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
// QA_A18_STORE (the offline pnpm store). Without them part 2 fails naming the missing input; it never skips.
//
// Mutations: the drill performs none through this harness; the workflows D8 runs (approval decision, CSRF refusal
// with the source origin) are asserted through the drill's step results. All data is SYNTHETIC; the drill IdP is not a
// corporate IdP; nothing here is a business, Finance or IT approval or touches DG0–DG7.
import { spawnSync } from "node:child_process";
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

const REPO = resolve(import.meta.dirname, "..", "..", "..");
const DRILL = "deploy/scripts/transfer-drill.sh";
/** DO-D's files (p7-work-split §B.2) and DOC-B's guide that D3 cites. */
const DRILL_FILES = [
  DRILL,
  "deploy/scripts/drill/fake-idp-server.mjs",
  "deploy/scripts/drill/journey.mjs",
  "deploy/scripts/drill/origin-scan.mjs",
  "deploy/scripts/drill/config-trace.mjs",
  "deploy/scripts/drill/guide-keys.json",
  "docs/handover/deployment.md",
] as const;

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

describe("A18 transfer drill: restored records, files and configuration work on another origin, offline (DO-D)", () => {
  const archive = process.env["QA_A18_ARCHIVE"] ?? "";
  const archiveSha = process.env["QA_A18_ARCHIVE_SHA256"] ?? "";
  const store = process.env["QA_A18_STORE"] ?? "";
  let out = "";
  let run: { status: number | null; text: string; seconds: number } | undefined;
  const read = (f: string): Json => JSON.parse(readFileSync(join(out, f), "utf8"));

  /** Runs the drill once (the first test that needs it); later tests read its report. */
  function drill(): NonNullable<typeof run> {
    requireBuilt();
    const missing = [
      ["QA_A18_ARCHIVE", archive && existsSync(archive)],
      ["QA_A18_ARCHIVE_SHA256", /^[0-9a-f]{64}$/.test(archiveSha)],
      ["QA_A18_STORE", store && existsSync(store)],
    ].filter(([, ok]) => !ok);
    if (missing.length > 0)
      throw new Error(`A18 input missing: ${missing.map(([k]) => k).join(", ")} (the DO-A archive and offline store)`);
    if (run) return run;
    // QA_A18_OUT keeps the report for evidence (QA-C: test-evidence/DG7/qa/transfer/); otherwise a scratch directory.
    out = process.env["QA_A18_OUT"] ?? mkdtempSync(join(tmpdir(), "qa-a18-drill-"));
    mkdirSync(out, { recursive: true });
    const t0 = performance.now();
    const r = spawnSync(
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
        encoding: "utf8",
        timeout: 2_400_000,
      },
    );
    run = { status: r.status, text: `${r.stdout ?? ""}${r.stderr ?? ""}`, seconds: (performance.now() - t0) / 1000 };
    console.log(`A18-TIMINGS ${JSON.stringify({ drillSeconds: run.seconds, exit: run.status })}`);
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
    for (const f of files) expect(inequalities(read(f)), f).toEqual([]);
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
});
