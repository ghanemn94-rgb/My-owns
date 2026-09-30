import { and, eq } from 'drizzle-orm';
import { schema } from '@hub/db';
import { addCalendarDays, localDate } from '@hub/domain';
import type { ModuleSeed } from '../../cli/seed-modules';
import { DbService } from '../../platform/db.service';
import { JobQueue } from '../../platform/jobs/job-queue.service';
import { StatusDimensionsService } from '../gates/status-dimensions.service';
import { RECOMPUTE_DIMENSIONS_JOB } from '../gates/gates.service';
import { DocumentsService } from '../documents/documents.service';
import { EvidenceService } from '../documents/evidence.service';
import { PartnersService } from './partners.service';
import { DealsService } from './deals.service';
import { RoomsService } from './rooms.service';
import { DiligenceService } from './diligence.service';
import { TransactionsService } from './transactions.service';
import { PostCloseService } from './postclose.service';

/**
 * DEMO sandbox scenario for the JV module (REQ-SET-002, REQ-SET-004). Everything goes through the services, so
 * authorization, audit and outbox apply; every record is flagged Demo. All content is FICTIONAL:
 *  - two fictional partners ("Demo Partner Alpha (fictional)", "Demo Partner Beta (fictional)") — no real names;
 *  - screening criteria with illustrative weights (no scores are invented);
 *  - Alpha: outreach approved, NDA recorded, materials access, a partner room with the fictional external user
 *    (partner.alpha), one disclosed synthetic note, one DD question answered through the review/release workflow;
 *  - a clean-team room with the clean-team persona (clean_team role + synthetic attestation reference);
 *  - an ownership scenario that lists the parties with NO percentage (never assumed);
 *  - a signing in preparation and a closing BLOCKED by an unverified, non-waivable blocking CP (REQ-SET-004), a
 *    verified CP with evidence, a waivable CP, a record-only funds-flow line (amount TBD) and a post-close obligation.
 * Demo rooms are classified `internal` only because the synthetic external / clean-team personas are cleared to
 * `internal` (see the JV report: the persona clearances should include their room-role defaults).
 */
