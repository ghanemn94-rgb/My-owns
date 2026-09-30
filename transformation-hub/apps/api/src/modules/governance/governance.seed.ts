import type { ModuleSeed } from '../../cli/seed-modules';
import { addCalendarDays } from '@hub/domain';
import { CommitteesService } from './committees.service';
import { MeetingsService } from './meetings.service';
import { DecisionsService } from './decisions.service';
import { ActionsService } from './actions.service';
import { GovernanceSupport } from './governance.support';
import { DEMO_AUTHORITY_POLICY } from './demo-policy';
import { EvidenceService } from '../documents/evidence.service';

export const DEMO_STEERING_COMMITTEE = 'DC Carve-out & JV Steering Committee (Demo)';

const DEMO_NOTE = 'DEMO — synthetic sandbox data (not a Mobily record)';

/**
 * Demo sandbox scenario for governance (spec §21): an active steering committee with persona seats and a placeholder
 * seat, an approved DEMO authority matrix, draft NewCo / JV boards (kept distinct), meeting #1 held with attendance,
 * frozen pack and approved minutes, and five decisions — (a) approved within mandate → implementation pending with an
 * action, (b) outside delegated authority → recommended / pending external authority with an escalation,
 * (c) submitted awaiting review, (d) draft, (e) gate G0 passage recommended to the delegating authority whose (synthetic)
 * approval is then recorded — it backs the demo G0 gate decision in the gates seed. Everything goes through the services (policy, rules, audit, outbox);
 * every record is is_demo because the project is a demo project. Idempotent: skipped when the committee exists.
 */
