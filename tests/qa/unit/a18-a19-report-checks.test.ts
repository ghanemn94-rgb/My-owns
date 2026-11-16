// qa-verifier (T-DG7-QA-A): the A18/A19 harness checks are themselves tested before the drills exist. A synthetic
// good report passes; each broken report is rejected with a problem naming the acceptance clause. An assertion that
// can never fail proves nothing (tests/qa/support/a18-a19-reports.ts). All fixtures are SYNTHETIC.
import { describe, expect, it } from "vitest";
import {
  BACKUP_PASS_LINE,
  DRILL_IDP_LABEL,
  RESTORE_CHECKS,
  RESTORE_PASS_LINE,
  TRANSFER_PASS_LINE,
  TRANSFER_STEPS,
  backupManifestProblems,
  configTraceProblems,
  headingAnchors,
  inequalities,
  isSeconds,
  originScanProblems,
  restoreReportProblems,
  templateKeys,
  transferReportProblems,
  type Json,
} from "../support/a18-a19-reports.ts";

const H = (c: string): string => c.repeat(64);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const goodTransfer = (): Json => ({
  schemaVersion: "mth-transfer-drill/1",
  result: "PASS",
  archive: { sha256: H("a") },
  idp: { label: DRILL_IDP_LABEL },
  steps: TRANSFER_STEPS.map((id) => ({ id, command: `synthetic ${id}`, exit: 0, seconds: 1.5, result: "PASS" })),
});

describe("A18 transfer report check", () => {
  it("a complete report passes", () => {
    expect(transferReportProblems(goodTransfer(), { archiveSha256: H("a") })).toEqual([]);
  });
  it.each([
    ["wrong schema", (r: Json) => (r.schemaVersion = "mth-transfer-drill/0"), /schemaVersion/],
    ["a skipped step", (r: Json) => r.steps.splice(4, 1), /D0..D11/],
    ["a failed step under a PASS result", (r: Json) => (r.steps[8].result = "FAIL"), /PASS although a step/],
    ["a non-zero exit", (r: Json) => (r.steps[2].exit = 1), /D2: exit 1/],
    ["a missing timing (never read as 0)", (r: Json) => delete r.steps[7].seconds, /D7: seconds/],
    ["no command", (r: Json) => (r.steps[0].command = ""), /D0: no command/],
    ["another archive", (r: Json) => (r.archive.sha256 = H("b")), /not the archive given/],
    ["a corporate IdP label", (r: Json) => (r.idp.label = "Corporate IdP"), /IdP label/],
    ["result FAIL", (r: Json) => (r.result = "FAIL"), /result "FAIL"/],
  ])("rejects %s", (_n, mutate, problem) => {
    const r = goodTransfer();
    mutate(r);
    expect(transferReportProblems(r, { archiveSha256: H("a") }).join("\n")).toMatch(problem);
  });
  it("the PASS line of §B.5 is recognised, and a BLOCKED line is not", () => {
    expect(
      TRANSFER_PASS_LINE.exec(
        "transfer-drill: PASS in 412.5 s: 310 tables and 3 evidence files equal, origin http://127.0.0.1:27001, restart verified; report /x/r.json",
      )?.slice(1, 5),
    ).toEqual(["412.5", "310", "3", "http://127.0.0.1:27001"]);
    expect(
      TRANSFER_PASS_LINE.test("transfer-drill: BLOCKED: no network namespace with loopback (bwrap unavailable)"),
    ).toBe(false);
  });
});

