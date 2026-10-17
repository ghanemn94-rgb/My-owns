// T-DG5-BE-T5 (D-167; D-QA-F2-1, REQ-S12-012): every outbox event type the API and the worker enqueue has a payload
// schema in OUTBOX_EVENT_SCHEMAS. The relay (apps/worker/src/relay.ts) refuses a row whose (event_type, schema_version)
// has no schema ("no schema for <type> v<n>"), retries it ten times and never publishes it; `dependency.slipped` was
// such a row, so starter 9 never ran. This test reads the sources (no database): it lists every event-type literal at
// an outbox write site, resolves the named constants, and checks the list against the registry. A new outbox write
// site (a file that inserts into outbox_event) must be added to OUTBOX_WRITE_SITES below, which makes a reviewer see it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { OUTBOX_EVENT_SCHEMAS, outboxPayloadSchema } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const SCANNED = ["apps/api/src", "apps/worker/src"];

/** Every event type the API or the worker writes to outbox_event, with where it is written. */
const ENQUEUED: Readonly<Record<string, string>> = {
  "transformation.created": "api transformations/routes.ts (v1 and v2)",
  "job_schedule.updated": "api jobs/schedules.ts",
  "kpi.threshold_changed": "api kpi/rag-thresholds.ts",
  "kpi.trajectory_approved": "api kpi/trajectories.ts",
  "kpi.version_activated": "api kpi/kpi-versions.ts",
  "kpi.actual_accepted": "api kpi/accept-pipeline.ts",
  "kpi.values_recalculated": "worker handlers/kpi.ts",
  "kpi.deviation_evaluated": "worker handlers/kpi.ts",
  "benefit.evidence_submitted": "api benefits/measurements.ts",
  "benefit.value_validated": "api benefits/finance-validation.ts",
  "benefit.value_rejected": "api benefits/finance-validation.ts",
  "benefit.variance_evaluated": "api benefits/values.ts, worker handlers/benefits.ts",
  "adoption.check_failed": "api adoption/interventions.ts, worker handlers/adoption.ts",
  "blocker_status.recorded": "api governance/escalations.ts",
  "control_check.failed": "api sustainment/controls.ts",
  "gate.submitted": "api workflows/gates.ts",
  "gate.decided": "api workflows/gates.ts",
  "procedure_step.activated": "api procedures/steps.ts",
  "job.failed": "worker kit.ts (failure capture)",
  "automation_failure.retry_requested": "api automation/failures.ts",
  "job.run_requested": "api jobs/operations.ts",
  "export_job.requested": "api reporting/exports/jobs.ts",
  "demo.reset_requested": "api admin/environment.ts",
  "kpi_restatement.approved": "api kpi/restatement-decisions.ts",
  "branding.published": "api admin/branding.ts",
  "dependency.slipped": "api portfolio/slip-events.ts (starter 9; registered by T-DG5-BE-T5)",
  "report_snapshot.issued": "api reporting/reports/snapshots.ts (written ONLY once registered; guarded, see below)",
};

/**
 * Event types whose write site checks the registry first and writes nothing while the type is unregistered (so the
 * relay never sees an unregistered row). `report_snapshot.issued` waits for its consumer (ADR-0045 §10, ADR-0047).
 */
const GUARDED_UNTIL_REGISTERED: Readonly<Record<string, string>> = {
  "report_snapshot.issued": "apps/api/src/modules/reporting/reports/snapshots.ts",
};

/** The files that insert into outbox_event, with the number of insert sites in each. */
const OUTBOX_WRITE_SITES: Readonly<Record<string, number>> = {
  "apps/api/src/modules/adoption/interventions.ts": 1,
  "apps/api/src/modules/benefits/values.ts": 1,
  "apps/api/src/modules/governance/escalations.ts": 1,
  "apps/api/src/modules/jobs/outbox.ts": 1,
  "apps/api/src/modules/kpi/kpi-outbox.ts": 1,
  "apps/api/src/modules/kpi/restatement-decisions.ts": 1,
  "apps/api/src/modules/portfolio/slip-events.ts": 1,
  "apps/api/src/modules/procedures/steps.ts": 1,
  "apps/api/src/modules/reporting/exports/jobs.ts": 1,
  "apps/api/src/modules/reporting/reports/snapshots.ts": 1,
  "apps/api/src/modules/sustainment/controls.ts": 1,
  "apps/api/src/modules/workflows/gates.ts": 1,
  "apps/worker/src/handlers/adoption.ts": 1,
  "apps/worker/src/handlers/benefits.ts": 1,
  "apps/worker/src/handlers/kpi.ts": 1,
  "apps/worker/src/kit.ts": 1,
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const files = SCANNED.flatMap((d) => sourceFiles(join(ROOT, d))).map((path) => ({
  rel: relative(ROOT, path).split("\\").join("/"),
  text: readFileSync(path, "utf8"),
}));

/** `export const NAME = "a.b"` (and non-exported) across the scanned sources. */
const constants = new Map<string, Set<string>>();
for (const f of files)
  for (const m of f.text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*"([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)"/g)) {
    const set = constants.get(m[1]!) ?? new Set<string>();
    set.add(m[2]!);
    constants.set(m[1]!, set);
  }

