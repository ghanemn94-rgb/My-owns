// A18 "Independent deployment" (master prompt §20; qa-verifier T-DG7-QA-A, test-first): "Clean environment starts
// successfully, restored records/files/configuration work and workflows run without the original builder or mandatory
// public SaaS" (REQ-S20-018; with REQ-S19-017, REQ-S01-006, REQ-S19-009, REQ-S01-001 per p7-work-split §B.8).
//
// TEST-FIRST. Two parts:
//  1. "Clean environment starts" in process (passes today, BE-B landed): a freshly migrated, empty installation with
//     an empty evidence directory is ready (database, migrations, storage `ok`); the worker without a heartbeat is
//     `unknown`, never `alive` (Unknown is never shown green); a missing evidence directory makes it NOT ready.
//  2. The transfer drill (ADR-0069 §4, DO-D): runs `deploy/scripts/transfer-drill.sh` on a release archive and asserts
//     the report of §B.4/§B.5 independently of the drill's own verdict: D0–D11 each PASS with command, exit and
//     seconds; the archive checksum is the one given; configuration came only from `.env.example` keys, each citing
//     a section of docs/handover/deployment.md (D3); every reconciliation is equal (D5, D9: restored records, files
//     and configuration); the source origin survives only in `audit_event` (D10); the IdP is the synthetic drill IdP.
//     Until DO-D lands, these tests fail with "A18 not built: <file> is missing (DO-D)". The drill runs inside its own
//     `bwrap --unshare-net` namespace (no public SaaS reachable); exit 3 is BLOCKED and fails here, never passes.
//
// Inputs of part 2 (the archive is DO-A's `build-archive.mjs` output; building it needs the candidate commit and the
// demo export, which DO-D's drill wiring or QA-C's re-run provides): QA_A18_ARCHIVE, QA_A18_ARCHIVE_SHA256,
// QA_A18_STORE (the offline pnpm store). T-DG7-QA-E (project rule: missing inputs make a check BLOCKED, never passed;
// tests/qa/support/a18-inputs.ts):
//  - none of the three set: the drill tests are SKIPPED and a skipped test titled "BLOCKED: A18 transfer drill not run:
//    input missing: …" names them; the same line goes to stderr. Skipped is not passed: A18 stays unproved by that run.
//  - some set but incomplete or wrong (missing path, wrong kind, malformed checksum), or QA_A18_REQUIRE=1 without
//    them: every drill test FAILS naming the problem.
//  - all set and well formed: the drill runs exactly as in QA-C's run; a drill that rejects them fails.
// DO-D's drill files are checked in every run (a missing file fails, whatever the inputs).
//
// Mutations: the drill performs none through this harness; the workflows D8 runs (approval decision, CSRF refusal
// with the source origin) are asserted through the drill's step results. All data is SYNTHETIC; the drill IdP is not a
// corporate IdP; nothing here is a business, Finance or IT approval or touches DG0–DG7.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate } from "../../../packages/db/src/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { call, startApi, type TestApi } from "../support/api.ts";
import {
  TRANSFER_PASS_LINE,
  configTraceProblems,
  headingAnchors,
  inequalities,
  originScanProblems,
  templateKeys,
  transferReportProblems,
  type Json,
} from "../support/a18-a19-reports.ts";
import { classifyA18Inputs } from "../support/a18-inputs.ts";

const REPO = resolve(import.meta.dirname, "..", "..", "..");
const DRILL = "deploy/scripts/transfer-drill.sh";
/** DO-D's files (p7-work-split §B.2) and DOC-B's guide that D3 cites. */
const DRILL_FILES = [
  DRILL,
  "deploy/scripts/drill/fake-idp-server.mjs",
  "deploy/scripts/drill/journey.mjs",
  "deploy/scripts/drill/origin-scan.mjs",
  "deploy/scripts/drill/config-trace.mjs",
  "deploy/scripts/drill/schedule-explained.mjs",
  "deploy/scripts/drill/guide-keys.json",
  "docs/handover/deployment.md",
] as const;

