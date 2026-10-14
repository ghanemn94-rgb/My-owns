// Invariant protection of Studio element edits (ADR-0039 §2, §13; REQ-S06-006; p5-work-split §A.2; T-DG5-BE-B).
//
// The API refuses first, with the §13 codes, everything the 0062/0068 database guards refuse (reaching a guard is a
// programming error, p5-work-split §A.10 item 2):
//  - an element type the version's kind does not accept, or an identity that does not exist -> 422 unknown_element;
//  - a changed stable identifier (an identity field inside the attributes that differs from the path, a changed
//    origin, or a new position of a fixed source element) -> 422 stable_id_change;
//  - adding or deleting a source phase, gate or TOM dimension -> 422 source_element_protected (D-142 Q4);
//  - an administrator role (role kind technical_admin) or AUD as an approver -> 422 admin_approver_forbidden;
//  - the attributes' Zod shape of the element type -> 400 (never an unvalidated blob).
// The kind's provider then adds its own checks (the methodology provider: a gate approver inside the DG2 allowed set,
// 422 approver_not_allowed; providers/methodology-kind.ts).
// `elementRowFindings` re-runs the same rules over every stored row of a version, for preview and compatibility.
import type { DbOrTx } from "@mth/db";
import { configKind, type ConfigElementType, type ConfigKind } from "@mth/shared/schemas";
import { HttpProblem, parse } from "../platform/index.ts";
import { loadCatalogue } from "./config-resolver.ts";
import type { MethodologyVersionRow } from "./drafts.ts";
import { studioRefusals } from "./drafts.ts";
import {
  configKindProvider,
  elementAttributeSchema,
  kindAcceptsElementType,
  type CompatibilityFinding,
} from "./kinds.ts";

/** Phases, gates and TOM dimensions: never added, never removed, never re-ordered (REQ-S02-001, D-142 Q4). */
export const FIXED_SET_TYPES: ReadonlySet<string> = new Set(["phase", "gate", "tom_dimension"]);
/** Element types whose identities come from a catalogue (the 0062 `methodology_element_source_identity` list). */
const CATALOGUE_TYPES: ReadonlySet<string> = new Set([
  "phase",
  "gate",
  "tom_dimension",
  "gate_criterion",
  "template",
  "source_element",
]);
/** The six T06 criteria (the 0062 guard's list for scoring rows). */
const SCORING_KEYS: ReadonlySet<string> = new Set([
  "strategic_fit",
  "financial_value",
  "customer_impact",
  "feasibility",
  "time_to_value",
  "risk_compliance",
]);
const SCORING_TYPES: ReadonlySet<string> = new Set(["scoring_weight", "scoring_rubric"]);
/** Attribute names that would carry an identity; a differing value is a stable-identifier change. */
const IDENTITY_FIELDS = ["stableKey", "code", "key", "elementType", "origin", "id"] as const;
/** The attributes that name an approver role (the 0062 guard's `methodology_element_no_admin_approver` list). */
export const APPROVER_FIELDS = ["approverRoleCode", "approverRoleCodes", "defaultApproverRoleCode"] as const;

export interface ElementIdentity {
  readonly stableKey: string;
  readonly ordinal: number;
}

/** The catalogue identity of `(type, key)`, or null (types without a catalogue have none). */
export async function catalogueIdentity(
  db: DbOrTx,
  type: ConfigElementType,
  stableKey: string,
): Promise<ElementIdentity | null> {
  if (SCORING_TYPES.has(type)) return SCORING_KEYS.has(stableKey) ? { stableKey, ordinal: 0 } : null;
  if (!CATALOGUE_TYPES.has(type)) return null;
  const found = (await loadCatalogue(db, type)).find((c) => c.stableKey === stableKey);
  return found === undefined ? null : { stableKey: found.stableKey, ordinal: found.ordinal };
}

/** The stored element row of a version, or undefined. */
export async function loadElementRow(db: DbOrTx, versionId: string, type: string, stableKey: string) {
  return db
    .selectFrom("methodology_element")
    .selectAll()
    .where("methodology_version_id", "=", versionId)
    .where("element_type", "=", type)
    .where("stable_key", "=", stableKey)
    .executeTakeFirst();
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};

