// The compatibility check of a draft (ADR-0039 §5; REQ-S06-007; p5-work-split §A.2; T-DG5-BE-B). Every element
// change against the base is classified:
//  - label and help text only (labels, help, methodology body text)                      -> compatible
//  - a removed element; an added element marked mandatory (a new required element/field);
//    a changed approver (default approver, approver roles, routing mode)                  -> warn
//  - any other behavioural attribute change (submission switch, mandatory flag, offsets,
//    recipients, gate/phase references, sections, formula references)                     -> warn
//  - an invariant break or an element whose stored attributes the kind rejects (invariants.ts), and the kind
//    provider's own findings (the methodology provider: an unknown role, gate, phase, template or criterion)  -> fail
// `pass` and `warn` are publishable, `fail` is not (the 0062 guard's methodology_version_checks_required). A warn lists
// the transformations pinned to the lineage in the caller's organization: they stay pinned (ADR-0040 maps them).
import type { DbOrTx } from "@mth/db";
import { configKind } from "@mth/shared/schemas";
import { baseOf, lineageTransformations } from "./affected-records.ts";
import { diffVersions } from "./diff.ts";
import type { MethodologyVersionRow } from "./drafts.ts";
import { APPROVER_FIELDS, elementRowFindings } from "./invariants.ts";
import { configKindProvider, type CompatibilityFinding, type ConfigElementChange } from "./kinds.ts";

const TEXT_FIELDS: ReadonlySet<string> = new Set(["labelEn", "labelAr", "helpEn", "helpAr", "bodyEn", "bodyAr"]);
const APPROVER: ReadonlySet<string> = new Set([...APPROVER_FIELDS, "mode"]);

export interface CheckOutcome {
  readonly result: "pass" | "warn" | "fail";
  readonly report: Record<string, unknown>;
}

function changedFields(c: ConfigElementChange): string[] {
  const a = new Map(Object.entries(c.from ?? {}));
  const b = new Map(Object.entries(c.to ?? {}));
  return [...new Set([...a.keys(), ...b.keys()])].filter(
    (k) => JSON.stringify(a.get(k) ?? null) !== JSON.stringify(b.get(k) ?? null),
  );
}

/** The ADR-0039 §5 classification of one change: null = compatible. */
export function classifyChange(c: ConfigElementChange): CompatibilityFinding | null {
  const at = { elementType: c.elementType, stableKey: c.stableKey };
  if (c.change === "removed") return { severity: "warn", code: "compatibility.element_removed", ...at, params: {} };
  if (c.change === "added") {
    const mandatory = new Map(Object.entries(c.to ?? {})).get("mandatory") === true;
    return mandatory ? { severity: "warn", code: "compatibility.required_element_added", ...at, params: {} } : null;
  }
  const fields = changedFields(c);
  if (fields.length === 0 || fields.every((f) => TEXT_FIELDS.has(f))) return null;
  if (fields.some((f) => APPROVER.has(f)))
    return { severity: "warn", code: "compatibility.approver_changed", ...at, params: { fields: fields.join(",") } };
  return { severity: "warn", code: "compatibility.behaviour_changed", ...at, params: { fields: fields.join(",") } };
}

/** Runs the compatibility check of `version` (the caller records it as a check run). */
export async function runCompatibility(
  db: DbOrTx,
  version: MethodologyVersionRow,
  organizationId: string,
): Promise<CheckOutcome> {
  const base = await baseOf(db, version);
  const { changes } = await diffVersions(db, version, base);
  const findings: CompatibilityFinding[] = [];
  const compatible: { elementType: string; stableKey: string; change: string }[] = [];
  for (const c of changes) {
    const f = classifyChange(c);
    if (f === null) compatible.push({ elementType: c.elementType, stableKey: c.stableKey, change: c.change });
    else findings.push(f);
  }
  findings.push(...(await elementRowFindings(db, version)));
  const hook = configKindProvider(configKind.parse(version.config_kind)).compatibility;
  if (hook !== undefined)
    findings.push(...(await hook(db, { versionId: version.id, baseVersionId: base.id, changes })));
  const result = findings.some((f) => f.severity === "fail")
    ? "fail"
    : findings.some((f) => f.severity === "warn")
      ? "warn"
      : "pass";
  const affected =
    result === "pass"
      ? []
      : (await lineageTransformations(db, version, organizationId)).map((t) => ({
          transformationId: t.transformationId,
          code: t.code,
          pinnedVersionId: t.pinnedVersionId,
        }));
  return {
    result,
    report: {
      schema: "mth.config-compatibility/1",
      baseVersionId: base.id,
      changeCount: changes.length,
      compatible,
      findings: findings.map((f) => ({ ...f, params: { ...f.params } })),
      affectedTransformations: affected,
    },
  };
}
