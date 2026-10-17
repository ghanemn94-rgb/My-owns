// T-DG5-KBE-D4 pure helpers (D-164 g, D-165; ADR-0045 §5, ADR-0046 §9), with worked fixtures:
//  - `kpiTargetText`: a KPI target printed in its own unit kind through the shared display formatter (half-up display
//    rounding, trailing zeros dropped, the stored value never rounded); no target is null (n/a), never "0";
//  - `kpiStatusesByItem`: the KPI status behind each dashboard item that shows a KPI;
//  - `uniqueVersions`: one snapshot version row per reference, with unique keys (report_snapshot_version_key).
// All data is synthetic.
import { formatDecimal } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import type { KpiStatusFact } from "../../dashboards/areas.ts";
import { kpiStatusesByItem, uniqueVersions } from "./executive-dashboard.ts";
import { kpiTargetText } from "./registers.ts";

describe("kpiTargetText (D-164 g; QA-C O3): the KPI target in its own unit kind", () => {
  it("drops trailing zeros: 100.000000 → 100 (count, score, ratio, duration, other)", () => {
    for (const unit of ["count", "score", "ratio", "duration", "other"])
      expect(kpiTargetText("100.000000", unit, null), unit).toBe("100");
    expect(kpiTargetText("12.500000", "ratio", null)).toBe("12.5");
    expect(kpiTargetText("0.000000", "count", null)).toBe("0");
  });

  it("a percentage (stored as a fraction) shows its % form: 0.250000 → 25 %; 0.123456 → 12.35 % (half-up)", () => {
    expect(kpiTargetText("0.250000", "percentage", null)).toBe("25 %");
    expect(kpiTargetText("1.000000", "percentage", null)).toBe("100 %");
    expect(kpiTargetText("0.123456", "percentage", null)).toBe("12.35 %");
    expect(kpiTargetText("0.123449", "percentage", null)).toBe("12.34 %");
    expect(kpiTargetText("-0.050000", "percentage", null)).toBe("-5 %");
  });

  it("money at 2 fraction digits with its ISO 4217 code (half-up), grouping in both languages", () => {
    expect(kpiTargetText("1500000.000000", "currency", "SAR")).toBe("SAR 1,500,000");
    expect(kpiTargetText("10.125000", "currency", "SAR ")).toBe("SAR 10.13");
    expect(kpiTargetText("10.124999", "currency", "SAR")).toBe("SAR 10.12");
  });

  it("other units keep up to 4 fraction digits (display rounding only)", () => {
    expect(kpiTargetText("3.141593", "score", null)).toBe("3.1416");
    expect(kpiTargetText("1234.500000", "count", null)).toBe("1,234.5");
  });

  it("no target is null (the cell says n/a), never 0", () => {
    expect(kpiTargetText(null, "count", null)).toBeNull();
    expect(kpiTargetText(null, "percentage", null)).toBeNull();
  });

  it("the text is the same in en and ar (Latin digits, the same separators): one document serves both", () => {
    for (const v of ["100", "1234567.125", "25", "0.5"])
      expect(formatDecimal(v, { locale: "ar", maxFractionDigits: 2 })).toBe(
        formatDecimal(v, { locale: "en", maxFractionDigits: 2 }),
      );
  });
});

const status = (kpiDefinitionId: string, evaluationId: string | null): KpiStatusFact => ({
  kpiDefinitionId,
  kpiName: "Synthetic KPI",
  ownerUserId: null,
  displayedRag: "green",
  calculatedRag: "green",
  overridden: false,
  actual: "90",
  actualStatus: "accepted",
  actualReason: null,
  unit: null,
  unitKind: "count",
  unitLabel: null,
  currency: null,
  reportingPeriodId: "p1",
  periodLabel: "2085-Q1",
  evaluationId,
  calculationRunId: null,
});

describe("kpiStatusesByItem (D-165): the KPI behind a dashboard item", () => {
  it("maps outcome KPIs and adoption indicators by `<recordType>:<recordId>`; other items show no KPI", () => {
    const m = kpiStatusesByItem({
      outcomes: [
        {
          outcomeId: "o1",
          transformationId: "t1",
          statement: "Synthetic outcome",
          ownerUserId: null,
          kpis: [{ outcomeKpiId: "ok1", ownerUserId: null, status: status("k1", "e1") }],
        },
      ],
      indicators: [
        {
          metricLinkId: "m1",
          transformationId: "t1",
          templateKey: "adoption",
          targetKind: "rate",
          status: status("k2", null),
        },
      ],
    });
    expect([...m.keys()].sort()).toEqual(["adoption_metric_link:m1", "outcome_kpi:ok1"]);
    expect(m.get("outcome_kpi:ok1")?.evaluationId).toBe("e1");
    expect(m.get("adoption_metric_link:m1")?.kpiDefinitionId).toBe("k2");
    expect(m.get("outcome:o1")).toBeUndefined();
  });
});

describe("uniqueVersions (D-165): one row per reference, keys unique per kind", () => {
  it("drops exact repeats and suffixes a second label of the same key", () => {
    const out = uniqueVersions([
      { versionKind: "kpi_version", referenceId: "v1", referenceKey: "kpi_definition:k1", versionLabel: "v1" },
      { versionKind: "kpi_version", referenceId: "v1", referenceKey: "kpi_definition:k1", versionLabel: "v1" },
      { versionKind: "kpi_version", referenceId: "v2", referenceKey: "kpi_definition:k1", versionLabel: "v2" },
      {
        versionKind: "calculation_engine",
        referenceId: null,
        referenceKey: "kpi_rules",
        versionLabel: "mth-kpi/1.0.0",
      },
      {
        versionKind: "calculation_engine",
        referenceId: null,
        referenceKey: "kpi_rules",
        versionLabel: "mth-kpi/1.0.0",
      },
    ]);
    expect(out.map((v) => [v.versionKind, v.referenceId, v.referenceKey, v.versionLabel])).toEqual([
      ["kpi_version", "v1", "kpi_definition:k1", "v1"],
      ["kpi_version", "v2", "kpi_definition:k1:v2", "v2"],
      ["calculation_engine", null, "kpi_rules", "mth-kpi/1.0.0"],
    ]);
    expect(new Set(out.map((v) => `${v.versionKind}|${v.referenceKey}`)).size).toBe(out.length);
  });
});