// ------------------------------------------------- the harness's own re-check of ADR-0064 A5.2 S2-S8 (T-DG7-DO-D9)
// Written independently of deploy/scripts/drill/schedule-explained.mjs: it reads only the report's entries and window.
const WDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function cronField(tok: string, lo: number, hi: number, v: number): boolean | null {
  return tok.split(",").some((item) => {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
    if (!m || (m[4] !== undefined && m[2] !== undefined && m[3] === undefined)) throw new Error(`cron token ${item}`);
    const a = m[2] === undefined ? lo : Number(m[2]);
    const b = m[2] === undefined ? hi : m[3] === undefined ? a : Number(m[3]);
    const step = m[4] === undefined ? 1 : Number(m[4]);
    return v >= a && v <= b && (v - a) % step === 0;
  });
}
function isOccurrence(cron: string, tz: string, ms: number): boolean {
  try {
    const f = cron.trim().split(/\s+/);
    if (f.length !== 5 || ms % 60_000 !== 0) return false;
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        weekday: "short",
      })
        .formatToParts(new Date(ms))
        .map((x) => [x.type, x.value]),
    );
    const dow = WDAY[p["weekday"]!]!;
    if (!cronField(f[0]!, 0, 59, Number(p["minute"])) || !cronField(f[1]!, 0, 23, Number(p["hour"]))) return false;
    if (!cronField(f[3]!, 1, 12, Number(p["month"]))) return false;
    const dom = cronField(f[2]!, 1, 31, Number(p["day"]))!;
    const dw = cronField(f[4]!, 0, 7, dow)! || (dow === 0 && cronField(f[4]!, 0, 7, 7)!);
    return f[2]!.startsWith("*") || f[4]!.startsWith("*") ? dom && dw : dom || dw;
  } catch {
    return false;
  }
}
/** The problems of the D9 `scheduleExplained` entries against the report's window (S2-S8; S1, S9 need the target). */
function scheduleExplainedProblems(entries: Json[], window: Json): string[] {
  const p: string[] = [];
  const w0 = Date.parse(window?.start),
    w1 = Date.parse(window?.end);
  if (!Number.isFinite(w0) || !Number.isFinite(w1) || w0 > w1) return [`scheduleWindow ${JSON.stringify(window)}`];
  const slots = new Set<string>();
  for (const x of entries) {
    const id = x.executionId;
    if (x.initiatingUserId !== null || x.runAs !== "service") p.push(`${id}: S2 has an initiating user`);
    if (x.triggerKind !== "schedule") p.push(`${id}: S3 trigger kind ${x.triggerKind}`);
    const k = /^([a-z_]+\.[a-z_]+):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/.exec(x.triggerKey ?? "");
    const M = k ? Date.parse(`${k[2]}:00.000Z`) : NaN;
    if (!k || !Number.isFinite(M) || new Date(M).toISOString().slice(0, 16) !== k[2] || k[1] !== x.triggerCode)
      p.push(`${id}: S4 key ${x.triggerKey}`);
    if (x.scheduleCode !== x.triggerCode) p.push(`${id}: S5 schedule ${x.scheduleCode} is not ${x.triggerCode}`);
    const s = Date.parse(x.slot);
    const named = isOccurrence(x.cron, x.timezone, M)
      ? M
      : isOccurrence(x.cron, x.timezone, M - 60_000)
        ? M - 60_000
        : NaN;
    if (!Number.isFinite(s) || s !== named)
      p.push(`${id}: S6 slot ${x.slot} is not the slot key ${x.triggerKey} names`);
    if (!(s > w0 - 60_000 && s <= w1)) p.push(`${id}: S7 slot ${x.slot} outside the window`);
    const c = Date.parse(x.createdAt);
    if (!(c >= w0 && c <= w1)) p.push(`${id}: S8 created ${x.createdAt} outside the window`);
    if (slots.has(`${x.triggerCode}@${s}`)) p.push(`${id}: two executions for slot ${x.slot}`);
    slots.add(`${x.triggerCode}@${s}`);
    if (!(x.auditEvents as Json[]).some((e) => e.recordId === id && /^job:.+$/.test(e.requestId ?? "")))
      p.push(`${id}: no job audit event of the execution listed`);
  }
  return p;
}

function requireBuilt(): void {
  const missing = DRILL_FILES.filter((f) => !existsSync(join(REPO, f)));
  if (missing.length > 0)
    throw new Error(`A18 not built: ${missing.join(", ")} missing (DO-D, DOC-B; p7-work-split §B.2, §H)`);
}

// --------------------------------------------------------------------------- part 1: clean environment starts