/** The event-type values named where an outbox row's event type is set (`event_type:` / `eventType:` / `= `). */
function enqueuedTypes(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const add = (type: string, where: string) => {
    const set = found.get(type) ?? new Set<string>();
    set.add(where);
    found.set(type, set);
  };
  for (const f of files) {
    if (f.rel === "apps/worker/src/relay.ts") continue; // the relay reads rows; it writes none
    const lines = f.text.split("\n");
    lines.forEach((line, i) => {
      if (!/\b(?:event_type|eventType)\s*(?::(?!:)|=(?!=))/.test(line)) return;
      if (/\b(?:readonly\s+)?(?:event_type|eventType)\s*:\s*string\b/.test(line)) return;
      const where = `${f.rel}:${i + 1}`;
      const rhs = line.slice(line.search(/\b(?:event_type|eventType)\b/));
      for (const m of rhs.matchAll(/"([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)"/g)) add(m[1]!, where);
      for (const m of rhs.matchAll(/\b([A-Z][A-Z0-9_]*_EVENT|[A-Z][A-Z0-9_]*(?:_ISSUED|_RECORDED))\b/g))
        for (const t of constants.get(m[1]!) ?? []) add(t, where);
    });
  }
  return found;
}

describe("outbox event types vs OUTBOX_EVENT_SCHEMAS (T-DG5-BE-T5, D-QA-F2-1)", () => {
  it("the outbox write sites are exactly the reviewed list (a new site must be added here)", () => {
    const sites = new Map<string, number>();
    for (const f of files) {
      const n = (f.text.match(/insertInto\(\s*"outbox_event"\s*\)/g) ?? []).length;
      if (n > 0) sites.set(f.rel, n);
    }
    expect(Object.fromEntries(sites)).toEqual(OUTBOX_WRITE_SITES);
    for (const f of files) expect(/INSERT\s+INTO\s+outbox_event/i.test(f.text), f.rel).toBe(false);
  });

  it("every event type named at a write site is in the reviewed list, and the list is complete", () => {
    const found = enqueuedTypes();
    const unknown = [...found.keys()].filter((t) => !(t in ENQUEUED)).map((t) => `${t} @ ${[...found.get(t)!]}`);
    expect(unknown).toEqual([]);
    expect([...found.keys()].sort()).toEqual(Object.keys(ENQUEUED).sort());
  });

  it("every enqueued event type has a v1 schema in OUTBOX_EVENT_SCHEMAS, except the guarded ones", () => {
    const missing = Object.keys(ENQUEUED).filter(
      (t) => outboxPayloadSchema(t, 1) === null && !(t in GUARDED_UNTIL_REGISTERED),
    );
    expect(missing).toEqual([]);
    expect(outboxPayloadSchema("transformation.created", 2)).not.toBeNull();
  });

  it("dependency.slipped v1 is registered (the relay publishes it; starter 9 runs)", () => {
    expect(Object.keys(OUTBOX_EVENT_SCHEMAS)).toContain("dependency.slipped");
    const schema = outboxPayloadSchema("dependency.slipped", 1)!;
    const payload = {
      slipId: "01920000-0000-7000-8000-000000000001",
      dependencyId: "01920000-0000-7000-8000-000000000002",
      transformationId: "01920000-0000-7000-8000-000000000003",
      slipDays: 5,
    };
    expect(schema.safeParse(payload).success).toBe(true);
    expect(schema.safeParse({ ...payload, extra: 1 }).success).toBe(false);
  });

  it("a guarded event type is written only after the registry check (never an unregistered row)", () => {
    for (const [type, file] of Object.entries(GUARDED_UNTIL_REGISTERED)) {
      const text = files.find((f) => f.rel === file)!.text;
      expect(text, type).toMatch(/if \(outboxPayloadSchema\([A-Z_]+, 1\) === null\) return;/);
      // Still unregistered today: when its consumer registers it, move it out of GUARDED_UNTIL_REGISTERED.
      expect(outboxPayloadSchema(type, 1), type).toBeNull();
    }
  });
});
