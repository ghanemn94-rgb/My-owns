import { describe, expect, it } from 'vitest';
import { formatMessage, parseRenderedMessage, renderMessagesEn, serverMessage } from './messages';
import { reconcilePerimeter } from './carveout';
import {
  derivePerimeterImpacts,
  IMPACT_MESSAGES_EN,
  PERIMETER_HISTORY_MESSAGES_EN,
  PERIMETER_MESSAGES_EN,
  perimeterHistoryReason,
  perimeterHistoryReasonI18n,
  reconcilePerimeterRegister,
  withheldImpactEntry,
  type ImpactInput,
} from './perimeter';
import { TSA_MESSAGES_EN, tsaEscalationI18n, tsaEscalationText } from './readiness';

/**
 * QA-P34-01 (docs/reviews/P3-P4-qa-review.md) [REQ-UX-001, REQ-UX-002]: the carve-out and TSA sentences the server computes
 * or stores are returned with codes + parameters the web translates. Sentences stored as plain text (record-history reasons,
 * system escalation texts) are rendered from a template table and their codes recovered from the same table.
 */
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
/** Record codes, enum values, keys and dates as the server writes them. */
const CODE_PARAMS: Record<string, string> = {
  code: 'TSA-002',
  cr: 'CR-004',
  item: 'PI-003',
  aspect: 'economic',
  command: 'report_transferred',
  from: 'in_progress',
  to: 'transferred_pending_evidence',
  disposition: 'shared',
  transferClass: 'novation_required',
  decisionType: 'tsa_approval_or_extension',
  matrixVersion: '12',
  endDate: '2026-09-24',
};
/** Free text (names, the user's justification / note, recorded summaries) may hold any punctuation of the templates. */
const sample = (name: string) => CODE_PARAMS[name] ?? `${name} text (with "quotes", parentheses) — and: punctuation; v2 → ok.`;

describe('QA-P34-01 — stored sentences: codes recovered from the template they were rendered from', () => {
  for (const [label, table, parse] of [
    ['perimeter history reasons', PERIMETER_HISTORY_MESSAGES_EN, perimeterHistoryReasonI18n],
    ['TSA escalation texts', TSA_MESSAGES_EN, tsaEscalationI18n],
  ] as const) {
    it(`${label}: every template round-trips (render → parse gives the same code and parameters)`, () => {
      for (const [code, template] of Object.entries(table)) {
        const params = Object.fromEntries(placeholders(template).map((p) => [p, sample(p)]));
        const text = formatMessage(template, params);
        expect(parse(text), `${code}: ${text}`).toEqual([serverMessage(code, params)]);
      }
    });
  }

  it('without the token list, a free-text parameter followed by "(" would be split at the wrong place (why tokens exist)', () => {
    const text = 'Board of Directors (Demo) (tsa_approval_or_extension, matrix v3)';
    expect(parseRenderedMessage(text, TSA_MESSAGES_EN)!.params['escalateTo']).toBe('Board of Directors');
    expect(tsaEscalationI18n(text)[0]!.params['escalateTo']).toBe('Board of Directors (Demo)');
  });

  it('a more specific template wins over a generic one; unknown text matches nothing', () => {
    expect(perimeterHistoryReasonI18n('Change requested (CR-7): legal transfer not applicable — no legal title moves')).toEqual([
      serverMessage('perimeter.history.aspect_not_applicable_requested', { cr: 'CR-7', aspect: 'legal', note: 'no legal title moves' }),
    ]);
    expect(perimeterHistoryReasonI18n('Change requested (CR-8): split the shared hall')).toEqual([serverMessage('perimeter.history.change_requested', { cr: 'CR-8', justification: 'split the shared hall' })]);
    expect(tsaEscalationI18n('Steering (Demo) — within its delegated authority (tsa_approval_or_extension, matrix v1)')).toEqual([
      serverMessage('tsa.routing.within_authority', { committee: 'Steering (Demo)', decisionType: 'tsa_approval_or_extension', matrixVersion: '1' }),
    ]);
    expect(tsaEscalationI18n('Delegating authority — to be confirmed (tsa_approval_or_extension, matrix v2)')).toEqual([
      serverMessage('tsa.routing.delegating_authority_tbc', { decisionType: 'tsa_approval_or_extension', matrixVersion: '2' }),
    ]);
    expect(tsaEscalationI18n('Board of Directors (tsa_approval_or_extension, matrix v3)')).toEqual([
      serverMessage('tsa.routing.escalate_to', { escalateTo: 'Board of Directors', decisionType: 'tsa_approval_or_extension', matrixVersion: '3' }),
    ]);
    expect(perimeterHistoryReasonI18n('Edited by hand')).toEqual([]);
    expect(perimeterHistoryReasonI18n(null)).toEqual([]);
    expect(tsaEscalationI18n('Free text typed by a committee secretary')).toEqual([]);
  });

  it('writers render the sentences the API stored before the codes existed (stored rows stay recognised)', () => {
    expect(perimeterHistoryReason('perimeter.history.created_pending')).toBe('Created — held Pending under change control');
    expect(perimeterHistoryReason('perimeter.history.change_request_raised', { cr: 'CR-004', disposition: 'included' })).toBe('Change request CR-004 raised (requested: included)');
    expect(perimeterHistoryReason('perimeter.history.applied', { cr: 'CR-004' })).toBe('Applied: CR-004');
    expect(perimeterHistoryReason('perimeter.history.transferability', { transferClass: 'consent_required' })).toBe('Transferability: consent_required');
    expect(perimeterHistoryReason('perimeter.history.transfer', { aspect: 'legal', command: 'plan', from: 'not_started', to: 'planned' })).toBe('Transfer (legal) plan: not_started → planned');
    expect(tsaEscalationText('tsa.escalation.expired_unresolved', { code: 'TSA-002', name: 'Legacy monitoring bridge', endDate: '2026-09-24' })).toBe(
      'TSA TSA-002 (Legacy monitoring bridge) reached its end date 2026-09-24 without an accepted replacement service. This is NOT an exit. Decide on continuity: an extension (approved decision required; never automatic) or an alternative arrangement.',
    );
    expect(tsaEscalationText('tsa.routing.no_matrix')).toBe('Authorized body — to be confirmed (no approved authority matrix covers TSA decisions)');
  });
});

