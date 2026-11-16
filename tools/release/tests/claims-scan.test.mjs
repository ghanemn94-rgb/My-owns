// T-G4, T-G5, T-G6 (ADR-0063 §6; p7-work-split §G.4): the claims scan's self-test in en and ar, K1 parity with the
// DG5 rule, and the real docs and UI strings. Planted claims are assembled at run time from fragments (§2 rule 6).
// Fixture repositories are written under $TMPDIR and removed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";
import { classify, k1Verdict, loadPmiRule, scanClaims } from "../claims-scan.mjs";
import { FIXTURES, REPO, runNode, tmp } from "./helpers.mjs";

const SCAN = join(REPO, "tools", "release", "claims-scan.mjs");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const cleanup = [];
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));
const j = (...parts) => parts.join(" ");

/** One claim per rule, en and ar (fragments joined at run time). */
const CLAIMS = {
  K1: [j("The hub is an", "official PMI", "standard."), j("منهجية", "معتمدة من", "PMI")],
  K2: [j("The hub is fully", "compliant", "with the corporate security policy."), j("النظام", "ممتثل", "لمعايير الأمن.")],
  K3: [j("The platform", "meets", "ISO 27001."), j("المنصة", "تلبي", "متطلبات", "PDPL")],
  K4: [j("A", "certified", "platform for transformation."), j("منصة", "معتمدة", "للتحول")],
};

/** A git repository (untracked files are listed by the scan) with the given files. */
function repoWith(files) {
  const dir = tmp("claims-repo");
  cleanup.push(dir);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  execFileSync("git", ["init", "-q", dir]);
  return dir;
}