describe("A18 clean environment starts: an empty, freshly migrated installation is ready (REQ-S20-018)", () => {
  let db: string;
  let work: string;
  beforeAll(async () => {
    db = await createScratchDatabase(inject("mthDb").adminUrl, "mth_qa_a18_clean");
    await migrate(roleUrl(inject("mthDb").adminUrl, db, "mth_owner"));
    work = mkdtempSync(join(tmpdir(), "qa-a18-"));
  }, 120_000);
  afterAll(async () => {
    await dropScratchDatabase(inject("mthDb").adminUrl, db).catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
  });

  async function readyz(evidencePath: string): Promise<{ status: number; body: Json }> {
    let api: TestApi | undefined;
    try {
      api = await startApi({ database: db, env: { EVIDENCE_STORAGE_PATH: evidencePath } });
      const r = await call<Json>(api.app, "GET", "/readyz");
      return { status: r.status, body: r.body };
    } finally {
      await api?.close();
    }
  }

  it("ready with database, migrations and storage ok; the worker without a heartbeat is unknown, never alive", async () => {
    const ev = join(work, "evidence");
    mkdirSync(ev);
    const r = await readyz(ev);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.checks).toMatchObject({ database: "ok", migrations: "ok", storage: "ok", worker: "unknown" });
  });

  it("a missing evidence directory is not ready (503, storage fail), never reported ok", async () => {
    const r = await readyz(join(work, "does-not-exist"));
    expect(r.status, JSON.stringify(r.body)).toBe(503);
    expect(r.body.checks.storage).toBe("fail");
    // ADR-0069 §2 / p7-work-split §B.9: the public body names no path.
    expect(JSON.stringify(r.body)).not.toContain(work);
  });
});

// --------------------------------------------------------------------------- part 2: the transfer drill (DO-D)

const inputState = classifyA18Inputs(process.env);
if (inputState.kind === "absent") console.warn(inputState.reason);

describe("A18 transfer drill harness: drill files present; inputs absent = BLOCKED (skipped), wrong = FAIL", () => {
  it("DO-D's drill files and DOC-B's deployment guide are present (checked whatever the inputs)", () => {
    requireBuilt();
  });
  if (inputState.kind === "absent") {
    // A skipped test whose title is the BLOCKED reason, so every reporter shows why the drill did not run.
    it.skip(inputState.reason, () => undefined);
  } else {
    it("the QA_A18_* inputs given are complete and well formed", () => {
      if (inputState.kind === "invalid") throw new Error(inputState.message);
    });
  }
});

