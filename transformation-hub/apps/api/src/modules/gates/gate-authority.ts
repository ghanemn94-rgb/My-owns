import { and, eq, inArray, or } from 'drizzle-orm';
import { schema } from '@hub/db';
import { gateAuthorityOf, type GateDecisionAuthority } from '@hub/domain';
import type { DbService } from '../../platform/db.service';

type DecisionRow = Pick<typeof schema.decision.$inferSelect, 'id' | 'committeeId' | 'tallySnapshot' | 'decisionTypeKey'>;

/**
 * DOM-P2-01: the approved authority matrix of each decision's DECIDING committee — the version recorded with the committee
 * outcome (tally snapshot), or, before an outcome, the committee's latest approved version — and the decision's type in
 * it. A committee without an approved matrix yields `matrixVersionId: null` (the decision cannot back a gate). Shared by
 * gate decisions and every approval that must be backed by a gate decision (e.g. the perimeter version, G1).
 */
export async function gateDecisionAuthorities(db: DbService, projectId: string, decisions: DecisionRow[]): Promise<Map<string, GateDecisionAuthority>> {
  const out = new Map<string, GateDecisionAuthority>();
  if (!decisions.length) return out;
  const recorded = (d: DecisionRow) => {
    const id = (d.tallySnapshot as { matrixVersionId?: unknown } | null)?.matrixVersionId;
    return typeof id === 'string' ? id : null;
  };
  const ids = [...new Set(decisions.map(recorded).filter((x): x is string => !!x))];
  const committees = [...new Set(decisions.map((d) => d.committeeId))];
  const M = schema.authorityMatrixVersion;
  const rows = await db
    .tx()
    .select({ id: M.id, committeeId: M.committeeId, status: M.status, versionNo: M.versionNo, policy: M.policy })
    .from(M)
    .where(and(eq(M.projectId, projectId), or(...(ids.length ? [inArray(M.id, ids)] : []), and(inArray(M.committeeId, committees), eq(M.status, 'approved')))));
  for (const d of decisions) {
    const rid = recorded(d);
    // The outcome's matrix (approved at the time; possibly superseded since) — never a draft, never another committee's.
    const m = rid
      ? rows.find((r) => r.id === rid && r.committeeId === d.committeeId && r.status !== 'draft')
      : rows.filter((r) => r.committeeId === d.committeeId && r.status === 'approved').sort((a, b) => b.versionNo - a.versionNo)[0];
    out.set(d.id, gateAuthorityOf(m ? { id: m.id, policy: m.policy as { decisionTypes?: { key: string; gateKeys?: string[]; withinCommitteeAuthority: boolean }[] } } : null, d.decisionTypeKey));
  }
  return out;
}
