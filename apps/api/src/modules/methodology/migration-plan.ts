// The migration plan of a pinned transformation (ADR-0040 §2, §3, §7; REQ-S06-008, M0155 "Migration must explain default
// mappings, new required fields, invalidated calculations and necessary reapprovals"; p5-work-split §A.5; T-DG5-BE-C).
//
// One plan revision = an ordered list of `methodology_migration_item` rows (append-only; a new revision appends a new
// set, earlier ones stay readable). Built from:
//  - the diff of the target against the pinned version (diff.ts, the resolved elements): a `mapping` item per changed
//    element (old -> new, the field-level default mapping; `automatic`) and a `removed_element` item per element the
//    target removes (records referring to it keep their reference; `acknowledged`);
//  - for the `methodology` kind, a `reapproval` item per APPROVED gate of the transformation whose resolved `gate`
//    element, or any of its `gate_criterion`, `checklist_item` or `mandatory_artifact` elements, the target changes
//    beyond label/help text (ADR-0040 §3; D-142 Q9);
//  - the kind provider's `migrationItems` hook (form_schema: `new_required_field` per required field the target adds for
//    a record type the transformation has records of, `invalidated_calculation` per changed calculated field with
//    stored values). The slice A kinds (`methodology`, `scoring_defaults`) hold no record fields and no formulas, so
//    they report none (§2). A kind whose provider has not registered the hook yet gets ONE item with
//    `detail.unknown = true` that blocks `plan_ready`: an impact that cannot be computed is never "no impact" (§7);
//  - always, last, one `unchanged_history` item.
// `plan_ready` = no `needs_input` item and no unknown item; `plan_sha256` = SHA-256 of the canonical JSON of the
// revision's items. Reading only: the caller writes the rows (migrations.ts). Nothing here rewrites a record.
import { createHash } from "node:crypto";
import { type DbOrTx } from "@mth/db";
import { configKind as configKindSchema, type ConfigElementType, type ConfigKind } from "@mth/shared/schemas";
import { canonicalJson, problems } from "../platform/index.ts";
import { configKindProvider, type ConfigElementChange } from "./kinds.ts";
import { diffVersions } from "./diff.ts";
import type { MethodologyVersionRow } from "./drafts.ts";
import { loadGateDefinitions } from "./repository.ts";

export type PlanItemKind =
  | "mapping"
  | "new_required_field"
  | "invalidated_calculation"
  | "reapproval"
  | "removed_element"
  | "unchanged_history";
export type PlanItemResolution = "automatic" | "needs_input" | "provided" | "acknowledged";

/** One plan item before it is written (ordinal = position + 1). */
export interface PlanItem {
  readonly itemKind: PlanItemKind;
  readonly elementType: string | null;
  readonly stableKey: string | null;
  readonly recordType: string | null;
  readonly recordId: string | null;
  readonly gateCode: string | null;
  readonly resolution: PlanItemResolution;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface Plan {
  readonly items: readonly PlanItem[];
  readonly sha256: string;
  readonly ready: boolean;
}

/** One admin input for a new required field: a default value, or null = "leave empty until next edit". */
export interface PlanInput {
  readonly stableKey: string;
  readonly value: unknown;
}

/** The text of the always-present `unchanged_history` item (ADR-0040 §2; Arabic provisional). */
export const UNCHANGED_HISTORY = Object.freeze({
  messageKey: "methodology_migration.item.unchanged_history",
  textEn: "Historical records keep the version they were captured with; nothing is rewritten.",
  textAr: "تحتفظ السجلات التاريخية بالإصدار الذي سُجّلت به؛ ولا يُعاد كتابة أي شيء.",
});

/** Fields whose change is a label/help change only (never a re-approval, ADR-0040 §3). */
const TEXT_ONLY = new Set(["labelEn", "labelAr", "helpEn", "helpAr"]);
/** Element types that belong to a gate (ADR-0040 §3). */
const GATE_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  "gate",
  "gate_criterion",
  "checklist_item",
  "mandatory_artifact",
]);
const ITEM_KINDS: ReadonlySet<string> = new Set([
  "mapping",
  "new_required_field",
  "invalidated_calculation",
  "reapproval",
  "removed_element",
]);
const RESOLUTIONS: ReadonlySet<string> = new Set(["automatic", "needs_input", "provided", "acknowledged"]);

const asRecord = (v: unknown): Readonly<Record<string, unknown>> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const field = (o: Readonly<Record<string, unknown>> | null, name: string): unknown =>
  o === null ? undefined : new Map(Object.entries(o)).get(name);
const textOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The changed field names of a `changed` diff row (resolved attributes). */
function changedFields(c: ConfigElementChange): string[] {
  const a = new Map(Object.entries(c.from ?? {}));
  const b = new Map(Object.entries(c.to ?? {}));
  return [...new Set([...a.keys(), ...b.keys()])]
    .filter((k) => canonicalJson(a.get(k) ?? null) !== canonicalJson(b.get(k) ?? null))
    .sort();
}

/** Is the change more than a label/help text change? (added and removed elements always are) */
function isMaterial(c: ConfigElementChange): boolean {
  if (c.change !== "changed") return true;
  return changedFields(c).some((f) => !TEXT_ONLY.has(f));
}

/** The gate codes a gate-related change concerns (by gate code, else through its phase's closing gate). */
function gatesOf(c: ConfigElementChange, gateByPhase: ReadonlyMap<string, string>): string[] {
  if (c.elementType === "gate") return [c.stableKey];
  const out = new Set<string>();
  for (const side of [c.from, c.to]) {
    const g = textOrNull(field(side, "gateCode"));
    if (g !== null) out.add(g);
    const p = textOrNull(field(side, "phaseCode"));
    const closing = p === null ? undefined : gateByPhase.get(p);
    if (closing !== undefined) out.add(closing);
  }
  return [...out].sort();
}

const labelsOf = (c: ConfigElementChange) => ({
  labelEn: textOrNull(field(c.to, "labelEn")) ?? textOrNull(field(c.from, "labelEn")),
  labelAr: textOrNull(field(c.to, "labelAr")) ?? textOrNull(field(c.from, "labelAr")),
});

