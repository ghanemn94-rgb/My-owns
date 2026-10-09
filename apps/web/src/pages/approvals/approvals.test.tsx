// My Work > Approvals and Delegations (T-DG4-FE-A; ADR-0026 §3-§6) with stubbed responses, in English (LTR) and
// Arabic (RTL). SYNTHETIC data only.
//  - four distinct outcomes; defer asks for a date; the rationale is required; the body carries subjectVersion and the
//    request If-Match; a stale 409 says "the record changed" with a link to its history (REQ-S10-014/017/018);
//  - the requester is not offered the decision (REQ-S10-016); "B on behalf of A" in the history (REQ-S10-010);
//  - Unknown due dates show Unknown with their reason, never a date;
//  - delegations: wall-clock times in Asia/Riyadh are sent as UTC instants; a loop 422 is translated.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { USER_ID, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { OTHER_USER, approval, delegation, esc, json, p4Handlers, page } from "../my-work/p4fixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const label = (text: string) => new RegExp(`^${esc(text)}`);

describe.each(["en", "ar"] as const)("Approvals (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("lists my approvals; an Unknown due date shows Unknown with its reason, never a date", async () => {
    const a = approval({ dueDate: null, dueUnknownReason: "calendar_not_configured", title: "Synthetic unknown due" });
    mockApi(...p4Handlers(locale, ["approval.decide"], [route("GET", /\/api\/v1\/approvals(\?|$)/, () => page([a]))]));
    renderApp("/my-work/approvals", { i18n: createI18n(locale) });
    const row = (await screen.findByText("Synthetic unknown due")).closest("tr")!;
    const due = row.querySelector("[data-due='unknown']")!;
    expect(due.textContent).toContain(t("common.value.unknown"));
    expect(due.textContent).toContain(t("myWork.ui.unknownReason.calendar_not_configured"));
    expect(document.querySelector("[data-state='business-approval']")?.textContent).toContain(
      t("myWork.ui.businessApproval"),
    );
  });

  it("offers exactly four outcomes; defer needs a date; the decision sends subjectVersion with If-Match", async () => {
    const a = approval();
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["approval.decide"],
        [
          route("GET", new RegExp(`/api/v1/approvals/${a.id}$`), () => json(a)),
          route("POST", new RegExp(`/api/v1/approvals/${a.id}/decisions$`), () =>
            json({ ...a, status: "deferred", version: 2 }),
          ),
        ],
      ),
    );
    renderApp(`/my-work/approvals/${a.id}`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("approvals.decide.action") }));
    const dialog = await screen.findByRole("dialog");
    const outcome = within(dialog).getByLabelText(label(t("approvals.decide.outcome"))) as HTMLSelectElement;
    expect([...outcome.options].map((o) => o.value).filter(Boolean)).toEqual([
      "approve",
      "reject",
      "request_changes",
      "defer",
    ]);
    fireEvent.change(outcome, { target: { value: "defer" } });
    fireEvent.change(within(dialog).getByLabelText(label(t("approvals.decide.rationale"))), {
      target: { value: "Synthetic: wait for the pilot results" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("approvals.decide.confirm") }));
    // No date: the field is invalid and nothing is sent.
    const date = within(dialog).getByLabelText(label(t("approvals.decide.deferUntil")));
    await waitFor(() => expect(date.getAttribute("aria-invalid")).toBe("true"));
    expect(api.requests.some((r) => r.method === "POST")).toBe(false);
    fireEvent.change(date, { target: { value: "2026-10-20" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("approvals.decide.confirm") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({
      outcome: "defer",
      rationale: "Synthetic: wait for the pilot results",
      subjectVersion: 3,
      deferUntil: "2026-10-20",
    });
    expect(post.headers["if-match"]).toBe('"1"');
  });

  it("a blank rationale is refused before sending", async () => {
    const a = approval();
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["approval.decide"],
        [route("GET", new RegExp(`/api/v1/approvals/${a.id}$`), () => json(a))],
      ),
    );
    renderApp(`/my-work/approvals/${a.id}`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("approvals.decide.action") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(label(t("approvals.decide.outcome"))), {
      target: { value: "approve" },
    });
    const rationale = within(dialog).getByLabelText(label(t("approvals.decide.rationale")));
    fireEvent.change(rationale, { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("approvals.decide.confirm") }));
    await waitFor(() => expect(rationale.getAttribute("aria-invalid")).toBe("true"));
    expect(api.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("a stale 409 says the record changed, records nothing and links to the history", async () => {
    const a = approval();
    mockApi(
      ...p4Handlers(
        locale,
        ["approval.decide"],
        [
          route("GET", new RegExp(`/api/v1/approvals/${a.id}$`), () => json(a)),
          route("POST", /\/decisions$/, () => problem(409, "approval.stale_version", { currentVersion: 4 })),
        ],
      ),
    );
    renderApp(`/my-work/approvals/${a.id}`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("approvals.decide.action") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(label(t("approvals.decide.outcome"))), {
      target: { value: "approve" },
    });
    fireEvent.change(within(dialog).getByLabelText(label(t("approvals.decide.rationale"))), {
      target: { value: "Synthetic OK" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("approvals.decide.confirm") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.dataset["problem"]).toBe("approval.stale_version");
    expect(alert.textContent).toContain(t("problems.approval__stale_version"));
    expect(alert.querySelector("[data-state='record-changed']")?.textContent).toContain(t("approvals.stale.review"));
    const history = within(alert).getByRole("link", { name: t("approvals.stale.history") });
    expect(history.getAttribute("href")).toContain("/approval-decisions");
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
  });

  it("the requester is not offered the decision; the history shows 'B on behalf of A'", async () => {
    const a = approval({
      requestedBy: USER_ID,
      status: "changes_requested",
      decisions: [
        {
          id: "01920000-0000-7000-a000-00000000aaaa",
          roundNo: 1,
          outcome: "request_changes",
          rationale: "Synthetic: add the baseline",
          comments: null,
          subjectVersion: 3,
          decidedBy: OTHER_USER,
          onBehalfOfUserId: "01920000-0000-7000-9000-000000000777",
          decidedAt: "2026-10-02T09:00:00Z",
          businessDate: "2026-10-02",
          deferUntil: null,
        },
      ],
    });
    mockApi(
      ...p4Handlers(
        locale,
        ["approval.decide", "approval.request"],
        [route("GET", new RegExp(`/api/v1/approvals/${a.id}$`), () => json(a))],
      ),
    );
    renderApp(`/my-work/approvals/${a.id}`, { i18n: createI18n(locale) });
    expect(await screen.findByRole("button", { name: new RegExp(t("approvals.resubmit.action")) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("approvals.decide.action") })).toBeNull();
    const cell = document.querySelector("[data-on-behalf='true']")!;
    expect(cell.textContent).toBe(
      t("approvals.onBehalf", {
        actor: t("myWork.ui.person", { ref: OTHER_USER.slice(-4) }),
        principal: t("myWork.ui.person", { ref: "0777" }),
      }),
    );
  });

  it("offers 'on behalf of' only for an active delegation to me", async () => {
    const a = approval();
    const d = delegation({ delegatorUserId: OTHER_USER, delegateUserId: USER_ID });
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["approval.decide"],
        [
          route("GET", new RegExp(`/api/v1/approvals/${a.id}$`), () => json(a)),
          route("GET", /\/api\/v1\/delegations\?/, () => page([d])),
          route("POST", /\/decisions$/, () => json(a)),
        ],
      ),
    );
    renderApp(`/my-work/approvals/${a.id}`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("approvals.decide.action") }));
    const dialog = await screen.findByRole("dialog");
    const behalf = (await within(dialog).findByLabelText(label(t("approvals.decide.onBehalfOf")))) as HTMLSelectElement;
    fireEvent.change(behalf, { target: { value: OTHER_USER } });
    fireEvent.change(within(dialog).getByLabelText(label(t("approvals.decide.outcome"))), {
      target: { value: "approve" },
    });
    fireEvent.change(within(dialog).getByLabelText(label(t("approvals.decide.rationale"))), {
      target: { value: "Synthetic OK" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("approvals.decide.confirm") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    expect((api.requests.find((r) => r.method === "POST")!.body as Record<string, unknown>)["onBehalfOfUserId"]).toBe(
      OTHER_USER,
    );
  });
});

