// Draft recovery on the Initiative Card (T05) and the "Your drafts" list, with stubbed API responses, in English and
// Arabic (T-DG6-FE-D2; ADR-0057 §6, §9; ADR-0041 §5; REQ-S15-010 "unsaved drafts are recoverable"; REQ-S15-011 "a
// draft is labelled 'Draft - not submitted'"). SYNTHETIC data. Proves:
//  - an open draft of the record is offered with the badge "Draft - not submitted", "Restore draft" and "Discard draft";
//    restoring opens the editor with the draft's values;
//  - editing autosaves on blur through the P5 routes: createFormDraft (recordType, recordId, baseRecordVersion and the
//    changed fields only) when there is no draft, updateFormDraft with If-Match of the draft's version when there is;
//  - saving the record sends the PATCH with If-Match of the record and then closes the draft as "saved"; cancelling
//    keeps the draft; "Discard draft" closes it as "discarded";
//  - a draft whose record was saved since (`baseChanged`) shows the conflict state;
//  - the auditor (no initiative.edit) reads no draft and is offered nothing;
//  - "Your drafts" lists the drafts across transformations with the badge, the conflict state and the record link.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { mockApi, renderApp, route, TR_ID, type Handler } from "../../test/fixtures.tsx";
import { esc, frameHandlers, initiative, page, TR, wave } from "../../pages/portfolio/p3fixtures.ts";
import type { FormDraft } from "./api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Locale = "en" | "ar";
const W1 = wave();
const INI = initiative({ code: "INI-09", name: "Synthetic saved name", objective: "Synthetic objective", version: 3 });
const DRAFT_ID = "01920006-0000-7000-8000-00000000d001";

function draft(over: Partial<FormDraft> = {}): FormDraft {
  return {
    id: DRAFT_ID,
    recordType: "T05",
    recordId: INI.id,
    baseRecordVersion: 3,
    baseChanged: false,
    payload: { sourceFields: { name: "Synthetic draft name" }, customFieldValues: {}, currencyCodes: {} },
    status: "open",
    closedReason: null,
    closedAt: null,
    version: 2,
    createdAt: "2026-10-30T06:00:00Z",
    updatedAt: "2026-10-30T06:05:00Z",
    ...over,
  };
}

function render(locale: Locale, opts: { grants?: "lead" | "auditor"; open?: FormDraft | null } = {}) {
  let open = opts.open ?? null;
  const handlers: Handler[] = [
    route("GET", new RegExp(`${esc(TR)}/form-drafts\\?`), () => page(open ? [open] : [])),
    route("POST", new RegExp(`${esc(TR)}/form-drafts$`), (req) => {
      const b = req.body as { payload: FormDraft["payload"] };
      open = draft({ version: 1, payload: b.payload });
      return { status: 201, body: open };
    }),
    route("PUT", new RegExp(`${esc(TR)}/form-drafts/${DRAFT_ID}$`), (req) => {
      const b = req.body as { payload: FormDraft["payload"] };
      open = draft({ ...(open ?? {}), version: (open?.version ?? 1) + 1, payload: b.payload });
      return { status: 200, body: open };
    }),
    route("POST", new RegExp(`${esc(TR)}/form-drafts/${DRAFT_ID}/close$`), (req) => {
      const closed = draft({
        ...(open ?? {}),
        status: "closed",
        closedReason: (req.body as { reason: "saved" | "discarded" }).reason,
        closedAt: "2026-10-30T07:00:00Z",
      });
      open = null;
      return { status: 200, body: closed };
    }),
    route("GET", new RegExp(`/api/v1/initiatives/${INI.id}$`), () => ({ status: 200, body: INI })),
    route("PATCH", new RegExp(`/api/v1/initiatives/${INI.id}$`), (req) => ({
      status: 200,
      body: { ...INI, ...(req.body as object), version: INI.version + 1 },
    })),
    route("GET", new RegExp(`/api/v1/initiatives/${INI.id}/deliverables`), () => ({
      status: 200,
      body: { items: [], countWarning: null },
    })),
    route("GET", new RegExp(`${esc(TR)}/waves`), () => page([W1])),
  ];
  const api = mockApi(...frameHandlers(locale, opts.grants ?? "lead", handlers));
  renderApp(`/transformations/${TR_ID}/initiatives/${INI.id}`, { i18n: createI18n(locale) });
  return api;
}

