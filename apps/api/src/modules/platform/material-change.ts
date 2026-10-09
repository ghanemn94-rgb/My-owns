// The material-change port (P4 slice H; ADR-0036 §3, §6; T-DG4-BE-L). Modules that cannot import workflows (kpi:
// workflows depends on kpi) or that should not read the change-control policy themselves (portfolio) reach change
// control through this interface, in their own editing transaction. workflows/change-requests.ts implements it; the
// composition root (server.ts) wires it with `setMaterialChangePort`, the GateFactsProvider pattern.
// The port only RAISES a request or REFUSES a direct edit beyond a configured threshold: deciding a request is a person's
// business approval (ADR-0026 §4). Nothing here touches the engineering gates DG0-DG7.
import type { DbOrTx, Tx } from "@mth/db";

/** A new version of a T09 benefit formula was inserted (DG3 `POST /benefit-formulas/{id}/versions`). */
export interface BenefitFormulaVersionChange {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly benefitFormulaId: string;
  readonly benefitFormulaVersionId: string;
  readonly versionNo: number;
  /** The person who saved the version; the automatic request is raised in their name (`origin = 'automatic'`). */
  readonly editorUserId: string;
  readonly requestId: string;
  readonly changeNote: string | null;
}

export interface MaterialChangePort {
  /**
   * Called after a new formula version is inserted. When a version of the formula is pinned by an APPROVED G4
   * submission snapshot, raises and submits one `benefit_logic` change request (under the change-request subject
   * lock); otherwise does nothing. Never changes the caller's response.
   */
  readonly benefitFormulaVersionCreated: (tx: Tx, change: BenefitFormulaVersionChange) => Promise<void>;
  /**
   * DG3 `POST /milestones/{id}/approve-date`: a RE-approval whose working-day shift exceeds a CONFIGURED threshold is
   * refused 422 `milestone.rebaseline_requires_change_request`; without a threshold nothing changes.
   */
  readonly assertMilestoneDateWithinThreshold: (
    db: DbOrTx,
    organizationId: string,
    transformationId: string,
    approvedFrom: string | null,
    approvedTo: string,
  ) => Promise<void>;
  /**
   * BE-E's budget-line update: a change of an existing budget amount beyond a CONFIGURED ratio is refused 422
   * `budget_line.rebaseline_requires_change_request`; without a threshold, or for a first amount, nothing changes.
   */
  readonly assertBudgetChangeWithinThreshold: (
    db: DbOrTx,
    transformationId: string,
    from: string | null,
    to: string | null,
  ) => Promise<void>;
}

let port: MaterialChangePort | null = null;

/** The composition root wires the implementation (registration time); null unwires it (tests). */
export function setMaterialChangePort(next: MaterialChangePort | null): void {
  port = next;
}

/** The wired port, or null when the server was built without it (the callers then fail closed with 500). */
export function materialChangePort(): MaterialChangePort | null {
  return port;
}
