// Unit tests of the ADR-0045 §5 validation rules, the value builders, the approval-state helpers and the canonical
// content hash (T-DG5-KBE-C; REQ-S13-007, REQ-S13-008). Pure: no database, no network. Worked fixtures are synthetic.
import { createHash } from "node:crypto";
import { countReportValues, reportDocument, reportValue, type ReportDocument } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import {
  codeValue,
  combinedApprovalState,
  countValue,
  dateValue,
  decimalValue,
  gateApprovalState,
  textValue,
  timestampValue,
} from "./assembler.ts";
import {
  approvalBackedState,
  baselineState,
  benefitAmountState,
  benefitBaselineState,
  benefitValueState,
  formulaVersionState,
  isStale,
  kpiActualState,
  NOT_APPLICABLE,
  plainState,
  PROVISIONAL,
  STALE,
  UNKNOWN_MISSING,
  UNKNOWN_NOT_COMPUTABLE,
  VALIDATED,
} from "./provisional.ts";
import { canonicalReportJson, reportContentSha256 } from "./snapshots.ts";

describe("rule 1: benefit value states (ADR-0030)", () => {
  it.each([
    ["validated", VALIDATED],
    ["sustained", VALIDATED],
    ["submitted", PROVISIONAL],
    ["forecast", PROVISIONAL],
    ["measured", PROVISIONAL],
    ["planned", NOT_APPLICABLE],
    ["rejected", UNKNOWN_NOT_COMPUTABLE],
  ])("%s -> %o", (state, expected) => {
    expect(benefitValueState(state)).toEqual(expected);
  });

  it("an amount state: unknown has no number, n/a stays n/a, known takes its value state", () => {
    expect(benefitAmountState("unknown", "validated")).toEqual(UNKNOWN_MISSING);
    expect(benefitAmountState("not_applicable", "submitted")).toEqual(NOT_APPLICABLE);
    expect(benefitAmountState("known", "submitted")).toEqual(PROVISIONAL);
    expect(benefitAmountState("known", "validated")).toEqual(VALIDATED);
  });
});

describe("rule 2: formula versions (ADR-0024)", () => {
  it("only a validated formula version is validated; any other status is provisional; none is unknown", () => {
    expect(formulaVersionState("validated")).toEqual(VALIDATED);
    expect(formulaVersionState("draft")).toEqual(PROVISIONAL);
    expect(formulaVersionState("submitted")).toEqual(PROVISIONAL);
    expect(formulaVersionState(null)).toEqual(UNKNOWN_MISSING);
  });
});

describe("rule 3: baselines (ADR-0019, ADR-0029)", () => {
  it("validated on the current row version only; an earlier version's validation is stale and does not count", () => {
    expect(baselineState({ validationStatus: "validated", validatedRecordVersion: 3, version: 3 })).toEqual(VALIDATED);
    expect(baselineState({ validationStatus: "validated", validatedRecordVersion: 2, version: 3 })).toEqual(
      PROVISIONAL,
    );
    expect(baselineState({ validationStatus: "unvalidated", validatedRecordVersion: null, version: 1 })).toEqual(
      PROVISIONAL,
    );
    expect(baselineState({ validationStatus: "rejected", validatedRecordVersion: 1, version: 1 })).toEqual(PROVISIONAL);
  });

  it("the benefit register's baseline copy: validated only when validated", () => {
    expect(benefitBaselineState("validated")).toEqual(VALIDATED);
    expect(benefitBaselineState("unvalidated")).toEqual(PROVISIONAL);
    expect(benefitBaselineState("rejected")).toEqual(PROVISIONAL);
  });
});

