// T-G1, T-G2, T-G3 (ADR-0063 §6; p7-work-split §G.4): the secret scan's self-test, the real payload and history, and
// the environment template. Every planted key, secret and canary is assembled at run time from fragments (§2 rule 6),
// so this file holds no whole planted value and the repository scans stay clean without an entry for it. Fixtures are
// written under $TMPDIR and removed.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { entropy, isI18nKey, isNonSecretValue, scanContent, scanSecrets } from "../secret-scan.mjs";
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

  it("its own masked output in a committed log is not a hit again, but a real credential URL beside it still is (T-DG7-DO-J2)", () => {
    const log = [
      "S2 packages/x.test.ts:104: const u = \"postgres://mth_owner:[S2:x…]@127.0.0.1:1/none\"; (value sha256 2d711642b726)",
      "S2 docs/x.log:5: S2 y.ts:1: postgres://mth_owner:[S2:[S2:…]@127.0.0.1:1/none (value sha256 f81eacd8098d)",
      "S2 config/db.yaml:1: url: postgres://mth_app:[S2:Hunt…]@db.internal (value sha256 0123456789ab)",
    ].join("\n");
    assert.deepEqual(scanContent("docs/delivery/x/secret-scan.log", Buffer.from(log)), []);
    const real = Buffer.from(`${log}\nurl: postgres://mth_app:${PLANT.S2}@db.internal:5432/mth\n`);
    assert.deepEqual(
      scanContent("docs/delivery/x/secret-scan.log", real).map((h) => [h.rule, h.line]),
      [["S2", 4]],
    );
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

// F-DG7-1011: the S3 "i18n key" exception used to exempt every lower-case alphanumeric value, so the shapes this
// project's own tooling generates (`openssl rand -hex`, deploy/scripts/init-secrets.sh) were never reported. The
// generated values are derived at run time from a hash (deterministic, never stored whole in the repository).
const LOWER_ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
const derivedHex = (seed, n) => createHash("sha512").update(seed).digest("hex").slice(0, n);
const derivedLower = (seed, n) =>
  [...createHash("sha512").update(seed).digest()].slice(0, n).map((b) => LOWER_ALNUM[b % 36]).join("");
const GENERATED = {
  hex48: derivedHex("F-DG7-1011 postgres", 48), // openssl rand -hex 24
  hex32: derivedHex("F-DG7-1011 s3", 32), // openssl rand -hex 16
  lower24: derivedLower("F-DG7-1011 oidc", 24), // 24 random lower-case alphanumerics
};
const mixedCase = (v) => v.replace(/[a-f]/g, (c, i) => (i % 2 ? c.toUpperCase() : c));

/** Every key path of the real web dictionaries (en and ar), e.g. `auth.password.reset_hint_text`. */
function realI18nKeys() {
  const keys = new Set();
  const walk = (o, p) => {
    for (const [k, v] of Object.entries(o)) {
      const q = `${p}.${k}`;
      if (v && typeof v === "object") walk(v, q);
      else keys.add(q);
    }
  };
  for (const lang of ["en", "ar"]) {
    const d = join(REPO, "apps", "web", "src", "i18n", lang);
    for (const f of readdirSync(d).filter((x) => x.endsWith(".json")))
      walk(JSON.parse(readFileSync(join(d, f), "utf8")), f.replace(/\.json$/, ""));
  }
  return [...keys];
}

describe("F-DG7-1011 S3: a generated lower-case or hex secret is reported, a real i18n key is not", () => {
  it("the derived values are high-entropy secret shapes (ADR-0063 §1.2: >= 16 chars, >= 3.5 bits/char)", () => {
    for (const [name, v] of Object.entries(GENERATED)) {
      assert.ok(v.length >= 16, name);
      assert.ok(entropy(v) >= 3.5, `${name} entropy ${entropy(v)}`);
      assert.match(v, /^[a-z0-9]+$/, `${name} is all lower-case alphanumeric (the shape the old exemption covered)`);
    }
  });

  for (const [file, line, key] of [
    ["compose.override.yaml", (v) => `    POSTGRES_PASSWORD: ${v}`, "hex48"],
    ["values.yaml", (v) => `s3_access_key: ${v}`, "hex32"],
    ["deploy.conf", (v) => `OIDC_CLIENT_SECRET="${v}"`, "lower24"],
  ])
    it(`reports ${key} under a secret-named key in ${file} as S3 (exit 1, masked)`, () => {
      const d = tmp("secret-lower");
      cleanup.push(d);
      const value = GENERATED[key];
      writeFileSync(join(d, file), `${line(value)}\n`);
      assert.deepEqual(
        scanContent(file, readFileSync(join(d, file))).map((h) => [h.rule, h.line, h.value === value]),
        [["S3", 1, true]],
      );
      // the real default allow-list: its payload/history entries never apply to a --path scan
      const real = runNode([SCAN, "--path", join(d, file)], { cwd: d });
      assert.equal(real.code, 1, real.stdout + real.stderr);
      assert.match(real.stdout, /^S3 .*\[S3:[a-z0-9]{4}…\]/m);
      assert.match(real.stdout, /^secret-scan: FAIL \(1 hits?\)$/m);
      assert.ok(!real.stdout.includes(value), "the generated value is never printed whole");
    });

  it("the mixed-case control is reported as before", () => {
    const v = mixedCase(GENERATED.lower24);
    assert.equal(isNonSecretValue("OIDC_CLIENT_SECRET", v), false);
  });

  it("no random lower-case or hex string is an i18n key (500 samples per shape)", () => {
    for (let i = 0; i < 500; i++) {
      for (const v of [randomBytes(24).toString("hex"), randomBytes(16).toString("hex")])
        assert.equal(isI18nKey(v), false, "hex");
      const lower = [...randomBytes(24)].map((b) => LOWER_ALNUM[b % 36]).join("");
      assert.equal(isI18nKey(lower), false, "lower-case alphanumeric");
    }
  });

  it("every real i18n key of the web dictionaries (en, ar) stays exempt", () => {
    const keys = realI18nKeys().filter((k) => /^[a-z0-9_.]+$/.test(k) && k.length >= 16);
    assert.ok(keys.length > 1000, `found ${keys.length} lower-case keys`);
    const refused = keys.filter((k) => !isI18nKey(k) || !isNonSecretValue("password_hint", k));
    assert.deepEqual(refused, []);
    // in context: a secret-named key whose value is an i18n key is not a hit
    for (const k of ["auth.password.reset_hint_text", "capacity.problem.resource_role__archived", ...keys.slice(0, 50)])
      assert.deepEqual(scanContent("x.yaml", Buffer.from(`password_label: ${k}\n`)), [], k);
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
