import type { ModuleSeed } from '../../cli/seed-modules';
import { RegulatoryService } from './regulatory.service';

const DEMO = 'Demo';

/**
 * NewCo demo scenario (idempotent; through the services). The demo NewCo's incorporation status is the one declared at
 * project creation ("incorporation in progress", proposed, unverified) — the seed never invents an incorporation or a
 * verification. Register entries are synthetic: an item referenced by the source summary stays
 * "Assessment pending — specialist"; only a fictional INTERNAL approval gets a (synthetic, labelled) applicability
 * assessment to show the flow. No approval is recorded as obtained. Register entries are maintained by Legal only
 * (REQ-AGR-004); the applicability assessment is recorded by a different verifier (the functional approver), never the
 * registrant.
 */
export const newcoSeed: ModuleSeed = {
  name: 'newco',
  run: async ({ app, dcProjectId: pid, asUser, userId, log }) => {
    const reg = app.get(RegulatoryService);
    const existing = await asUser('pm', (ctx) => reg.list(ctx, pid, { page: 1, pageSize: 5 }));
    if (existing.total > 0) {
      log('newco: demo register already present');
      return;
    }
    const legal = await userId('legal');
    await asUser('legal', (ctx) =>
      reg.create(ctx, pid, {
        category: 'regulatory',
        authority: 'CST',
        title: `${DEMO}: licensing / approval item referenced in the source summary`,
        description: 'Referenced in the reference summary only; whether it applies, and to whom, is for a specialist to determine.',
        origin: 'source_extraction',
        sourceReference: 'Reference image summary (image extraction not performed; historical / unverified)',
        ownerUserId: legal,
        gateKey: 'G2',
      }),
    );
    await asUser('legal', (ctx) =>
      reg.create(ctx, pid, {
        category: 'external_party',
        authority: `${DEMO} landlord of Site A (fictional)`,
        title: `${DEMO}: landlord consent for the Site A lease (illustrative)`,
        origin: 'manual',
        ownerUserId: legal,
        gateKey: 'G3',
      }),
    );
    const internal = await asUser('legal', (ctx) =>
      reg.create(ctx, pid, {
        category: 'internal',
        authority: `${DEMO} internal approval body (fictional)`,
        title: `${DEMO}: internal approval of the separation budget (illustrative)`,
        origin: 'manual',
        gateKey: 'G2',
      }),
    );
    await asUser('approver', (ctx) => reg.assessApplicability(ctx, pid, internal.id, { expectedVersion: 1, applicability: 'applicable', basis: `${DEMO}: synthetic assessment for the demo sandbox — not a real determination` }));
    await asUser('legal', (ctx) => reg.progress(ctx, pid, internal.id, { expectedVersion: 2, command: 'start_preparation', note: `${DEMO}: preparation started` }));
    log('newco: 3 demo register entries (source item pending specialist assessment; internal approval in preparation)');
  },
};