describe("rule 4: KPI actuals (ADR-0027, ADR-0028)", () => {
  const base = { hasValue: true, dataAsOf: "2026-09-30", staleAfterDays: 45, asOfDate: "2026-10-14" };
  it("no actual or a missing value is unknown; not accepted is provisional; accepted and fresh is validated", () => {
    expect(kpiActualState({ ...base, status: null })).toEqual(UNKNOWN_MISSING);
    expect(kpiActualState({ ...base, status: "accepted", hasValue: false })).toEqual(UNKNOWN_MISSING);
    expect(kpiActualState({ ...base, status: "submitted" })).toEqual(PROVISIONAL);
    expect(kpiActualState({ ...base, status: "draft" })).toEqual(PROVISIONAL);
    expect(kpiActualState({ ...base, status: "accepted" })).toEqual(VALIDATED);
  });

  it("accepted but older than the staleness window is stale (no number), never green", () => {
    expect(kpiActualState({ ...base, status: "accepted", dataAsOf: "2026-08-01" })).toEqual(STALE);
    // Boundary: data as of 2026-08-30 + 45 days = 2026-10-14, not before the as-of date: still current.
    expect(isStale("2026-08-30", 45, "2026-10-14")).toBe(false);
    expect(isStale("2026-08-29", 45, "2026-10-14")).toBe(true);
    // Across a month and a leap day.
    expect(isStale("2028-02-28", 1, "2028-02-29")).toBe(false);
    expect(isStale("2028-02-28", 1, "2028-03-01")).toBe(true);
  });
});

describe("rules 5 and 6", () => {
  it("present without a state of its own -> not_applicable; absent -> unknown (missing)", () => {
    expect(plainState(true)).toEqual(NOT_APPLICABLE);
    expect(plainState(false)).toEqual(UNKNOWN_MISSING);
  });
  it("an approval-backed record: approved -> validated; otherwise provisional; none -> not_applicable", () => {
    expect(approvalBackedState("approved")).toEqual(VALIDATED);
    expect(approvalBackedState("pending")).toEqual(PROVISIONAL);
    expect(approvalBackedState("not_submitted")).toEqual(PROVISIONAL);
    expect(approvalBackedState(null)).toEqual(NOT_APPLICABLE);
    expect(approvalBackedState("not_applicable")).toEqual(NOT_APPLICABLE);
  });
});

describe("value builders: Unknown and Stale never carry a number", () => {
  it("a missing decimal is unknown with no value; a stale one drops its number; each parses as a report value", () => {
    const missing = decimalValue(null, { unitKind: "currency", currency: "SAR", valueBasis: "planned" });
    expect(missing).toEqual({
      type: "decimal",
      value: null,
      unitKind: "currency",
      currency: "SAR",
      valueBasis: "planned",
      validation: "unknown",
      reason: "missing",
    });
    const stale = decimalValue("12.5", { unitKind: "count", state: STALE });
    expect(stale).toMatchObject({ value: null, validation: "stale", reason: "stale" });
    const pending = decimalValue("1000.0000", {
      unitKind: "currency",
      currency: "SAR ",
      valueBasis: "submitted",
      state: PROVISIONAL,
    });
    expect(pending).toMatchObject({ value: "1000.0000", currency: "SAR", validation: "provisional", reason: null });
    const na = decimalValue(null, { unitKind: "currency", valueBasis: "planned", state: NOT_APPLICABLE });
    expect(na).toMatchObject({ value: null, validation: "not_applicable", reason: null });
    for (const v of [missing, stale, pending, na]) expect(reportValue.safeParse(v).success).toBe(true);
  });

  it("text, date, timestamp, code and count follow the same rule", () => {
    expect(textValue(null)).toMatchObject({ value: null, validation: "unknown", reason: "missing" });
    expect(textValue("Synthetic", "user")).toMatchObject({ value: "Synthetic", validation: "not_applicable" });
    expect(dateValue("2026-01-31T00:00:00.000Z")).toMatchObject({ value: "2026-01-31" });
    expect(timestampValue(new Date("2026-10-14T10:00:00Z"))).toMatchObject({ value: "2026-10-14T10:00:00.000Z" });
    expect(codeValue("risk", "report.raid_type")).toMatchObject({ value: "risk", labelKey: "report.raid_type.risk" });
    expect(codeValue(null, "report.raid_type")).toMatchObject({ value: null, labelKey: null, validation: "unknown" });
    expect(countValue(0)).toMatchObject({ value: 0, validation: "not_applicable" });
    expect(countValue(3, STALE)).toMatchObject({ value: null, validation: "stale" });
  });

  it("the schema refuses a number with an unknown label and a validated value without one", () => {
    const bad1 = { type: "count", value: 0, validation: "unknown", reason: "missing" };
    const bad2 = { type: "count", value: null, validation: "validated", reason: null };
    const bad3 = { type: "count", value: null, validation: "unknown", reason: null };
    const bad4 = { type: "count", value: 1, validation: "not_applicable", reason: "missing" };
    for (const v of [bad1, bad2, bad3, bad4]) expect(reportValue.safeParse(v).success).toBe(false);
  });
});

