// Unit tests of the pure Modular-entry rules (T-DG4-BE-M2; ADR-0038 §7.2, §7.3; REQ-PB-005, REQ-S03-005): the
// missing-link derivation over facts, the blocking subset that the Modular G3 precondition reads, the gate labels
// (inherited is never approved) and the create-body validation. All data is synthetic.
import { describe, expect, it } from "vitest";
import {
  blockingMissingLinks,
  deriveMissingLinks,
  gateLabelOf,
  INHERITED_LABEL_TEXT,
  inheritedApprovalAnnotation,
  inheritedRecordCreate,
  MISSING_LINK_CODES,
  MISSING_LINK_SEVERITY,
  MODULAR_LINKS_MISSING_DETAIL,
  type InheritedApprovalLabelFact,
  type MissingLinkFacts,
} from "./missing-links.ts";

const ID = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const EMPTY: MissingLinkFacts = {
  baselines: [],
  outcomes: [],
  initiatives: [],
  benefits: [],
  pendingInheritedApprovals: [],
};

describe("deriveMissingLinks (ADR-0038 §7.3)", () => {
  it("an empty Modular entry at Design: baseline and outcome link missing (blocking), and no benefit (warning)", () => {
    expect(deriveMissingLinks(EMPTY).map((i) => [i.code, i.severity])).toEqual([
      ["baseline_missing", "blocking"],
      ["outcome_link_missing", "blocking"],
      ["benefit_missing", "warning"],
    ]);
    expect(blockingMissingLinks(EMPTY).map((i) => i.code)).toEqual(["baseline_missing", "outcome_link_missing"]);
  });

  it("a baseline WITHOUT a value does not count; one with a value clears baseline_missing", () => {
    const noValue = { ...EMPTY, baselines: [{ id: ID(1), hasValue: false }] };
    expect(blockingMissingLinks(noValue).map((i) => i.code)).toContain("baseline_missing");
    const withValue = {
      ...EMPTY,
      baselines: [
        { id: ID(1), hasValue: false },
        { id: ID(2), hasValue: true },
      ],
    };
    expect(blockingMissingLinks(withValue).map((i) => i.code)).toEqual(["outcome_link_missing"]);
  });

  it("an outcome without a KPI keeps outcome_link_missing and is listed per record; one with a KPI clears it", () => {
    const f = {
      ...EMPTY,
      baselines: [{ id: ID(1), hasValue: true }],
      outcomes: [{ id: ID(3), label: "Synthetic outcome", activeKpiCount: 0 }],
    };
    expect(deriveMissingLinks(f).filter((i) => i.code !== "benefit_missing")).toEqual([
      { code: "outcome_link_missing", severity: "blocking", recordType: null, recordId: null, label: null },
      {
        code: "outcome_kpi_missing",
        severity: "warning",
        recordType: "outcome",
        recordId: ID(3),
        label: "Synthetic outcome",
      },
    ]);
    const linked = { ...f, outcomes: [...f.outcomes, { id: ID(4), label: "Linked", activeKpiCount: 2 }] };
    expect(blockingMissingLinks(linked)).toEqual([]);
    expect(deriveMissingLinks(linked).map((i) => i.code)).toEqual(["outcome_kpi_missing", "benefit_missing"]);
  });

  it("per-record warnings for initiatives, benefits and pending inherited approvals, in table order", () => {
    const f: MissingLinkFacts = {
      baselines: [{ id: ID(1), hasValue: true }],
      outcomes: [{ id: ID(2), label: "O", activeKpiCount: 1 }],
      initiatives: [
        { id: ID(5), label: "INI-0001 A", hasActiveContribution: false, hasActiveTomGapLink: false },
        { id: ID(6), label: "INI-0002 B", hasActiveContribution: true, hasActiveTomGapLink: true },
      ],
      benefits: [
        { id: ID(7), label: "BEN-01 X", hasUpstream: false },
        { id: ID(8), label: "BEN-02 Y", hasUpstream: true },
      ],
      pendingInheritedApprovals: [{ id: ID(9), gateCode: "G2" }],
    };
    expect(deriveMissingLinks(f).map((i) => [i.code, i.recordId])).toEqual([
      ["initiative_outcome_link_missing", ID(5)],
      ["initiative_gap_link_missing", ID(5)],
      ["benefit_outcome_link_missing", ID(7)],
      ["inherited_approval_unverified", ID(9)],
    ]);
    expect(blockingMissingLinks(f)).toEqual([]);
  });

  it("every code has a severity, and only the two of §7.3 block", () => {
    expect(Object.keys(MISSING_LINK_SEVERITY).sort()).toEqual([...MISSING_LINK_CODES].sort());
    expect(MISSING_LINK_CODES.filter((c) => MISSING_LINK_SEVERITY[c] === "blocking")).toEqual([
      "baseline_missing",
      "outcome_link_missing",
    ]);
  });

  it("the texts are the ADR-0038 §7.1 / §12 English texts verbatim", () => {
    expect(INHERITED_LABEL_TEXT.en).toBe("Inherited - recorded, not granted in platform");
    expect(MODULAR_LINKS_MISSING_DETAIL).toBe(
      "Modular entry: supply the missing baseline and outcome links, or record an authorized waiver, before submitting this gate.",
    );
  });
});

