// F-DG2-340 (T-DG2-FE8, REQ-PB-029): one alert per distinct form error, in English LTR and Arabic RTL. The record form
// (as a dialog, and inline with sections like the charter) gets a scripted 400 problem (SYNTHETIC; the shapes of
// docs/api/openapi.yaml) and must:
//  - say a form-level validation problem whose only field error has pointer "" ONCE, in ONE live region;
//  - keep a genuinely different second form-level message (two distinct messages: each once, two regions);
//  - say the same pointer-"" code given twice once;
//  - keep a field-pointer error on its field (aria-invalid, aria-describedby), with the generic banner once.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCsrfToken } from "../api/client.ts";
import { AppProviders, createQueryClient } from "../app/App.tsx";
import { createI18n } from "../i18n/index.ts";
import { mockApi, problem, route } from "../test/fixtures.tsx";
import { InlineRecordForm, RecordDialog, type FieldSpec } from "./RecordForm.tsx";

const LOCALES = ["en", "ar"] as const;
type Locale = (typeof LOCALES)[number];

beforeEach(() => {
  localStorage.clear();
  setCsrfToken(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL_ = "/api/v1/synthetic-records";
const FIELDS: readonly FieldSpec[] = [
  { name: "name", kind: "text", label: "Name (synthetic)", required: true },
  { name: "notes", kind: "textarea", label: "Notes (synthetic)" },
];

type Layout = "dialog" | "inline-sections";
function renderForm(layout: Layout, locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  const i18n = createI18n(locale);
  const common = {
    fields: FIELDS,
    record: null,
    createUrl: URL_,
    submitLabel: "Save (synthetic)",
    onSaved: () => undefined,
  };
  render(
    <AppProviders i18n={i18n} queryClient={createQueryClient()}>
      {layout === "dialog" ? (
        <RecordDialog {...common} title="Synthetic record" onCancel={() => undefined} />
      ) : (
        <InlineRecordForm {...common} sections={[{ title: "Synthetic section", fields: ["name", "notes"] }]} />
      )}
    </AppProviders>,
  );
  return i18n.t;
}

/** How many times `text` occurs in the rendered document. */
const occurrences = (text: string) => (document.body.textContent ?? "").split(text).length - 1;

async function submitWith(layout: Layout, locale: Locale, errors: { pointer: string; code: string }[]) {
  mockApi(route("POST", new RegExp(`${URL_}$`), () => problem(400, "validation", { errors })));
  const t = renderForm(layout, locale);
  fireEvent.change(screen.getByRole("textbox", { name: /^Name \(synthetic\)/ }), {
    target: { value: "Synthetic name" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save (synthetic)" }));
  await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
  return t;
}

describe.each(LOCALES)("record form: one alert per distinct form error (%s)", (locale) => {
  describe.each(["dialog", "inline-sections"] as const)("%s", (layout) => {
    it('a 400 whose only field error has pointer "" says its message once, in one live region', async () => {
      const t = await submitWith(layout, locale, [{ pointer: "", code: "validation.json" }]);
      const message = t("problems.validation__json");
      expect(message).not.toBe("problems.validation__json");
      await waitFor(() => expect(occurrences(message)).toBe(1));
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.textContent).toContain(message);
      expect(document.querySelector('[data-state="form-errors"]')).toBeNull();
    });

    it('the same pointer-"" code twice is still said once', async () => {
      const t = await submitWith(layout, locale, [
        { pointer: "", code: "validation.json" },
        { pointer: "", code: "validation.json" },
      ]);
      await waitFor(() => expect(occurrences(t("problems.validation__json"))).toBe(1));
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    });

    it("two distinct form-level messages: each is said exactly once, one live region each", async () => {
      const t = await submitWith(layout, locale, [
        { pointer: "", code: "validation.json" },
        { pointer: "", code: "validation.content_type" },
      ]);
      const first = t("problems.validation__json");
      const second = t("problems.validation__content_type");
      expect(first).not.toBe(second);
      await waitFor(() => expect(occurrences(first)).toBe(1));
      expect(occurrences(second)).toBe(1);
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(2);
      expect(alerts.filter((a) => a.textContent?.includes(first))).toHaveLength(1);
      expect(alerts.filter((a) => a.textContent?.includes(second))).toHaveLength(1);
    });

    it("a field-pointer error stays on its field; the generic banner is said once", async () => {
      const t = await submitWith(layout, locale, [{ pointer: "/name", code: "validation.too_big" }]);
      const fieldMessage = t("problems.validation__too_big");
      const banner = t("problems.validation");
      await waitFor(() => expect(occurrences(fieldMessage)).toBe(1));
      expect(occurrences(banner)).toBe(1);
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.textContent).toContain(banner);
      expect(alerts[0]!.textContent).not.toContain(fieldMessage);
      const name = screen.getByRole("textbox", { name: /^Name \(synthetic\)/ });
      expect(name.getAttribute("aria-invalid")).toBe("true");
      const describedBy = (name.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
      expect(describedBy.map((id) => document.getElementById(id)?.textContent ?? "").join(" ")).toContain(fieldMessage);
    });
  });
});