/** The approved gates of the transformation with the approved decision a re-approval would name (ADR-0040 §3). */
async function approvedGates(
  db: DbOrTx,
  transformationId: string,
): Promise<Map<string, { gateInstanceId: string; approvedDecisionId: string }>> {
  const instances = await db
    .selectFrom("gate_instance")
    .select(["id", "gate_code"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "approved")
    .execute();
  const out = new Map<string, { gateInstanceId: string; approvedDecisionId: string }>();
  for (const i of instances) {
    const d = await db
      .selectFrom("gate_decision")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .where("gate_code", "=", i.gate_code)
      .where("outcome", "=", "approved")
      .orderBy("decided_at", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst();
    if (d !== undefined) out.set(i.gate_code, { gateInstanceId: i.id, approvedDecisionId: d.id });
  }
  return out;
}

/** A provider item as the hook reports it, checked into the item shape (an unknown kind or resolution fails closed). */
function providerItem(raw: Readonly<Record<string, unknown>>): PlanItem {
  const kind = field(raw, "itemKind");
  const resolution = field(raw, "resolution");
  if (
    typeof kind !== "string" ||
    !ITEM_KINDS.has(kind) ||
    typeof resolution !== "string" ||
    !RESOLUTIONS.has(resolution)
  )
    throw problems.internal();
  const gateCode = textOrNull(field(raw, "gateCode"));
  return {
    itemKind: kind as PlanItemKind,
    elementType: textOrNull(field(raw, "elementType")),
    stableKey: textOrNull(field(raw, "stableKey")),
    recordType: textOrNull(field(raw, "recordType")),
    recordId: textOrNull(field(raw, "recordId")),
    gateCode: kind === "reapproval" ? gateCode : null,
    resolution: resolution as PlanItemResolution,
    detail: asRecord(field(raw, "detail")),
  };
}

/** Applies the admin's inputs to the `new_required_field` items (needs_input -> provided). */
function applyInputs(items: PlanItem[], inputs: ReadonlyMap<string, unknown>): PlanItem[] {
  return items.map((i) => {
    if (i.itemKind !== "new_required_field" || i.stableKey === null || !inputs.has(i.stableKey)) return i;
    const value = inputs.get(i.stableKey) ?? null;
    return {
      ...i,
      resolution: "provided",
      detail: { ...i.detail, providedValue: value, leaveEmptyUntilNextEdit: value === null },
    };
  });
}

/** The stable keys of the items that take an input (for the 400 on an input naming no item). */
export function inputKeysOf(items: readonly PlanItem[]): Set<string> {
  return new Set(
    items.filter((i) => i.itemKind === "new_required_field" && i.stableKey !== null).map((i) => i.stableKey!),
  );
}

/** The SHA-256 of the canonical JSON of a revision's items (ADR-0040 §2). */
export function planSha256(items: readonly PlanItem[]): string {
  const canonical = items.map((i, n) => ({ ordinal: n + 1, ...i }));
  return createHash("sha256").update(canonicalJson(canonical)).digest("hex");
}

/**
 * Builds the plan of moving `transformationId`'s pin from `from` to `to` (same kind and key; the caller checks), with
 * the admin's inputs. Read-only.
 */
export async function buildMigrationPlan(
  db: DbOrTx,
  input: {
    readonly transformationId: string;
    readonly from: MethodologyVersionRow;
    readonly to: MethodologyVersionRow;
    readonly inputs: ReadonlyMap<string, unknown>;
  },
): Promise<Plan> {
  const kind: ConfigKind = configKindSchema.parse(input.to.config_kind);
  const diff = await diffVersions(db, input.to, input.from);
  const items: PlanItem[] = [];
  for (const c of diff.changes) {
    if (c.change === "changed")
      items.push({
        itemKind: "mapping",
        elementType: c.elementType,
        stableKey: c.stableKey,
        recordType: null,
        recordId: null,
        gateCode: null,
        resolution: "automatic",
        detail: {
          ...labelsOf(c),
          mapping: "keep_identity",
          fields: changedFields(c).map((f) => ({
            field: f,
            from: field(c.from, f) ?? null,
            to: field(c.to, f) ?? null,
          })),
        },
      });
    else if (c.change === "removed")
      items.push({
        itemKind: "removed_element",
        elementType: c.elementType,
        stableKey: c.stableKey,
        recordType: null,
        recordId: null,
        gateCode: null,
        resolution: "acknowledged",
        detail: { ...labelsOf(c), recordsKeepReference: true },
      });
  }
  if (kind === "methodology") {
    const approved = await approvedGates(db, input.transformationId);
    const defs = await loadGateDefinitions(db);
    const gateByPhase = new Map(defs.map((d) => [d.phase as string, d.code]));
    const reasons = new Map<string, { elementType: ConfigElementType; stableKey: string; change: string }[]>();
    for (const c of diff.changes) {
      if (!GATE_ELEMENT_TYPES.has(c.elementType) || !isMaterial(c)) continue;
      for (const g of gatesOf(c, gateByPhase)) {
        if (!approved.has(g)) continue;
        const list = reasons.get(g) ?? [];
        list.push({ elementType: c.elementType, stableKey: c.stableKey, change: c.change });
        reasons.set(g, list);
      }
    }
    for (const def of defs) {
      const why = reasons.get(def.code);
      const gate = approved.get(def.code);
      if (why === undefined || gate === undefined) continue;
      items.push({
        itemKind: "reapproval",
        elementType: "gate",
        stableKey: def.code,
        recordType: "gate_instance",
        recordId: gate.gateInstanceId,
        gateCode: def.code,
        resolution: "automatic",
        detail: {
          gateInstanceId: gate.gateInstanceId,
          approvedDecisionId: gate.approvedDecisionId,
          labelEn: def.sourceNameEn,
          labelAr: def.nameAr,
          reasons: why,
          messageKey: "methodology_migration.item.reapproval",
        },
      });
    }
  }
  const provider = configKindProvider(kind);
  if (provider.migrationItems !== undefined) {
    const raw = await provider.migrationItems(db, {
      transformationId: input.transformationId,
      fromVersionId: input.from.id,
      toVersionId: input.to.id,
    });
    for (const r of raw) items.push(providerItem(r));
  } else if (kind !== "methodology" && kind !== "scoring_defaults") {
    // §7: the provider of this kind is not registered yet, so its impact cannot be computed; never "no impact".
    items.push({
      itemKind: "invalidated_calculation",
      elementType: null,
      stableKey: null,
      recordType: null,
      recordId: null,
      gateCode: null,
      resolution: "acknowledged",
      detail: { unknown: true, reason: "provider_not_registered", configKind: kind },
    });
  }
  items.push({
    itemKind: "unchanged_history",
    elementType: null,
    stableKey: null,
    recordType: null,
    recordId: null,
    gateCode: null,
    resolution: "automatic",
    detail: { ...UNCHANGED_HISTORY },
  });
  const resolved = applyInputs(items, input.inputs);
  const ready = resolved.every((i) => i.resolution !== "needs_input" && field(i.detail, "unknown") !== true);
  return { items: resolved, sha256: planSha256(resolved), ready };
}