const draftWrites = (api: ReturnType<typeof mockApi>) =>
  api.requests.filter((r) => r.method !== "GET" && r.url.includes("/form-drafts"));

describe.each(["en", "ar"] as const)("draft recovery on the Initiative Card (%s)", (locale) => {
  const t = createI18n(locale).t;
  const nameLabel = t("portfolio.t05.name");

  it("offers an open draft with the badge; restore opens the editor with the draft's values; save closes it", async () => {
    const api = render(locale, { open: draft() });
    const offer = await screen.findByRole("region", { name: t("productivity.drafts.recoveryTitle") });
    expect(offer.querySelector("[data-badge='draft-not-submitted']")?.textContent?.trim()).toBe(
      t("productivity.drafts.badge"),
    );
    if (locale === "en") expect(t("productivity.drafts.badge")).toBe("Draft - not submitted");
    fireEvent.click(within(offer).getByRole("button", { name: new RegExp(t("productivity.drafts.restore")) }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText(new RegExp(nameLabel)) as HTMLInputElement;
    expect(name.value).toBe("Synthetic draft name");
    // An edit is autosaved on blur, on the open draft, with If-Match of the draft's version.
    const objective = within(dialog).getByLabelText(new RegExp(t("portfolio.t05.objective"))) as HTMLTextAreaElement;
    fireEvent.change(objective, { target: { value: "Synthetic drafted objective" } });
    fireEvent.focusOut(objective);
    await waitFor(() => expect(draftWrites(api).filter((r) => r.method === "PUT")).toHaveLength(1));
    const put = draftWrites(api).find((r) => r.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"2"');
    expect(put.body).toEqual({
      payload: {
        sourceFields: { name: "Synthetic draft name", objective: "Synthetic drafted objective" },
        customFieldValues: {},
        currencyCodes: {},
      },
    });
    await waitFor(() => expect(dialog.querySelector("[data-autosave='saved']")).toBeTruthy());
    // Save: the record PATCH (If-Match of the record), then the draft closes as saved.
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(api.requests.some((r) => r.url.endsWith(`/form-drafts/${DRAFT_ID}/close`))).toBe(true));
    const patch = api.requests.find((r) => r.method === "PATCH")!;
    expect(patch.headers["if-match"]).toBe('"3"');
    expect(patch.body).toEqual({ name: "Synthetic draft name", objective: "Synthetic drafted objective" });
    const close = api.requests.find((r) => r.url.endsWith(`/form-drafts/${DRAFT_ID}/close`))!;
    expect(close.body).toEqual({ reason: "saved" });
    expect(api.requests.indexOf(close)).toBeGreaterThan(api.requests.indexOf(patch));
  });

  it("creates the draft on blur when there is none (changed fields only); cancel keeps it", async () => {
    const api = render(locale);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("portfolio.card.edit")) }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-badge='draft-not-submitted']")).toBeNull();
    const name = within(dialog).getByLabelText(new RegExp(nameLabel));
    fireEvent.change(name, { target: { value: "Synthetic typed name" } });
    fireEvent.focusOut(name);
    await waitFor(() => expect(draftWrites(api)).toHaveLength(1));
    const post = draftWrites(api)[0]!;
    expect(post.method).toBe("POST");
    expect(post.body).toEqual({
      recordType: "T05",
      recordId: INI.id,
      baseRecordVersion: 3,
      payload: { sourceFields: { name: "Synthetic typed name" }, customFieldValues: {}, currencyCodes: {} },
    });
    expect(await within(dialog).findByText(t("productivity.drafts.badge"))).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.requests.some((r) => r.url.includes("/close"))).toBe(false);
    expect(api.requests.some((r) => r.method === "PATCH")).toBe(false);
    // The kept draft is offered again on the page.
    expect(await screen.findByRole("region", { name: t("productivity.drafts.recoveryTitle") })).toBeTruthy();
  });

  it("discards a draft (closed as discarded) and says the record is unchanged", async () => {
    const api = render(locale, { open: draft() });
    const offer = await screen.findByRole("region", { name: t("productivity.drafts.recoveryTitle") });
    fireEvent.click(within(offer).getByRole("button", { name: t("productivity.drafts.discard") }));
    expect(await screen.findByText(t("productivity.drafts.discarded"))).toBeTruthy();
    const close = api.requests.find((r) => r.url.endsWith("/close"))!;
    expect(close.body).toEqual({ reason: "discarded" });
    expect(close.headers["if-match"]).toBe('"2"');
  });

  it("shows the conflict state for a draft whose record was saved since", async () => {
    render(locale, { open: draft({ baseChanged: true, baseRecordVersion: 2 }) });
    const offer = await screen.findByRole("region", { name: t("productivity.drafts.recoveryTitle") });
    const conflict = offer.querySelector("[data-state='conflict']");
    expect(conflict?.textContent).toContain(t("common.conflict.lead"));
    expect(conflict?.textContent).toContain(t("productivity.drafts.baseChanged"));
  });

  it("reads no draft for the auditor and offers nothing", async () => {
    const api = render(locale, { grants: "auditor", open: draft() });
    await screen.findByRole("heading", { level: 2, name: new RegExp("INI-09") });
    expect(api.requests.some((r) => r.url.includes("/form-drafts"))).toBe(false);
    expect(screen.queryByRole("region", { name: t("productivity.drafts.recoveryTitle") })).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("Your drafts (%s)", (locale) => {
  const t = createI18n(locale).t;
  const OTHER_TR = "01920006-0000-7000-8000-0000000000f2";
  const mine = [
    {
      id: DRAFT_ID,
      transformationId: TR_ID,
      transformationCode: "TR-01",
      transformationName: "Synthetic transformation",
      recordType: "T05",
      recordId: INI.id,
      baseRecordVersion: 3,
      baseChanged: true,
      version: 2,
      createdAt: "2026-10-30T06:00:00Z",
      updatedAt: "2026-10-30T06:05:00Z",
    },
    {
      id: "01920006-0000-7000-8000-00000000d002",
      transformationId: OTHER_TR,
      transformationCode: "TR-02",
      transformationName: "Synthetic second transformation",
      recordType: "T13",
      recordId: null,
      baseRecordVersion: null,
      baseChanged: false,
      version: 1,
      createdAt: "2026-10-29T06:00:00Z",
      updatedAt: "2026-10-29T06:05:00Z",
    },
  ];

  it("lists the caller's drafts across transformations with the badge, the conflict state and the record link", async () => {
    const api = mockApi(
      ...frameHandlers(locale, "lead", [route("GET", /\/api\/v1\/me\/form-drafts/, () => page(mine))]),
    );
    renderApp("/my-work/drafts", { i18n: createI18n(locale) });
    expect(await screen.findByRole("heading", { level: 1, name: t("productivity.drafts.mineTitle") })).toBeTruthy();
    const table = await screen.findByRole("table");
    const badges = table.querySelectorAll("[data-badge='draft-not-submitted']");
    expect(badges).toHaveLength(2);
    for (const b of badges) expect(b.textContent?.trim()).toBe(t("productivity.drafts.badge"));
    expect(table.textContent).toContain("TR-01");
    expect(table.textContent).toContain("TR-02");
    expect(table.querySelector("[data-state='conflict']")?.textContent).toContain(
      t("productivity.drafts.baseMoved", { version: 3 }),
    );
    expect(table.textContent).toContain(t("productivity.drafts.newRecord"));
    const link = within(table).getByRole("link", { name: new RegExp("TR-01") });
    expect(link.getAttribute("href")).toBe(`/transformations/${TR_ID}/initiatives/${INI.id}`);
    expect(api.requests.find((r) => r.url.includes("/me/form-drafts"))!.url).toContain("limit=50");
  });

  it("shows the empty state when there is no draft", async () => {
    mockApi(...frameHandlers(locale, "lead", [route("GET", /\/api\/v1\/me\/form-drafts/, () => page([]))]));
    renderApp("/my-work/drafts", { i18n: createI18n(locale) });
    expect(await screen.findByText(t("productivity.drafts.empty"))).toBeTruthy();
  });
});