describe("A18 D3 configuration trace, D10 origin scan, reconciliation", () => {
  const guide = '# Deployment\n\n## Database URL\n\n### Evidence storage {#evidence-storage}\n<a id="oidc"></a>\n';
  const anchors = headingAnchors(guide);
  const keys = templateKeys("DATABASE_URL=\n# EVIDENCE_STORAGE_PATH=\nOIDC_ISSUER=\n");
  it("guide anchors and template keys are read", () => {
    expect([...anchors].sort()).toEqual(["database-url", "deployment", "evidence-storage", "oidc"]);
    expect([...keys].sort()).toEqual(["DATABASE_URL", "EVIDENCE_STORAGE_PATH", "OIDC_ISSUER"]);
  });
  it("a trace citing guide sections for template keys passes; an undocumented or invented key fails", () => {
    const ok = { entries: [{ key: "DATABASE_URL", section: "docs/handover/deployment.md#database-url" }] };
    expect(configTraceProblems(ok, anchors, keys)).toEqual([]);
    expect(configTraceProblems({ entries: [] }, anchors, keys).join()).toMatch(/no filled key/);
    expect(configTraceProblems([{ key: "OIDC_ISSUER", section: "" }], anchors, keys).join()).toMatch(/undocumented/);
    expect(configTraceProblems([{ key: "OIDC_ISSUER", section: "#nope" }], anchors, keys).join()).toMatch(/#nope/);
    expect(configTraceProblems([{ key: "BUILDER_TOKEN", section: "#oidc" }], anchors, keys).join()).toMatch(
      /not a key of .env.example/,
    );
  });
  it("the source origin may remain only in audit_event", () => {
    expect(originScanProblems({ hits: [{ table: "audit_event", column: "detail", rows: 4 }] })).toEqual([]);
    expect(originScanProblems({ hits: [{ table: "notification", column: "link", rows: 2 }] }).join()).toMatch(
      /notification\.link \(2 rows\)/,
    );
    expect(originScanProblems({}).join()).toMatch(/no hits/);
  });
  it("any inequality anywhere in a reconciliation report is found", () => {
    expect(inequalities({ tables: [{ name: "a", equal: true }], attachments: { mismatches: [] } })).toEqual([]);
    expect(inequalities({ tables: [{ name: "a", equal: false }] })).toEqual(["$.tables[0].equal"]);
    expect(inequalities({ attachments: { mismatches: [{ sha256: H("c") }] } })).toEqual(["$.attachments.mismatches"]);
    expect(inequalities({ evidence: { missing: 1 } })).toEqual(["$.evidence.missing"]);
  });
});

const goodManifest = (): Json => ({
  schemaVersion: "mth-backup/1",
  label: "qa-synthetic",
  migrationLevel: "0149_p7_synthetic",
  server: { version: "16.4", major: 16 },
  database: {
    file: "db/database.dump",
    format: "custom",
    sha256: H("1"),
    snapshotDigest: H("2"),
    auditEvents: { count: 12, maxSeq: "12" },
    pgbossJobsByState: { created: 1 },
  },
  evidence: { backend: "filesystem", attachmentManifest: { file: "evidence/attachments.json", count: 2 } },
  config: { files: [], sha256: H("3") },
  timings: { snapshot: 0.1, dump: 2, evidence: 0.4, config: 0, verify: 1 },
});

const goodRestore = (): Json => ({
  checks: RESTORE_CHECKS.map((id) => ({ id, expected: 1, actual: 1, result: "PASS" })),
  steps: [
    { name: "package", seconds: 0.2 },
    { name: "pg_restore", seconds: 4 },
  ],
});

describe("A19 manifest and restore report checks", () => {
  it("a complete manifest passes; each missing scope is named", () => {
    expect(backupManifestProblems(goodManifest())).toEqual([]);
    const cases: [(m: Json) => void, RegExp][] = [
      [(m) => (m.schemaVersion = "mth-backup/2"), /schemaVersion/],
      [(m) => delete m.database.snapshotDigest, /snapshots/],
      [(m) => delete m.database.auditEvents, /audit/],
      [(m) => delete m.database.pgbossJobsByState, /job state/],
      [(m) => delete m.evidence.attachmentManifest, /evidence/],
      [(m) => delete m.config, /configuration/],
      [(m) => delete m.timings.dump, /timings\.dump/],
      [(m) => (m.config.files = [{ path: "env", password: "synthetic" }]), /credential/],
    ];
    for (const [mutate, problem] of cases) {
      const m = clone(goodManifest());
      mutate(m);
      expect(backupManifestProblems(m).join("\n")).toMatch(problem);
    }
  });
  it("a complete restore report passes; a missing check, a failed check or a missing timing is named", () => {
    expect(restoreReportProblems(goodRestore())).toEqual([]);
    const r1 = goodRestore();
    r1.checks = r1.checks.filter((c: Json) => c.id !== "R5");
    expect(restoreReportProblems(r1).join()).toMatch(/R5 not recorded/);
    const r2 = goodRestore();
    r2.checks[3].result = "FAIL";
    expect(restoreReportProblems(r2).join()).toMatch(/R4 result "FAIL"/);
    const r3 = goodRestore();
    r3.checks[2].actual = 2;
    expect(restoreReportProblems(r3).join()).toMatch(/R3 is PASS but expected/);
    const r4 = goodRestore();
    delete r4.steps[1].seconds;
    expect(restoreReportProblems(r4).join()).toMatch(/pg_restore has no measured seconds/);
    expect(restoreReportProblems({ checks: goodRestore().checks }).join()).toMatch(/no step timings/);
  });
  it("timings: a measured value is a finite number >= 0; a string, null, NaN or negative is not", () => {
    expect([0, 1.25].map(isSeconds)).toEqual([true, true]);
    expect(["1", null, Number.NaN, -1, undefined].map(isSeconds)).toEqual([false, false, false, false, false]);
  });
  it("the backup and restore lines of §E.5 are recognised", () => {
    expect(
      BACKUP_PASS_LINE.test(
        `backup: set qa-x succeeded: 1024 database bytes, 2 evidence objects; manifest sha256 ${H("f")}`,
      ),
    ).toBe(true);
    expect(BACKUP_PASS_LINE.test("backup: set qa-x failed: pg_dump exited 1")).toBe(false);
    expect(RESTORE_PASS_LINE.exec("restore: qa-x restored and ready in 12.3 s; all checks passed")?.[1]).toBe("qa-x");
    expect(RESTORE_PASS_LINE.test("restore: check R3 failed: expected 4, got 3")).toBe(false);
  });
});
