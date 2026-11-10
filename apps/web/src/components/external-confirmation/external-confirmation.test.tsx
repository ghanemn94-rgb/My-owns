// T-DG6-FE-C (ADR-0055 §6; REQ-S01-005 "Deliverables flagged as external changes carry a separate confirmation state
// that only reviewed evidence or a confirmed connector result can set; task completion alone leaves it Unconfirmed"):
// the panel on the Initiative Card's deliverables, beside the DG3 acceptance, against a scripted API (SYNTHETIC data).
//  - an accepted deliverable (DG3) whose flag is unconfirmed shows both: the acceptance and "Unconfirmed", never green;
//  - "Confirmed by reviewed evidence" and "Confirmed by connector result" (with source system and reference);
//  - flagging sends If-Match "0"; confirming sends the chosen verified evidence with the flag's If-Match;
//  - a refusal (filename-only evidence) is the form's one alert; AUD sees the state and no control.
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n } from "../../i18n/index.ts";
import {
  BUSINESS_UNIT,
  TR_ID,
  USER_ID,
  makeMe,
  makeTransformation,
  mockApi,
  renderApp,
  route,
  type Handler,
} from "../../test/fixtures.tsx";
import { AUDITOR_GRANTS, METHODOLOGY, id, leadGrants } from "../../test/p2fixtures.ts";
import { esc, initiative, page, TR } from "../../pages/portfolio/p3fixtures.ts";
import type { ExternalChange } from "./ExternalConfirmationPanel.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const T0 = "2026-10-01T09:00:00Z";
const INI = initiative({ code: "INI-07", name: "Synthetic network initiative", status: "selected" });
const D_ID = id();
const EVIDENCE_ID = id();

const deliverable = {
  id: D_ID,
  organizationId: "o",
  transformationId: TR_ID,
  initiativeId: INI.id,
  ordinal: 1,
  title: "Synthetic network upgrade",
  description: null,
  ownerUserId: null,
  dueDate: null,
  acceptanceStatus: "accepted",
  submittedBy: null,
  submittedAt: null,
  decidedBy: null,
  decidedAt: null,
  acceptanceNote: null,
  status: "active",
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
  version: 2,
  createdAt: T0,
  createdBy: USER_ID,
  updatedAt: T0,
  updatedBy: USER_ID,
};

function flag(over: Partial<ExternalChange> = {}): ExternalChange {
  return {
    id: id(),
    isExternalChange: true,
    changeType: "network_upgrade",
    description: null,
    confirmationStatus: "unconfirmed",
    confirmationSource: null,
    evidenceId: null,
    outboundWriteId: null,
    connectorId: null,
    sourceSystemId: null,
    sourceReference: null,
    sourceConfirmedAt: null,
    serviceIdentityId: null,
    confirmedAt: null,
    confirmedBy: null,
    confirmationNote: null,
    version: 1,
    ...over,
  };
}

function renderCard(
  locale: "en" | "ar",
  perms: Permission[] | "auditor",
  ext: ExternalChange | null,
  extra: Handler[] = [],
) {
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(perms === "auditor" ? AUDITOR_GRANTS : leadGrants(perms), { preferredLocale: locale }),
    })),
    ...extra,
    route("GET", new RegExp(`/api/v1/deliverables/${D_ID}/confirmation$`), () => ({
      status: 200,
      body: { deliverableId: D_ID, transformationId: TR_ID, externalChange: ext },
    })),
    route("GET", /\/evidence-register/, () =>
      page([
        {
          evidenceId: EVIDENCE_ID,
          title: "Synthetic signed site report",
          kind: "file",
          evidenceType: "document",
          reviewStatus: "verified",
          status: "active",
        },
      ]),
    ),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({ status: 200, body: makeTransformation() })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
    route("GET", new RegExp(`/api/v1/initiatives/${INI.id}$`), () => ({ status: 200, body: INI })),
    route("GET", new RegExp(`/api/v1/initiatives/${INI.id}/deliverables`), () => ({
      status: 200,
      body: { items: [deliverable], countWarning: null },
    })),
    (req) => (req.method === "GET" && req.url.startsWith("/api/v1/") ? page([]) : undefined),
  );
  renderApp(`/transformations/${TR_ID}/initiatives/${INI.id}`, { i18n: createI18n(locale) });
  return api;
}

