// qa-verifier (T-DG7-QA-E): the A18 transfer drill harness reports BLOCKED (skipped, never passed) when its inputs are
// absent, and fails hard when they are present but incomplete or wrong (CLAUDE.md: a missing input makes a check
// BLOCKED; p7-work-split §2 rule 4). Two layers:
//  1. classifyA18Inputs (tests/qa/support/a18-inputs.ts) on synthetic environments, with no files.
//  2. The harness file itself, run in a child Vitest process with `-t "A18 transfer drill"` (only the part-2 blocks,
//     which need no database; tests/qa/support/a18-harness.vitest.config.ts), with the inputs absent, incomplete, and
//     present but wrong (a well-formed checksum of a file that is not an archive: the real drill runs and rejects it
//     at D0). The JSON report's per-test status is asserted, not only the exit code.
// All values are SYNTHETIC. Nothing here runs a real transfer or touches DG0–DG7 records.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { A18_INPUT_KEYS, classifyA18Inputs, type PathKind } from "../support/a18-inputs.ts";

const HEX = "ab".repeat(32);
const ARCHIVE = "/synthetic/mth-transformation-hub.tar.gz";
const STORE = "/synthetic/store";
const disk: PathKind = (p) => (p === ARCHIVE ? "file" : p === STORE ? "directory" : "missing");
const full = { QA_A18_ARCHIVE: ARCHIVE, QA_A18_ARCHIVE_SHA256: HEX, QA_A18_STORE: STORE };

describe("classifyA18Inputs: absent = BLOCKED, incomplete or wrong = invalid, complete = ready", () => {
  it("none set: absent, with a BLOCKED reason naming all three inputs and saying it is not a pass", () => {
    for (const env of [{}, { QA_A18_ARCHIVE: "", QA_A18_ARCHIVE_SHA256: "  ", QA_A18_STORE: "" }]) {
      const s = classifyA18Inputs(env, disk);
      expect(s.kind).toBe("absent");
      if (s.kind !== "absent") continue;
      expect(s.reason).toMatch(/^BLOCKED: /);
      for (const k of A18_INPUT_KEYS) expect(s.reason).toContain(k);
      expect(s.reason).toContain("not passed");
    }
  });

  it("QA_A18_REQUIRE=1 without inputs: invalid (a gate run that demands the drill fails, never skips)", () => {
    const s = classifyA18Inputs({ QA_A18_REQUIRE: "1" }, disk);
    expect(s.kind).toBe("invalid");
    if (s.kind === "invalid") expect(s.message).toContain("QA_A18_REQUIRE=1");
  });

  it("partly set: invalid, naming each unset input", () => {
    const s = classifyA18Inputs({ QA_A18_ARCHIVE: ARCHIVE }, disk);
    expect(s.kind).toBe("invalid");
    if (s.kind !== "invalid") return;
    expect(s.message).toContain("QA_A18_ARCHIVE_SHA256, QA_A18_STORE not set");
    expect(s.message).not.toMatch(/^BLOCKED/);
  });

  it.each([
    [
      "the archive does not exist",
      { QA_A18_ARCHIVE: "/synthetic/none.tar.gz" },
      /QA_A18_ARCHIVE is not an existing file/,
    ],
    ["the archive is a directory", { QA_A18_ARCHIVE: STORE }, /QA_A18_ARCHIVE is not an existing file.*directory/],
    ["the checksum is short", { QA_A18_ARCHIVE_SHA256: "ab".repeat(31) }, /not 64 lowercase hex/],
    ["the checksum is upper case", { QA_A18_ARCHIVE_SHA256: HEX.toUpperCase() }, /not 64 lowercase hex/],
    ["the store does not exist", { QA_A18_STORE: "/synthetic/none" }, /QA_A18_STORE is not an existing directory/],
    ["the store is a file", { QA_A18_STORE: ARCHIVE }, /QA_A18_STORE is not an existing directory.*file/],
  ])("all set but %s: invalid", (_name, override, problem) => {
    const s = classifyA18Inputs({ ...full, ...override }, disk);
    expect(s.kind).toBe("invalid");
    if (s.kind === "invalid") expect(s.message).toMatch(problem);
  });

  it("all set and well formed: ready with the trimmed values (QA-C's invocation)", () => {
    expect(classifyA18Inputs({ ...full, QA_A18_STORE: ` ${STORE} ` }, disk)).toEqual({
      kind: "ready",
      inputs: { archive: ARCHIVE, archiveSha256: HEX, store: STORE },
    });
  });
});

// ------------------------------------------------------------------- the harness file in a child Vitest process

const REPO = resolve(import.meta.dirname, "..", "..", "..");
const CONFIG = "tests/qa/support/a18-harness.vitest.config.ts";

interface Outcome {
  exit: number | null;
  output: string;
  tests: { title: string; status: string; failure: string }[];
}