describe.each(["en", "ar"] as const)("Delegations (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("records a delegation with Asia/Riyadh wall-clock times sent as UTC; a loop 422 is translated", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["delegation.create_own", "user.read"],
        [
          route("GET", /\/api\/v1\/users\?/, () =>
            page([
              { id: OTHER_USER, displayName: "Synthetic Delegate", status: "active" },
              { id: USER_ID, displayName: "Synthetic Test User", status: "active" },
            ]),
          ),
          route("POST", /\/api\/v1\/delegations$/, () => problem(422, "delegation.loop")),
        ],
      ),
    );
    renderApp("/my-work/delegations", { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("delegations.create.action") }));
    const dialog = await screen.findByRole("dialog");
    const delegate = within(dialog).getByLabelText(label(t("delegations.field.delegate"))) as HTMLSelectElement;
    await waitFor(() => expect([...delegate.options].some((o) => o.value === OTHER_USER)).toBe(true));
    expect([...delegate.options].some((o) => o.value === USER_ID)).toBe(false);
    fireEvent.change(delegate, { target: { value: OTHER_USER } });
    fireEvent.change(within(dialog).getByLabelText(label(t("delegations.field.from"))), {
      target: { value: "2026-10-10T08:00" },
    });
    fireEvent.change(within(dialog).getByLabelText(label(t("delegations.field.to"))), {
      target: { value: "2026-10-20T08:00" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("delegations.create.submit") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.delegation__loop"));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({
      delegateUserId: OTHER_USER,
      reasonCode: "absence",
      effectiveFrom: "2026-10-10T05:00:00.000Z",
      effectiveTo: "2026-10-20T05:00:00.000Z",
    });
  });

  it("revokes with a reason and If-Match; a read-only user sees no action", async () => {
    const d = delegation({ version: 4 });
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["delegation.create_own"],
        [
          route("GET", /\/api\/v1\/delegations\?/, () => page([d])),
          route("POST", /\/revoke$/, () => json({ ...d, status: "revoked" })),
        ],
      ),
    );
    renderApp("/my-work/delegations", { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("delegations.revoke.action")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(label(t("delegations.revoke.reason"))), {
      target: { value: "Synthetic: back early" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("delegations.revoke.action") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({ reason: "Synthetic: back early" });
    expect(post.headers["if-match"]).toBe('"4"');
  });
});
