// The `methodology` configuration kind's provider hooks (ADR-0039 §2, §5; REQ-S06-004, REQ-S06-006, REQ-S06-007;
// p5-work-split §A.1 "methodology ... registered by BE-B", §A.2; T-DG5-BE-B):
//  - validateElement: a gate's default approver, and the approvers of a gate approver route (`gate.<code>`), must be
//    inside the gate's DG2 allowed set (422 config_version.approver_not_allowed); a gate route names an existing gate
//    (422 config_version.unknown_element). Administrator and AUD approvers are refused earlier (invariants.ts).
//  - compatibility: an unknown reference (a reminder/escalation recipient role, a checklist or artifact phase or gate)
//    is a `fail` finding.
//  - affectedRecords: live counts per transformation of the records a change touches (gate instances, TOM canvas
//    cells, gate submission criteria, phase steps); anything without a counter is Unknown with a reason, never 0.
//  - preview: sample formulas through the DG3 engine unchanged (evaluateFormula), sample submissions routed through
//    the draft's approver routes resolved by ConfigResolver.withDraft; record samples belong to the form_schema kind
//    (ADR-0041) and fail here with a reason.
// Configuration only: routing a sample submission in the sandbox decides nothing and creates no approval.
import { sql, type DbOrTx } from "@mth/db";
import { evaluateFormula } from "@mth/shared/calc";
import { stableKey as stableKeySchema, type ConfigPreviewRequest } from "@mth/shared/schemas";
import { z } from "zod";
import { createConfigResolver } from "../config-resolver.ts";
import { studioRefusals } from "../drafts.ts";
import { approverRoleCodes, loadRoles } from "../invariants.ts";
import {
  registerConfigKindProvider,
  type AffectedRecordCount,
  type CompatibilityFinding,
  type ConfigElementChange,
  type PreviewOutcome,
} from "../kinds.ts";

const GATE_ROUTE = /^gate\.(G[0-9]+)$/;

async function allowedApprovers(db: DbOrTx, gateCode: string): Promise<readonly string[] | null> {
  const g = await db
    .selectFrom("gate_definition")
    .select("allowed_approver_role_codes")
    .where("code", "=", gateCode)
    .executeTakeFirst();
  return g === undefined ? null : g.allowed_approver_role_codes;
}

