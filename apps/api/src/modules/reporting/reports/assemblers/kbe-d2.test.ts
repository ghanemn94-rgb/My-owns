// Unit tests of the pure rules of the KBE-D2 assemblers (T-DG5-KBE-D2; ADR-0045 §3, §5, §7; p5-work-split §F.4), with
// worked fixtures. The database behaviour is proved by test/integration/reporting/kbe-d2-assemblers.test.ts.
// All data is SYNTHETIC. Approval states are recorded facts, never approvals; nothing here touches DG0-DG7.
import type { DashboardItem, DashboardValue } from "@mth/shared/schemas";
import { reportDocument } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { assembledCodes, assemblerOf } from "../assembler.ts";
import { itemReportValue, itemRow, itemValueBasis, itemValueState, valueColumns } from "./executive-dashboard.ts";
import { handoverApprovalState, handoverItems } from "./handover.ts";
import { minutesApprovalState } from "./meeting-minutes.ts";
import { askElements, missingElementCount } from "./meeting-pack.ts";

const KBE_D2 = ["meeting_minutes", "executive_dashboard", "handover", "meeting_pack"] as const;

describe("registry (p5-work-split §F.4)", () => {
  it("registers the four KBE-D2 assemblers, so every one of the twelve definitions has one", () => {
    for (const code of KBE_D2) expect(assemblerOf(code)?.code).toBe(code);
    expect(new Set(assembledCodes()).size).toBe(12);
  });

  it("the four take no settings: an empty object passes, anything else is report.parameters_invalid", () => {
    for (const code of KBE_D2) {
      const a = assemblerOf(code)!;
      expect(a.parseParameters({})).toEqual({});
      expect(a.parseParameters(undefined)).toEqual({});
      expect(() => a.parseParameters({ register: "raid" })).toThrow(
        expect.objectContaining({ code: "report.parameters_invalid" }),
      );
    }
  });
});

describe("approval states (ADR-0045 §3): recorded facts, never approvals", () => {
  it("meeting_minutes: approved once the minutes are approved or published, else pending (also with no minutes)", () => {
    expect(minutesApprovalState("approved")).toBe("approved");
    expect(minutesApprovalState("published")).toBe("approved");
    expect(minutesApprovalState("draft")).toBe("pending");
    expect(minutesApprovalState(null)).toBe("pending");
  });

  it("handover: accepted -> approved, submitted -> pending, returned -> changes_requested, draft -> not_submitted", () => {
    expect(handoverApprovalState("accepted")).toBe("approved");
    expect(handoverApprovalState("submitted")).toBe("pending");
    expect(handoverApprovalState("returned")).toBe("changes_requested");
    expect(handoverApprovalState("draft")).toBe("not_submitted");
  });
});

describe("handover: the M0217 items (the handovers.ts missingItemsOf rule)", () => {
  const empty = {
    kpi_owner_user_id: null,
    operating_procedures: null,
    capability_readiness: null,
    unresolved_accepted_risks: null,
    benefit_monitoring_cadence: null,
    data_access: null,
    improvement_backlog_summary: null,
  };
  it("an empty handover misses all nine, in the ADR-0034 §5 order", () => {
    expect(handoverItems(empty, { controls: 0, evidence: 0 })).toEqual(
      [
        "kpi_owner",
        "operating_procedures",
        "controls",
        "evidence",
        "capability_readiness",
        "unresolved_accepted_risks",
        "benefit_monitoring_cadence",
        "data_access",
        "improvement_backlog",
      ].map((item) => ({ item, present: false })),
    );
  });
  it("worked fixture: everything but data access, with one control and one evidence item", () => {
    const h = {
      ...empty,
      kpi_owner_user_id: "u",
      operating_procedures: "Synthetic SOP",
      capability_readiness: "Synthetic: trained",
      unresolved_accepted_risks: "None (synthetic)",
      benefit_monitoring_cadence: "monthly",
      improvement_backlog_summary: "Synthetic backlog",
    };
    const items = handoverItems(h, { controls: 1, evidence: 1 });
    expect(items.filter((i) => !i.present).map((i) => i.item)).toEqual(["data_access"]);
  });
});

