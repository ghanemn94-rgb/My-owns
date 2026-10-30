// The compare-and-reapply panel (T-DG6-FE-D2; ADR-0057 §7; REQ-S16-026 A14: "the second save returns 409 and the UI
// offers compare and reapply without losing the first change"), in English and Arabic. SYNTHETIC values.
//  - three groups field by field: my changes, their changes (kept, never sent), changed by both (a choice each);
//  - reapply waits until every conflict has a choice and sends only my changes plus the conflicts kept as mine;
//  - with no current version (the GET failed) only discard is offered.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { CompareChanges } from "./CompareChanges.tsx";

afterEach(cleanup);

const inLocale = (locale: "en" | "ar", ui: ReactNode) =>
  render(<I18nextProvider i18n={createI18n(locale)}>{ui}</I18nextProvider>);

const FIELDS = [
  { key: "name", label: "Name" },
  { key: "objective", label: "Objective" },
  { key: "risksSummary", label: "Risks" },
];
const B = { name: "Synthetic A", objective: "Grow", risksSummary: "" };
const M = { name: "Synthetic A (mine)", objective: "Grow fast", risksSummary: "" };
const C = { name: "Synthetic A", objective: "Grow safely", risksSummary: "Vendor delay" };

describe.each(["en", "ar"] as const)("CompareChanges (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("lists my changes, their changes and the conflicts, and reapplies only mine after a choice", () => {
    const onReapply = vi.fn();
    inLocale(
      locale,
      <CompareChanges
        fields={FIELDS}
        base={B}
        mine={M}
        current={C}
        yourVersion={2}
        currentVersion={3}
        onReapply={onReapply}
        onDiscard={() => undefined}
      />,
    );
    const panel = screen.getByRole("alert");
    expect(panel.dataset["state"]).toBe("conflict");
    expect(panel.textContent).toContain(t("common.conflict.lead"));
    const fieldsOf = (group: string) =>
      [...panel.querySelectorAll(`tr[data-compare-group='${group}']`)].map((e) => e.getAttribute("data-field"));
    expect(fieldsOf("mine")).toEqual(["name"]);
    expect(fieldsOf("theirs")).toEqual(["risksSummary"]);
    expect(fieldsOf("conflict")).toEqual(["objective"]);
    // The compare table keeps its caption and the "your value" / "current saved value" columns.
    const table = within(panel).getByRole("table", { name: t("common.conflict.compareCaption") });
    expect(within(table).getByRole("columnheader", { name: t("common.conflict.mine") })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: t("common.conflict.current") })).toBeTruthy();
    // An empty value is "None" (text), never blank or 0; their change is kept and labelled so.
    const theirs = panel.querySelector("tr[data-compare-group='theirs']")!;
    expect(theirs.textContent).toContain(t("common.value.none"));
    expect(theirs.textContent).toContain(t("productivity.compare.outcome_theirs"));
    const conflicts = panel.querySelector("tr[data-compare-group='conflict']")!;

    const reapply = screen.getByRole("button", { name: t("common.conflict.reapply") });
    expect((reapply as HTMLButtonElement).disabled).toBe(true);
    expect(panel.querySelector("[data-compare='unresolved']")).toBeTruthy();
    const group = within(conflicts as HTMLElement).getByRole("group", {
      name: t("productivity.compare.choose", { field: "Objective" }),
    });
    fireEvent.click(within(group).getByRole("radio", { name: new RegExp(t("productivity.compare.keepTheirs")) }));
    expect((reapply as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(reapply);
    expect(onReapply).toHaveBeenCalledOnce();
    expect(onReapply.mock.calls[0]![0]).toEqual(["name"]);

    fireEvent.click(within(group).getByRole("radio", { name: new RegExp(t("productivity.compare.keepMine")) }));
    fireEvent.click(reapply);
    expect(onReapply.mock.calls[1]![0]).toEqual(["name", "objective"]);
  });

  it("offers only discard when the current version could not be loaded", () => {
    const onDiscard = vi.fn();
    inLocale(
      locale,
      <CompareChanges
        fields={FIELDS}
        base={B}
        mine={M}
        current={null}
        yourVersion={2}
        currentVersion={null}
        onReapply={() => undefined}
        onDiscard={onDiscard}
      />,
    );
    expect(screen.queryByRole("button", { name: t("common.conflict.reapply") })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(t("productivity.compare.noLatest"));
    expect(screen.getByRole("alert").textContent).toContain(t("common.value.unknown"));
    fireEvent.click(screen.getByRole("button", { name: t("common.conflict.discard") }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("says nothing is left to send when every change of mine was resolved as theirs", () => {
    inLocale(
      locale,
      <CompareChanges
        fields={FIELDS}
        base={B}
        mine={{ ...B, objective: "Mine" }}
        current={{ ...B, objective: "Theirs" }}
        yourVersion={1}
        currentVersion={2}
        onReapply={() => undefined}
        onDiscard={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(t("productivity.compare.keepTheirs")) }));
    expect((screen.getByRole("button", { name: t("common.conflict.reapply") }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(document.querySelector("[data-compare='nothing-to-send']")).toBeTruthy();
  });
});