/** Every approver role code named by an attributes object (strings only; the Zod shape checks the rest). */
export function approverRoleCodes(attributes: Readonly<Record<string, unknown>>): string[] {
  const a = new Map(Object.entries(attributes));
  const out: string[] = [];
  for (const f of APPROVER_FIELDS) {
    const v = a.get(f);
    if (typeof v === "string") out.push(v);
    if (Array.isArray(v)) for (const x of v) if (typeof x === "string") out.push(x);
  }
  return out;
}

/** The role rows of the given codes (code -> kind). */
export async function loadRoles(db: DbOrTx, codes: readonly string[]): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const rows = await db
    .selectFrom("role")
    .select(["code", "kind"])
    .where("code", "in", [...new Set(codes)])
    .execute();
  return new Map(rows.map((r) => [r.code, r.kind]));
}

/**
 * REQ-S06-006, REQ-S10-003: no technical administrator and not the auditor as an approver (422
 * admin_approver_forbidden). An approver role that does not exist is refused as an unknown methodology element (422
 * unknown_element): ADR-0039 §13 has no dedicated code (proposed in the T-DG5-BE-B handback).
 */
export async function assertApproversAllowed(db: DbOrTx, attributes: Readonly<Record<string, unknown>>): Promise<void> {
  const codes = approverRoleCodes(attributes);
  const roles = await loadRoles(db, codes);
  for (const c of codes) {
    const kind = roles.get(c);
    if (kind === "technical_admin" || c === "AUD") throw studioRefusals.adminApproverForbidden();
  }
  for (const c of codes) if (!roles.has(c)) throw studioRefusals.unknownElement();
}

export interface PreparedElementPut {
  readonly existing: Awaited<ReturnType<typeof loadElementRow>>;
  readonly origin: "source" | "admin";
  readonly ordinal: number | null;
  readonly attributes: Record<string, unknown>;
}

/**
 * Validates a put of `(type, key)` into `version` (ADR-0039 §2) and returns the row to write. Throws the §13 refusal
 * or a 400 for the attributes' shape. The kind's provider hook runs last.
 */
export async function prepareElementPut(
  db: DbOrTx,
  version: MethodologyVersionRow,
  type: ConfigElementType,
  stableKey: string,
  body: {
    readonly origin?: "source" | "admin" | undefined;
    readonly ordinal?: number | null | undefined;
    readonly attributes: unknown;
  },
): Promise<PreparedElementPut> {
  const kind: ConfigKind = configKind.parse(version.config_kind);
  if (!kindAcceptsElementType(kind, type)) throw studioRefusals.unknownElement();
  const existing = await loadElementRow(db, version.id, type, stableKey);
  const identity = await catalogueIdentity(db, type, stableKey);
  const fixed = FIXED_SET_TYPES.has(type);

  // Origin: a stored row keeps its origin; else a catalogue identity is a source element, anything else admin-added.
  const derived: "source" | "admin" =
    existing !== undefined
      ? existing.origin === "admin"
        ? "admin"
        : "source"
      : identity !== null
        ? "source"
        : "admin";
  if (fixed && identity === null) throw studioRefusals.sourceElementProtected(); // a seventh gate, an eleventh dimension
  if (SCORING_TYPES.has(type) && identity === null) throw studioRefusals.unknownElement();
  if (body.origin !== undefined && body.origin !== derived) {
    if (fixed) throw studioRefusals.sourceElementProtected();
    // A source origin claimed for something that is not a source identity: the element does not exist.
    if (existing === undefined && body.origin === "source") throw studioRefusals.unknownElement();
    throw studioRefusals.stableIdChange();
  }

  // Identity fields inside the attributes: a differing value is an attempt to change the stable identifier.
  const attributes = asRecord(body.attributes);
  const expected = new Map<string, string>([
    ["stableKey", stableKey],
    ["code", stableKey],
    ["key", stableKey],
    ["elementType", type],
    ["origin", derived],
  ]);
  const given = new Map(Object.entries(attributes));
  for (const f of IDENTITY_FIELDS) {
    if (!given.has(f)) continue;
    if (given.get(f) !== expected.get(f)) throw studioRefusals.stableIdChange();
    given.delete(f);
  }
  const cleaned = Object.fromEntries(given);

  // The position of a fixed source element is part of its identity (G3 is the third gate).
  const ordinal = body.ordinal !== undefined ? body.ordinal : (existing?.ordinal ?? null);
  if (fixed && body.ordinal !== undefined && body.ordinal !== null && body.ordinal !== identity?.ordinal)
    throw studioRefusals.stableIdChange();

  const parsed = parse(elementAttributeSchema(type), cleaned, "body") as Record<string, unknown>;
  await assertApproversAllowed(db, parsed);
  const hook = configKindProvider(kind).validateElement;
  if (hook !== undefined)
    await hook(db, { versionId: version.id, elementType: type, stableKey, origin: derived, attributes: parsed });
  return { existing, origin: derived, ordinal: fixed ? null : ordinal, attributes: parsed };
}