describe("meeting_pack: the seven elements of an executive ask (B0102)", () => {
  const brief = {
    decision_id: null,
    ask_decision_required: "Synthetic: choose the billing platform",
    ask_why_now: "Synthetic: the offer expires",
    ask_options: ["Migrate now", "Wait"],
    ask_recommendation: "A",
    ask_impact_of_delay: null,
    ask_owner_user_id: "owner",
    ask_required_date: "2041-01-15",
  };
  it("a draft brief: its own elements; one missing (impact of delay)", () => {
    const e = askElements(brief, null, []);
    expect(e).toMatchObject({ decisionRequired: brief.ask_decision_required, options: ["Migrate now", "Wait"] });
    expect(missingElementCount(e)).toBe(1);
  });
  it("a linked T16 decision wins over the brief: its title, active options in ordinal order, recommended option", () => {
    const d = {
      title: "Synthetic T16 ask",
      why_now: "Synthetic why",
      recommendation_option_id: "o2",
      recommendation_text: null,
      impact_of_delay: "Synthetic impact",
      owner_user_id: "sp",
      due_date: "2041-02-01",
    };
    const opts = [
      { id: "o2", label: "B", title: "Wait", ordinal: 2 },
      { id: "o1", label: "A", title: "Migrate now", ordinal: 1 },
    ];
    const e = askElements({ ...brief, decision_id: "d" }, d, opts);
    expect(e).toEqual({
      decisionRequired: "Synthetic T16 ask",
      whyNow: "Synthetic why",
      options: ["A. Migrate now", "B. Wait"],
      recommendation: "B. Wait",
      impactOfDelay: "Synthetic impact",
      ownerUserId: "sp",
      requiredDate: "2041-02-01",
    });
    expect(missingElementCount(e)).toBe(0);
  });
  it("fewer than two options and every other element absent: all seven missing", () => {
    const e = askElements(
      {
        decision_id: null,
        ask_decision_required: null,
        ask_why_now: null,
        ask_options: ["Only one"],
        ask_recommendation: null,
        ask_impact_of_delay: null,
        ask_owner_user_id: null,
        ask_required_date: null,
      },
      null,
      [],
    );
    expect(missingElementCount(e)).toBe(7);
  });
});

const dv = (o: Partial<DashboardValue>): DashboardValue => ({
  state: "value",
  value: "1",
  unit: null,
  currency: null,
  reasonKey: null,
  kpiUnit: null,
  ...o,
});
const item = (o: Partial<DashboardItem> & Pick<DashboardItem, "recordType" | "recordId">): DashboardItem => ({
  code: null,
  label: null,
  href: "/x",
  rag: null,
  dueDate: null,
  value: null,
  ownerUserId: null,
  flags: [],
  valueBasis: null,
  ...o,
});

