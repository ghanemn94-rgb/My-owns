// Inline edit on the initiative register, with stubbed API responses, in English and Arabic (T-DG6-FE-D2;
// ADR-0057 §8; REQ-S15-010 "bulk and inline edits go through the same validation, authorization and concurrency
// checks as single edits"; REQ-S16-026). SYNTHETIC data. Proves:
//  - one PATCH per cell edit, through the record's own route, with If-Match of the row's version and only that field;
//  - a blank name is refused in the browser (the shared hasText rule) and nothing is sent;
//  - a 409 shows the conflict state in the row; compare loads the current record and reapply sends the field with
//    If-Match of the current version (the other user's change to another field is not sent);
//  - a 422 is the cell's one translated alert;
//  - the auditor (no initiative.edit) is offered no edit control.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { fieldErrorMessage } from "../../lib/problem.ts";
import { mockApi, renderApp, route, TR_ID, type Handler } from "../../test/fixtures.tsx";
import {
  EMPTY_HIERARCHY,
  esc,
  frameHandlers,
  initiative,
  page,
  problemBody,
  TR,
  wave,
} from "../../pages/portfolio/p3fixtures.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Locale = "en" | "ar";
const W1 = wave();
const INI = initiative({ code: "INI-07", name: "Synthetic inline item", version: 4 });

function render(locale: Locale, grants: "lead" | "auditor", extra: Handler[] = []) {
  let current = INI;
  const api = mockApi(
    ...frameHandlers(locale, grants, [
      ...extra,
      route("GET", /\/api\/v1\/initiatives\?/, () => page([current])),
      route("GET", new RegExp(`/api/v1/initiatives/${INI.id}$`), () => ({ status: 200, body: current })),
      route("PATCH", new RegExp(`/api/v1/initiatives/${INI.id}$`), (req) => {
        current = { ...current, ...(req.body as object), version: current.version + 1 };
        return { status: 200, body: current };
      }),
      route("GET", new RegExp(`${esc(TR)}/waves`), () => page([W1])),
      route("GET", new RegExp(`${esc(TR)}/prioritization$`), () => ({ status: 200, body: { items: [] } })),
      route("GET", new RegExp(`${esc(TR)}/outcome-hierarchy$`), () => ({ status: 200, body: EMPTY_HIERARCHY })),
    ]),
  );
  renderApp(`/transformations/${TR_ID}/portfolio`, { i18n: createI18n(locale) });
  return {
    api,
    setCurrent: (c: typeof INI) => {
      current = c;
    },
  };
}

const editButton = (locale: Locale) =>
  screen.findByRole("button", {
    name: createI18n(locale).t("productivity.inlineEdit.editLabel", {
      field: createI18n(locale).t("portfolio.field.name"),
      record: "INI-07",
    }),
  });
const input = (locale: Locale) =>
  screen.getByLabelText(
    createI18n(locale).t("productivity.inlineEdit.inputLabel", {
      field: createI18n(locale).t("portfolio.field.name"),
      record: "INI-07",
    }),
  );
const patches = (api: ReturnType<typeof mockApi>) => api.requests.filter((r) => r.method === "PATCH");

describe.each(["en", "ar"] as const)("inline edit (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("sends one PATCH of the cell's field with If-Match of the row's version", async () => {
    const { api } = render(locale, "lead");
    fireEvent.click(await editButton(locale));
    fireEvent.change(input(locale), { target: { value: "Synthetic renamed item" } });
    fireEvent.click(screen.getByRole("button", { name: t("productivity.inlineEdit.save") }));
    await waitFor(() => expect(patches(api)).toHaveLength(1));
    const req = patches(api)[0]!;
    expect(req.headers["if-match"]).toBe('"4"');
    expect(req.body).toEqual({ name: "Synthetic renamed item" });
    expect(await screen.findByText("Synthetic renamed item")).toBeTruthy();
  });

  it("refuses a blank name in the browser and sends nothing; Escape cancels", async () => {
    const { api } = render(locale, "lead");
    fireEvent.click(await editButton(locale));
    fireEvent.change(input(locale), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: t("productivity.inlineEdit.save") }));
    const alert = await screen.findByRole("alert");
    expect(alert.closest("[data-inline-edit='name']")).toBeTruthy();
    expect(alert.textContent).toContain(fieldErrorMessage(t, "validation.blank"));
    expect(input(locale).getAttribute("aria-invalid")).toBe("true");
    expect(patches(api)).toHaveLength(0);
    fireEvent.keyDown(input(locale), { key: "Escape" });
    expect(await editButton(locale)).toBeTruthy();
  });

  it("shows the conflict state in the row on 409; compare and reapply send only the field on the current version", async () => {
    let first = true;
    const conflictHandler: Handler = (req) => {
      if (req.method !== "PATCH" || !first) return undefined;
      first = false;
      return {
        status: 409,
        body: {
          type: "urn:mth:problem:version-conflict",
          title: "Conflict",
          status: 409,
          code: "version_conflict",
          currentVersion: 5,
          requestId: "req-409",
        },
      };
    };
    const { api, setCurrent } = render(locale, "lead", [conflictHandler]);
    fireEvent.click(await editButton(locale));
    // Someone else saved another field meanwhile (version 5).
    setCurrent({ ...INI, objective: "Synthetic objective of the other user", version: 5 });
    fireEvent.change(input(locale), { target: { value: "Synthetic mine" } });
    fireEvent.click(screen.getByRole("button", { name: t("productivity.inlineEdit.save") }));
    const cell = await waitFor(() => {
      const el = document.querySelector("[data-inline-edit='name'][data-row-state='conflict']");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(cell.textContent).toContain(t("productivity.inlineEdit.conflict"));
    fireEvent.click(within(cell).getByRole("button", { name: t("productivity.inlineEdit.compare") }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("tr[data-compare-group='mine'][data-field='name']")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.conflict.reapply") }));
    await waitFor(() => expect(patches(api)).toHaveLength(2));
    const second = patches(api)[1]!;
    expect(second.headers["if-match"]).toBe('"5"');
    expect(second.body).toEqual({ name: "Synthetic mine" });
  });

  it("shows a 422 as the cell's one translated alert", async () => {
    const refusal: Handler = (req) =>
      req.method === "PATCH"
        ? problemBody(422, "urn:mth:problem:business-rule", "initiative.read_only", "read only")
        : undefined;
    render(locale, "lead", [refusal]);
    fireEvent.click(await editButton(locale));
    fireEvent.change(input(locale), { target: { value: "Synthetic refused" } });
    fireEvent.click(screen.getByRole("button", { name: t("productivity.inlineEdit.save") }));
    const alerts = await screen.findAllByRole("alert");
    const inCell = alerts.filter((a) => a.closest("[data-inline-edit='name']"));
    expect(inCell).toHaveLength(1);
    expect(inCell[0]!.textContent?.trim().length).toBeGreaterThan(3);
  });

  it("offers the auditor no edit control", async () => {
    render(locale, "auditor");
    expect(await screen.findByText("Synthetic inline item")).toBeTruthy();
    expect(document.querySelector("[data-inline-edit]")).toBeNull();
  });
});
