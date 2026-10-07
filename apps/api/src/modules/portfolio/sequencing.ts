// Sequencing rules of the playbook as one set of PURE functions (ADR-0021 §3-§5; B0009, B0032; REQ-PB-004, REQ-PB-007,
// REQ-PB-022). The initiative transitions (BE-B), the readiness view (§9) and the web read the same answers; no route
// re-implements a rule.
//
//  - Entering the portfolio (submit, select; launch while still draft): G1 approved, or (Modular) an inherited approval
//    of G1 that COUNTS (accepted by another person, evidence verified, not revoked; ADR-0021 §5).
//  - Launch, End-to-End only: G2 AND G3 approved, or an active accepted waiver for each missing gate (for the whole
//    transformation or for this initiative). Modular transformations enter later and are not held to it.
//
// A dispensation never approves a gate: it only satisfies the sequencing precondition it names. Product gates G1-G6 are
// business approvals inside the product; nothing here touches the engineering gates DG0-DG7.
import type { Warning } from "@mth/shared/schemas";

/** The exact English texts of ADR-0021 §3 (the web translates `code`). */
export const SEQUENCING_REASONS = {
  "initiative.g1_not_approved":
    "Case for change not yet approved (G1): leadership agreement on problem, baseline and material value pools is required before an initiative enters the portfolio",
  "initiative.direction_not_approved": "North Star, outcomes and target state not yet approved",
} as const;
export type SequencingCode = keyof typeof SEQUENCING_REASONS;

/** `{ ok }` when the rule is satisfied, otherwise the 422 `code` and its exact English reason. */
export type SequencingResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: SequencingCode; readonly reasonEn: string };

export type SequencingGate = "G1" | "G2" | "G3";

/** A gate dispensation as the rules see it; `counts` is computed by dispensations.ts (accepted, current, verified). */
export interface DispensationFact {
  readonly kind: "inherited_approval" | "waiver";
  readonly gateCode: SequencingGate;
  /** null: the whole transformation (waivers may name one initiative). */
  readonly initiativeId: string | null;
  readonly counts: boolean;
}

export interface SequencingFacts {
  readonly mode: "end_to_end" | "modular";
  /** The gate_instance status of G1-G3 (missing = not approved). */
  readonly gates: Readonly<Partial<Record<SequencingGate, string>>>;
  readonly dispensations: readonly DispensationFact[];
}

const OK: SequencingResult = Object.freeze({ ok: true });
const REASONS: ReadonlyMap<string, string> = new Map(Object.entries(SEQUENCING_REASONS));
const fail = (code: SequencingCode): SequencingResult =>
  Object.freeze({ ok: false, code, reasonEn: REASONS.get(code) ?? code });

const approved = (f: SequencingFacts, gate: SequencingGate) =>
  Object.entries(f.gates).some(([g, status]) => g === gate && status === "approved");

/** Does a counting inherited approval exist for the gate? Only a Modular transformation inherits approvals (§5). */
export function hasInheritedApproval(f: SequencingFacts, gate: SequencingGate): boolean {
  return (
    f.mode === "modular" &&
    f.dispensations.some((d) => d.kind === "inherited_approval" && d.gateCode === gate && d.counts)
  );
}

/**
 * Does a counting waiver exist for the gate? A waiver for the whole transformation (initiativeId null) applies to every
 * initiative; one naming an initiative applies to that initiative only. `initiativeId` undefined = transformation-wide
 * view (readiness): only transformation-wide waivers count.
 */
export function hasWaiver(f: SequencingFacts, gate: SequencingGate, initiativeId?: string): boolean {
  return f.dispensations.some(
    (d) =>
      d.kind === "waiver" &&
      d.gateCode === gate &&
      d.counts &&
      (d.initiativeId === null || (initiativeId !== undefined && d.initiativeId === initiativeId)),
  );
}

/** G1 approved, or (Modular) a counting inherited approval of G1: may an initiative enter the portfolio? */
export function checkG1(f: SequencingFacts): SequencingResult {
  return approved(f, "G1") || hasInheritedApproval(f, "G1") ? OK : fail("initiative.g1_not_approved");
}

/**
 * End-to-End vs Modular launch rule (B0009): End-to-End needs G2 and G3 approved, or a counting waiver for each missing
 * one (for the transformation or `initiativeId`). Modular transformations are not held to it (they entered later).
 */
export function checkDirectionForLaunch(f: SequencingFacts, initiativeId?: string): SequencingResult {
  if (f.mode === "modular") return OK;
  for (const gate of ["G2", "G3"] as const) {
    if (!approved(f, gate) && !hasWaiver(f, gate, initiativeId)) return fail("initiative.direction_not_approved");
  }
  return OK;
}

/** Submit for prioritization (draft -> submitted) and selection: the G1 rule (ADR-0021 §3). */
export function checkSubmit(f: SequencingFacts): SequencingResult {
  return checkG1(f);
}

/**
 * The sequencing preconditions of launch, in ADR-0021 §3 order: G1 (only while the initiative is still draft), then
 * End-to-End direction. Status preconditions (selected-unfunded, not launchable) stay in the transition (BE-B).
 */
export function checkLaunch(
  f: SequencingFacts,
  initiative: { readonly id: string; readonly status: string },
): SequencingResult {
  if (initiative.status === "draft") {
    const g1 = checkG1(f);
    if (!g1.ok) return g1;
  }
  return checkDirectionForLaunch(f, initiative.id);
}

/** Every failing sequencing precondition as `Warning`s (code + exact English text), for errors[] and readiness. */
export function blockersOf(results: readonly SequencingResult[]): Warning[] {
  const out: Warning[] = [];
  for (const r of results)
    if (!r.ok && !out.some((w) => w.code === r.code)) out.push({ code: r.code, message: r.reasonEn });
  return out;
}

/** The transformation-wide view (readiness, §4): can initiatives be submitted / launched, and what blocks them. */
export function sequencingState(f: SequencingFacts): {
  readonly canSubmit: boolean;
  readonly canLaunch: boolean;
  readonly blockers: Warning[];
} {
  const submit = checkSubmit(f);
  const direction = checkDirectionForLaunch(f);
  return {
    canSubmit: submit.ok,
    canLaunch: submit.ok && direction.ok,
    blockers: blockersOf([submit, direction]),
  };
}
