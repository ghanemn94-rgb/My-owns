// code-security-reviewer DG4 ROUND-4 probe KU (T-DG4-REV-SEC-R4): the FE-R7 dashboard formatters (apps/web/src/pages/
// dashboards/ui.tsx formatValueParts/ValueView) with UNTRUSTED kpiUnit.label strings (free text from the KPI definition)
// and hostile values. Copied into the disposable clone at apps/web/src/pages/dashboards/zz-sec-dg4-ku.test.tsx and run
// with the web unit project. NOT product code. All data synthetic.
import { cleanup, render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardValue } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { ValueView, formatValue, formatValueParts } from "./ui.tsx";

afterEach(() => cleanup());
const HOSTILE = [
  "<img src=x onerror=alert(1)>",
  "%<script>alert(1)</script>",
  "{{constructor.constructor('alert(1)')()}}",
  "$t(dashboards.state.zero)",
  "‮evil‬",
  "% \" onmouseover=\"alert(1)",
  "javascript:alert(1)",
];
const v = (kind: string, label: string | null, value = "0.12", state = "value"): DashboardValue =>
  ({ state, value, unit: label ?? kind, currency: kind === "currency" ? "SAR" : null, reasonKey: state === "value" ? null : "kpi.stale", kpiUnit: { kind, label } }) as DashboardValue;

describe("SEC-DG4-R4 probe KU: kpiUnit.label is display text only", () => {
  it.each(HOSTILE)("label %j never changes the scaling and is rendered as inert text (en, ar; value and stale)", async (label) => {
    for (const locale of ["en", "ar"] as const) {
      const i18n = await createI18n(locale);
      for (const kind of ["percentage", "ratio", "count", "currency", "other"]) {
        const p = formatValueParts(v(kind, label), locale);
        const plain = formatValueParts(v(kind, null), locale);
        // the number never depends on a non-'%' label (a label starting with '%' only replaces the bare sign)
        if (!label.startsWith("%")) expect(p?.number, `${kind} ${locale}`).toBe(plain?.number);
        for (const state of ["value", "stale", "zero"]) {
          const { container } = render(
            <I18nextProvider i18n={i18n}>
              <ValueView value={v(kind, label, state === "zero" ? "0" : "0.12", state)} />
            </I18nextProvider>,
          );
          expect(container.querySelector("img,script,a,[onerror],[onmouseover]"), `${kind} ${state}`).toBeNull();
          if (kind !== "currency") expect(container.textContent, `${kind} ${state}`).toContain(label.trim());
          cleanup();
        }
      }
    }
  });
  it("scaling follows kind: percentage x100 whatever the label; ratio plain; exact decimals", () => {
    const r = {
      pct_none: formatValue(v("percentage", null, "0.07"), "en"),
      pct_users: formatValue(v("percentage", "% of users", "0.07"), "en"),
      pct_word: formatValue(v("percentage", "Percent", "0.07"), "en"),
      ratio_pct_label: formatValue(v("ratio", "%", "1.5"), "en"),
      ratio_none: formatValue(v("ratio", null, "1.5"), "en"),
      big: formatValue(v("percentage", null, "0.123456789012345678901234567890"), "en"),
      nan: formatValue(v("percentage", "x", "NaN"), "en"),
      inf: formatValue(v("ratio", "x", "Infinity"), "en"),
      junk: formatValue(v("count", "x", "<b>1</b>"), "en"),
      ws_label: formatValueParts(v("ratio", "   ", "2"), "en"),
    };
    console.log(`[probe-KU] ${JSON.stringify(r)}`);
    expect(r.pct_none).toBe("7 %");
    expect(r.pct_users).toBe("7 % of users");
    expect(r.ratio_none).toBe("1.5");
    expect(r.ratio_pct_label).not.toContain("150");
    expect(r.nan).toBeNull();
    expect(r.inf).toBeNull();
    expect(r.junk).toBeNull();
    expect(r.ws_label).toEqual({ number: "2", label: null });
  });
});
