// F-DG5-150 (ADR-0061 §9; T-DG6-FE-G): on the Traceability page the note "Showing the links of <record>" renders the
// record name inside `.record-name` (`overflow-wrap: anywhere`, styles/app.css), so a 200-character unbroken name wraps
// instead of widening the page. The layout itself (no page-level horizontal scroll at 390, 360 and 320 px and at
// 1280 px with 200 % text, en and ar) is measured in a real browser: see the T-DG6-FE-G handback evidence. Here: the
// sentence is the catalogue's, in the page language, and only the name is wrapped. SYNTHETIC data.
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { LOCALES } from "@mth/shared";
import { createI18n } from "../../i18n/index.ts";
import { RootedNote } from "./TraceabilityPage.tsx";

afterEach(cleanup);

const LONG = "R".repeat(200); // one unbroken 200-character token

describe.each(LOCALES)("the rooted note (F-DG5-150) (%s)", (locale) => {
  const i18n = createI18n(locale);
  const type = i18n.t("traceability.nodeType.initiative", { defaultValue: "Initiative" });

  it("renders the catalogue sentence with the record name inside .record-name, exactly once", () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <p>
          <RootedNote type={type} name={LONG} />
        </p>
      </I18nextProvider>,
    );
    const names = container.querySelectorAll(".record-name");
    expect(names).toHaveLength(1);
    expect(names[0]!.textContent).toBe(LONG);
    expect(container.textContent).toBe(i18n.t("traceability.graph.rooted", { type, name: LONG }));
    expect(container.textContent).not.toContain("");
  });
});

it("the .record-name rule wraps anywhere (styles/app.css)", () => {
  const css = readFileSync(join(import.meta.dirname, "../../styles/app.css"), "utf8");
  expect(css).toMatch(/\.record-name\s*\{\s*overflow-wrap:\s*anywhere;/);
});
