import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  DECISION_USE_SUBJECT_TYPE,
  conflict,
  decisionRelianceIssue,
  decisionUseConflict,
  ruleViolation,
  type DecisionRelianceInput,
  type DecisionRelianceIssue,
  type DecisionUseKind,
  type DecisionUseRecord,
  type ExternalEvidenceState,
  type RelianceDecision,
} from '@hub/domain';
import type { DbService } from '../../platform/db.service';
import { loadInProject } from '../../platform/helpers';
import { newId } from '../../platform/ids';

/**
 * Relying on a governance decision — the generic facility (DOM-P2R-03/-04/-05, QA-P2-01, O-1; documented in
 * docs/architecture/module-guide.md "Relying on a governance decision"). Every command that lets a committee decision back
 * one of its records (change-request / baseline / perimeter-version approval, gate cycle decision; P4: JV closing
 * confirmations, approved valuation values, budget-line approvals) does, inside its request transaction:
 *
 *   1. `loadInProject(decision)` + the caller's visibility check (404 outside scope);
 *   2. `lockDecisionForReliance` — `SELECT … FOR UPDATE` on the decision row, then re-reads it with the CURRENT state of its
 *      external-approval evidence and its registered uses: concurrent reliances on one decision serialize here;
 *   3. `decisionRelianceIssue` / `assertDecisionReliance` from @hub/domain (final → evidence still active and verified →
 *      type → raised for this record → not used for another record of the same kind), plus its own module rules;
 *   4. the approval write, then `registerDecisionUse` (a `decision_use` row, unique per decision and kind — the backstop
 *      when a caller forgot the lock: 409 `<prefix>.decision_already_used`).
 */

type DecisionRow = typeof schema.decision.$inferSelect;

/**
 * DOM-P2R-04: the evidence link recorded with each decision's external approval, as it is NOW (status, verified by a second
 * person). Decisions without a recorded link map to null.
 */
export async function decisionExternalEvidence(
  db: DbService,
  projectId: string,
  decisions: Pick<DecisionRow, 'id' | 'externalEvidenceLinkId'>[],
): Promise<Map<string, ExternalEvidenceState | null>> {
  const out = new Map<string, ExternalEvidenceState | null>();
  const ids = [...new Set(decisions.map((d) => d.externalEvidenceLinkId).filter((x): x is string => !!x))];
  const links = ids.length
    ? await db
        .tx()
        .select({ id: schema.evidenceLink.id, status: schema.evidenceLink.status, reviewedBy: schema.evidenceLink.reviewedBy })
        .from(schema.evidenceLink)
        .where(and(eq(schema.evidenceLink.projectId, projectId), inArray(schema.evidenceLink.id, ids)))
    : [];
  const byId = new Map(links.map((l) => [l.id, l]));
  for (const d of decisions) {
    if (!d.externalEvidenceLinkId) {
      out.set(d.id, null);
      continue;
    }
    const l = byId.get(d.externalEvidenceLinkId);
    out.set(d.id, l ? { linkId: l.id, status: l.status, verified: !!l.reviewedBy } : { linkId: d.externalEvidenceLinkId, status: null, verified: false });
  }
  return out;
}

/** Registered uses of a decision (`decision_use` rows). */
export async function decisionUses(db: DbService, projectId: string, decisionId: string): Promise<DecisionUseRecord[]> {
  const rows = await db
    .tx()
    .select({ kind: schema.decisionUse.useKind, subjectType: schema.decisionUse.subjectType, subjectId: schema.decisionUse.subjectId })
    .from(schema.decisionUse)
    .where(and(eq(schema.decisionUse.projectId, projectId), eq(schema.decisionUse.decisionId, decisionId)));
  return rows;
}

/** The fields of a decision the reliance rules read, with its external-approval evidence as it is now. */
export function relianceDecision(d: DecisionRow, externalEvidence: ExternalEvidenceState | null): RelianceDecision {
  return {
    id: d.id,
    code: d.code,
    status: d.status,
    authorityOutcome: d.authorityOutcome,
    externalAuthorityReference: d.externalAuthorityReference,
    decisionTypeKey: d.decisionTypeKey,
    subjectType: d.subjectType,
    subjectId: d.subjectId,
    externalEvidence,
  };
}

export interface LockedDecision {
  /** The decision row, re-read after the lock. */
  row: DecisionRow;
  /** Input for `decisionRelianceIssue` (with the current external evidence). */
  decision: RelianceDecision;
  externalEvidence: ExternalEvidenceState | null;
  /** Uses registered so far (read under the lock). */
  uses: DecisionUseRecord[];
}

/**
 * Locks the decision row until the end of the request transaction (`SELECT … FOR UPDATE`) and re-reads it, its external
 * evidence and its registered uses. Call it AFTER `loadInProject` and the caller's visibility check (so a decision outside
 * the caller's scope is 404 without being locked); a concurrent command relying on the same decision waits here and then
 * sees this command's registered use.
 */
export async function lockDecisionForReliance(db: DbService, projectId: string, decisionId: string): Promise<LockedDecision> {
  await db.tx().execute(sql`select id from decision where id = ${decisionId} and project_id = ${projectId} for update`);
  const row = await loadInProject(db, schema.decision, projectId, decisionId);
  const externalEvidence = (await decisionExternalEvidence(db, projectId, [row])).get(row.id) ?? null;
  return { row, decision: relianceDecision(row, externalEvidence), externalEvidence, uses: await decisionUses(db, projectId, decisionId) };
}

