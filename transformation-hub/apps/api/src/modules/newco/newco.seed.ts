import type { ModuleSeed } from '../../cli/seed-modules';
import { RegulatoryService } from './regulatory.service';

const DEMO = 'Demo';

/**
 * NewCo demo scenario (idempotent; through the services). The demo NewCo's incorporation status is the one declared at
 * project creation ("incorporation in progress", proposed, unverified) — the seed never invents an incorporation or a
 * verification. Register entries are synthetic and every one stays "Assessment pending — specialist": register edits AND
 * the applicability / outcome determinations are for Legal / regulatory roles only (REQ-AGR-004, SEC-P34-05) and never by
 * the registrant — the demo has a single Legal persona (the registrant), so no determination is recorded. The fictional
 * INTERNAL approval is only put in preparation. No approval is recorded as obtained.
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
    await asUser('legal', (ctx) => reg.progress(ctx, pid, internal.id, { expectedVersion: 1, command: 'start_preparation', note: `${DEMO}: preparation started` }));
    log('newco: 3 demo register entries (all pending specialist assessment; internal approval in preparation)');
  },
};
