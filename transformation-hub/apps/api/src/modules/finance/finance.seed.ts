import { and, eq } from 'drizzle-orm';
import { schema } from '@hub/db';
import type { ModuleSeed } from '../../cli/seed-modules';
import { DbService } from '../../platform/db.service';
import { ModelsService } from './models.service';
import { BenefitsService } from './benefits.service';
import { BudgetService } from './budget.service';

export const DEMO_VALUATION_MODEL = 'DEMO valuation model — outputs to be imported from the original model (synthetic)';
export const DEMO_BUSINESS_PLAN = 'DEMO NewCo business plan — outputs to be imported from the original model (synthetic)';
export const DEMO_BENEFIT = 'DEMO: standalone NOC operating cost avoidance (synthetic)';
export const DEMO_TSA_LINE = 'DEMO — TSA charge: NOC monitoring during transition (amounts to be confirmed)';
/** Created by the readiness seed (runs before this one). */
const READINESS_DEMO_TSA = 'NOC monitoring during transition — DEMO (synthetic)';

/**
 * Demo sandbox scenario for finance & value (idempotent; everything through the module services, as the demo Finance
 * persona, so policy, validation, audit and outbox apply; every record inherits is_demo from the demo project).
 * NO amount, rate, valuation, ownership percentage or approval is invented:
 *  - a valuation model and a business plan are registered WITHOUT versions — their outputs are to be imported from the
 *    original models, so proposed and approved values are both empty;
 *  - a benefit is registered with its measurement definition and owner; baseline, target, realization date and
 *    verification source are "to be confirmed";
 *  - the demo TSA (readiness seed) gets its TSA-charge budget line with zero commitments / spend and no approved budget,
 *    so the separation cost view shows the TSA counted once and the "no approved budget" flag.
 * Nothing is validated, approved or verified.
 */
export const financeSeed: ModuleSeed = {
  name: 'finance',
  run: async ({ app, dcProjectId: pid, asUser, userId, log }) => {
    const db = app.get(DbService);
    const models = app.get(ModelsService);
    const benefits = app.get(BenefitsService);
    const budget = app.get(BudgetService);
    const pmId = await userId('pm');

    const existing = <T>(fn: () => Promise<T>) => asUser('finance', fn);

    for (const [kind, name] of [
      ['valuation', DEMO_VALUATION_MODEL],
      ['business_plan', DEMO_BUSINESS_PLAN],
    ] as const) {
      const found = await existing(async () => {
        const [m] = await db.tx().select({ id: schema.financialModel.id }).from(schema.financialModel).where(and(eq(schema.financialModel.projectId, pid), eq(schema.financialModel.name, name)));
        return m ?? null;
      });
      if (!found) {
        await asUser('finance', (ctx) =>
          models.create(ctx, pid, { kind, name, description: 'DEMO — no figures recorded: the outputs (with their sheet / cell references) are to be imported from the original model. Proposed and approved values are empty.' }),
        );
        log(`finance: demo ${kind} model registered (no versions, no values)`);
      }
    }

    const benefit = await existing(async () => {
      const [b] = await db.tx().select({ id: schema.benefit.id }).from(schema.benefit).where(and(eq(schema.benefit.projectId, pid), eq(schema.benefit.title, DEMO_BENEFIT)));
      return b ?? null;
    });
    if (!benefit) {
      await asUser('finance', (ctx) =>
        benefits.create(ctx, pid, {
          title: DEMO_BENEFIT,
          measurementDefinition:
            'DEMO definition — annual NOC operating cost of the standalone NewCo compared with the pre-separation cost allocation; measurement basis, baseline and target to be confirmed by Finance (synthetic).',
          baselineValue: 'TBD',
          targetValue: 'TBD',
          ownerUserId: pmId,
          verificationSource: 'To be confirmed — Finance (DEMO)',
        }),
      );
      log('finance: demo benefit registered (proposed; values TBD)');
    }

    const tsa = await asUser('pm', async () => {
      const [t] = await db.tx().select({ id: schema.tsaService.id }).from(schema.tsaService).where(and(eq(schema.tsaService.projectId, pid), eq(schema.tsaService.name, READINESS_DEMO_TSA)));
      return t ?? null;
    });
    if (tsa) {
      const line = await existing(async () => {
        const [l] = await db.tx().select({ id: schema.budgetLine.id }).from(schema.budgetLine).where(and(eq(schema.budgetLine.projectId, pid), eq(schema.budgetLine.tsaServiceId, tsa.id)));
        return l ?? null;
      });
      if (!line) {
        await asUser('finance', (ctx) =>
          budget.create(ctx, pid, {
            name: DEMO_TSA_LINE,
            category: 'tsa_charge',
            currency: 'SAR',
            unitScale: 1,
            tsaServiceId: tsa.id,
            sourceRef: 'DEMO — no amount recorded; the TSA charge and budget are to be confirmed by Finance',
          }),
        );
        log('finance: demo TSA-charge budget line linked to the demo TSA (no amounts, no approved budget)');
      }
    }
  },
};