describe.skipIf(inputState.kind === "absent")(
  "A18 transfer drill: restored records, files and configuration work on another origin, offline (DO-D)",
  () => {
    const archive = inputState.kind === "ready" ? inputState.inputs.archive : "";
    const archiveSha = inputState.kind === "ready" ? inputState.inputs.archiveSha256 : "";
    const store = inputState.kind === "ready" ? inputState.inputs.store : "";
    let out = "";
    let run: { status: number | null; text: string; seconds: number } | undefined;
    const read = (f: string): Json => JSON.parse(readFileSync(join(out, f), "utf8"));

    // QA-C (T-DG7-QA-C): the drill runs ASYNCHRONOUSLY in beforeAll. The earlier spawnSync blocked the Vitest worker's
    // event loop for the whole drill (338 s in QA-C run 2), so Vitest reported `[vitest-worker]: Timeout calling
    // "onTaskUpdate"` and exited 1 although all 8 tests passed. The assertions are unchanged; a missing file or an
    // incomplete or wrong input fails every drill test through drill() below (absent inputs skip this block: QA-E).
    beforeAll(async () => {
      if (DRILL_FILES.some((f) => !existsSync(join(REPO, f))) || inputState.kind !== "ready") return;
      // QA_A18_OUT keeps the report for evidence (QA-C: test-evidence/DG7/qa/); otherwise a scratch directory.
      out = process.env["QA_A18_OUT"] ?? mkdtempSync(join(tmpdir(), "qa-a18-drill-"));
      mkdirSync(out, { recursive: true });
      const t0 = performance.now();
      const r = await new Promise<{ status: number | null; text: string }>((done) => {
        const child = spawn(
          "bash",
          [join(REPO, DRILL), "--archive", archive, "--sha256", archiveSha, "--store", store, "--out", out],
          {
            cwd: REPO,
            env: {
              PATH: process.env["PATH"] ?? "",
              HOME: process.env["HOME"] ?? tmpdir(),
              TMPDIR: tmpdir(),
              LANG: "C.UTF-8",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        const chunks: string[] = [];
        child.stdout.setEncoding("utf8").on("data", (c: string) => chunks.push(c));
        child.stderr.setEncoding("utf8").on("data", (c: string) => chunks.push(c));
        const timer = setTimeout(() => child.kill("SIGKILL"), 2_400_000);
        child.on("close", (status) => {
          clearTimeout(timer);
          done({ status, text: chunks.join("") });
        });
      });
      run = { status: r.status, text: r.text, seconds: (performance.now() - t0) / 1000 };
      console.log(`A18-TIMINGS ${JSON.stringify({ drillSeconds: run.seconds, exit: run.status })}`);
    }, 2_500_000);

    /** The drill's result from beforeAll; a missing file or a wrong input fails the calling test, never skips it. */
    function drill(): NonNullable<typeof run> {
      requireBuilt();
      if (inputState.kind === "invalid") throw new Error(inputState.message);
      if (!run) throw new Error("A18: the drill did not run in beforeAll");
      return run;
    }

    it("the drill exits 0 with the PASS line (exit 3 is BLOCKED and fails here, never passes)", () => {
      const r = drill();
      if (r.status === 3)
        throw new Error(`A18 BLOCKED (exit 3): ${r.text.split("\n").find((l) => l.includes("BLOCKED"))}`);
      expect(r.status, r.text.slice(-4000)).toBe(0);
      const m = TRANSFER_PASS_LINE.exec(r.text);
      expect(m, "transfer-drill: PASS line (p7-work-split §B.5)").not.toBeNull();
      expect(Number(m![2]), "tables reconciled").toBeGreaterThan(0);
      expect(Number(m![3]), "evidence files reconciled").toBeGreaterThan(0);
      // The target is another origin on loopback (D3: http://127.0.0.1:<pT>).
      expect(m![4]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    }, 2_500_000);

    it("the report: D0–D11 each PASS with command, exit and seconds; the given archive; the synthetic drill IdP", () => {
      drill();
      expect(transferReportProblems(read("transfer-drill-report.json"), { archiveSha256: archiveSha })).toEqual([]);
    });

    it("D3: configuration only from .env.example keys, each citing a section of the deployment guide", () => {
      drill();
      const anchors = headingAnchors(readFileSync(join(REPO, "docs/handover/deployment.md"), "utf8"));
      const keys = templateKeys(readFileSync(join(REPO, ".env.example"), "utf8"));
      expect(configTraceProblems(read("config-trace.json"), anchors, keys)).toEqual([]);
    });

    it("D5/D9: every reconciliation (counts, content digests, attachment checksums, after restart) is equal", () => {
      drill();
      const files = readdirSync(out).filter((f) => /^reconcile-.*\.json$/.test(f));
      expect(files.length, "reconcile-*.json written").toBeGreaterThanOrEqual(2); // D5 and D9
      // T-DG7-DO-D9 (ADR-0064 A5.5, D-278): D9 is accepted when its recheck matched, or when it is `schedule_explained`
      // AND every listed execution passes this harness's own re-check of S2-S8 against the report's window. Never
      // `not_matched`. reconcile-d9.json keeps the recheck's real exit 4 in the second case, so it is not re-read then.
      const d9 = (read("transfer-drill-report.json").steps as Json[]).find((s) => s.id === "D9");
      expect(["matched", "schedule_explained"], "D9 recheck").toContain(d9?.recheck);
      if (d9?.recheck === "schedule_explained") {
        const entries = d9.scheduleExplained as Json[];
        expect(entries.length, "schedule-explained executions listed").toBeGreaterThan(0);
        for (const x of entries)
          console.log(
            `A18 D9 schedule-explained (ADR-0064 A5): ${x.executionId} trigger ${x.triggerCode} key ${x.triggerKey} slot ${x.slot} '${x.cron}' ${x.timezone}, ${x.actionResultIds.length} action results, ${x.auditEvents.length} audit events`,
          );
        expect(scheduleExplainedProblems(entries, d9.scheduleWindow)).toEqual([]);
        const se = read("schedule-explained-d9.json");
        expect(se.recheckExit, "schedule-explained-d9.json recheckExit").toBe(4);
        expect(se.failures, "schedule-explained-d9.json failures").toEqual([]);
      }
      for (const f of files) {
        if (f === "reconcile-d9.json" && d9?.recheck === "schedule_explained") continue;
        expect(inequalities(read(f)), f).toEqual([]);
      }
    });

    it("D10: the source origin is stored nowhere except audit_event", () => {
      drill();
      expect(originScanProblems(read("origin-scan.json"))).toEqual([]);
    });

    it("the drill log names no builder-hosted or public service it reached", () => {
      drill();
      const log = readFileSync(join(out, "drill.log"), "utf8");
      expect(log).not.toMatch(/registry\.npmjs\.org.*(200|connected)/i);
      expect(log).toMatch(/network isolation|probe/i);
    });

    afterAll(() => {
      if (out && !process.env["QA_A18_OUT"]) rmSync(out, { recursive: true, force: true });
    });
  },
);