describe("executive_dashboard: Unknown and Stale carry no number (ADR-0045 §5, §12; shared rule 5)", () => {
  it("a Stale KPI actual keeps no number even though the read model carries the stale figure", () => {
    const stale = dv({
      state: "stale",
      value: "0.12",
      reasonKey: "kpi.stale",
      kpiUnit: { kind: "percentage", label: null },
    });
    expect(itemValueState(stale, "outcome_kpi")).toMatchObject({ validation: "stale", reason: "stale" });
    expect(itemReportValue(stale, "outcome_kpi")).toEqual({
      type: "decimal",
      value: null,
      unitKind: "percentage",
      currency: null,
      valueBasis: "actual",
      validation: "stale",
      reason: "stale",
    });
  });
  it("an Unknown value is unknown with no number, never 0; a known 0 is a fact", () => {
    const unknown = dv({
      state: "unknown",
      value: null,
      reasonKey: "kpi.no_accepted_actual",
      kpiUnit: { kind: "ratio", label: null },
    });
    expect(itemReportValue(unknown, "outcome_kpi")).toMatchObject({
      value: null,
      validation: "unknown",
      reason: "not_computable",
    });
    expect(
      itemReportValue(dv({ state: "zero", value: "0", unit: "currency", currency: "SAR" }), "benefit"),
    ).toMatchObject({
      value: "0",
      validation: "validated",
      valueBasis: "validated",
      currency: "SAR",
    });
  });
  it("labels: an accepted KPI actual and a validated benefit value are validated; a planned value is a plan figure (n/a)", () => {
    expect(itemValueState(dv({ kpiUnit: { kind: "count", label: null } }), "outcome_kpi").validation).toBe("validated");
    expect(itemValueState(dv({ unit: "currency", currency: "SAR" }), "benefit").validation).toBe("validated");
    expect(itemValueState(dv({ unit: "currency", currency: "SAR" }), "initiative").validation).toBe("not_applicable");
    expect([itemValueBasis("benefit"), itemValueBasis("initiative"), itemValueBasis("outcome_kpi")]).toEqual([
      "validated",
      "planned",
      "actual",
    ]);
  });

  it("worked fixture: one area with a percentage KPI, a ratio KPI and an outcome - one column per unit kind, never mixed", () => {
    const items = [
      item({ recordType: "outcome", recordId: "00000000-0000-7000-8000-000000000001", label: "Synthetic outcome" }),
      item({
        recordType: "outcome_kpi",
        recordId: "00000000-0000-7000-8000-000000000002",
        value: dv({ value: "0.12", kpiUnit: { kind: "percentage", label: "% of users" } }),
      }),
      item({
        recordType: "outcome_kpi",
        recordId: "00000000-0000-7000-8000-000000000003",
        value: dv({ value: "1.5", unit: "ratio", kpiUnit: { kind: "ratio", label: null } }),
      }),
    ];
    const cols = valueColumns(items);
    expect(cols.map((c) => c.key)).toEqual(["value_actual_percentage", "value_actual_ratio"]);
    const rows = items.map((i) => itemRow(i, cols, new Map(), 1));
    // Each value sits in its own column; the other cells of that column are n/a with the column's unit and basis.
    expect(
      rows.map((r) => r.cells.slice(6).map((c) => (c.type === "decimal" ? [c.value, c.unitKind, c.validation] : null))),
    ).toEqual([
      [
        [null, "percentage", "not_applicable"],
        [null, "ratio", "not_applicable"],
      ],
      [
        ["0.12", "percentage", "validated"],
        [null, "ratio", "not_applicable"],
      ],
      [
        [null, "percentage", "not_applicable"],
        ["1.5", "ratio", "validated"],
      ],
    ]);
    // The section passes the document schema's column_mixed rule.
    const doc = {
      schemaVersion: 1,
      definitionCode: "executive_dashboard",
      transformation: { id: "00000000-0000-7000-8000-00000000000a", code: "TR-1", name: "Synthetic" },
      subject: { type: "transformation", id: "00000000-0000-7000-8000-00000000000a", code: "TR-1", label: "Synthetic" },
      period: { id: "00000000-0000-7000-8000-00000000000b", label: "2041-01", start: "2041-01-01", end: "2041-01-31" },
      asOf: "2041-01-15T00:00:00.000Z",
      methodology: { versionId: "00000000-0000-7000-8000-00000000000c", key: "methodology", versionNo: 1 },
      approvalState: "not_applicable",
      sections: [
        {
          key: "items_outcomes",
          titleKey: "report.executive_dashboard.items",
          kind: "table",
          sources: [],
          columns: [
            ...["record_type", "code", "label", "rag", "due_date", "owner"].map((key) => ({
              key,
              labelKey: `report.executive_dashboard.${key}`,
              valueKind: key === "record_type" || key === "rag" ? "code" : key === "due_date" ? "date" : "text",
              unitKind: null,
            })),
            ...cols.map((c) => ({
              key: c.key,
              labelKey: `report.executive_dashboard.${c.key}`,
              valueKind: "decimal",
              unitKind: c.unitKind,
            })),
          ],
          rows,
          totals: [],
          emptyKey: null,
        },
      ],
    };
    const parsed = reportDocument.safeParse(doc);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });
});
