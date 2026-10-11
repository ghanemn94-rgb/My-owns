// code-security-reviewer DG4 ROUND-3 probe FP (T-DG4-REV-SEC-R3): formatPercent (apps/web/src/lib/format.ts) and the
// new HeadlineList/BasisChip (apps/web/src/pages/dashboards/ui.tsx) with untrusted strings. Copied into the disposable
// clone at apps/web/src/zz-sec-dg4/ and run with the unit-web project. NOT product code. All data synthetic.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatPercent } from "../lib/format.ts";

describe("SEC-DG4-R3 probe FP: formatPercent with untrusted input", () => {
  const bad = ["<img src=x onerror=alert(1)>", "NaN", "Infinity", "-Infinity", "", "   ", "1e", "12abc", "0x1g", "javascript:1"];
  it.each(bad)("invalid %j -> null (caller renders Unknown, never 0)", (v) => {
    for (const locale of ["en", "ar"] as const) expect(formatPercent(v, locale, { fraction: true })).toBeNull();
  });
  it("null/undefined -> null", () => {
    expect(formatPercent(null, "en")).toBeNull();
    expect(formatPercent(undefined, "ar")).toBeNull();
  });
  it("exact decimal, no float drift", () => {
    const r = {
      en_ratio: formatPercent("0.675676", "en", { fraction: true }),
      ar_ratio: formatPercent("0.675676", "ar", { fraction: true }),
      en_float_trap: formatPercent("0.07", "en", { fraction: true, maxFractionDigits: 6 }),
      en_neg: formatPercent("-0.125", "en", { fraction: true }),
      en_pct: formatPercent("12.5", "en"),
      en_one: formatPercent("1", "en", { fraction: true }),
    };
    console.log(`[probe-FP] ${JSON.stringify(r)}`);
    expect(r.en_float_trap).toBe("7 %"); // 0.07*100 in float = 7.000000000000001
    expect(r.en_one).toBe("100 %");
    expect(r.en_ratio).toBe("67.57 %");
    expect(r.en_pct).toBe("12.5 %");
  });
  it("a hostile string rendered as text is escaped (React text node)", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const { container } = render(<span>{formatPercent(hostile, "en") ?? hostile}</span>);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe(hostile);
  });
});