export const governanceSeed: ModuleSeed = {
  name: 'governance',
  run: async ({ app, dcProjectId: pid, asUser, userId, log }) => {
    const committees = app.get(CommitteesService);
    const meetings = app.get(MeetingsService);
    const decisions = app.get(DecisionsService);
    const actions = app.get(ActionsService);
    const sup = app.get(GovernanceSupport);
    const evidence = app.get(EvidenceService);

    const existing = await asUser('secretary', (ctx) => committees.list(ctx, pid, { page: 1, pageSize: 100, q: DEMO_STEERING_COMMITTEE }));
    if (existing.items.some((c) => c.name === DEMO_STEERING_COMMITTEE)) {
      log('governance demo scenario already present — skipped');
      return;
    }
    const today = await asUser('secretary', async () => sup.today(await sup.project(pid)));
    const in14 = addCalendarDays(today, 14);
    const in30 = addCalendarDays(today, 30);
    const in45 = addCalendarDays(today, 45);

    // 1. Steering committee: charter draft (secretary) → approved (sponsor, not the drafter) → active.
    const sc = await asUser('secretary', (ctx) =>
      committees.create(ctx, pid, {
        kind: 'program_steering',
        name: DEMO_STEERING_COMMITTEE,
        classification: 'confidential',
        charter: {
          purpose: 'DEMO — Oversee the fictional DC carve-out → standalone NewCo → JV programme; decide within delegated authority and recommend beyond it.',
          scope: 'DEMO — Integrated plan and baseline, perimeter, gates G0–G7, separation and Day-1 readiness, TSAs, partner process within delegation, closing readiness.',
          delegatedAuthority: 'DEMO — As set out in the approved DEMO authority matrix (synthetic values).',
          exclusions: 'Legal, tax, accounting and regulatory determinations; acting as the NewCo board or the JV board.',
          reservedMatters: 'Preferred partner selection, valuation and ownership terms, JV signing and closing confirmation, charter amendments (Board of Directors / delegating authority — to be confirmed).',
          cadence: 'Proposed: weekly operational follow-up; monthly committee meetings and as needed around gate decisions (proposal — not a confirmed schedule).',
          cadenceIsProposal: true,
          classification: 'Confidential (proposed)',
          minutesRetention: 'Per the approved corporate records policy — to be confirmed.',
          escalation: 'To the sponsor / delegating authority with requested action, decision deadline and options.',
          conflictsOfInterest: 'Declared per agenda item; conflicted members are recused (no vote, not counted in quorum).',
          circulation: 'Permitted for items designated by the chair, excluding reserved matters (proposed rule).',
        },
      }),
    );
    let v = (await asUser('sponsor', (ctx) => committees.approveCharter(ctx, pid, sc.id, { expectedVersion: sc.version, approvalReference: `${DEMO_NOTE}: charter approval` }))).version;
    v = (await asUser('secretary', (ctx) => committees.activate(ctx, pid, sc.id, { expectedVersion: v }))).version;

    const seats: { key: string | null; roleLabel: string; memberRole: 'chair' | 'sponsor' | 'secretary' | 'voting_member' | 'advisory_member'; voting: boolean }[] = [
      { key: 'chair', roleLabel: 'Chair (Demo persona — role to be confirmed)', memberRole: 'chair', voting: true },
      { key: 'sponsor', roleLabel: 'Sponsor (Demo persona)', memberRole: 'sponsor', voting: true },
      { key: 'secretary', roleLabel: 'Secretary / CPMO (Demo persona)', memberRole: 'secretary', voting: false },
      { key: 'finance', roleLabel: 'Finance (Demo persona)', memberRole: 'voting_member', voting: true },
      { key: 'legal', roleLabel: 'Legal (Demo persona)', memberRole: 'voting_member', voting: true },
      { key: 'approver', roleLabel: 'Operations — functional approver (Demo persona)', memberRole: 'voting_member', voting: true },
      { key: 'tech.lead', roleLabel: 'Technology / IT — advisory (Demo persona)', memberRole: 'advisory_member', voting: false },
      { key: null, roleLabel: 'Chair alternate — Role to be confirmed', memberRole: 'voting_member', voting: false },
    ];
    const membershipIds = new Map<string, string>();
    for (const s of seats) {
      const uid = s.key ? await userId(s.key) : null;
      const r = await asUser('secretary', (ctx) => committees.addMembership(ctx, pid, sc.id, { userId: uid, roleLabel: s.roleLabel, memberRole: s.memberRole, voting: s.voting, validFrom: today }));
      if (s.key) membershipIds.set(s.key, r.id);
    }

    // 2. DEMO authority matrix: drafted by the secretary, approved by the sponsor (demo project only).
    const mx = await asUser('secretary', (ctx) => committees.createMatrix(ctx, pid, sc.id, { policy: DEMO_AUTHORITY_POLICY, effectiveFrom: today }));
    await asUser('sponsor', (ctx) => committees.approveMatrix(ctx, pid, sc.id, mx.id, { approvalReference: `${DEMO_NOTE}: DEMO authority matrix v1`, effectiveFrom: today }));

    // 3. Distinct corporate bodies (drafts) — never confused with the programme committee.
    for (const [kind, name] of [
      ['newco_board', 'NewCo Board (Demo)'],
      ['jv_board', 'JV Board (Demo)'],
    ] as const) {
      const b = await asUser('secretary', (ctx) =>
        committees.create(ctx, pid, {
          kind,
          name,
          classification: 'confidential',
          charter: { purpose: `DEMO — Statutory board of the fictional ${kind === 'newco_board' ? 'NewCo' : 'JV company'}; separate from the programme steering committee.`, cadenceIsProposal: true },
        }),
      );
      await asUser('secretary', (ctx) => committees.addMembership(ctx, pid, b.id, { userId: null, roleLabel: 'Board chair — Role to be confirmed', memberRole: 'chair', voting: false, validFrom: today }));
    }

    // 4. Decision papers.
    const paper = (over: Record<string, unknown>) => ({
      whyNow: 'DEMO — Needed now to keep the fictional Day-1 plan on its synthetic dates.',
      alternatives: [{ title: 'Proceed as recommended' }, { title: 'Defer to the next committee meeting', summary: 'Pushes dependent demo activities.' }],
      impacts: { financial: 'DEMO — see amount (DEMO-SAR, synthetic).', operational: 'DEMO — none beyond the plan.', schedule: 'DEMO — keeps the synthetic critical path.' },
      risks: 'DEMO — synthetic risk: vendor availability.',
      dependencies: 'DEMO — Day-1 readiness workstream (WS07).',
      latestSafeDate: in30,
      ...over,
    });
    const a = await asUser('pm', (ctx) =>
      decisions.create(ctx, pid, {
        committeeId: sc.id,
        title: 'Demo — Approve budget for the Day-1 readiness rehearsal (synthetic)',
        ...paper({
          decisionTypeKey: 'change_request_budget',
          issue: 'DEMO — The rehearsal needs a budget line that is not in the synthetic baseline.',
          recommendation: 'DEMO — Approve 250,000 DEMO-SAR for the rehearsal.',
          amount: { amount: '250000.0000', currency: 'SAR', unitScale: 1 },
          requiredAuthority: 'Steering committee (within DEMO limit of 1,000,000 DEMO-SAR)',
        }),
      }),
    );
    const b = await asUser('pm', (ctx) =>
      decisions.create(ctx, pid, {
        committeeId: sc.id,
        title: 'Demo — Recommend authorization of JV signing with fictional Partner Alpha',
        ...paper({
          decisionTypeKey: 'jv_signing_authorization',
          issue: 'DEMO — Signing readiness for the fictional JV requires an authorization decision.',
          recommendation: 'DEMO — Recommend that the Board authorizes signing (reserved matter).',
          requiredAuthority: 'Board of Directors — to be confirmed (reserved matter in the DEMO matrix)',
          latestSafeDate: in45,
        }),
      }),
    );
    const c = await asUser('finance', (ctx) =>
      decisions.create(ctx, pid, {
        committeeId: sc.id,
        title: 'Demo — Separation spend commitment for network re-addressing (synthetic)',
        ...paper({
          decisionTypeKey: 'separation_spend_commitment',
          issue: 'DEMO — Network re-addressing needs a committed separation spend.',
          recommendation: 'DEMO — Commit 1,500,000 DEMO-SAR.',
          amount: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 },
          requiredAuthority: 'Steering committee (within DEMO limit of 5,000,000 DEMO-SAR)',
        }),
      }),
    );
    // (e) Gate G0 passage: the committee cannot approve its own mandate, so it recommends to the delegating authority
    //     (reserved matter in the DEMO matrix); the gates module links the final decision to the G0 gate decision.
    const g0 = await asUser('pm', (ctx) =>
      decisions.create(ctx, pid, {
        committeeId: sc.id,
        title: 'Demo — Recommend passage of gate G0 (Mandate & Governance) to the delegating authority',
        gateKey: 'G0',
        ...paper({
          decisionTypeKey: 'charter_amendment',
          issue: 'DEMO — The programme mandate, charters and delegation (G0 criteria) are evidenced; G0 passage is reserved to the delegating authority.',
          recommendation: 'DEMO — Recommend that the delegating authority approves passage of G0.',
          impacts: { financial: 'DEMO — None identified.', operational: 'DEMO — Enables gate G1 assessment to conclude.', schedule: 'DEMO — Keeps the synthetic G1 date.' },
          requiredAuthority: 'Delegating authority — to be confirmed (reserved matter in the DEMO matrix)',
        }),
      }),
    );
    await asUser('pm', (ctx) =>
      decisions.create(ctx, pid, {
        committeeId: sc.id,
        title: 'Demo — Change request: add a shared cooling asset to the perimeter (draft)',
        decisionTypeKey: 'change_request_budget',
        issue: 'DEMO — A shared cooling asset was identified after the perimeter draft.',
      }),
    );

    // 5. Meeting #1: agenda requests screened onto the agenda, pack frozen, session, attendance, conflicts, quorum.
    const m = await asUser('secretary', (ctx) => meetings.create(ctx, pid, sc.id, { title: 'Demo — Steering Committee meeting #1', scheduledAt: new Date().toISOString(), location: 'DEMO — virtual meeting room' }));
    for (const d of [a, b, g0]) {
      const req = await asUser('pm', (ctx) => meetings.createAgendaRequest(ctx, pid, { committeeId: sc.id, title: `Decision ${d.code}`, kind: 'decision', decisionId: d.id, meetingId: m.id }));
      await asUser('secretary', (ctx) => meetings.screenAgendaRequest(ctx, pid, req.id, { expectedVersion: req.version, outcome: 'accept', meetingId: m.id, note: DEMO_NOTE }));
    }
    const version = async (id: string) => (await asUser('secretary', (ctx) => decisions.get(ctx, pid, id))).version;
    for (const d of [a, b, g0]) {
      const ev = await version(d.id);
      await asUser('pm', (ctx) => decisions.submit(ctx, pid, d.id, { expectedVersion: ev }));
    }
    const cv = await version(c.id);
    await asUser('finance', (ctx) => decisions.submit(ctx, pid, c.id, { expectedVersion: cv }));
    for (const d of [a, b, g0]) {
      const ev = await version(d.id);
      await asUser('secretary', (ctx) => decisions.startReview(ctx, pid, d.id, { expectedVersion: ev }));
    }

    let mv = (await asUser('secretary', (ctx) => meetings.command(ctx, pid, m.id, 'publish_agenda', { expectedVersion: 1 }))).version;
    mv = (await asUser('secretary', (ctx) => meetings.freezePack(ctx, pid, m.id, { expectedVersion: mv, note: DEMO_NOTE }))).version;
    mv = (await asUser('secretary', (ctx) => meetings.command(ctx, pid, m.id, 'start_session', { expectedVersion: mv }))).version;
    await asUser('secretary', (ctx) =>
      meetings.recordAttendance(ctx, pid, m.id, { entries: ['chair', 'sponsor', 'secretary', 'finance', 'legal', 'approver', 'tech.lead'].map((k) => ({ membershipId: membershipIds.get(k)!, status: 'present' as const })) }),
    );
    for (const k of ['chair', 'sponsor', 'finance', 'legal', 'approver']) {
      await asUser(k, (ctx) => meetings.declareConflict(ctx, pid, m.id, { declaration: 'no_conflict', description: DEMO_NOTE }));
    }
    mv = (await asUser('secretary', (ctx) => meetings.quorumCheck(ctx, pid, m.id, { expectedVersion: mv }))).version;

    // 6. Votes and outcomes (recorded by the chair; the secretariat can later record the external decision on (b)).
    const av = await version(a.id);
    const bv = await version(b.id);
    const gv = await version(g0.id);
    for (const k of ['chair', 'sponsor', 'finance', 'legal', 'approver']) {
      await asUser(k, (ctx) => decisions.castVote(ctx, pid, a.id, { expectedVersion: av, choice: 'approve' }));
      await asUser(k, (ctx) => decisions.castVote(ctx, pid, b.id, { expectedVersion: bv, choice: k === 'legal' ? 'abstain' : 'approve', comment: DEMO_NOTE }));
      await asUser(k, (ctx) => decisions.castVote(ctx, pid, g0.id, { expectedVersion: gv, choice: 'approve', comment: DEMO_NOTE }));
    }
    await asUser('chair', (ctx) => decisions.recordOutcome(ctx, pid, a.id, { expectedVersion: av, note: DEMO_NOTE }));
    await asUser('chair', (ctx) => decisions.recordOutcome(ctx, pid, b.id, { expectedVersion: bv, note: DEMO_NOTE }));
    await asUser('chair', (ctx) => decisions.recordOutcome(ctx, pid, g0.id, { expectedVersion: gv, note: DEMO_NOTE }));

    // 7. Close, minutes (secretary drafts, chair approves).
    mv = (await asUser('secretary', (ctx) => meetings.command(ctx, pid, m.id, 'close_session', { expectedVersion: mv }))).version;
    mv = (
      await asUser('secretary', (ctx) =>
        meetings.draftMinutes(ctx, pid, m.id, {
          expectedVersion: mv,
          text: `DEMO minutes (synthetic). Quorum met. ${a.code} approved within the DEMO mandate. ${b.code} recommended — pending external authority (reserved matter). ${g0.code} (gate G0) recommended to the delegating authority. No conflicts declared.`,
        }),
      )
    ).version;
    await asUser('chair', (ctx) => meetings.approveMinutes(ctx, pid, m.id, { expectedVersion: mv }));

    // 7b. The delegating authority's approval of the G0 recommendation is recorded by the secretariat (a different
    //     person than the chair who recorded the recommendation) with a clearly synthetic reference. DOM-P2-12: it rests
    //     on an evidence link on the decision (linked by the PM) verified by a second person (Legal) — synthetic note.
    const ev = await asUser('pm', (ctx) =>
      evidence.link(ctx, pid, {
        targetType: 'decision',
        targetId: g0.id,
        note: 'DEMO — synthetic record of the delegating authority\'s approval of G0 passage (not a real resolution).',
        purpose: 'Evidence of the external authority decision (demo)',
      }),
    );
    await asUser('legal', (ctx) => evidence.verify(ctx, pid, ev.id, { expectedVersion: 1, decision: 'accept', note: `${DEMO_NOTE}: evidence checked against the synthetic reference` }));
    const g0v = await version(g0.id);
    await asUser('secretary', (ctx) =>
      decisions.recordExternalApproval(ctx, pid, g0.id, {
        expectedVersion: g0v,
        outcome: 'approved',
        externalReference: 'DEMO-DELEGATING-AUTHORITY-G0 (synthetic reference — not a real resolution)',
        evidenceLinkId: ev.id,
        note: DEMO_NOTE,
      }),
    );

    // 8. Approval ≠ implementation: action with owner + due date, then implementation tracking starts.
    const pmId = await userId('pm');
    await asUser('secretary', (ctx) => actions.create(ctx, pid, { title: 'Demo — Book rehearsal environment and confirm vendor slots', decisionId: a.id, meetingId: m.id, ownerUserId: pmId, dueDate: in14 }));
    const av2 = await version(a.id);
    await asUser('secretary', (ctx) => decisions.startImplementation(ctx, pid, a.id, { expectedVersion: av2, note: DEMO_NOTE }));
    log(`governance demo scenario: committee ${sc.id}, meeting #${m.number}, decisions ${a.code} (implementation pending), ${b.code} (recommended), ${c.code} (submitted), ${g0.code} (G0, approved by the delegating authority), + 1 draft`);
    void v;
  },
};
