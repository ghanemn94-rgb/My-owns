import type { ModuleSeed } from '../../cli/seed-modules';
import { addWorkingDays } from '@hub/domain';
import { Clock } from '../../platform/clock';
import { PortfolioService } from '../portfolio/portfolio.service';
import { ChangeControlService } from '../planning/change-control.service';
import { LegalEntitiesService } from '../newco/legal-entities.service';
import { PerimeterService } from './perimeter.service';
import { TransfersService } from './transfers.service';
import { AgreementsService } from './agreements.service';

const DEMO = 'Demo';

/**
 * Carve-out demo scenario (idempotent; through the services so authorization, validation, audit and outbox apply).
 * Everything is synthetic and labelled "Demo": fictional sites, entities, counterparties and items; no amounts; planned
 * dates are derived from the demo project's planned start (assumed, not commitments); no transfer is reported or
 * verified. The planning seed approved baseline v1 first, so every item is added through a change request (AT-07):
 * most requests are approved by the sponsor and applied by the PM; the shared cooling asset stays under review.
 */
export const carveoutSeed: ModuleSeed = {
  name: 'carveout',
  run: async ({ app, dcProjectId: pid, asUser, userId, log }) => {
    const perimeter = app.get(PerimeterService);
    const transfers = app.get(TransfersService);
    const agreements = app.get(AgreementsService);
    const entities = app.get(LegalEntitiesService);
    const cc = app.get(ChangeControlService);
    const portfolio = app.get(PortfolioService);
    const clock = app.get(Clock);

    const existing = await asUser('pm', (ctx) => perimeter.listItems(ctx, pid, { page: 1, pageSize: 5 }));
    if (existing.total > 0) {
      log('carveout: demo perimeter already present');
      return;
    }
    const uid: Record<string, string> = {};
    for (const k of ['pm', 'legal', 'finance', 'ops.lead', 'tech.lead']) uid[k] = await userId(k);
    const ws = new Map((await asUser('pm', (ctx) => portfolio.listWorkstreams(ctx, pid))).items.map((w) => [w.code, w.id]));

    // Entities: the (fictional) parent as current owner; the demo NewCo created with the project as target.
    const ents = await asUser('pm', (ctx) => entities.list(ctx, pid));
    const newcoId = ents.items.find((e) => e.role === 'newco')?.id ?? null;
    const parentId = ents.items.find((e) => e.role === 'parent')?.id ?? (await asUser('pm', (ctx) => entities.create(ctx, pid, { name: 'Demo Parent Company (fictional)', kind: 'parent', role: 'parent' }))).id;

    // Sites and agreements (labels as found in the source summary; expansions stay Unconfirmed — REQ-AGR-002).
    const siteA = await asUser('pm', (ctx) => perimeter.createSite(ctx, pid, { name: `${DEMO} Site A (fictional data centre)`, kind: 'data_center', notes: 'Synthetic site for the demo sandbox' }));
    await asUser('pm', (ctx) => perimeter.createSite(ctx, pid, { name: `${DEMO} Site B (fictional data centre)`, kind: 'data_center', notes: 'Synthetic site — not in the demo perimeter yet' }));
    const ata = await asUser('pm', (ctx) =>
      agreements.createAgreement(ctx, pid, { kindLabel: 'ATA', title: `${DEMO}: ATA as referenced in the source summary (terms TBD)`, ownerUserId: uid['pm'], legalReviewerUserId: uid['legal'], parties: [{ name: 'Demo Parent Company (fictional)', role: 'Transferor (proposed)', legalEntityId: parentId }] }),
    );
    await asUser('pm', (ctx) => agreements.createAgreement(ctx, pid, { kindLabel: 'TSA', title: `${DEMO}: TSA as referenced in the source summary (services TBD)`, ownerUserId: uid['ops.lead'], parties: [] }));
    await asUser('pm', (ctx) => agreements.createAgreement(ctx, pid, { kindLabel: 'MSA', title: `${DEMO}: MSA as referenced in the source summary (scope TBD)`, parties: [] }));
    await asUser('pm', async (ctx) => {
      const a = await agreements.getAgreement(ctx, pid, ata.id);
      await agreements.stage(ctx, pid, ata.id, { expectedVersion: a.version, command: 'start_drafting' });
    });

    // Perimeter items — each added after baseline approval, so each raises a change request with impacts.
    const projectInfo = await asUser('pm', (ctx) => portfolio.getProject(ctx, pid));
    const project = projectInfo.plannedStart;
    const assumed = (days: number) => (project ? addWorkingDays(project, days) : undefined);
    const common = { currentEntityId: parentId, ...(newcoId ? { targetEntityId: newcoId } : {}), consentRequired: false };
    const specs = [
      { key: 'site', body: { type: 'site' as const, name: `${DEMO} Site A — land, building and fit-out`, siteId: siteA.id, workstreamId: ws.get('WS05'), ownerUserId: uid['pm'], disposition: 'included' as const, legalOwner: 'Demo Parent Company (fictional)', operator: 'Demo Parent Company (fictional) — TBD after Day 1', economicBeneficiary: 'TBD', agreementId: ata.id, ...common }, approve: true },
      { key: 'cooling', body: { type: 'asset' as const, name: `${DEMO} shared cooling plant at Site A`, siteId: siteA.id, workstreamId: ws.get('WS05'), ownerUserId: uid['ops.lead'], disposition: 'shared' as const, ...common }, approve: false },
      { key: 'contract', body: { type: 'contract' as const, name: `${DEMO} customer colocation contract C-1 (fictional customer)`, workstreamId: ws.get('WS09'), ownerUserId: uid['pm'], disposition: 'included' as const, ...common, consentRequired: true }, approve: true },
      { key: 'data', body: { type: 'data' as const, name: `${DEMO} DCIM configuration data`, workstreamId: ws.get('WS06'), ownerUserId: uid['tech.lead'], disposition: 'included' as const, ...common }, approve: true },
      { key: 'people', body: { type: 'employee_group' as const, name: `${DEMO} site operations roles (role-based, no names)`, workstreamId: ws.get('WS08'), ownerUserId: uid['pm'], disposition: 'pending' as const, resolutionPath: 'Demo: decide allocation vs secondment in the people workstream', targetGateKey: 'G1', ...common }, approve: true },
    ];
    const ids: Record<string, string> = {};
    for (const s of specs) {
      const r = await asUser('pm', (ctx) =>
        perimeter.createItem(ctx, pid, { ...s.body, justification: `${DEMO}: synthetic perimeter item added for the demo scenario (after baseline approval)`, classification: 'confidential' }),
      );
      ids[s.key] = r.id;
      if (!r.changeRequest || !s.approve) continue;
      const crId = r.changeRequest.id;
      await asUser('pm', (ctx) => cc.crCommand(ctx, pid, crId, 'start_review', { expectedVersion: 2, note: 'Demo review' }));
      await asUser('sponsor', (ctx) => cc.crCommand(ctx, pid, crId, 'approve', { expectedVersion: 3, note: 'Demo approval (synthetic persona)' }));
      await asUser('pm', async (ctx) => {
        const it = await perimeter.getItem(ctx, pid, r.id);
        await perimeter.applyChange(ctx, pid, r.id, { expectedVersion: it.version, changeRequestId: crId, note: 'Demo: approved change applied' });
      });
    }
    log(`carveout: ${specs.length} demo perimeter items added through change requests (${specs.filter((s) => s.approve).length} approved and applied, shared cooling asset pending review)`);

    // Separate legal and economic transfer planning for the site (assumed demo dates; nothing reported or verified).
    const legalDate = assumed(80);
    const econDate = assumed(60);
    if (legalDate && econDate) {
      await asUser('pm', async (ctx) => {
        let it = await perimeter.getItem(ctx, pid, ids['site']!);
        await transfers.record(ctx, pid, { perimeterItemId: it.id, aspect: 'economic', command: 'plan', expectedVersion: it.version, mechanism: `${DEMO}: transfer instrument TBD (proposed)`, effectiveDate: econDate, note: 'Demo: assumed date derived from the project planned start' });
        it = await perimeter.getItem(ctx, pid, ids['site']!);
        await transfers.record(ctx, pid, { perimeterItemId: it.id, aspect: 'legal', command: 'plan', expectedVersion: it.version, effectiveDate: legalDate, note: 'Demo: legal title transfer assumed later than the economic transfer' });
      });
      log('carveout: site legal/economic transfers planned separately (assumed demo dates)');
    }

    // AT-08: the customer contract needs consent that is still outstanding → Day-1 interim arrangement.
    await asUser('legal', async (ctx) => {
      const it = await perimeter.getItem(ctx, pid, ids['contract']!);
      await perimeter.setTransferability(ctx, pid, it.id, { expectedVersion: it.version, transferClass: 'consent_required', basis: `${DEMO}: synthetic specialist assessment for the demo scenario (not a legal determination)` });
    });
    const consent = await asUser('pm', (ctx) => agreements.createConsent(ctx, pid, { perimeterItemId: ids['contract'], kind: 'consent', counterparty: `${DEMO} Customer One (fictional)`, contractRef: 'DEMO-C-1', ownerUserId: uid['pm'] }));
    await asUser('pm', async (ctx) => {
      const today = clock.today(projectInfo.timezone);
      await agreements.recordResponse(ctx, pid, consent.id, { expectedVersion: 1, status: 'requested', date: today, note: 'Demo: consent request recorded (synthetic)' });
      const it = await perimeter.getItem(ctx, pid, ids['contract']!);
      await perimeter.setInterimArrangement(ctx, pid, it.id, {
        expectedVersion: it.version,
        interimArrangement: `${DEMO}: the parent keeps the contract on Day 1 and NewCo delivers the service back-to-back — structure TBD (Legal)`,
        serviceAccountableUserId: uid['ops.lead'],
        billingAccountableUserId: uid['finance'],
        slaAccountableUserId: uid['ops.lead'],
        remediationPlan: `${DEMO}: chase the consent; review the position at G3 (synthetic)`,
      });
    });
    log('carveout: AT-08 demo — customer contract consent requested, Day-1 interim arrangement with accountable owners');

    // Category coverage: one category reviewed with no item; impact assessment of the site.
    await asUser('pm', (ctx) => perimeter.reviewCategory(ctx, pid, 'financing', { conclusion: `${DEMO}: no financing arrangement identified in the synthetic scenario` }));
    await asUser('pm', (ctx) => perimeter.assessImpact(ctx, pid, ids['site']!, { narrative: { financial_statements: `${DEMO}: carve-out statements impact to be assessed by Finance (synthetic)` } }));
    log('carveout: category review and site impact assessment recorded');
  },
};