describe('QA-P34-01a/f — computed carve-out sentences carry their codes', () => {
  it('reconciliation findings: the English sentence is rendered from the codes it returns', () => {
    const r = reconcilePerimeterRegister({
      items: [
        { id: '1', code: 'PI-1', type: 'contract', disposition: 'included', transferStatus: 'not_started', economicTransferStatus: 'not_started', transferMechanism: null, plannedEffectiveDate: null, consentRequired: true, consentGranted: false, evidenceCount: 0, hasInterimArrangement: false, ownerUserId: null, resolutionPath: null, targetGateKey: null, pendingChangeRequest: true, day1: { ok: false, missing: ['interimArrangement', 'remediationPlan'] } },
        { id: '2', code: 'PI-2', type: 'asset', disposition: 'pending', transferStatus: 'not_started', economicTransferStatus: 'not_started', transferMechanism: null, plannedEffectiveDate: null, consentRequired: false, consentGranted: false, evidenceCount: 0, hasInterimArrangement: false, ownerUserId: null, resolutionPath: null, targetGateKey: null, pendingChangeRequest: false, day1: null },
        { id: '3', code: 'PI-3', type: 'asset', disposition: 'shared', transferStatus: 'not_applicable', economicTransferStatus: 'transferred_pending_evidence', transferMechanism: 'APA', plannedEffectiveDate: '2027-01-01', consentRequired: false, consentGranted: false, evidenceCount: 0, hasInterimArrangement: false, ownerUserId: 'u', resolutionPath: null, targetGateKey: null, pendingChangeRequest: false, day1: null },
      ],
      reviewedCategories: [],
    });
    expect(r.findings.map((f) => `${f.code}:${f.messageI18n.map((m) => m.code).join('+')}`)).toEqual([
      'PI-1:perimeter.recon.no_transfer_plan',
      'PI-1:perimeter.recon.consent_outstanding',
      'PI-2:perimeter.recon.pending_disposition',
      'PI-3:perimeter.recon.not_applicable_legal',
      'PI-3:perimeter.recon.no_evidence',
      'PI-1:perimeter.recon.day1_position_incomplete',
      'PI-1:perimeter.recon.change_request_pending',
      'PI-2:perimeter.recon.pending_without_resolution',
    ]);
    for (const f of r.findings) expect(f.message).toBe(renderMessagesEn(f.messageI18n, PERIMETER_MESSAGES_EN));
    expect(r.findings.find((f) => f.issue === 'day1_position_incomplete')!.messageI18n[0]!.params).toEqual({ missing: 'interimArrangement, remediationPlan' });
    expect(reconcilePerimeter([]).length).toBe(0);
  });

  it('impact entries: every summary is rendered from its codes; the financial sentence keeps its wording', () => {
    const input: ImpactInput = {
      change: { kind: 'add', itemCode: 'PI-9', itemType: 'site', fromDisposition: null, toDisposition: 'included', scopeAttributesChanged: false },
      agreements: null,
      consents: null,
      tsaServices: [],
      readinessChecks: [{ type: 'readiness_check', id: 'r1', code: 'RC-001' }],
      milestones: [],
      budgetLines: null,
      hasSite: true,
      hasWorkstream: false,
    };
    const entries = derivePerimeterImpacts(input);
    for (const e of entries) {
      expect(e.summaryI18n!.length).toBeGreaterThan(0);
      expect(e.summary).toBe(renderMessagesEn(e.summaryI18n!, IMPACT_MESSAGES_EN));
    }
    const fin = entries.find((e) => e.area === 'financial_statements')!;
    expect(fin.summary).toBe('The change adds PI-9 (included); the carve-out financial statements / reporting perimeter (balance-sheet item) must be reassessed — Assessment pending — specialist (Finance).');
    expect(fin.summaryI18n).toEqual([serverMessage('perimeter.impact.change.add', { item: 'PI-9', disposition: 'included' }), serverMessage('perimeter.impact.financial.reassess_balance_sheet')]);
    expect(entries.find((e) => e.area === 'readiness')!.summaryI18n).toEqual([serverMessage('perimeter.impact.readiness.linked', { codes: 'RC-001' })]);
    expect(withheldImpactEntry('tsa')).toEqual({ area: 'tsa', status: 'not_visible', summary: 'Not visible to you.', summaryI18n: [serverMessage('perimeter.impact.withheld')], references: [] });
  });
});
