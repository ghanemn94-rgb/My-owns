// Gate dispensations (ADR-0021 §5-§6, REQ-PB-004) with stubbed responses, in English (LTR) and Arabic (RTL). SYNTHETIC.
//  - a waiver needs a reason, a scope and an expiry; an inherited approval an approving body, a date and evidence;
//  - an inherited approval shows as unverified until its evidence is verified;
//  - accept / reject / revoke are labelled business approvals; the recorder is never offered the decision;
//  - a delegated decision's 422 and the recorder's 403 are translated; no "on behalf of" control exists.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, mockApi, renderApp, route, type Handler } from "../../test/fixtures.tsx";
import { id } from "../../test/p2fixtures.ts";
import { dispensation, esc, frameHandlers, page, problemBody, TR, type Grants } from "../portfolio/p3fixtures.ts";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Locale = "en" | "ar";
const PENDING = dispensation({ gateCode: "G3", reason: "Synthetic pilot waiver" });
const MINE = dispensation({ gateCode: "G2", recordedBy: USER_ID, reason: "Synthetic waiver I recorded" });
const ACCEPTED = dispensation({
  gateCode: "G2",
  reason: "Synthetic accepted waiver",
  status: "accepted",
  counts: true,
  decidedBy: id(),
  version: 2,
});
const INHERITED = dispensation({
  kind: "inherited_approval",
  gateCode: "G1",
  reason: null,
  approvingBody: "Synthetic executive committee",
  approvedOn: "2026-02-01",
  evidenceId: id(),
  evidenceVerified: false,
  expiresOn: null,
});

function render(
  locale: Locale,
  grants: Grants = "lead",
  extra: Handler[] = [],
  mode: "end_to_end" | "modular" = "end_to_end",
) {
  const api = mockApi(
    ...frameHandlers(
      locale,
      grants,
      [
        ...extra,
        route("GET", new RegExp(`${esc(TR)}/gate-dispensations`), () => page([PENDING, MINE, ACCEPTED, INHERITED])),
      ],
      { mode, entryPhase: mode === "modular" ? "design" : null },
    ),
  );
  renderApp(`/transformations/${TR_ID}/dispensations`, { i18n: createI18n(locale) });
  return api;
}

const rowWith = async (text: string) => (await screen.findByText(text)).closest("tr")!;