describe("approval states (ADR-0045 §3): recorded facts, never an approval", () => {
  it("maps the product gate status", () => {
    expect(gateApprovalState("approved")).toBe("approved");
    expect(gateApprovalState("submitted")).toBe("pending");
    expect(gateApprovalState("under_review")).toBe("pending");
    expect(gateApprovalState("changes_requested")).toBe("changes_requested");
    expect(gateApprovalState("rejected")).toBe("rejected");
    expect(gateApprovalState("draft")).toBe("not_submitted");
    expect(gateApprovalState("deferred")).toBe("not_submitted");
    expect(gateApprovalState(null)).toBe("not_submitted");
  });
  it("combines row states: none -> not_applicable, one -> it, several -> mixed", () => {
    expect(combinedApprovalState([null, "not_applicable"])).toBe("not_applicable");
    expect(combinedApprovalState(["approved", null, "approved"])).toBe("approved");
    expect(combinedApprovalState(["approved", "pending"])).toBe("mixed");
  });
});

describe("canonical content JSON and its SHA-256 (ADR-0045 §3, ADR-0039 §1 rules)", () => {
  it("sorts keys by code point, drops undefined, no whitespace; integers only", () => {
    expect(canonicalReportJson({ b: 1, a: "x", c: undefined, d: [true, null] })).toBe(
      '{"a":"x","b":1,"d":[true,null]}',
    );
    // U+FFFF sorts before U+1F600 by code point (UTF-16 code-unit order would put the emoji first).
    expect(canonicalReportJson({ "\u{1F600}": 1, "￿": 2 })).toBe('{"￿":2,"\u{1F600}":1}');
    expect(() => canonicalReportJson({ a: 0.1 })).toThrow(/integers/);
  });

  it("a worked document: same content -> same hash on every run; any change -> another hash", () => {
    const doc: ReportDocument = {
      schemaVersion: 1,
      definitionCode: "charter",
      transformation: { id: "0190f0a0-0000-7000-8000-000000000001", code: "T-001", name: "Synthetic" },
      subject: {
        type: "transformation",
        id: "0190f0a0-0000-7000-8000-000000000001",
        code: "T-001",
        label: "Synthetic",
      },
      period: null,
      asOf: "2026-10-14T10:00:00.000Z",
      methodology: { versionId: "0190f0a0-0000-7000-8000-000000000002", key: "playbook", versionNo: 1 },
      approvalState: "not_submitted",
      sections: [
        {
          key: "charter",
          titleKey: "report.charter.title",
          kind: "fields",
          sources: [],
          fields: [{ key: "in_scope", labelKey: "report.charter.in_scope", value: textValue("Synthetic scope") }],
        },
      ],
    };
    expect(reportDocument.safeParse(doc).success).toBe(true);
    const h = reportContentSha256(doc);
    const expected = createHash("sha256")
      .update(Buffer.from(canonicalReportJson(doc), "utf8"))
      .digest("hex");
    expect(h.sha256).toBe(expected);
    expect(h.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(reportContentSha256(JSON.parse(JSON.stringify(doc)) as ReportDocument).sha256).toBe(h.sha256);
    const changed = { ...doc, asOf: "2026-10-14T10:00:00.001Z" };
    expect(reportContentSha256(changed).sha256).not.toBe(h.sha256);
    expect(countReportValues(doc.sections)).toEqual({ provisional: 0, unknown: 0 });
  });
});
