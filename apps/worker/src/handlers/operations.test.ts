// T-DG6-BE-K2 (ADR-0053 §2, §3, §6; REQ-S12-019): the pure parts of the operations jobs, without a database. Their
// registration (queues, event routing, handlers, service identities), the exception and event keys, the data.stale
// payload contract, and migration 0116's catalogue and starter-16 rows read as text (the seed.test.ts pattern). The
// database-backed proofs (stale KPI -> one exception, replay, recovery, one alert per open, narrowed grant) are in
// apps/worker/test/integration/operations-freshness.test.ts and apps/api/test/integration/operations/freshness-scan.test.ts.
import { readFileSync } from "node:fs";
import { connectorRunFailedV1, dataStaleV1, outboxPayloadSchema } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { jobIdentityDeclaration } from "../kit.ts";
import { AUTOMATION_EVENT_QUEUES } from "../queues/automation.ts";
import { DOMAIN_QUEUES, QUEUES_FOR_EVENT } from "../queues/index.ts";
import { OPERATIONS_EVENT_QUEUES, OPERATIONS_QUEUES } from "../queues/operations.ts";
import { DOMAIN_HANDLERS } from "./index.ts";
import {
  ALERT_LOOKBACK_HOURS,
  DATA_STALE_EVENT,
  dataStaleEventKey,
  dataStaleKey,
  EXCEPTION_ALERTS_QUEUE,
  EXCEPTION_RAISE_QUEUE,
  FRESHNESS_SCAN_QUEUE,
  OPERATIONS_HANDLERS,
  setOperationsAlertLogger,
} from "./operations.ts";

const MIGRATION = readFileSync(
  new URL("../../../../packages/db/migrations/0116_p6_operations_triggers_freshness.sql", import.meta.url),
  "utf8",
);
const KPI = "01920006-0116-7000-8000-0000000000aa";
const T = "01920006-0116-7000-8000-0000000000bb";

describe("operations jobs: registration (ADR-0053 §2, §6)", () => {
  it("declares the three queues, each with one handler registered in DOMAIN_HANDLERS", () => {
    const queues = [FRESHNESS_SCAN_QUEUE, EXCEPTION_RAISE_QUEUE, EXCEPTION_ALERTS_QUEUE];
    expect(OPERATIONS_QUEUES.map((q) => q.name)).toEqual(queues);
    expect(OPERATIONS_HANDLERS.map((h) => h.queue)).toEqual(queues);
    for (const q of queues) {
      expect(DOMAIN_QUEUES.map((d) => d.name)).toContain(q);
      expect(DOMAIN_HANDLERS.filter((h) => h.queue === q)).toHaveLength(1);
    }
  });

  it("routes data.stale to the raise consumer and to the engine; connector.run_failed to the engine", () => {
    expect(OPERATIONS_EVENT_QUEUES).toEqual({ [DATA_STALE_EVENT]: EXCEPTION_RAISE_QUEUE });
    // D-102 order: the domain consumer first, the engine last (adoption-below-trajectory.test.ts pins the rule).
    expect(QUEUES_FOR_EVENT[DATA_STALE_EVENT]).toEqual([EXCEPTION_RAISE_QUEUE, "automation.evaluate"]);
    expect(AUTOMATION_EVENT_QUEUES["connector.run_failed"]).toBe("automation.evaluate");
    expect(outboxPayloadSchema(DATA_STALE_EVENT, 1)).toBe(dataStaleV1);
    expect(outboxPayloadSchema("connector.run_failed", 1)).toBe(connectorRunFailedV1);
  });

  it("each queue's identity reads only what it needs; none holds a write, configure or approval code", () => {
    expect(jobIdentityDeclaration(FRESHNESS_SCAN_QUEUE)?.permissions).toEqual([
      "transformation.read",
      "operations.read",
    ]);
    expect(jobIdentityDeclaration(EXCEPTION_RAISE_QUEUE)?.permissions).toEqual([
      "transformation.read",
      "operations.read",
    ]);
    expect(jobIdentityDeclaration(EXCEPTION_ALERTS_QUEUE)?.permissions).toEqual(["operations.read", "access.read"]);
    for (const q of [FRESHNESS_SCAN_QUEUE, EXCEPTION_RAISE_QUEUE, EXCEPTION_ALERTS_QUEUE])
      expect(jobIdentityDeclaration(q)?.sensitiveAccess).toBe("none");
  });
});

