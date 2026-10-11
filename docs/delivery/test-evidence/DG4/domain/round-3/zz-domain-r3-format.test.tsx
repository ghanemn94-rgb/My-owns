// domain-reviewer DG4 round 3 (T-DG4-REV-DOM-R3): web unit probe of the dashboards' formatValue (apps/web/src/pages/
// dashboards/ui.tsx), copied ONLY into the disposable clone as apps/web/src/pages/dashboards/zz-domain-r3-format.test.tsx.
// Review evidence, not part of the candidate. It prints what each value object renders in EN and AR, and asserts the
// source semantics:
//  - F-DG4-122: a ratio (the value gap) with a currency renders as a percentage, never as money;
//  - M0170 / ADR-0028 s3: a percentage KPI value is stored as a FRACTION (0.12 = 12 %); the API sends it with unit
//    `percentage` (no unit label) or the label `%` (kpi/dashboard-facts.ts: unit = unit_label ?? unit_kind), so the
//    dashboards must show 12 %, as the KPI pages do (formatKpiValue multiplies by 100).
import { describe, expect, it } from "vitest";
import { formatValue } from "./ui.tsx";

const cases: [string, { value: string; unit: string | null; currency: string | null }, RegExp][] = [
  ["gap 100 % (ratio with SAR)", { value: "1", unit: "ratio", currency: "SAR" }, /^100 ?%$/],
  ["gap 25 % (ratio with SAR)", { value: "0.25", unit: "ratio", currency: "SAR" }, /^25 ?%$/],
  ["gap -20 % (ratio with SAR)", { value: "-0.2", unit: "ratio", currency: "SAR" }, /20 ?%/],
  ["money stays money", { value: "90", unit: "currency", currency: "SAR" }, /90\.00/],
  ["percentage KPI 12 % (fraction, unit percentage)", { value: "0.12", unit: "percentage", currency: null }, /^12 ?%$/],
  ["percentage KPI 12 % (fraction, label %)", { value: "0.12", unit: "%", currency: null }, /^12 ?%$/],
];
describe("domain-reviewer DG4 R3: formatValue renders units by the source's semantics", () => {
  for (const locale of ["en", "ar"] as const)
    for (const [name, v, want] of cases)
      it(`${locale}: ${name}`, () => {
        const out = formatValue(v, locale);
        console.log(`FORMAT ${locale} ${name} ${JSON.stringify(v)} -> ${JSON.stringify(out)}`);
        expect.soft(out ?? "<null>").toMatch(want);
        if (v.unit === "ratio") expect.soft(out ?? "").not.toMatch(/SAR|ر\.س/);
      });
});
