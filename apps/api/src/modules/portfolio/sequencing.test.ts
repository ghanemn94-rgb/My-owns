// Unit tests of the pure sequencing rules (ADR-0021 §3-§5; REQ-PB-004, REQ-PB-007, REQ-PB-022). No database.
import { describe, expect, it } from "vitest";
import {
  blockersOf,
  checkDirectionForLaunch,
  checkG1,
  checkLaunch,
  checkSubmit,
  SEQUENCING_REASONS,
  sequencingState,
  type DispensationFact,
  type SequencingFacts,
} from "./sequencing.ts";

const INI = "01920000-0000-7000-8000-0000000000a1";
const OTHER = "01920000-0000-7000-8000-0000000000a2";
const INI_FUNDED = { id: INI, status: "funded" } as const;
const G1_TEXT =
  "Case for change not yet approved (G1): leadership agreement on problem, baseline and material value pools is required before an initiative enters the portfolio";
const DIRECTION_TEXT = "North Star, outcomes and target state not yet approved";

const facts = (over: Partial<SequencingFacts> = {}): SequencingFacts => ({
  mode: "end_to_end",
  gates: { G1: "draft", G2: "draft", G3: "draft" },
  dispensations: [],
  ...over,
});
const disp = (over: Partial<DispensationFact>): DispensationFact => ({
  kind: "waiver",
  gateCode: "G3",
  initiativeId: null,
  counts: true,
  ...over,
});

describe("sequencing rules (pure)", { timeout: 5_000 }, () => {
  it("uses the exact ADR-0021 §3 texts", () => {
    expect(SEQUENCING_REASONS["initiative.g1_not_approved"]).toBe(G1_TEXT);
    expect(SEQUENCING_REASONS["initiative.direction_not_approved"]).toBe(DIRECTION_TEXT);
  });

  it("G1: approved satisfies; draft, submitted or rejected does not", () => {
    expect(checkG1(facts({ gates: { G1: "approved" } }))).toEqual({ ok: true });
    for (const status of ["draft", "submitted", "rejected", "changes_requested", "deferred"])
      expect(checkG1(facts({ gates: { G1: status } }))).toEqual({
        ok: false,
        code: "initiative.g1_not_approved",
        reasonEn: G1_TEXT,
      });
    expect(checkSubmit(facts({ gates: {} })).ok).toBe(false);
  });

  it("G1: a counting inherited approval satisfies only in a Modular transformation; pending/unverified never", () => {
    const inherited = disp({ kind: "inherited_approval", gateCode: "G1" });
    expect(checkG1(facts({ mode: "modular", dispensations: [inherited] })).ok).toBe(true);
    expect(checkG1(facts({ mode: "modular", dispensations: [{ ...inherited, counts: false }] })).ok).toBe(false);
    expect(checkG1(facts({ mode: "end_to_end", dispensations: [inherited] })).ok).toBe(false);
    // An inherited approval of another gate, or a waiver of G1, does not let an initiative enter the portfolio.
    expect(checkG1(facts({ mode: "modular", dispensations: [{ ...inherited, gateCode: "G2" }] })).ok).toBe(false);
    expect(checkG1(facts({ mode: "modular", dispensations: [disp({ gateCode: "G1" })] })).ok).toBe(false);
  });

  it("End-to-End launch: G2 and G3 approved, or a counting waiver for each missing gate", () => {
    const base = { gates: { G1: "approved", G2: "approved", G3: "draft" } };
    expect(checkDirectionForLaunch(facts(base))).toEqual({
      ok: false,
      code: "initiative.direction_not_approved",
      reasonEn: DIRECTION_TEXT,
    });
    expect(checkDirectionForLaunch(facts({ gates: { G1: "approved", G2: "approved", G3: "approved" } })).ok).toBe(true);
    expect(checkDirectionForLaunch(facts({ ...base, dispensations: [disp({})] })).ok).toBe(true);
    expect(checkDirectionForLaunch(facts({ ...base, dispensations: [disp({ counts: false })] })).ok).toBe(false);
    expect(checkDirectionForLaunch(facts({ ...base, dispensations: [disp({ gateCode: "G2" })] })).ok).toBe(false);
    // Both missing: one waiver is not enough.
    const neither = { gates: { G1: "approved" } };
    expect(checkDirectionForLaunch(facts({ ...neither, dispensations: [disp({})] })).ok).toBe(false);
    expect(checkDirectionForLaunch(facts({ ...neither, dispensations: [disp({}), disp({ gateCode: "G2" })] })).ok).toBe(
      true,
    );
  });

  it("an initiative-scoped waiver applies to that initiative only; inherited approvals never waive End-to-End", () => {
    const f = facts({ gates: { G1: "approved", G2: "approved" }, dispensations: [disp({ initiativeId: INI })] });
    expect(checkDirectionForLaunch(f, INI).ok).toBe(true);
    expect(checkDirectionForLaunch(f, OTHER).ok).toBe(false);
    expect(checkDirectionForLaunch(f).ok).toBe(false);
    const inherited = facts({
      gates: { G1: "approved", G2: "approved" },
      dispensations: [disp({ kind: "inherited_approval" })],
    });
    expect(checkDirectionForLaunch(inherited, INI).ok).toBe(false);
  });

  it("Modular launch is not held to G2/G3 (entered later)", () => {
    expect(checkDirectionForLaunch(facts({ mode: "modular", gates: {} })).ok).toBe(true);
  });

  it("launch checks G1 first only while the initiative is draft, then direction", () => {
    const f = facts({ gates: { G1: "draft", G2: "draft", G3: "draft" } });
    expect(checkLaunch(f, { id: INI, status: "draft" })).toMatchObject({ code: "initiative.g1_not_approved" });
    expect(checkLaunch(f, { id: INI, status: "selected" })).toMatchObject({
      code: "initiative.direction_not_approved",
    });
    expect(checkLaunch(facts({ gates: { G1: "approved", G2: "approved", G3: "approved" } }), INI_FUNDED).ok).toBe(true);
  });

  it("sequencingState: a fresh End-to-End transformation can neither submit nor launch, with both blockers", () => {
    expect(sequencingState(facts())).toEqual({
      canSubmit: false,
      canLaunch: false,
      blockers: [
        { code: "initiative.g1_not_approved", message: G1_TEXT },
        { code: "initiative.direction_not_approved", message: DIRECTION_TEXT },
      ],
    });
    expect(sequencingState(facts({ gates: { G1: "approved", G2: "approved", G3: "approved" } }))).toEqual({
      canSubmit: true,
      canLaunch: true,
      blockers: [],
    });
    expect(sequencingState(facts({ gates: { G1: "approved" } }))).toMatchObject({
      canSubmit: true,
      canLaunch: false,
    });
  });

  it("blockersOf de-duplicates by code", () => {
    const g1 = checkG1(facts());
    expect(blockersOf([g1, g1, { ok: true }])).toEqual([{ code: "initiative.g1_not_approved", message: G1_TEXT }]);
  });
});
