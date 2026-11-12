// T-G1, T-G2, T-G3 (ADR-0063 §6; p7-work-split §G.4): the secret scan's self-test, the real payload and history, and
// the environment template. Every planted key, secret and canary is assembled at run time from fragments (§2 rule 6),
// so this file holds no whole planted value and the repository scans stay clean without an entry for it. Fixtures are
// written under $TMPDIR and removed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { scanContent, scanSecrets } from "../secret-scan.mjs";
import { FIXTURES, REPO, runNode, tmp } from "./helpers.mjs";

const SCAN = join(REPO, "tools", "release", "secret-scan.mjs");
const SECRET_FIXTURES = join(FIXTURES, "secrets");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const cleanup = [];
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

// Planted values (fragments joined at run time; none of them is a credential).
const PLANT = {
  S1: ["AK", "IA", "QZ7X", "N4M2", "P8R6", "T3W5"].join(""),
  S2: ["Hu", "nter", "2Pass", "Word"].join(""),
  S3: ["Zk8p", "Q2mN", "7vR4", "xL9s", "T1wY", "6bC3"].join(""),
  S4: ["mth", "canary", "planted", "value"].join("-"),
  S5: ["NODE_ENV", "production"].join("="),
};

/** A tree with one planted hit per rule S1-S6, the non-match fixture and a canary in a test path. */
function plantedTree() {
  const dir = tmp("secret-plant");
  cleanup.push(dir);
  const put = (p, text) => {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  };
  put("notes/aws.txt", `access key id ${PLANT.S1} in a note\n`);
  put("config/db.yaml", `url: postgres://mth_app:${PLANT.S2}@db.internal:5432/mth\n`);
  put("config/app.conf", `SMTP_PASSWORD=${PLANT.S3}\n`);
  put("src/app.js", `const marker = "${PLANT.S4}";\n`);
  put(".env.example", `# template\n${PLANT.S5}\n`);
  put("keys/server.pem", "not a real key, the file name is the finding\n");
  put("tests/fake.test.js", `const c = "${PLANT.S4}";\n`);
  copyFileSync(join(SECRET_FIXTURES, "non-matches.txt"), join(dir, "notes", "non-matches.txt"));
  return dir;
}