async function validateElement(
  db: DbOrTx,
  input: {
    readonly elementType: string;
    readonly stableKey: string;
    readonly attributes: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  let gateCode: string | null = null;
  if (input.elementType === "gate") gateCode = input.stableKey;
  if (input.elementType === "approver_route") {
    const m = GATE_ROUTE.exec(input.stableKey);
    if (m !== null) gateCode = m[1] ?? null;
  }
  if (gateCode === null) return;
  const allowed = await allowedApprovers(db, gateCode);
  if (allowed === null) throw studioRefusals.unknownElement();
  for (const code of approverRoleCodes(input.attributes))
    if (!allowed.includes(code)) throw studioRefusals.approverNotAllowed();
}

// ------------------------------------------------------------------------------------------------ compatibility

async function compatibility(db: DbOrTx, input: { readonly versionId: string }): Promise<CompatibilityFinding[]> {
  const rows = await db
    .selectFrom("methodology_element")
    .select(["element_type", "stable_key", "attributes"])
    .where("methodology_version_id", "=", input.versionId)
    .where("removed", "=", false)
    .orderBy("element_type")
    .orderBy("stable_key")
    .execute();
  const [phases, gates] = await Promise.all([
    db.selectFrom("phase_definition").select("code").execute(),
    db.selectFrom("gate_definition").select("code").execute(),
  ]);
  const phaseCodes = new Set(phases.map((p) => p.code));
  const gateCodes = new Set(gates.map((g) => g.code));
  const refs = rows.map((r) => ({ r, a: new Map(Object.entries((r.attributes ?? {}) as Record<string, unknown>)) }));
  const recipients = refs.map(({ a }) => a.get("recipientRoleCode")).filter((v): v is string => typeof v === "string");
  const roles = await loadRoles(db, recipients);
  const out: CompatibilityFinding[] = [];
  const unknown = (r: (typeof rows)[number], reference: string, value: string): CompatibilityFinding => ({
    severity: "fail",
    code: "compatibility.unknown_reference",
    elementType: r.element_type as CompatibilityFinding["elementType"],
    stableKey: r.stable_key,
    params: { reference, value },
  });
  for (const { r, a } of refs) {
    const recipient = a.get("recipientRoleCode");
    if (typeof recipient === "string" && !roles.has(recipient)) out.push(unknown(r, "role", recipient));
    const phase = a.get("phaseCode");
    if (typeof phase === "string" && !phaseCodes.has(phase)) out.push(unknown(r, "phase", phase));
    const gate = a.get("gateCode");
    if (typeof gate === "string" && !gateCodes.has(gate)) out.push(unknown(r, "gate", gate));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ affected records

/** The record counter of a change: [recordType, table, column, value], or null when nothing counts it. */
function counterOf(c: ConfigElementChange): readonly [string, string, string, string] | null {
  switch (c.elementType) {
    case "gate":
      return ["gate_instance", "gate_instance", "gate_code", c.stableKey];
    case "approver_route": {
      const m = GATE_ROUTE.exec(c.stableKey);
      return m === null ? null : ["gate_instance", "gate_instance", "gate_code", m[1] ?? ""];
    }
    case "tom_dimension":
      return ["tom_canvas_cell", "tom_canvas_cell", "dimension_code", c.stableKey];
    case "gate_criterion":
      return ["gate_submission_criterion", "gate_submission_criterion", "criterion_key", c.stableKey];
    case "phase":
      return ["phase_step", "phase_step", "phase_code", c.stableKey];
    default:
      return null;
  }
}

async function affectedRecords(
  db: DbOrTx,
  input: { readonly changes: readonly ConfigElementChange[]; readonly transformationIds: readonly string[] },
): Promise<AffectedRecordCount[]> {
  const out: AffectedRecordCount[] = [];
  const ids = [...input.transformationIds];
  for (const c of input.changes) {
    const counter = counterOf(c);
    if (counter === null) {
      for (const t of ids)
        out.push({
          transformationId: t,
          recordType: c.elementType,
          count: null,
          unknownReason: "affected_records.no_counter",
        });
      continue;
    }
    const [recordType, table, column, value] = counter;
    // Table and column names are the constants above, never input.
    const rows = await sql<{ transformation_id: string; n: number }>`
      SELECT transformation_id, count(*)::int AS n FROM ${sql.table(table)}
       WHERE ${sql.ref(column)} = ${value} AND transformation_id = ANY(${ids}::uuid[])
       GROUP BY transformation_id`.execute(db);
    const counts = new Map(rows.rows.map((r) => [r.transformation_id, Number(r.n)]));
    for (const t of ids) out.push({ transformationId: t, recordType, count: counts.get(t) ?? 0, unknownReason: null });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ preview

const formulaInput = z.strictObject({
  expression: z.string().min(1).max(2000),
  variables: z.array(z.unknown()).max(50).optional(),
  inputs: z.record(z.string(), z.string().nullable()).optional(),
});
const submissionInput = z.strictObject({ routeKey: stableKeySchema });

async function preview(
  db: DbOrTx,
  input: { readonly versionId: string; readonly samples: unknown },
): Promise<PreviewOutcome> {
  const samples = input.samples as ConfigPreviewRequest["samples"];
  const resolver = createConfigResolver().withDraft(input.versionId);
  const results: Record<string, unknown>[] = [];
  for (const [index, s] of samples.entries()) {
    if (s.kind === "record") {
      results.push({ index, kind: s.kind, result: "fail", code: "preview.sample_not_supported" });
      continue;
    }
    if (s.kind === "formula") {
      const f = formulaInput.safeParse(s.input);
      if (!f.success) {
        results.push({ index, kind: s.kind, result: "fail", code: "preview.sample_invalid" });
        continue;
      }
      // The DG3 formula engine, unchanged (p5-work-split §2 rule 9). Unknown stays null, never 0.
      const ev = evaluateFormula(f.data.expression, f.data.variables ?? [], f.data.inputs ?? {});
      results.push({
        index,
        kind: s.kind,
        result: ev.ok ? "pass" : "fail",
        value: ev.result,
        code: ev.errorCode ?? null,
      });
      continue;
    }
    const sub = submissionInput.safeParse(s.input);
    if (!sub.success) {
      results.push({ index, kind: s.kind, result: "fail", code: "preview.sample_invalid" });
      continue;
    }
    const routeKey = sub.data.routeKey;
    const route = await resolver.element(db, input.versionId, "approver_route", routeKey);
    if (route !== null && !route.removed) {
      results.push({
        index,
        kind: s.kind,
        result: "pass",
        routeKey,
        source: "approver_route",
        approverRoleCodes: approverRoleCodes(route.attributes),
        mode: new Map(Object.entries(route.attributes)).get("mode") ?? "any",
      });
      continue;
    }
    const m = GATE_ROUTE.exec(routeKey);
    const gate = m === null ? null : await resolver.element(db, input.versionId, "gate", m[1] ?? "");
    if (gate === null) {
      results.push({ index, kind: s.kind, result: "fail", routeKey, code: "preview.route_unknown" });
      continue;
    }
    const approver = new Map(Object.entries(gate.attributes)).get("defaultApproverRoleCode");
    results.push({
      index,
      kind: s.kind,
      result: typeof approver === "string" ? "pass" : "fail",
      routeKey,
      source: "gate_default",
      approverRoleCodes: typeof approver === "string" ? [approver] : [],
      mode: "any",
    });
  }
  const failed = results.filter((r) => r["result"] === "fail").length;
  return { result: failed === 0 ? "pass" : "fail", report: { evaluated: results.length, failed, results } };
}

/** Registers the methodology kind's hooks (idempotent; called when the element routes register). */
export function registerMethodologyKindProvider(): void {
  registerConfigKindProvider("methodology", { validateElement, compatibility, affectedRecords, preview });
}
