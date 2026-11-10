// Status chips are distinguishable in greyscale (T-DG6-FE-F; ADR-0061 §3 item 1; REQ-S15-003 "status chips render a
// label and icon with the colour … distinguishable in greyscale"; M0300). Greyscale distinguishability is proven by the
// non-colour cues: each of the five statuses renders its own icon and its own non-empty label, in English and in
// Arabic, so no two statuses look alike once colour is removed. Unknown renders the `question` icon and its label.
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { createI18n } from "../i18n/index.ts";
import { HealthChip, Unknown, type Health } from "./Badges.tsx";
import { Icon, type IconName } from "./Icon.tsx";

afterEach(cleanup);

const STATUSES: readonly Health[] = ["on_track", "at_risk", "off_track", "unknown", "stale"];
const EXPECTED_ICON: Record<Health, IconName> = {
  on_track: "check",
  at_risk: "alert",
  off_track: "cross",
  unknown: "question",
  stale: "clock",
};

/** The icon a chip renders, identified by comparing its SVG markup to each named icon's markup. */
const ICON_MARKUP = new Map(
  (["check", "alert", "cross", "question", "clock", "dot", "info"] as const).map((n) => [
    renderToStaticMarkup(<Icon name={n} />),
    n,
  ]),
);
function iconOf(chip: Element): IconName | undefined {
  const svg = chip.querySelector("svg.icon");
  return svg ? ICON_MARKUP.get(svg.outerHTML) : undefined;
}

function inLocale(locale: "en" | "ar", ui: ReactNode) {
  return render(<I18nextProvider i18n={createI18n(locale)}>{ui}</I18nextProvider>);
}

describe("HealthChip: five statuses, five icons, five labels (greyscale-distinguishable)", () => {
  for (const locale of ["en", "ar"] as const)
    it(`renders a distinct icon and a distinct non-empty label for each status (${locale})`, () => {
      const { container } = inLocale(
        locale,
        <>
          {STATUSES.map((s) => (
            <HealthChip key={s} health={s} />
          ))}
        </>,
      );
      const chips = [...container.querySelectorAll(".status-chip")];
      expect(chips.length).toBe(5);
      const icons = chips.map(iconOf);
      const labels = chips.map((c) => (c.textContent ?? "").trim());
      expect(icons).toEqual(STATUSES.map((s) => EXPECTED_ICON[s]));
      expect(new Set(icons).size).toBe(5);
      for (const l of labels) expect(l.length).toBeGreaterThan(0);
      expect(new Set(labels).size).toBe(5);
      if (locale === "ar") for (const l of labels) expect(/[؀-ۿ]/.test(l), l).toBe(true);
      // The icon is decorative (the label carries the meaning for screen readers).
      for (const c of chips) expect(c.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    });

  it("labels differ between languages (the Arabic chip is not English text)", () => {
    const en = inLocale("en", <HealthChip health="on_track" />).container.textContent;
    cleanup();
    const ar = inLocale("ar", <HealthChip health="on_track" />).container.textContent;
    expect(en).not.toBe(ar);
  });

  for (const locale of ["en", "ar"] as const)
    it(`Unknown renders the question icon and its label, never green or 0 (${locale})`, () => {
      const { container } = inLocale(locale, <Unknown hint="no actual" />);
      const chip = container.querySelector(".status-chip")!;
      expect(iconOf(chip)).toBe("question");
      expect(chip.getAttribute("data-health")).toBe("unknown");
      expect(chip.className).toContain("status-chip--unknown");
      expect(chip.className).not.toContain("on-track");
      expect((chip.textContent ?? "").trim()).not.toMatch(/^0$/);
      expect((chip.textContent ?? "").trim().length).toBeGreaterThan(0);
    });
});