const panel = async () => {
  await waitFor(() => expect(document.querySelector(`[data-external-confirmation="${D_ID}"]`)).not.toBeNull());
  await waitFor(() => expect(document.querySelector("[data-external-change]")).not.toBeNull());
  return document.querySelector(`[data-external-confirmation="${D_ID}"]`) as HTMLElement;
};

describe.each(["en", "ar"] as const)("deliverable external-change confirmation (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("keeps an accepted deliverable Unconfirmed beside its DG3 acceptance, never green", async () => {
    renderCard(locale, ["initiative.edit"], flag());
    const p = await panel();
    const li = p.closest("li")!;
    expect(li.textContent).toContain(t("portfolio.deliverable.acceptance.accepted"));
    const chip = p.querySelector('[data-external-change="unconfirmed"]')!;
    expect(chip.textContent).toContain(t("externalChange.state.unconfirmed"));
    expect(chip.className).not.toContain("on-track");
  });

  it("shows the source of a confirmation: reviewed evidence, or the connector's source system and reference", async () => {
    renderCard(
      locale,
      "auditor",
      flag({
        confirmationStatus: "confirmed",
        confirmationSource: "connector_result",
        sourceSystemId: "SYN-SRC-1",
        sourceReference: "TEST-abc123",
        sourceConfirmedAt: T0,
        confirmedAt: T0,
      }),
    );
    const p = await panel();
    expect(p.querySelector('[data-external-change="connector_result"]')?.textContent).toContain(
      t("externalChange.state.connector_result"),
    );
    expect(p.querySelector('[data-provenance="connector_result"]')?.textContent).toContain("TEST-abc123");
    expect(within(p).queryByRole("button")).toBeNull();
    cleanup();
    renderCard(
      locale,
      "auditor",
      flag({
        confirmationStatus: "confirmed",
        confirmationSource: "reviewed_evidence",
        evidenceId: EVIDENCE_ID,
        confirmedAt: T0,
      }),
    );
    const q = await panel();
    expect(q.querySelector('[data-external-change="reviewed_evidence"]')?.textContent).toContain(
      t("externalChange.state.reviewed_evidence"),
    );
  });

  it("flags with If-Match 0 when the deliverable was never flagged", async () => {
    const api = renderCard(locale, ["initiative.edit", "external_change.flag"], null, [
      route("PUT", new RegExp(`/api/v1/deliverables/${D_ID}/external-change$`), () => ({
        status: 200,
        body: { deliverableId: D_ID, transformationId: TR_ID, externalChange: flag() },
      })),
    ]);
    const p = await panel();
    expect(p.querySelector('[data-external-change="not_flagged"]')).not.toBeNull();
    fireEvent.click(within(p).getByRole("button", { name: new RegExp(t("externalChange.flag")) }));
    fireEvent.click(await within(p).findByRole("button", { name: t("externalChange.save") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "PUT")).toBe(true));
    const put = api.requests.find((r) => r.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"0"');
    expect(put.body).toEqual({ isExternalChange: true, changeType: "customer_system", description: null });
  });

  it("confirms with verified evidence and shows a refusal as the form's one alert", async () => {
    const api = renderCard(locale, ["initiative.edit", "external_change.confirm"], flag({ version: 3 }), [
      route("POST", new RegExp(`/api/v1/deliverables/${D_ID}/confirmation$`), () => ({
        status: 422,
        body: {
          type: "urn:mth:problem:business-rule",
          title: "x",
          status: 422,
          code: "external_change.evidence_not_verified",
          requestId: "r",
        },
      })),
    ]);
    const p = await panel();
    fireEvent.click(within(p).getByRole("button", { name: new RegExp(t("externalChange.confirm")) }));
    const select = await within(p).findByLabelText(new RegExp(t("externalChange.field.evidence")));
    await waitFor(() => expect(within(select).getByText("Synthetic signed site report")).toBeTruthy());
    fireEvent.change(select, { target: { value: EVIDENCE_ID } });
    fireEvent.click(within(p).getByRole("button", { name: t("externalChange.confirmSubmit") }));
    const alert = await within(p).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.external_change__evidence_not_verified"));
    expect(within(p).getAllByRole("alert")).toHaveLength(1);
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"3"');
    expect(post.body).toEqual({ evidenceId: EVIDENCE_ID, note: null });
  });
});
