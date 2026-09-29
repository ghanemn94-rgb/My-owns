import { and, eq, inArray, or, isNotNull, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { DomainError, FINAL_APPROVED_DECISION_STATUSES } from '@hub/domain';
import type { ModuleSeed } from '../../cli/seed-modules';
import { DbService } from '../../platform/db.service';
import { GatesService } from './gates.service';
import { StatusDimensionsService } from './status-dimensions.service';
import { EvidenceService } from '../documents/evidence.service';

const DEMO_EVIDENCE = (key: string) => `DEMO — synthetic note evidence for ${key} (no real document; illustrates the evidence → review flow)`;

/**
 * Demo sandbox scenario for gates (idempotent; everything goes through the gates services so policy, audit and outbox
 * apply). Tolerant of absent governance/documents seeds:
 *  - evidence is linked through the documents module (note evidence, clearly labelled demo) where a criterion has none —
 *    the documents seed already links the demo charter excerpt to the first criterion (G0-C01);
 *  - G0 is approved ONLY if an approved demo governance decision raised for G0 exists — otherwise it is left
 *    ready_for_decision (a gate approval without a final decision is refused by the server, AT-04).
 * Scenario: G0 approved (or ready), G1 in assessment with some criteria met, G2 in assessment, G5 in assessment in
 * parallel with separation (AT-11), one REJECTED waiver request on a non-waivable criterion (AT-13), dimensions recomputed.
 */
export const gatesSeed: ModuleSeed = {
  name: 'gates',
  run: async ({ app, dcProjectId: pid, asUser, log }) => {
    const gates = app.get(GatesService);
    const dims = app.get(StatusDimensionsService);
    const db = app.get(DbService);
    const evidence = app.get(EvidenceService);

    const list = await asUser('pm', (ctx) => gates.listGates(ctx, pid));
    const gateId = (key: string) => {
      const g = list.items.find((x) => x.key === key);
      if (!g) throw new Error(`gate ${key} missing in demo project`);
      return g.id;
    };
    const detail = (key: string) => asUser('pm', (ctx) => gates.getGate(ctx, pid, gateId(key)));
    const criterion = async (gateKey: string, critKey: string) => {
      const g = await detail(gateKey);
      const c = g.criteria.find((x) => x.key === critKey);
      if (!c) throw new Error(`criterion ${critKey} missing`);
      return { g, c };
    };
    const start = async (key: string) => {
      const g = await detail(key);
      if (g.assessment.status === 'not_started') {
        await asUser('pm', (ctx) => gates.startAssessment(ctx, pid, g.id, { expectedVersion: g.assessment.version, note: 'Demo sandbox scenario' }));
      }
    };
    /** Evidence added by the PM (evidence owner), accepted by a different reviewer (Legal) — separation of duties. */
    const meet = async (gateKey: string, critKey: string) => {
      let { g, c } = await criterion(gateKey, critKey);
      if (c.assessment.status === 'met') return;
      if (c.evidence.active === 0) {
        await asUser('pm', (ctx) => evidence.link(ctx, pid, { targetType: 'gate_criterion', targetId: c.id, note: DEMO_EVIDENCE(critKey), purpose: 'Demo sandbox — synthetic note evidence (no real document)' }));
        ({ g, c } = await criterion(gateKey, critKey));
      }
      await asUser('legal', (ctx) => gates.reviewCriterion(ctx, pid, g.id, c.id, { expectedVersion: c.assessment.version, outcome: 'met', note: 'Demo review of synthetic evidence' }));
    };

    // G0 — Mandate & Governance: all mandatory criteria met with (demo) evidence.
    await start('G0');
    for (const k of ['G0-C01', 'G0-C02', 'G0-C03', 'G0-C04', 'G0-C05', 'G0-C06', 'G0-C07']) await meet('G0', k);
    let g0 = await detail('G0');
    if (g0.assessment.status === 'in_assessment' && g0.evaluation.ready) {
      await asUser('pm', (ctx) => gates.markReady(ctx, pid, g0.id, { expectedVersion: g0.assessment.version, note: 'Demo: all mandatory G0 criteria met' }));
      g0 = await detail('G0');
    }
    if (g0.assessment.status === 'ready_for_decision') {
      const decision = await asUser('sponsor', async () => {
        const rows = await db
          .tx()
          .select({ id: schema.decision.id, code: schema.decision.code })
          .from(schema.decision)
          .where(
            and(
              eq(schema.decision.projectId, pid),
              eq(schema.decision.gateKey, 'G0'),
              eq(schema.decision.isDemo, true),
              inArray(schema.decision.status, [...FINAL_APPROVED_DECISION_STATUSES]),
              or(eq(schema.decision.authorityOutcome, 'within_mandate'), and(eq(schema.decision.authorityOutcome, 'pending_external_authority'), isNotNull(schema.decision.externalAuthorityReference))),
            ),
          )
          .orderBy(sql`${schema.decision.createdAt} desc`)
          .limit(1);
        return rows[0] ?? null;
      });
      if (decision) {
        await asUser('sponsor', (ctx) =>
          gates.decide(ctx, pid, g0.id, { expectedVersion: g0.assessment.version, outcome: 'approve', decisionId: decision.id, note: `Demo: G0 approved on the basis of demo decision ${decision.code}` }),
        );
        log(`gates: G0 approved (backed by demo decision ${decision.code})`);
      } else {
        log('gates: G0 left ready_for_decision — no approved demo governance decision for G0 exists (the server refuses a gate approval without one)');
      }
    }

    // G1 — in assessment, two criteria met with evidence.
    await start('G1');
    await meet('G1', 'G1-C01');
    await meet('G1', 'G1-C05');

    // G2 in assessment; G5 in assessment in parallel with separation (JV preparation — AT-11).
    await start('G2');
    await start('G5');

    // AT-13 demo: a waiver request on a NON-waivable criterion is rejected and logged; the criterion stays unmet.
    const { g: g1, c: c02 } = await criterion('G1', 'G1-C02');
    const alreadyLogged = await asUser('pm', async () => {
      const r = await db
        .tx()
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.auditEvent)
        .where(and(eq(schema.auditEvent.projectId, pid), eq(schema.auditEvent.entityId, c02.id), eq(schema.auditEvent.outcome, 'rejected')));
      return (r[0]?.n ?? 0) > 0;
    });
    if (!alreadyLogged) {
      try {
        await asUser('pm', (ctx) =>
          gates.requestWaiver(ctx, pid, g1.id, c02.id, {
            basis: 'Demo scenario: attempt to waive the perimeter baseline to accelerate G1 (synthetic)',
            impact: 'Demo scenario: G1 would proceed without a baselined perimeter register',
          }),
        );
        throw new Error('expected the non-waivable waiver request to be rejected');
      } catch (e) {
        if (!(e instanceof DomainError) || e.code !== 'gates.waiver.non_waivable') throw e;
        log('gates: waiver request on non-waivable G1-C02 rejected and audited (AT-13 demo)');
      }
    }

    await asUser('pm', (ctx) => dims.recompute(ctx, pid));
  },
};
