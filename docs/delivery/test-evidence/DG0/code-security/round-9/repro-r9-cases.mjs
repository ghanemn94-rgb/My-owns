// code-security-reviewer, DG0 round 9: adversarial cases for the F-DG0-223 change
// (tools/gates/lib/rules.mjs:313, prompt regex `\S+` -> `.+?`).
// This file is APPENDED to lines 1-238 of tools/gates/tests/validator.test.mjs (the fixture harness, copied
// verbatim) by run-repro-r9.sh, in a disposable clone. It never runs inside the candidate tree.

function rewritePrompt(repo, role, records, fn) {
  const ref = get(repo, records[role]).invocation_reference;
  const base = `docs/delivery/runs/DG0/${ref.run_id}`;
  const lines = gunzipSync(readFileSync(join(repo, `${base}/transcript.jsonl.gz`))).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const p = lines.find((o) => o.isReplay);
  p.message.content = fn(p.message.content);
  const gz = gzipSync(Buffer.from(lines.map((o) => JSON.stringify(o)).join("\n") + "\n"));
  put(repo, `${base}/transcript.jsonl.gz`, gz);
  edit(repo, `${base}/meta.json`, (m) => (m.transcript_sha256 = sha(gz)));
  return get(repo, `${base}/meta.json`);
}
const ASSIGN_RE = /in the file (\S+) \(sha256 ([0-9a-f]{64})\)/;

test("R9-1 baseline: the unmodified fixture passes", () => {
  const { repo } = buildValidRepo();
  assert.deepEqual(validateGate(repo, "DG0"), []);
});

test("R9-2 decoy first: a wrong (path, sha) pair placed before the real one is what binds -> rejected", () => {
  const { repo, records } = buildValidRepo();
  rewritePrompt(repo, "qa-verifier", records, (c) => {
    const [, path, h] = c.match(ASSIGN_RE);
    return c.replace(ASSIGN_RE, `in the file /work/repo/docs/delivery/assignments/DG0/round-2/other.md (sha256 ${"a".repeat(64)}) and also ${path} (sha256 ${h})`);
  });
  expectError(validateGate(repo, "DG0"), /the replayed prompt names assignment .*other\.md/);
});

test("R9-3 lazy stop: a path that ends with the right suffix only after a fake '(sha256 ...)' is rejected", () => {
  const { repo, records } = buildValidRepo();
  rewritePrompt(repo, "qa-verifier", records, (c) => {
    const [, path, h] = c.match(ASSIGN_RE);
    return c.replace(ASSIGN_RE, `in the file /x (sha256 ${h}) ${path} (sha256 ${h})`);
  });
  expectError(validateGate(repo, "DG0"), /the replayed prompt names assignment \/x /);
});

test("R9-4 right path, wrong sha in the prompt is still rejected", () => {
  const { repo, records } = buildValidRepo();
  rewritePrompt(repo, "qa-verifier", records, (c) => c.replace(/\(sha256 [0-9a-f]{64}\)/, `(sha256 ${"b".repeat(64)})`));
  expectError(validateGate(repo, "DG0"), /the replayed prompt names assignment/);
});

test("R9-5 a path with parentheses and spaces (legitimate) binds", () => {
  const { repo, records } = buildValidRepo();
  rewritePrompt(repo, "qa-verifier", records, (c) => c.replace("in the file /work/repo/", "in the file /home/J Doe/copy (2)/repo/"));
  assert.deepEqual(validateGate(repo, "DG0"), []);
});

test("R9-6 a newline inside the path does not match (fails closed)", () => {
  const { repo, records } = buildValidRepo();
  rewritePrompt(repo, "qa-verifier", records, (c) => c.replace("in the file /work/repo/", "in the file /work/re\npo/"));
  expectError(validateGate(repo, "DG0"), /names no assignment file and sha256/);
});

test("R9-7 prefix-only suffix match: 'Xdocs/...' without the '/' boundary is rejected", () => {
  const { repo, records } = buildValidRepo();
  rewritePrompt(repo, "qa-verifier", records, (c) => c.replace("in the file /work/repo/docs/", "in the file /work/repodocs/"));
  // '/work/repodocs/...' still ends with '/docs/...'? No: meta.assignment starts with 'docs/', and the check is
  // endsWith('/' + meta.assignment), so '/work/repodocs/delivery/...' must NOT satisfy it.
  expectError(validateGate(repo, "DG0"), /the replayed prompt names assignment/);
});

test("R9-8 timing: a 200 KB forged prompt line with 2,000 prefix repetitions validates in bounded time", () => {
  const { repo, records } = buildValidRepo();
  rewritePrompt(repo, "qa-verifier", records, (c) => c + " " + "Your complete assignment is in the file ".repeat(2000) + "z".repeat(100000));
  const t0 = Date.now();
  const errs = validateGate(repo, "DG0");
  const ms = Date.now() - t0;
  console.log(`# R9-8 validateGate took ${ms} ms; errors=${errs.length}`);
  assert.ok(ms < 30000, `took ${ms} ms`);
});