describe("T-G4 claims-scan self-test (K1-K4 en and ar, negation, non-claims, allow-list)", async () => {
  const pmi = await loadPmiRule();

  for (const [rule, [en, ar]] of Object.entries(CLAIMS)) {
    it(`${rule} catches the en claim`, () => assert.ok(classify(en, pmi).hits.includes(rule), en));
    it(`${rule} catches the ar claim`, () => assert.ok(classify(ar, pmi).hits.includes(rule), ar));
  }

  it("reports a planted claim in a doc and in a UI catalogue with rule, path and line", async () => {
    const dir = repoWith({
      "docs/operations/guide.md": `# Guide\n\nIntro line.\n\n${CLAIMS.K3[0]}\n`,
      "apps/web/src/i18n/en/x.json": JSON.stringify({ a: { b: CLAIMS.K4[0] } }, null, 2),
      "apps/web/src/i18n/ar/x.json": JSON.stringify({ a: CLAIMS.K2[1] }, null, 2),
      "apps/api/src/m.ts": `// ${CLAIMS.K1[0]} (a comment is not UI)\nexport const t = "${CLAIMS.K1[0]}";\n`,
      "apps/api/src/m.test.ts": `export const t = "${CLAIMS.K1[0]}"; // tests are out of scope\n`,
      "packages/db/migrations/0001_x.sql": `-- ${CLAIMS.K4[0]}\nINSERT INTO t VALUES ('${CLAIMS.K4[1]}');\nRAISE EXCEPTION '${CLAIMS.K4[0]}';\n`,
    });
    const r = await scanClaims({ repo: dir, allowlist: null });
    const got = r.hits.map((h) => `${h.rule} ${h.path}:${h.line}`).sort();
    assert.deepEqual(got, [
      "K1 apps/api/src/m.ts:2",
      "K2 apps/web/src/i18n/ar/x.json:2",
      "K2 apps/web/src/i18n/en/x.json:3", // "certified … for": K2 as well as K4
      "K3 docs/operations/guide.md:5",
      "K4 apps/web/src/i18n/en/x.json:3",
      "K4 packages/db/migrations/0001_x.sql:2",
    ]);
    assert.deepEqual(r.counts, { D: 1, U: 4 });
  });

  it("passes the negated twins, the non-claims of Context 4 and the M0332 sentence (fixture)", async () => {
    const dir = repoWith({});
    mkdirSync(join(dir, "docs", "architecture"), { recursive: true });
    copyFileSync(join(FIXTURES, "claims", "non-claims.md"), join(dir, "docs", "architecture", "non-claims.md"));
    const r = await scanClaims({ repo: dir, allowlist: null });
    assert.deepEqual(r.hits, []);
    // "not certified by PMI …" and "Do not claim compliance with …" are negated K2 hits; the others are no hit at all
    assert.equal(r.negated.length, 2);
  });

  it("negates a claim only within 6 words after the negation", () => {
    assert.deepEqual(classify(j("This product is not", "certified by", "any body."), pmi).hits, []);
    const far = j("No", "one two three four five six seven", "certified by", "the auditors.");
    assert.ok(classify(far, pmi).hits.includes("K2"));
  });

  it("the M0332 sentence quoted in the register passes", async () => {
    const m0332 = "Do not claim compliance with an organizational or regulatory standard based solely on these controls.";
    assert.deepEqual(classify(m0332, pmi).hits, []);
  });

  for (const [path, why] of [
    ["docs/handover/security-controls.md", "handover"],
    ["apps/web/src/i18n/en/common.json", "group U"],
    ["apps/api/src/modules/admin/branding.ts", "group U"],
    ["packages/db/migrations/0047_p4_adoption.sql", "group U"],
  ])
    it(`refuses an allow-list entry for ${path} (${why}; exit 2)`, () => {
      const d = tmp("claims-refuse");
      cleanup.push(d);
      writeFileSync(
        join(d, "allow.json"),
        JSON.stringify({ entries: [{ rule: "K2", path, lineSha256: sha("x"), reason: "must be refused" }] }),
      );
      const r = runNode([SCAN, "--allowlist", join(d, "allow.json")], { cwd: REPO });
      assert.equal(r.code, 2, r.stdout);
      assert.equal(r.stdout.trim(), `claims-scan: an allow-list entry cannot cover ${path}`);
    });

  it("an allow-list entry allows exactly its sentence, and a stale entry fails", async () => {
    const dir = repoWith({ "docs/architecture/q.md": `${CLAIMS.K2[0]}\n` });
    const list = join(dir, "allow.json");
    writeFileSync(
      list,
      JSON.stringify({
        entries: [{ rule: "K2", path: "docs/architecture/q.md", lineSha256: sha(CLAIMS.K2[0]), reason: "quoted requirement" }],
      }),
    );
    const ok = await scanClaims({ repo: dir, allowlist: list });
    assert.equal(ok.ok, true);
    assert.equal(ok.allowed, 1);
    writeFileSync(
      list,
      JSON.stringify({
        entries: [
          { rule: "K2", path: "docs/architecture/q.md", lineSha256: sha(CLAIMS.K2[0]), reason: "quoted requirement" },
          { rule: "K3", path: "docs/architecture/q.md", lineSha256: sha("gone"), reason: "stale" },
        ],
      }),
    );
    const stale = await scanClaims({ repo: dir, allowlist: list });
    assert.equal(stale.ok, false);
    assert.deepEqual(stale.stale, [{ n: 1, path: "docs/architecture/q.md" }]);
  });

  it("prints the exact messages, --show-negated lists the negated sentences, and a usage error is BLOCKED", () => {
    const dir = tmp("claims-root");
    cleanup.push(dir);
    writeFileSync(join(dir, "a.md"), `${CLAIMS.K3[0]}\n\nThis product is not certified by any body.\n`);
    // the default (real) allow-list: none of its entries names a file under this root, so none is stale here
    const r = runNode([SCAN, "--root", dir, "--show-negated"], { cwd: dir });
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /^K3 a\.md:1: The platform meets ISO 27001\.$/m);
    assert.match(r.stdout, /^negated K2 a\.md:3: This product is not certified by any body\.$/m);
    assert.match(r.stdout, /^claims-scan: FAIL \(1 hits\)$/m);
    assert.equal(runNode([SCAN, "--bogus"]).code, 2);
    const missing = runNode([SCAN, "--allowlist", join(dir, "absent.json")]);
    assert.equal(missing.code, 2);
    assert.match(missing.stdout, /^claims-scan: BLOCKED: allow-list not found: /m);
  });

  it("with --root, a repository entry matches the archive copy of its file by path suffix", async () => {
    const root = tmp("claims-archive");
    cleanup.push(root);
    mkdirSync(join(root, "docs", "docs", "architecture"), { recursive: true });
    writeFileSync(join(root, "docs", "docs", "architecture", "q.md"), `${CLAIMS.K2[0]}\n`);
    const list = join(root, "allow.json");
    writeFileSync(
      list,
      JSON.stringify({
        entries: [
          { rule: "K2", path: "docs/architecture/q.md", lineSha256: sha(CLAIMS.K2[0]), reason: "quoted requirement" },
          { rule: "K2", path: "docs/architecture/other.md", lineSha256: sha("x"), reason: "file not in this root" },
        ],
      }),
    );
    const r = await scanClaims({ roots: [join(root, "docs")], allowlist: list });
    assert.equal(r.ok, true, JSON.stringify(r.stale));
    assert.equal(r.allowed, 1);
  });
});

describe("T-G5 K1 agrees with claimsOfficialPmi on every CLAIM_CORPUS sample", async () => {
  const { CLAIM_CORPUS } = await import(pathToFileURL(join(REPO, "packages/shared/src/text-scan/corpus.ts")).href);
  const pmi = await loadPmiRule();
  it(`covers the whole corpus (${CLAIM_CORPUS.length} samples)`, () => assert.ok(CLAIM_CORPUS.length >= 40));
  CLAIM_CORPUS.forEach((s, n) =>
    it(`sample ${n}: ${JSON.stringify(s.text)?.slice(0, 60)}`, async () => {
      assert.equal(await k1Verdict(s.text), pmi.claimsOfficialPmi(s.text));
      assert.equal(await k1Verdict(s.text), s.expected);
    }),
  );
});

describe("T-G6 the real docs and UI strings are clean (REQ-S16-033)", () => {
  it("claims-scan.mjs exits 0 over the repository, ADR-0062, ADR-0063 and p7-work-split.md included", async () => {
    const r = runNode([SCAN], { cwd: REPO });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^claims-scan: PASS \(\d+ files; D \d+, U \d+; negated \d+; allowed \d+\)$/m);
    const res = await scanClaims();
    for (const f of [
      "docs/architecture/adr/ADR-0062-p7-source-archive-reproducible-offline-build.md",
      "docs/architecture/adr/ADR-0063-p7-secret-hygiene-claims-scan-security-controls-evidence.md",
      "docs/architecture/p7-work-split.md",
    ])
      assert.ok(!res.hits.some((h) => h.path === f), f);
  });
});