/** Validates a removal of `(type, key)` from `version` and returns the stored row (if any) and its origin. */
export async function prepareElementRemove(
  db: DbOrTx,
  version: MethodologyVersionRow,
  type: ConfigElementType,
  stableKey: string,
): Promise<{ existing: Awaited<ReturnType<typeof loadElementRow>>; origin: "source" | "admin" }> {
  const kind: ConfigKind = configKind.parse(version.config_kind);
  if (!kindAcceptsElementType(kind, type)) throw studioRefusals.unknownElement();
  const existing = await loadElementRow(db, version.id, type, stableKey);
  const identity = await catalogueIdentity(db, type, stableKey);
  // Deleting a source phase, gate or TOM dimension is refused (REQ-S06-006 "deleting a TOM dimension ... is rejected").
  if (FIXED_SET_TYPES.has(type))
    throw identity === null ? studioRefusals.unknownElement() : studioRefusals.sourceElementProtected();
  if (existing === undefined && identity === null) throw studioRefusals.unknownElement();
  return { existing, origin: existing !== undefined ? (existing.origin === "admin" ? "admin" : "source") : "source" };
}

/** One problem of a stored row, as a compatibility/preview finding (ADR-0039 §5 "an invariant break ... fail"). */
function finding(code: string, type: string, key: string, params: CompatibilityFinding["params"] = {}) {
  return { severity: "fail" as const, code, elementType: type as ConfigElementType, stableKey: key, params };
}

/**
 * Re-runs the element rules over every stored row of a version (shape, identity, approvers, the provider's
 * validateElement): each failure is a `fail` finding with the refusal code. Used by preview (the kind's invariant
 * checks) and compatibility ("an invariant break, or an element the kind's provider rejects").
 */
export async function elementRowFindings(db: DbOrTx, version: MethodologyVersionRow): Promise<CompatibilityFinding[]> {
  const kind: ConfigKind = configKind.parse(version.config_kind);
  const rows = await db
    .selectFrom("methodology_element")
    .select(["element_type", "stable_key", "origin", "removed", "attributes"])
    .where("methodology_version_id", "=", version.id)
    .orderBy("element_type")
    .orderBy("stable_key")
    .execute();
  const hook = configKindProvider(kind).validateElement;
  const out: CompatibilityFinding[] = [];
  for (const r of rows) {
    const type = r.element_type as ConfigElementType;
    if (!kindAcceptsElementType(kind, type)) {
      out.push(finding("config_version.unknown_element", r.element_type, r.stable_key));
      continue;
    }
    if (FIXED_SET_TYPES.has(type) && (r.removed || r.origin !== "source")) {
      out.push(finding("config_version.source_element_protected", r.element_type, r.stable_key));
      continue;
    }
    if (
      r.origin === "source" &&
      (await catalogueIdentity(db, type, r.stable_key)) === null &&
      CATALOGUE_TYPES.has(type)
    ) {
      out.push(finding("config_version.unknown_element", r.element_type, r.stable_key));
      continue;
    }
    if (r.removed) continue; // a removed element's attributes are not in effect
    const shape = elementAttributeSchema(type).safeParse(r.attributes);
    if (!shape.success) {
      out.push(finding("validation.attributes", r.element_type, r.stable_key));
      continue;
    }
    const attrs = shape.data as Record<string, unknown>;
    try {
      await assertApproversAllowed(db, attrs);
      if (hook !== undefined)
        await hook(db, {
          versionId: version.id,
          elementType: type,
          stableKey: r.stable_key,
          origin: r.origin === "admin" ? "admin" : "source",
          attributes: attrs,
        });
    } catch (e) {
      if (!(e instanceof HttpProblem)) throw e;
      out.push(finding(e.code, r.element_type, r.stable_key));
    }
  }
  return out;
}