export const jvSeed: ModuleSeed = {
  name: 'jv',
  run: async ({ app, dcProjectId: pid, asUser, userId, log }) => {
    const db = app.get(DbService);
    const partners = app.get(PartnersService);
    const deals = app.get(DealsService);
    const rooms = app.get(RoomsService);
    const dd = app.get(DiligenceService);
    const tx = app.get(TransactionsService);
    const post = app.get(PostCloseService);
    const docs = app.get(DocumentsService);
    const evidence = app.get(EvidenceService);

    const existing = await asUser('pm', async () => (await db.tx().select({ id: schema.partner.id }).from(schema.partner).where(and(eq(schema.partner.projectId, pid), eq(schema.partner.code, 'DEMO-PA'))))[0]);
    if (existing) {
      log('jv demo scenario already present');
      return;
    }
    const today = localDate(new Date(), 'Asia/Riyadh');
    // User ids are resolved OUTSIDE the persona transactions (each lookup runs in its own context).
    const pmId = await userId('pm');
    const legalId = await userId('legal');
    const sponsorId = await userId('sponsor');
    const cleanteamId = await userId('cleanteam');
    const partnerUser = await userId('partner.alpha');
    const text = (lines: string[]) => Buffer.from(lines.join('\n\n'), 'utf8');
    const upload = async (persona: string, title: string, kind: 'agreement' | 'dd_material' | 'evidence', filename: string, body: string[], roomId?: string) => {
      const d = await asUser(persona, (ctx) => docs.create(ctx, pid, { title, kind, classification: 'internal', roomId }));
      const v = await asUser(persona, (ctx) => docs.uploadVersion(ctx, pid, d.id, { bytes: text(body), filename, declaredType: 'text/plain', note: 'Demo synthetic content' }));
      return { id: d.id, versionId: v.versionId };
    };

    // 1. Screening criteria (illustrative weights; the template does not prescribe them) and two fictional partners.
    await asUser('pm', (ctx) =>
      partners.setCriteria(ctx, pid, {
        expectedVersion: 0,
        criteria: [
          { key: 'operating_capability', name: 'Operating capability (demo criterion)', nameAr: 'القدرة التشغيلية (معيار تجريبي)', weight: '40' },
          { key: 'funding_capacity', name: 'Funding capacity (demo criterion)', nameAr: 'القدرة التمويلية (معيار تجريبي)', weight: '35' },
          { key: 'strategic_fit', name: 'Strategic fit (demo criterion)', nameAr: 'الملاءمة الاستراتيجية (معيار تجريبي)', weight: '25' },
        ],
        note: 'DEMO — illustrative criteria and weights (synthetic); to be approved by the authorized owner.',
      }),
    );
    const alpha = await asUser('pm', (ctx) => partners.create(ctx, pid, { code: 'DEMO-PA', name: 'Demo Partner Alpha (fictional)', description: 'FICTIONAL demo counterparty — not a real company.', classification: 'confidential' }));
    const beta = await asUser('pm', (ctx) => partners.create(ctx, pid, { code: 'DEMO-PB', name: 'Demo Partner Beta (fictional)', description: 'FICTIONAL demo counterparty — not a real company.', classification: 'confidential' }));
    await asUser('pm', (ctx) => partners.addAssessment(ctx, pid, alpha.id, { basis: 'judgement', statement: 'DEMO — team view: operating track record appears relevant (synthetic judgement, no score).', criterionKey: 'operating_capability' }));
    await asUser('pm', (ctx) => partners.addConflict(ctx, pid, beta.id, { description: 'DEMO — synthetic example of a disclosed conflict (no real relationship).', mitigation: 'DEMO — the declarant is excluded from approvals for this partner.', declarantUserId: undefined }));

    // 2. Alpha: outreach approval (separate), NDA recorded by Legal (grants no access), materials access.
    let v = (await asUser('pm', (ctx) => partners.get(ctx, pid, alpha.id))).version;
    v = (await asUser('pm', (ctx) => partners.requestOutreach(ctx, pid, alpha.id, { expectedVersion: v, note: 'DEMO — request to approach the fictional partner.' }))).version;
    v = (await asUser('sponsor', (ctx) => partners.decideOutreach(ctx, pid, alpha.id, { expectedVersion: v, outcome: 'approve', note: 'DEMO — outreach approved within the DEMO authority matrix.' }))).version;
    const nda = await upload('legal', 'Demo — NDA executed copy (fictional)', 'agreement', 'demo-nda.md', ['# Demo NDA (fictional)', 'DEMO — SYNTHETIC placeholder for an executed NDA. No real parties or terms.']);
    v = (await asUser('pm', (ctx) => partners.submitNda(ctx, pid, alpha.id, { expectedVersion: v, documentId: nda.id, executedOn: today, note: 'DEMO — executed copy uploaded.' }))).version;
    v = (await asUser('legal', (ctx) => partners.recordNda(ctx, pid, alpha.id, { expectedVersion: v, outcome: 'record', note: 'DEMO — NDA recorded (grants no document access).' }))).version;
    await asUser('pm', (ctx) => partners.advance(ctx, pid, alpha.id, { expectedVersion: v, toStage: 'materials_access', note: 'DEMO — materials access approved; room grants still required.' }));
    let bv = (await asUser('pm', (ctx) => partners.get(ctx, pid, beta.id))).version;
    bv = (await asUser('pm', (ctx) => partners.requestOutreach(ctx, pid, beta.id, { expectedVersion: bv, note: 'DEMO — outreach request pending approval.' }))).version;
    void bv;

    // 3. Rooms and grants: Alpha's partner room (PM creates → manage grant), a clean-team room (Legal creates).
    const room = await asUser('pm', (ctx) => rooms.create(ctx, pid, { name: 'Demo — Partner Alpha data room (fictional)', type: 'partner', partnerId: alpha.id, classification: 'internal', description: 'DEMO — synthetic virtual data room.' }));
    const ctRoom = await asUser('legal', (ctx) => rooms.create(ctx, pid, { name: 'Demo — Clean team room (fictional)', type: 'clean_team', classification: 'internal', description: 'DEMO — clean-team material is visible to clean-team members only.' }));
    await asUser('legal', (ctx) => partners.addContact(ctx, pid, alpha.id, { userId: partnerUser, note: 'DEMO — fictional counterparty user.' }));
    const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString();
    await asUser('legal', (ctx) => rooms.grant(ctx, pid, room.id, { userId: partnerUser, accessLevel: 'contribute', role: 'external_partner_limited', expiresAt: in60, reason: 'DEMO — counterparty access after Materials access.' }));
    await asUser('legal', (ctx) => rooms.grant(ctx, pid, room.id, { userId: sponsorId, accessLevel: 'manage', role: null, reason: 'DEMO — disclosure release authority.' }));
    await asUser('sponsor', (ctx) => rooms.grant(ctx, pid, room.id, { userId: legalId, accessLevel: 'manage', role: null, reason: 'DEMO — legal review of disclosures and answers.' }));
    await asUser('legal', (ctx) => rooms.grant(ctx, pid, ctRoom.id, { userId: cleanteamId, accessLevel: 'contribute', role: 'clean_team', reason: 'DEMO — clean-team analyst.', attestationRef: 'DEMO-CT-ATTESTATION-001 (synthetic)' }));

    // 4. A disclosed synthetic note (requested by the PM, released by Legal) and a DD question answered and released.
    const welcome = await upload('pm', 'Demo — Data room welcome note (synthetic)', 'dd_material', 'demo-welcome.md', ['# Demo data room (fictional)', 'DEMO — SYNTHETIC content disclosed to the fictional partner.'], room.id);
    const disc = await asUser('pm', (ctx) => rooms.requestDisclosure(ctx, pid, room.id, { documentId: welcome.id, note: 'DEMO — welcome note' }));
    await asUser('legal', (ctx) => rooms.decideDisclosure(ctx, pid, room.id, disc.id, { expectedVersion: disc.version, outcome: 'release', note: 'DEMO — released to the fictional partner.' }));
    const q = await asUser('partner.alpha', (ctx) => dd.externalCreate(ctx, pid, room.id, { question: 'DEMO — Please share the synthetic list of in-scope halls.', domain: 'technical' }));
    let qv = (await asUser('pm', (ctx) => dd.get(ctx, pid, q.id))).version;
    qv = (await asUser('pm', (ctx) => dd.assign(ctx, pid, q.id, { expectedVersion: qv, assigneeUserId: pmId, reviewerUserId: legalId, dueDate: addCalendarDays(today, 10) }))).version;
    qv = (await asUser('pm', (ctx) => dd.draftAnswer(ctx, pid, q.id, { expectedVersion: qv, answerDraft: 'DEMO — The synthetic list is summarised in the welcome note (fictional).', evidenceDocumentIds: [] }))).version;
    qv = (await asUser('pm', (ctx) => dd.submitForReview(ctx, pid, q.id, { expectedVersion: qv }))).version;
    qv = (await asUser('legal', (ctx) => dd.review(ctx, pid, q.id, { expectedVersion: qv, outcome: 'approve', note: 'DEMO — reviewed.' }))).version;
    await asUser('sponsor', (ctx) => dd.release(ctx, pid, q.id, { expectedVersion: qv, note: 'DEMO — released.' }));
    await asUser('pm', (ctx) =>
      dd.createFinding(ctx, pid, {
        title: 'DEMO — Synthetic finding: one hall lease needs landlord consent',
        materiality: 'high',
        diligenceRequestId: q.id,
        remediation: 'DEMO — obtain the (fictional) consent before closing; tracked as a CP.',
        remediationOwnerUserId: legalId,
        cpImplication: 'DEMO — becomes a condition precedent of the closing.',
        classification: 'internal',
      }),
    );

    // 5. Ownership scenario with parties only — no percentage is ever assumed (REQ-JV-007).
    await asUser('finance', (ctx) =>
      deals.createScenario(ctx, pid, {
        name: 'DEMO — Illustrative JV structure (percentages TBD)',
        partnerId: alpha.id,
        ownership: [
          { party: 'Mobily (party label, demo)', percent: null, note: 'TBD — to be negotiated' },
          { party: 'Demo Partner Alpha (fictional)', percent: null, note: 'TBD — to be negotiated' },
        ],
        contributions: [{ party: 'Mobily (party label, demo)', description: 'DEMO — data center perimeter (per the approved perimeter)' }],
        governanceTerms: 'DEMO — board composition and reserved matters: TBD (no terms assumed).',
        classification: 'confidential',
      }),
    );

    // 6. Signing in preparation; closing #1 blocked by an unverified, non-waivable blocking CP (REQ-SET-004).
    const signing = await asUser('pm', (ctx) => tx.createEvent(ctx, pid, 'signing', { name: 'DEMO — JV signing (fictional)', partnerId: alpha.id, targetDate: addCalendarDays(today, 45) }));
    await asUser('pm', (ctx) => tx.createItem(ctx, pid, { eventId: signing.id, title: "DEMO — Executed shareholders' agreement (fictional)", responsibleParty: 'Legal — Role to be confirmed' }));
    await asUser('pm', (ctx) => tx.transitionEvent(ctx, pid, signing.id, { expectedVersion: 1, command: 'start_preparation', note: 'DEMO' }));
    const closing = await asUser('pm', (ctx) => tx.createEvent(ctx, pid, 'closing', { signingId: signing.id, name: 'DEMO — Closing #1 (fictional)', targetDate: addCalendarDays(today, 120) }));
    await asUser('pm', (ctx) => tx.transitionEvent(ctx, pid, closing.id, { expectedVersion: 1, command: 'start_preparation', note: 'DEMO' }));
    const blocked = await asUser('legal', (ctx) => tx.createCp(ctx, pid, { closingId: closing.id, reference: 'DEMO-CP-01', title: 'DEMO — Regulatory approval of the transaction (synthetic; applicability to be confirmed)', ownerUserId: pmId, blocking: true, longStopDate: addCalendarDays(today, 180) }));
    await asUser('legal', (ctx) => tx.determineWaivability(ctx, pid, blocked.id, { expectedVersion: 1, blocking: true, waivable: false, waiverAuthorityRole: null, basis: 'DEMO — synthetic determination: a regulatory approval cannot be waived.' }));
    const met = await asUser('legal', (ctx) => tx.createCp(ctx, pid, { closingId: closing.id, reference: 'DEMO-CP-02', title: 'DEMO — Board resolutions of both parties (synthetic)', ownerUserId: pmId, blocking: true }));
    await asUser('pm', (ctx) => evidence.link(ctx, pid, { targetType: 'closing_condition', targetId: met.id, note: 'DEMO — synthetic evidence note: resolutions on file (fictional).' }));
    await asUser('pm', (ctx) => tx.submitEvidence(ctx, pid, met.id, { expectedVersion: 1, note: 'DEMO' }));
    await asUser('legal', (ctx) => tx.verify(ctx, pid, met.id, { expectedVersion: 2, outcome: 'verify', note: 'DEMO — verified against the synthetic evidence.' }));
    const waivable = await asUser('legal', (ctx) => tx.createCp(ctx, pid, { closingId: closing.id, reference: 'DEMO-CP-03', title: 'DEMO — Delivery of a synthetic certificate (waivable)', ownerUserId: pmId, blocking: true }));
    await asUser('legal', (ctx) => tx.determineWaivability(ctx, pid, waivable.id, { expectedVersion: 1, blocking: true, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'DEMO — synthetic determination: waivable by the sponsor.' }));
    await asUser('finance', (ctx) => tx.createFlow(ctx, pid, closing.id, { description: 'DEMO — Consideration at closing (amount TBD; record-only)', payer: 'Demo Partner Alpha (fictional)', payee: 'Mobily (party label, demo)' }));
    await asUser('pm', (ctx) => post.create(ctx, pid, { kind: 'condition_subsequent', title: 'DEMO — Post-closing registration filing (synthetic)', ownerUserId: pmId, dueDate: addCalendarDays(today, 150), closingId: closing.id }));
    // The event/CP commands above queued status-dimension recomputes (cp.changed): recompute synchronously now (as the
    // gates / readiness seeds do) so the JV transaction dimension reflects the demo signing/closing — and a re-run, which
    // returns early above, changes nothing — then cancel the redundant queued recomputes.
    await asUser('pm', (ctx) => app.get(StatusDimensionsService).recompute(ctx, pid));
    const cancelled = await app.get(JobQueue).cancelQueued(pid, [RECOMPUTE_DIMENSIONS_JOB]);
    log(`jv demo scenario: partners ${alpha.code}/${beta.code}, rooms ${room.id}/${ctRoom.id}, signing ${signing.code}, closing ${closing.code} blocked by DEMO-CP-01; dimensions recomputed (${cancelled} queued recompute job(s) cancelled)`);
  },
};
