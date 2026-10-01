import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeStatusDimensions, isCarveOutComplete, type DimensionInput } from '@hub/domain';

/**
 * P3 DOMAIN REVIEW — the operational-readiness dimension and the dimension vocabulary (docs/reviews/P3-domain-review.md;
 * business-gates.md §1, spec §3 "Show transitional services and approved enduring arrangements…", AT-06, AT-10).
 *
 * These probes call the SAME pure rule the gates module stores (`StatusDimensionsService.recomputeDimensions` →
 * `computeStatusDimensions`, `view` → `isCarveOutComplete`); reaching an approved G4 through the API needs G0–G3 approved,
 * so the rule is exercised directly with the inputs `buildInput` produces. `DEFECT` is `it.fails` while open
 * (`P3D_PROBE_PLAIN=1` runs it plain); `OBSERVED` pins current behaviour. No database access.
 */
// Implementer (fix of the P3 domain review): the DEFECT probe of this file is fixed and renamed `… (fixed, regression)` — a
// plain `it`, assertion unchanged. The alias stays so that P3D_PROBE_PLAIN=1 keeps working for any probe added later.
const defect = process.env['P3D_PROBE_PLAIN'] ? it : it.fails;
void defect;

const base: DimensionInput = {
  newcoIncorporation: { status: 'incorporated', evidenceVerified: true },
  perimeter: [{ disposition: 'included', transferStatus: 'transferred_verified', economicTransferStatus: 'transferred_verified' }],
  readiness: [{ mandatory: true, blocker: true, status: 'passed' }],
  standaloneAccepted: false,
  standaloneUnderReassessment: false,
  closings: [],
  tsas: [],
  independenceDefinitionApproved: true,
};
const ops = (i: DimensionInput) => computeStatusDimensions(i).find((d) => d.key === 'operational_readiness')!;

describe('P3 domain review — TSA problems after standalone acceptance [AT-10, REQ-LCY-014, G7-C03]', () => {
  it('CONTROL: before G4, an expired-unresolved TSA blocks the operational-readiness dimension (D-15)', () => {
    const d = ops({ ...base, tsas: [{ status: 'expired_unresolved', isEnduringArrangement: false }] });
    expect(d.state).toBe('blocked');
    expect(d.explanationI18n.map((m) => m.code)).toContain('dimension.readiness.tsa_blocked');
  });

  it('DOM-P3-11: once G4 is approved, an expired-unresolved TSA disappears from the dimension and the carve-out is shown COMPLETE (fixed, regression)', () => {
    const input: DimensionInput = { ...base, standaloneAccepted: true, tsas: [{ status: 'expired_unresolved', isEnduringArrangement: false }, { status: 'breached', isEnduringArrangement: false }] };
    const all = computeStatusDimensions(input);
    const d = all.find((x) => x.key === 'operational_readiness')!;
    const complete = isCarveOutComplete(all);
    // Required (AT-10 "escalate without declaring exit"; business-gates.md §6 rule 3 and G7-C03 "no TSA is in
    // Expired-unresolved state"; spec §3 "show transitional services … and their effect on the approved definition of
    // independence"): a TSA that expired without an accepted replacement (or is in breach) stays visible as a problem in the
    // operational dimension after standalone acceptance, and the carve-out is not shown as complete while it lasts.
    const surfaced = d.state !== 'standalone_accepted' || d.explanationI18n.some((m) => m.code === 'dimension.readiness.tsa_blocked');
    expect({ surfaced, complete }, `dimension ${JSON.stringify({ state: d.state, explanation: d.explanation })}; carveOutComplete ${complete}`).toEqual({ surfaced: true, complete: false });
  });
});

// Implementer (fix): the OBSERVED probe below pinned the reported behaviour; per the probe convention it was updated together
// with the fix (template read and inputs unchanged; GO / perimeter-approval inputs added) and now pins the implemented rule —
// see the "Fix status" of the review.
describe('P3 domain review — dimension states vs business-gates.md §1 and the dc-carveout template [REQ-LCY-006, REQ-LCY-014]', () => {
  it('DOM-P3-12 (fixed): the computed states are the documented state machines — a Day-1 GO, TSA exits and the approved perimeter move a dimension', () => {
    const template = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'packages', 'db', 'seed', 'templates', 'dc-carveout.v1.json'), 'utf8')) as {
      statusDimensions: { key: string; states: { key: string }[] }[];
    };
    const documented = Object.fromEntries(template.statusDimensions.map((d) => [d.key, d.states.map((s) => s.key)]));
    const inputs: DimensionInput[] = [
      { ...base, newcoIncorporation: { status: 'incorporated', evidenceVerified: false } },
      { ...base, perimeter: [] },
      { ...base, perimeter: [{ disposition: 'included', transferStatus: 'in_progress', economicTransferStatus: 'in_progress' }] },
      { ...base, perimeter: [{ disposition: 'included', transferStatus: 'blocked', economicTransferStatus: 'planned' }] },
      { ...base, readiness: [{ mandatory: true, blocker: true, status: 'in_progress' }] },
      { ...base, readiness: [{ mandatory: true, blocker: true, status: 'failed' }] },
      base, // every check passed — no Day-1 GO recorded anywhere in the input
      { ...base, standaloneAccepted: true, tsas: [{ status: 'active', isEnduringArrangement: false }] },
      { ...base, standaloneAccepted: true, tsas: [{ status: 'exit_accepted', isEnduringArrangement: false }] },
      // Inputs the fix adds (DimensionInput now carries the GO / acceptance of each transition plan and the perimeter approval).
      { ...base, perimeter: [{ disposition: 'included', transferStatus: 'not_started', economicTransferStatus: 'not_started' }], perimeterApproved: true },
      { ...base, cutoverPlans: [{ status: 'approved_go', goFlagged: false }] },
      { ...base, cutoverPlans: [{ status: 'accepted', goFlagged: false }] },
    ];
    const produced: Record<string, Set<string>> = {};
    for (const i of inputs) for (const d of computeStatusDimensions(i)) (produced[d.key] ??= new Set()).add(d.state);
    const undocumented = Object.fromEntries(Object.entries(produced).map(([k, s]) => [k, [...s].filter((x) => !documented[k]!.includes(x)).sort()]));
    // Implemented: every state the cockpit shows is defined by business-gates.md §1 / the template …
    expect(undocumented['incorporation']).toEqual([]);
    expect(undocumented['perimeter_transfer']).toEqual([]);
    expect(undocumented['operational_readiness']).toEqual([]);
    // … and the GO decision, the post-transition acceptance, the TSA exits and the perimeter approval move the dimensions.
    expect(produced['operational_readiness']!.has('day1_go_approved')).toBe(true);
    expect(produced['operational_readiness']!.has('operating_with_transitional_services')).toBe(true);
    expect(produced['operational_readiness']!.has('transitional_services_exited')).toBe(true);
    expect(produced['perimeter_transfer']!.has('perimeter_approved')).toBe(true);
    // Every mandatory check passed but no GO decision exists: still in progress, never "Day-1 ready" without a GO.
    expect(ops(base).state).toBe('readiness_in_progress');
    // G4 approved while a TSA is still active: "standalone_accepted" — the terminal state needs the TSA exits.
    expect(ops({ ...base, standaloneAccepted: true, tsas: [{ status: 'active', isEnduringArrangement: false }] }).state).toBe('standalone_accepted');
    expect(ops({ ...base, standaloneAccepted: true, tsas: [{ status: 'exit_accepted', isEnduringArrangement: false }] }).state).toBe('transitional_services_exited');
  });
});