/** A reliance rule: everything `decisionRelianceIssue` needs except the decision's state and its registered uses. */
export type RelianceRule = Omit<DecisionRelianceInput, 'decision' | 'uses'>;

/**
 * The reliance issue of a decision as it is NOW, without locking it: its CURRENT external-approval evidence and its
 * registered uses (P4 consumers: the pre-check before the row lock, a reliance that does not consume the decision, and the
 * state shown next to a record). Null issue when the decision backs the record.
 */
export async function currentDecisionReliance(
  db: DbService,
  projectId: string,
  row: DecisionRow,
  rule: RelianceRule,
): Promise<{ issue: DecisionRelianceIssue | null; uses: DecisionUseRecord[]; externalEvidence: ExternalEvidenceState | null }> {
  const externalEvidence = (await decisionExternalEvidence(db, projectId, [row])).get(row.id) ?? null;
  const uses = await decisionUses(db, projectId, row.id);
  return { issue: decisionRelianceIssue({ ...rule, decision: relianceDecision(row, externalEvidence), uses }), uses, externalEvidence };
}

/**
 * `currentDecisionReliance`, thrown as a 422 business-rule violation (`<codePrefix>.decision_*`). Returns the uses it read,
 * for `lockDecisionAndRecheck` (a command that consumes the decision) — a reliance that does not consume it (e.g. a CP
 * long-stop extension, an opening balance) needs nothing more.
 */
export async function assertCurrentDecisionReliance(db: DbService, projectId: string, row: DecisionRow, rule: RelianceRule): Promise<DecisionUseRecord[]> {
  const r = await currentDecisionReliance(db, projectId, row, rule);
  if (r.issue) throw ruleViolation(r.issue.code, r.issue.reason, r.issue.params);
  return r.uses;
}

/**
 * For a command that CONSUMES the decision (a registered use — JV closing, valuation model version, budget line), after its
 * unlocked pre-check (`assertCurrentDecisionReliance`, 422 when the decision is already used): locks the decision row
 * (`SELECT … FOR UPDATE`, until the end of the request transaction), re-reads it with its evidence and uses and re-checks the
 * rule. A use of the same kind for ANOTHER record that was not among `usesBefore` was registered meanwhile by a concurrent
 * command relying on the same decision: 409 `<codePrefix>.decision_already_used`. Any other issue (the decision or its
 * evidence changed meanwhile) is 422. Then write the record and `registerDecisionUse` (its unique index is the backstop).
 */
export async function lockDecisionAndRecheck(db: DbService, projectId: string, decisionId: string, rule: RelianceRule, usesBefore: readonly DecisionUseRecord[]): Promise<LockedDecision> {
  const locked = await lockDecisionForReliance(db, projectId, decisionId);
  const issue = decisionRelianceIssue({ ...rule, decision: locked.decision, uses: locked.uses });
  if (issue) {
    if (issue.kind === 'already_used' && rule.use.kind && !decisionUseConflict(usesBefore, rule.use.kind, rule.use.subjectId)) {
      throw conflict(issue.code, `${issue.reason} (a concurrent command relied on it first)`, issue.params);
    }
    throw ruleViolation(issue.code, issue.reason, issue.params);
  }
  return locked;
}

/**
 * Records, in the request transaction, that `decisionId` backs `subjectId` for `kind`. A unique violation (another command
 * registered the decision for this kind first — only possible when a caller relied on it without the lock) is answered
 * 409 `<codePrefix>.decision_already_used`. `onExisting: 'keep'` (e.g. a gate REJECTION citing a decision): an existing use
 * of the decision for this kind is kept and nothing is written.
 */
export async function registerDecisionUse(
  db: DbService,
  input: {
    orgId: string;
    projectId: string;
    decisionId: string;
    decisionCode: string;
    kind: DecisionUseKind;
    subjectId: string;
    usedBy: string | null;
    codePrefix: string;
    onExisting?: 'conflict' | 'keep';
  },
): Promise<void> {
  const values = {
    id: newId(),
    orgId: input.orgId,
    projectId: input.projectId,
    decisionId: input.decisionId,
    useKind: input.kind,
    subjectType: DECISION_USE_SUBJECT_TYPE[input.kind],
    subjectId: input.subjectId,
    usedBy: input.usedBy,
  };
  if (input.onExisting === 'keep') {
    await db.tx().insert(schema.decisionUse).values(values).onConflictDoNothing();
    return;
  }
  try {
    await db.tx().insert(schema.decisionUse).values(values);
  } catch (e) {
    if (isUniqueViolation(e, ['decision_use_kind_uq'])) {
      throw conflict(`${input.codePrefix}.decision_already_used`, `Decision ${input.decisionCode} already backs another record of this kind (concurrent approval) — one decision backs one record of each kind`, {
        decisionId: input.decisionId,
      });
    }
    throw e;
  }
}

/** A PostgreSQL unique violation of one of the given indexes (walks the driver error's cause chain). */
export function isUniqueViolation(e: unknown, constraints: readonly string[]): boolean {
  for (let x = e as { code?: string; constraint?: string; cause?: unknown } | undefined, i = 0; x && i < 5; x = x.cause as typeof x, i++) {
    if (x.code === '23505' && x.constraint && constraints.includes(x.constraint)) return true;
  }
  return false;
}
