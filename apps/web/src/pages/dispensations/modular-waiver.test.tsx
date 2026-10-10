// The Modular G3 waiver on the DG3 dispensations page (T-DG4-FE-F; D-110; ADR-0021 amendment W1-W2; ADR-0038 B1) with
// stubbed responses, in English (LTR) and Arabic (RTL). SYNTHETIC data; a waiver decision is a business approval inside
// the product, never an engineering gate (DG0-DG7). The DG3 dispensation tests (dispensations.test.tsx) are unchanged.
//  - On a Modular transformation the form offers a waiver; its hint says it applies only to G3 for the whole
//    transformation and covers only the missing baseline and outcome links.
//  - A G3 waiver with no initiative is sent as recorded and labelled "Waiver of the missing baseline and outcome links"
//    in the list (never a launch waiver or an approval).
//  - Every other Modular waiver still reaches the server and shows the DG3 refusal, translated.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, mockApi, renderApp, route, type Handler } from "../../test/fixtures.tsx";
import { dispensation, esc, frameHandlers, page, problemBody, TR } from "../portfolio/p3fixtures.ts";
import { isModularLinksWaiver } from "./DispensationsPage.tsx";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LINKS_WAIVER = dispensation({ gateCode: "G3", reason: "Synthetic: the baseline is being located" });

function render(locale: "en" | "ar", extra: Handler[] = [], mode: "end_to_end" | "modular" = "modular") {
  const api = mockApi(
    ...frameHandlers(
      locale,
      "lead",
      [...extra, route("GET", new RegExp(`${esc(TR)}/gate-dispensations`), () => page([LINKS_WAIVER]))],
      { mode, entryPhase: mode === "modular" ? "design" : null },
    ),
  );
  renderApp(`/transformations/${TR_ID}/dispensations`, { i18n: createI18n(locale) });
  return api;
}

describe("isModularLinksWaiver", () => {
  it("is exactly a Modular G3 waiver with no initiative", () => {
    expect(isModularLinksWaiver("modular", { kind: "waiver", gateCode: "G3", initiativeId: null })).toBe(true);
    expect(isModularLinksWaiver("modular", { kind: "waiver", gateCode: "G2", initiativeId: null })).toBe(false);
    expect(isModularLinksWaiver("modular", { kind: "waiver", gateCode: "G3", initiativeId: "x" })).toBe(false);
    expect(isModularLinksWaiver("end_to_end", { kind: "waiver", gateCode: "G3", initiativeId: null })).toBe(false);
    expect(isModularLinksWaiver("modular", { kind: "inherited_approval", gateCode: "G3", initiativeId: null })).toBe(
      false,
    );
  });
});

describe.each(["en", "ar"] as const)("Modular G3 waiver (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("labels a Modular G3 waiver as the waiver of the missing links; End-to-End keeps the DG3 label", async () => {
    render(locale);
    const cell = await waitFor(() => {
      const el = document.querySelector("[data-modular-links-waiver]");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(cell.textContent).toContain(t("gates.modularWaiver.label"));
    cleanup();
    vi.unstubAllGlobals();
    render(locale, [], "end_to_end");
    await screen.findByText("Synthetic: the baseline is being located");
    expect(document.querySelector("[data-modular-links-waiver]")).toBeNull();
  });

  it("offers the waiver with the Modular hint and sends a G3 waiver without an initiative", async () => {
    const { requests } = render(locale, [
      route("POST", new RegExp(`${esc(TR)}/gate-dispensations$`), () => ({ status: 201, body: LINKS_WAIVER })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("dispensations.record.action")) }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-kind-hint='modular']")!.textContent).toBe(t("gates.modularWaiver.kindHint"));
    fireEvent.click(within(dialog).getByRole("radio", { name: t("dispensations.kind.waiver") }));
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t("dispensations.field.gate"))), {
      target: { value: "G3" },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("dispensations.field.reason")}`)), {
      target: { value: "Synthetic: the baseline is being located" },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("dispensations.field.expiresOn")}`)), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("dispensations.record.submit") }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({
      kind: "waiver",
      gateCode: "G3",
      reason: "Synthetic: the baseline is being located",
      expiresOn: "2026-12-31",
    });
  });

  it("any other Modular waiver shows the DG3 refusal, translated", async () => {
    render(locale, [
      route("POST", new RegExp(`${esc(TR)}/gate-dispensations$`), () =>
        problemBody(
          422,
          "urn:mth:problem:validation",
          "dispensation.waiver_requires_end_to_end",
          "A waiver applies to the End-to-End launch sequencing; a Modular transformation is not held to it.",
          [{ pointer: "/kind", code: "dispensation.waiver_requires_end_to_end", message: "English" }],
        ),
      ),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("dispensations.record.action")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: t("dispensations.kind.waiver") }));
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t("dispensations.field.gate"))), {
      target: { value: "G2" },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("dispensations.field.reason")}`)), {
      target: { value: "Synthetic G2 waiver" },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("dispensations.field.expiresOn")}`)), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("dispensations.record.submit") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("dispensations.problem.dispensation__waiver_requires_end_to_end"));
  });
});
