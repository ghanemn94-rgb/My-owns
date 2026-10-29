// Self-test of deploy/scripts/log-scan.mjs (ADR-0053 §5; REQ-S16-029; T-DG6-DO-D).
//   node --test deploy/scripts/tests/log-scan.test.mjs
// The negative fixture is built at run time (one log line per pattern class) and written under $TMPDIR, so no
// key-shaped string is committed to the repository; every value is SYNTHETIC. The scan must FAIL on each line (exit 1,
// the match masked in its report), PASS on a clean run (exit 0) and be BLOCKED (exit 2, never a pass) without input,
// on a docs/delivery path, or with --require-canaries and no canary.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { FIXED_PATTERNS } from "../log-scan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(root, "deploy", "scripts", "log-scan.mjs");
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "log-scan-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const CANARY = `mth-canary-db-password-${"z".repeat(10)}`;
const STORE_HOST = "objects.example.internal";
const STORAGE_PATH = "/var/lib/mth/evidence-synthetic";

/** The negative fixture: [class, line]. Built from pieces so the repository holds no key-shaped literal. */
const NEGATIVE = [
  ["private-key", `{"msg":"${"-----BEGIN"} RSA PRIVATE ${"KEY-----"}"}`],
  ["aws-access-key-id", `{"msg":"key id ${"AK" + "IA"}${"Q".repeat(16)}"}`],
  ["x-amz-signature", `{"url":"https://s3.example/b/k?${"X-Amz-" + "Signature"}=abc"}`],
  ["x-amz-credential", `{"url":"https://s3.example/b/k?${"X-Amz-" + "Credential"}=abc"}`],
  ["bearer-token", `{"msg":"Authorization: Bearer ${"t".repeat(24)}"}`],
  ["jwt", `{"msg":"${"ey" + "J"}${"a".repeat(12)}.${"ey" + "J"}${"b".repeat(12)}.sig"}`],
  ["deep-link-token", `{"req":{"url":"/api/v1/links/${"L".repeat(43)}"}}`],
  ["canary-secret", `{"msg":"connect with ${CANARY}"}`],
  ["object-store-host", `{"msg":"PUT https://${STORE_HOST}/mth-evidence/ab failed"}`],
  ["evidence-storage-path", `{"msg":"open ${STORAGE_PATH}/ab/cd.bin"}`],
];

const CLEAN = [
  '{"level":30,"msg":"incoming request","req":{"method":"GET","url":"/api/v1/links/[token]"}}',
  '{"level":30,"msg":"callback","req":{"url":"/auth/callback?code=[redacted]&state=[redacted]"}}',
  '{"level":50,"msg":"smtp login refused for [secret]","file":"[storage-path]","url":"[storage-url]"}',
  '{"level":30,"msg":"Bearer [secret]","bucket":"[redacted]"}',
];

function scan(args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const write = (name, lines) => {
  const file = join(dir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
};
const config = ["--store-host", STORE_HOST, "--storage-path", STORAGE_PATH];

test("the fixture covers every fixed pattern class plus the canary, store-host and storage-path classes", () => {
  const classes = new Set(NEGATIVE.map(([c]) => c));
  for (const [name] of FIXED_PATTERNS) assert.ok(classes.has(name), `fixture misses ${name}`);
  assert.equal(classes.size, FIXED_PATTERNS.length + 3);
});

for (const [cls, line] of NEGATIVE) {
  test(`FAIL on a line with the ${cls} class (exit 1, file and line reported, the match masked)`, () => {
    const file = write(`neg-${cls}.log`, [CLEAN[0], line]);
    const r = scan([...config, file], { MTH_TEST_DB_PASSWORD: CANARY });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, new RegExp(`neg-${cls}\\.log:2: [a-z,-]*${cls}`));
    assert.match(r.out, new RegExp(`«masked:${cls}»`));
    assert.match(r.out, /log-scan: FAIL: 1 line\(s\) matched/);
    assert.ok(!r.out.includes(CANARY), "the canary value itself is never printed");
    assert.ok(!r.out.includes("Q".repeat(16)) && !r.out.includes("L".repeat(43)), "a matched value is never printed");
  });
}

test("FAIL on the whole fixture: every line is reported", () => {
  const file = write(
    "negative-fixture.log",
    NEGATIVE.map(([, l]) => l),
  );
  const r = scan(["--require-canaries", ...config, file], { MTH_TEST_DB_PASSWORD: CANARY });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, new RegExp(`log-scan: FAIL: ${NEGATIVE.length} line\\(s\\) matched`));
});

test("PASS on a clean run (redacted lines only), scanning a directory recursively", () => {
  write("clean/api-1.log", CLEAN);
  write("clean/nested/worker.log", CLEAN);
  const r = scan(["--require-canaries", ...config, join(dir, "clean")], { MTH_TEST_DB_PASSWORD: CANARY });
  assert.equal(r.status, 0, r.out);
  assert.match(
    r.out,
    /log-scan: PASS: 2 file\(s\), 8 line\(s\), 1 canary value\(s\), 7 fixed pattern\(s\), 1 store host\(s\), 1 storage path\(s\)/,
  );
});

test("canaries come from every mth-canary-* environment value; store hosts from MTH_LOG_SCAN_STORE_HOSTS", () => {
  const file = write("env.log", [`{"msg":"x mth-canary-smtp-1234 y"}`, `{"msg":"GET http://minio.example:9000/x"}`]);
  const r = scan([file], { SMTP_PASSWORD: "mth-canary-smtp-1234", MTH_LOG_SCAN_STORE_HOSTS: "minio.example:9000" });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /env\.log:1: canary-secret/);
  assert.match(r.out, /env\.log:2: object-store-host/);
});

test("BLOCKED (exit 2, never a pass): no input, an empty directory, a docs/delivery path, no canary when required", () => {
  assert.equal(scan([]).status, 2);
  mkdirSync(join(dir, "empty"), { recursive: true });
  const empty = scan([join(dir, "empty")]);
  assert.equal(empty.status, 2, empty.out);
  assert.match(empty.out, /no log file found/);
  const delivery = scan([join(root, "docs", "delivery")]);
  assert.equal(delivery.status, 2, delivery.out);
  assert.match(delivery.out, /D-138/);
  assert.equal(scan([join(root, "docs")]).status, 2, "a directory containing docs/delivery is refused too");
  const noCanary = scan(["--require-canaries", write("x.log", CLEAN)]);
  assert.equal(noCanary.status, 2, noCanary.out);
  assert.match(noCanary.out, /--require-canaries/);
  assert.equal(scan(["--bogus", "x"]).status, 2);
});