describe("gate labels (ADR-0038 §7.2): inherited is never approved", () => {
  const fact = (over: Partial<InheritedApprovalLabelFact>): InheritedApprovalLabelFact => ({
    dispensationId: ID(1),
    gateCode: "G2",
    status: "accepted",
    counts: true,
    approvingBody: "Synthetic board",
    approvedOn: "2026-01-15",
    createdAt: "2026-02-01T00:00:00.000Z",
    ...over,
  });

  it("approved only for a platform approval; inherited when the annotation counts; pending when pending", () => {
    const counting = inheritedApprovalAnnotation([fact({})], "G2");
    expect(gateLabelOf("draft", counting)).toBe("inherited");
    expect(gateLabelOf("approved", counting)).toBe("approved");
    const pending = inheritedApprovalAnnotation([fact({ status: "pending", counts: false })], "G2");
    expect(pending?.status).toBe("pending_verification");
    expect(gateLabelOf("draft", pending)).toBe("inherited_pending_verification");
    const revoked = inheritedApprovalAnnotation([fact({ status: "revoked", counts: false })], "G2");
    expect(gateLabelOf("draft", revoked)).toBe("draft");
    expect(gateLabelOf("submitted", null)).toBe("submitted");
    // An accepted but not-counting annotation (e.g. evidence no longer verified) is never shown as inherited.
    expect(gateLabelOf("draft", inheritedApprovalAnnotation([fact({ counts: false })], "G2"))).toBe("draft");
  });

  it("the annotation picks the counting one, else the newest pending, else the newest, per gate", () => {
    const facts = [
      fact({ dispensationId: ID(1), status: "rejected", counts: false, createdAt: "2026-03-01T00:00:00.000Z" }),
      fact({ dispensationId: ID(2), status: "pending", counts: false, createdAt: "2026-02-01T00:00:00.000Z" }),
      fact({ dispensationId: ID(3), gateCode: "G1", createdAt: "2026-04-01T00:00:00.000Z" }),
    ];
    expect(inheritedApprovalAnnotation(facts, "G2")?.dispensationId).toBe(ID(2));
    expect(inheritedApprovalAnnotation(facts, "G1")?.dispensationId).toBe(ID(3));
    expect(inheritedApprovalAnnotation(facts, "G3")).toBeNull();
    const withCounting = [...facts, fact({ dispensationId: ID(4), createdAt: "2026-01-01T00:00:00.000Z" })];
    expect(inheritedApprovalAnnotation(withCounting, "G2")?.dispensationId).toBe(ID(4));
  });
});

describe("inheritedRecordCreate", () => {
  const ok = { sourceDescription: "Synthetic: programme office archive" };
  const paths = (body: unknown) => {
    const r = inheritedRecordCreate.safeParse(body);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
  };

  it("evidence needs evidenceId and no baselineId; baseline needs baselineId and no evidenceId", () => {
    expect(paths({ ...ok, kind: "evidence", evidenceId: ID(1) })).toEqual([]);
    expect(paths({ ...ok, kind: "evidence" })).toEqual(["evidenceId:validation.required"]);
    expect(paths({ ...ok, kind: "evidence", evidenceId: ID(1), baselineId: ID(2) })).toEqual([
      "baselineId:validation.not_allowed_for_kind",
    ]);
    expect(paths({ ...ok, kind: "baseline", baselineId: ID(2) })).toEqual([]);
    expect(paths({ ...ok, kind: "baseline", evidenceId: ID(1) })).toEqual([
      "baselineId:validation.required",
      "evidenceId:validation.not_allowed_for_kind",
    ]);
  });

  it("prior_approval passes validation so the API can answer the exact 422; free text is the shared rule", () => {
    expect(paths({ ...ok, kind: "prior_approval" })).toEqual([]);
    expect(paths({ kind: "evidence", evidenceId: ID(1), sourceDescription: "   " })).toEqual([
      "sourceDescription:validation.blank",
    ]);
    expect(paths({ kind: "evidence", evidenceId: ID(1), sourceDescription: "ab" })[0]).toMatch(/^sourceDescription:/);
    expect(paths({ ...ok, kind: "evidence", evidenceId: ID(1), extra: 1 })).not.toEqual([]);
    expect(paths({ ...ok, kind: "evidence", evidenceId: ID(1), originalDate: "2026-02-30" })[0]).toMatch(
      /^originalDate:/,
    );
  });
});