describe("operations jobs: keys and payloads (ADR-0053 §2)", () => {
  it("one exception key per KPI (source kpi:<id>, class data_stale); one event key per stale episode", () => {
    expect(dataStaleKey("org", KPI)).toEqual({
      organizationId: "org",
      sourceKind: "data_freshness",
      sourceCode: `kpi:${KPI}`,
      failureClass: "data_stale",
    });
    expect(dataStaleEventKey(KPI, "2026-01-15")).toBe(`data.stale:${KPI}:2026-01-15`);
    expect(dataStaleEventKey(KPI, "2026-01-15")).not.toBe(dataStaleEventKey(KPI, "2026-02-01"));
    expect(dataStaleEventKey(KPI, "2026-01-15").length).toBeLessThanOrEqual(200);
  });

  it("the data.stale payload is strict: a business date, a whole-day window, no value field", () => {
    const ok = { kpiId: KPI, transformationId: T, dataAsOf: "2026-01-15", staleAfterDays: 30 };
    expect(dataStaleV1.parse(ok)).toEqual(ok);
    for (const bad of [
      { ...ok, dataAsOf: "2026-01-15T00:00:00Z" },
      { ...ok, staleAfterDays: 0 },
      { ...ok, staleAfterDays: 1.5 },
      { ...ok, value: "0" },
      { ...ok, kpiId: "kpi-1" },
    ])
      expect(dataStaleV1.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(connectorRunFailedV1.safeParse({ connectorId: KPI, failureClass: "job_failed" }).success).toBe(false);
  });

  it("the alert logger can be replaced and restored", () => {
    const seen: string[] = [];
    const previous = setOperationsAlertLogger({ error: (_o, msg) => seen.push(msg) });
    const mine = setOperationsAlertLogger(previous);
    mine.error({}, "x");
    expect(seen).toEqual(["x"]);
    expect(ALERT_LOOKBACK_HOURS).toBe(24);
  });
});

describe("migration 0116 (ADR-0053 §3), read as text", () => {
  it("adds exactly the two admin-selectable M0239 triggers", () => {
    const block = MIGRATION.slice(
      MIGRATION.indexOf("INSERT INTO automation_trigger"),
      MIGRATION.indexOf(";", MIGRATION.indexOf("INSERT INTO automation_trigger")),
    );
    const codes = [...block.matchAll(/\('([a-z_.]+)', 'event'/g)].map((m) => m[1]);
    expect(codes).toEqual(["connector.run_failed", "data.stale"]);
    expect(block).toContain("'{connectorId,failureClass}', NULL, true, 'M0239'");
    expect(block).toContain("'{kpiId}', NULL, true, 'M0239'");
  });

  it("seeds starter 16 version 2 with the three triggers; version 1 is superseded, never rewritten", () => {
    expect(MIGRATION).toContain("ARRAY['job.failed', 'connector.run_failed', 'data.stale']::text[]");
    expect(MIGRATION).toContain("SET status = 'superseded', superseded_at = now(), version = version + 1");
    // Version 1's content columns are never updated (only its status, stamp and version).
    expect(MIGRATION).not.toMatch(
      /UPDATE automation_rule_version\s+SET[^;]*(trigger_codes|actions|parameters|content_sha256)/,
    );
    // The guard is redefined, keeping every 0074 constraint name.
    for (const name of [
      "automation_rule_version_trigger_known",
      "automation_rule_version_human_only",
      "automation_rule_version_admin_catalogue",
      "automation_rule_version_starter_seed",
      "automation_rule_version_starter_fixed",
      "automation_rule_version_initiating_user",
      "automation_rule_version_service_permission",
      "automation_rule_version_next_number",
      "automation_rule_version_identity_fixed",
      "automation_rule_version_content_frozen",
      "automation_rule_version_dry_run_required",
      "automation_rule_version_review_required",
      "automation_rule_version_reviewed_complete",
    ])
      expect(MIGRATION, name).toContain(`CONSTRAINT = '${name}'`);
  });
});