describe("T-G1 secret-scan self-test (S1-S6, non-matches, allow-list, masking)", () => {
  const dir = plantedTree();

  it("reports one planted hit per rule S1-S6, each with its rule", async () => {
    const r = await scanSecrets({ scope: "path", repo: dir, paths: [dir], allowlist: null });
    const got = r.hits.map((h) => `${h.rule} ${h.path}`).sort();
    assert.deepEqual(got, [
      "S1 notes/aws.txt",
      "S2 config/db.yaml",
      "S3 config/app.conf",
      "S4 src/app.js",
      "S5 .env.example",
      "S6 keys/server.pem",
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.canaries, 1, "the canary in tests/ is counted as documented, never as a hit or a silent pass");
    for (const [rule, value] of Object.entries(PLANT))
      assert.equal(r.hits.find((h) => h.rule === rule).valueSha256, sha(value), `${rule} fingerprints the value`);
  });

  it("does not report the placeholders and non-secrets of ADR-0063 §1.2", () => {
    const text = readFileSync(join(SECRET_FIXTURES, "non-matches.txt"));
    assert.deepEqual(scanContent("notes/non-matches.txt", text), []);
    // code: an unquoted value is an expression; a namespaced identifier and a key NAME are not secrets
    const code = Buffer.from(
      [
        "const token = request.headers.authorization;",
        'const RESTRICTED_TOKEN_TAG_DOMAIN = "mth.automation.restricted-token.v1";',
        'const secretKeyName = "MTH_S3_SECRET_ACCESS_KEY_NAME";',
        "secretary_user_id: body.secretary_user_id ?? null,",
      ].join("\n"),
    );
    assert.deepEqual(scanContent("src/x.ts", code), []);
  });

  it("prints the exact messages and never a planted value whole (masking)", () => {
    // the default (real) allow-list: its payload/history entries never apply to a --path scan
    const r = runNode([SCAN, "--path", dir], { cwd: dir });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    for (const value of Object.values(PLANT)) assert.ok(!r.stdout.includes(value), "a planted value printed whole");
    assert.match(r.stdout, /^S1 notes\/aws\.txt:1: access key id \[S1:AKIA…\] in a note \(value sha256 [0-9a-f]{12}\)$/m);
    assert.match(r.stdout, /^S2 config\/db\.yaml:1: url: postgres:\/\/mth_app:\[S2:Hunt…\]@db\.internal/m);
    assert.match(r.stdout, /^S6 keys\/server\.pem:0: \[S6:secret-file\]/m);
    assert.match(r.stdout, /^secret-scan: FAIL \(6 hits\)$/m);
  });

  it("an allow-list entry (rule, path glob, value hash) allows exactly its hit", async () => {
    const list = join(dir, "..", `${dir.split("/").pop()}-allow.json`);
    cleanup.push(list);
    writeFileSync(
      list,
      JSON.stringify({
        entries: [{ rule: "S1", path: "notes/*.txt", valueSha256: sha(PLANT.S1), reason: "T-G1 fixture", scopes: ["path"] }],
      }),
    );
    const r = await scanSecrets({ scope: "path", repo: dir, paths: [dir], allowlist: list });
    assert.equal(r.allowed, 1);
    assert.equal(r.hits.filter((h) => h.rule === "S1").length, 0);
    assert.equal(r.hits.length, 5);
  });

  it("a stale entry fails the scan with its message (exit 1)", () => {
    const clean = tmp("secret-clean");
    cleanup.push(clean);
    copyFileSync(join(SECRET_FIXTURES, "non-matches.txt"), join(clean, "non-matches.txt"));
    const list = join(clean, "allow.json");
    writeFileSync(
      list,
      JSON.stringify({
        entries: [{ rule: "S3", path: "non-matches.txt", valueSha256: sha("nothing"), reason: "T-G1 stale", scopes: ["path"] }],
      }),
    );
    const r = runNode([SCAN, "--path", join(clean, "non-matches.txt"), "--allowlist", list], { cwd: clean });
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /^secret-scan: stale allow-list entry 0 \(non-matches\.txt\)$/m);
  });

  for (const path of [
    ".env.example",
    "deploy/compose/**",
    "deploy/docker/Dockerfile",
    "deploy/keycloak/*.json",
    "docs/handover/**",
    "apps/api/src/server.ts",
    "packages/*/src/**",
    "**",
  ])
    it(`refuses an entry that can cover the protected path ${path} (exit 2)`, () => {
      const d = tmp("secret-protect");
      cleanup.push(d);
      writeFileSync(join(d, "a.txt"), "nothing\n");
      writeFileSync(
        join(d, "allow.json"),
        JSON.stringify({ entries: [{ rule: "S3", path, valueSha256: sha("x"), reason: "must be refused" }] }),
      );
      const r = runNode([SCAN, "--path", join(d, "a.txt"), "--allowlist", join(d, "allow.json")]);
      assert.equal(r.code, 2, r.stdout);
      assert.equal(r.stdout.trim(), `secret-scan: an allow-list entry cannot cover ${path}`);
    });

  it("accepts an entry for a test file under src/ (not protected)", async () => {
    const d = tmp("secret-testpath");
    cleanup.push(d);
    writeFileSync(join(d, "a.txt"), `k: ${PLANT.S1}\n`);
    writeFileSync(
      join(d, "allow.json"),
      JSON.stringify({
        entries: [
          { rule: "S1", path: "a.txt", valueSha256: sha(PLANT.S1), reason: "fixture", scopes: ["path"] },
          { rule: "S1", path: "apps/api/src/**/*.test.ts", valueSha256: sha(PLANT.S1), reason: "fixture", scopes: ["payload"] },
        ],
      }),
    );
    const r = await scanSecrets({ scope: "path", repo: d, paths: [join(d, "a.txt")], allowlist: join(d, "allow.json") });
    assert.equal(r.ok, true);
    assert.equal(r.allowed, 1);
  });

  it("is BLOCKED (exit 2) for a usage error and an unreadable list", () => {
    assert.equal(runNode([SCAN, "--bogus"]).code, 2);
    const d = tmp("secret-nogit");
    cleanup.push(d);
    const missing = runNode([SCAN, "--scope", "envelope", "--list", join(d, "absent.txt")]);
    assert.equal(missing.code, 2);
    assert.match(missing.stdout, /^secret-scan: BLOCKED: cannot read list /m);
  });

  it("history scope outside a git repository is BLOCKED through the module API", async () => {
    const d = tmp("secret-nogit-api");
    cleanup.push(d);
    await assert.rejects(
      scanSecrets({ scope: "history", repo: d, allowlist: null }),
      /secret-scan: BLOCKED: --scope history needs a git repository/,
    );
  });

  it("envelope scope reads exactly the listed files", async () => {
    const d = plantedTree();
    writeFileSync(join(d, "list.txt"), "notes/aws.txt\nnotes/non-matches.txt\n");
    const r = await scanSecrets({ scope: "envelope", repo: d, list: join(d, "list.txt"), allowlist: null });
    assert.equal(r.files, 2);
    assert.deepEqual(r.hits.map((h) => h.rule), ["S1"]);
  });
});

describe("T-G2 the real repository: payload and history are clean (REQ-S16-031)", () => {
  it("--scope payload exits 0", () => {
    const r = runNode([SCAN], { cwd: REPO });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^secret-scan: PASS \(payload; \d+ files; allowed \d+; canary \(documented\) \d+\)$/m);
  });

  it("--scope history exits 0 (every blob reachable from HEAD)", { timeout: 900_000 }, () => {
    const r = runNode([SCAN, "--scope", "history"], { cwd: REPO, maxBuffer: 1 << 26 });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^secret-scan: PASS \(history; \d+ files; allowed \d+; canary \(documented\) \d+\)$/m);
  });
});

describe("T-G3 the environment template contains placeholders only (S5)", () => {
  it("the real .env.example passes", () => {
    const hits = scanContent(".env.example", readFileSync(join(REPO, ".env.example")));
    assert.deepEqual(hits, []);
  });

  it("the placeholder-only fixture passes", () => {
    assert.deepEqual(scanContent(".env.example", readFileSync(join(SECRET_FIXTURES, "env-template-ok.env"))), []);
  });

  for (const [label, line] of [
    ["a value", ["NODE_ENV", "production"].join("=")],
    ["a quoted empty value", ["X", '""'].join("=")],
    ["a lower-case name", ["node_env", ""].join("=")],
  ])
    it(`${label} fails S5`, () => {
      const hits = scanContent(".env.example", Buffer.from(`# template\n${line}\n`));
      assert.deepEqual(
        hits.map((h) => [h.rule, h.line]),
        [["S5", 2]],
      );
    });
});