/** Runs the harness's drill blocks with exactly `inputs` as the A18 environment (the outer run's values are removed). */
function runHarness(work: string, name: string, inputs: Record<string, string>): Promise<Outcome> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !k.startsWith("QA_A18_") && !k.startsWith("VITEST")) env[k] = v;
  Object.assign(env, inputs, { TMPDIR: work });
  const report = join(work, `${name}.json`);
  const args = [
    join(REPO, "node_modules/vitest/vitest.mjs"),
    "run",
    // The runner loader writes no bundled config into node_modules/.vite-temp (read-only in the agent sandboxes).
    "--configLoader",
    "runner",
    "--config",
    CONFIG,
    "-t",
    "A18 transfer drill",
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${report}`,
  ];
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: string[] = [];
    child.stdout.setEncoding("utf8").on("data", (c: string) => chunks.push(c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => chunks.push(c));
    child.on("close", (exit) => {
      let tests: Outcome["tests"] = [];
      try {
        const j = JSON.parse(readFileSync(report, "utf8")) as {
          testResults: { assertionResults: { title: string; status: string; failureMessages: string[] }[] }[];
        };
        tests = j.testResults.flatMap((f) =>
          f.assertionResults.map((a) => ({ title: a.title, status: a.status, failure: a.failureMessages.join("\n") })),
        );
      } catch {
        // No report: the assertions below fail and print the output.
      }
      done({ exit, output: chunks.join(""), tests });
    });
  });
}

const DRILL_TESTS = 6;
const isDrillTest = (t: { title: string }): boolean =>
  /^(the drill exits|the report:|D3:|D5\/D9:|D10:|the drill log)/.test(t.title);

describe("the A18 harness file: absent inputs skip with BLOCKED, wrong inputs fail (child Vitest run)", () => {
  let work: string;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "qa-a18-harness-"));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it("absent: exit 0, the six drill tests skipped, a skipped BLOCKED test names the inputs, nothing failed", async () => {
    const r = await runHarness(work, "absent", {});
    const why = r.output.slice(-3000);
    expect(r.exit, why).toBe(0);
    const drill = r.tests.filter(isDrillTest);
    expect(drill.length, why).toBe(DRILL_TESTS);
    for (const t of drill) expect(t.status, t.title).toBe("skipped");
    const blocked = r.tests.filter((t) => t.title.startsWith("BLOCKED: A18 transfer drill not run: input missing:"));
    expect(blocked, why).toHaveLength(1);
    expect(blocked[0]!.status).toBe("skipped");
    for (const k of A18_INPUT_KEYS) expect(blocked[0]!.title).toContain(k);
    expect(r.output).toContain("BLOCKED: A18 transfer drill not run");
    expect(r.tests.filter((t) => t.status === "failed")).toEqual([]);
    // The only passing test is the drill-files check; no drill assertion is reported as passed.
    expect(r.tests.filter((t) => t.status === "passed").map((t) => t.title)).toEqual([
      "DO-D's drill files and DOC-B's deployment guide are present (checked whatever the inputs)",
    ]);
  }, 120_000);

  it("incomplete (only the archive set): exit 1, the input check and all six drill tests fail naming the inputs", async () => {
    const archive = join(work, "only.tar.gz");
    writeFileSync(archive, "synthetic");
    const r = await runHarness(work, "partial", { QA_A18_ARCHIVE: archive });
    const why = r.output.slice(-3000);
    expect(r.exit, why).toBe(1);
    const failed = r.tests.filter((t) => t.status === "failed");
    expect(failed.length, why).toBe(DRILL_TESTS + 1);
    for (const t of failed) expect(t.failure, t.title).toContain("QA_A18_ARCHIVE_SHA256, QA_A18_STORE not set");
    expect(r.tests.some((t) => t.title.startsWith("BLOCKED:"))).toBe(false);
  }, 120_000);

  it("present but wrong (not an archive): the drill runs, rejects it and the drill tests fail; exit 1", async () => {
    const archive = join(work, "fake.tar.gz");
    const store = join(work, "store");
    writeFileSync(archive, "synthetic, not a gzip tar");
    mkdirSync(store, { recursive: true });
    const r = await runHarness(work, "wrong", {
      QA_A18_ARCHIVE: archive,
      QA_A18_ARCHIVE_SHA256: "0".repeat(64),
      QA_A18_STORE: store,
    });
    const why = r.output.slice(-3000);
    expect(r.exit, why).toBe(1);
    const exits = r.tests.find((t) => t.title.startsWith("the drill exits"));
    expect(exits?.status, why).toBe("failed");
    // The drill itself ran (D0 rejects the archive), so this is a product-path failure, not a skipped input.
    expect(exits?.failure).toMatch(/step D0|BLOCKED \(exit 3\)/);
    const report = r.tests.find((t) => t.title.startsWith("the report:"));
    expect(report?.status).toBe("failed");
    expect(r.tests.some((t) => t.title.startsWith("BLOCKED:"))).toBe(false);
  }, 180_000);
});