describe.each(["en", "ar"] as const)("Dispensations (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("lists waivers and inherited approvals; unverified evidence is shown as unverified; recorder cannot decide", async () => {
    render(locale);
    expect(await screen.findByRole("heading", { level: 1, name: t("dispensations.title") })).toBeTruthy();
    expect(document.querySelector("[data-state='business-approval']")?.textContent).toContain(
      t("portfolio.businessApproval"),
    );
    const inherited = await rowWith("Synthetic executive committee");
    expect(inherited.querySelector("[data-verification='unverified']")?.textContent).toContain(
      t("dispensations.verification.unverified"),
    );
    expect(inherited.querySelector("[data-counts='false']")).toBeTruthy();
    const mine = await rowWith("Synthetic waiver I recorded");
    expect(mine.querySelector("[data-action='decide']")).toBeNull();
    expect(mine.textContent).toContain(t("dispensations.decide.recorderCannot"));
    const pending = await rowWith("Synthetic pilot waiver");
    expect(pending.querySelector("[data-action='decide']")).toBeTruthy();
    expect(pending.textContent).toContain(t("dispensations.scope.transformation"));
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("a waiver needs a reason and an expiry: refused inline, nothing sent; then sent with its scope", async () => {
    const { requests } = render(locale, "lead", [
      route("POST", new RegExp(`${esc(TR)}/gate-dispensations$`), () => ({ status: 201, body: PENDING })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("dispensations.record.action")) }));
    const dialog = await screen.findByRole("dialog");
    // End-to-End: the waiver is the default kind, and G1 is not offered for a waiver.
    const gate = within(dialog).getByLabelText(new RegExp(t("dispensations.field.gate")));
    expect([...gate.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual(["", "G2", "G3"]);
    fireEvent.click(within(dialog).getByRole("button", { name: t("dispensations.record.submit") }));
    const reason = within(dialog).getByLabelText(new RegExp(`^${t("dispensations.field.reason")}`));
    const expires = within(dialog).getByLabelText(new RegExp(t("dispensations.field.expiresOn")));
    await waitFor(() => expect(reason.getAttribute("aria-invalid")).toBe("true"));
    expect(expires.getAttribute("aria-invalid")).toBe("true");
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
    fireEvent.change(gate, { target: { value: "G3" } });
    fireEvent.change(reason, { target: { value: "Synthetic pilot under waiver" } });
    fireEvent.change(expires, { target: { value: "2026-12-31" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("dispensations.record.submit") }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({
      kind: "waiver",
      gateCode: "G3",
      reason: "Synthetic pilot under waiver",
      expiresOn: "2026-12-31",
    });
  });

  it("an inherited approval (Modular) needs the approving body, the date and evidence; 422s are translated", async () => {
    render(
      locale,
      "lead",
      [
        route("POST", new RegExp(`${esc(TR)}/gate-dispensations$`), () =>
          problemBody(422, "urn:mth:problem:validation", "dispensation.approved_on_future", "English detail", [
            { pointer: "/approvedOn", code: "dispensation.approved_on_future", message: "English" },
          ]),
        ),
        route("GET", new RegExp(`${esc(TR)}/evidence`), () =>
          page([
            { id: INHERITED.evidenceId, title: "Synthetic minutes", status: "active", reviewStatus: "unverified" },
          ]),
        ),
      ],
      "modular",
    );
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("dispensations.record.action")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("dispensations.record.submit") }));
    for (const label of ["approvingBody", "approvedOn", "evidence"])
      await waitFor(() =>
        expect(
          within(dialog)
            .getByLabelText(new RegExp(`^${t(`dispensations.field.${label}`)}`))
            .getAttribute("aria-invalid"),
          label,
        ).toBe("true"),
      );
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t("dispensations.field.gate"))), {
      target: { value: "G1" },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("dispensations.field.approvingBody")}`)), {
      target: { value: "Synthetic board" },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("dispensations.field.approvedOn")}`)), {
      target: { value: "2099-01-01" },
    });
    const evidence = within(dialog).getByLabelText(new RegExp(`^${t("dispensations.field.evidence")}`));
    await waitFor(() => expect(evidence.querySelectorAll("option")).toHaveLength(2));
    expect(evidence.textContent).toContain(t("dispensations.verification.unverified"));
    fireEvent.change(evidence, { target: { value: INHERITED.evidenceId } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("dispensations.record.submit") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("dispensations.problem.dispensation__approved_on_future"));
    expect(alert.textContent).not.toContain("English");
  });

  it("deciding is a labelled business approval; the delegated-decision 422 and the recorder 403 are translated", async () => {
    let answer = problemBody(422, "urn:mth:problem:validation", "dispensation.on_behalf_not_supported", "English", [
      { pointer: "/onBehalfOfUserId", code: "dispensation.on_behalf_not_supported", message: "English" },
    ]);
    const { requests } = render(locale, "lead", [
      route("POST", new RegExp(`/gate-dispensations/${PENDING.id}/decision$`), () => answer),
    ]);
    const row = await rowWith("Synthetic pilot waiver");
    fireEvent.click(within(row).getByRole("button", { name: new RegExp(t("dispensations.decide.action")) }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-state='business-approval']")).toBeTruthy();
    expect(dialog.textContent?.toLowerCase()).not.toMatch(/on behalf/);
    // The result is required.
    fireEvent.click(within(dialog).getByRole("button", { name: t("dispensations.decide.confirm") }));
    await waitFor(() => expect(within(dialog).getAllByRole("radio")[0]!.getAttribute("aria-invalid")).toBe("true"));
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
    fireEvent.click(within(dialog).getByLabelText(t("dispensations.decide.accepted")));
    fireEvent.click(within(dialog).getByRole("button", { name: t("dispensations.decide.confirm") }));
    let alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("dispensations.problem.dispensation__on_behalf_not_supported"));
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({ result: "accepted" });
    expect(post.headers["if-match"]).toBe(`"${PENDING.version}"`);
    answer = problemBody(403, "urn:mth:problem:forbidden", "dispensation.decider_is_recorder", "English");
    fireEvent.click(within(dialog).getByRole("button", { name: t("dispensations.decide.confirm") }));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toContain(
        t("dispensations.problem.dispensation__decider_is_recorder"),
      ),
    );
    alert = within(dialog).getByRole("alert");
    expect(alert.textContent).not.toContain("English");
  });

  it("revoking an accepted dispensation needs a reason and is a business approval", async () => {
    const { requests } = render(locale, "lead", [
      route("POST", new RegExp(`/gate-dispensations/${ACCEPTED.id}/revoke$`), () => ({
        status: 200,
        body: { ...ACCEPTED, status: "revoked" },
      })),
    ]);
    const button = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>("[data-action='revoke']");
      expect(b).toBeTruthy();
      return b!;
    });
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-state='business-approval']")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t("portfolio.transition.text.reason"))), {
      target: { value: "Synthetic: G2 approved meanwhile" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("dispensations.revoke.action") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({ reason: "Synthetic: G2 approved meanwhile" });
    expect(post.headers["if-match"]).toBe(`"${ACCEPTED.version}"`);
  });

  it("the read-only auditor sees the register with no enabled write control", async () => {
    const { requests } = render(locale, "auditor");
    await rowWith("Synthetic pilot waiver");
    expect(document.querySelector("[data-state='read-only']")).toBeTruthy();
    expect(document.querySelectorAll("[data-action]")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: new RegExp(t("dispensations.record.action")) })).toBeNull();
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  });
});
