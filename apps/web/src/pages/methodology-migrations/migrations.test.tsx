// Methodology migrations and configuration pins (T-DG5-FE-B; REQ-S06-008, REQ-S06-010; ADR-0040 §1-§4, §8) with STUBBED
// responses, in English (LTR) and Arabic (RTL). SYNTHETIC data. Approving a migration is a business approval inside the
// product (labelled so), never an engineering delivery gate.
//  - The plan lists the new required field and a required G2 re-approval; history stays unchanged (labelled).
//  - Preview sends the admin's inputs (blank = null); submit, decide and execute send If-Match.
//  - 403 methodology_migration.self_approval and 409 methodology_migration.pin_moved are shown translated.
//  - Planning posts the kind, the newer published target and the reason; publishing never moves a pin (no target
//    offered when no newer version exists).
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { LOCALES } from "@mth/shared";
import { catalogues, createI18n } from "../../i18n/index.ts";
import {
  ORG_ID,
  TR_ID,
  USER_ID,
  makeMe,
  makeTransformation,
  mockApi,
  problem,
  renderApp,
  route,
} from "../../test/fixtures.tsx";
import { itemsByKind, previewInputs, type MethodologyMigration } from "./api.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const en = catalogues.en.studio;
const grants = (permissions: Permission[]) => [
  { scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: true, permissions },
];
const ADM: Permission[] = [
  "organization.read",
  "transformation.read",
  "methodology.read",
  "methodology_migration.plan",
  "methodology_migration.execute",
];
const SP: Permission[] = [
  "organization.read",
  "transformation.read",
  "methodology.read",
  "methodology_migration.approve",
];
const meRoute = (permissions: Permission[], locale: "en" | "ar" = "en") =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe(grants(permissions), { preferredLocale: locale }),
  }));

const MIG = "01920000-0000-7000-d000-000000000001";
const V1 = "01920000-0000-7000-b000-000000000001";
const V2 = "01920000-0000-7000-b000-000000000002";
const page = <T,>(items: T[]) => ({ status: 200, body: { items, nextCursor: null } });

function migration(over: Partial<MethodologyMigration> = {}): MethodologyMigration {
  return {
    id: MIG,
    transformationId: TR_ID,
    configKind: "methodology",
    fromVersionId: V1,
    toVersionId: V2,
    status: "draft",
    reason: "Synthetic: adopt the revised G3 wording",
    planRevision: 1,
    planSha256: null,
    planReady: false,
    items: [
      {
        planRevision: 1,
        ordinal: 1,
        itemKind: "new_required_field",
        elementType: "form_field",
        stableKey: "t13.synthetic_owner_note",
        recordType: "T13",
        recordId: null,
        gateCode: null,
        resolution: "needs_input",
        detail: {},
      },
      {
        planRevision: 1,
        ordinal: 2,
        itemKind: "reapproval",
        elementType: "gate",
        stableKey: "G2",
        recordType: null,
        recordId: null,
        gateCode: "G2",
        resolution: "automatic",
        detail: {},
      },
      {
        planRevision: 1,
        ordinal: 3,
        itemKind: "unchanged_history",
        elementType: null,
        stableKey: null,
        recordType: "gate_decision",
        recordId: null,
        gateCode: null,
        resolution: "acknowledged",
        detail: {},
      },
    ],
    requestedBy: USER_ID,
    submittedBy: null,
    submittedAt: null,
    approvalId: null,
    decidedBy: null,
    decidedAt: null,
    executedBy: null,
    executedAt: null,
    withdrawnAt: null,
    version: 3,
    createdAt: "2026-10-15T08:00:00Z",
    updatedAt: "2026-10-15T08:00:00Z",
    ...over,
  };
}
const versionRoute = route("GET", /\/admin\/methodology-versions\/[0-9a-f-]+$/, (req) => ({
  status: 200,
  body: {
    id: req.url.endsWith(V1) ? V1 : V2,
    versionNo: req.url.endsWith(V1) ? 1 : 2,
    titleEn: "Synthetic methodology",
    titleAr: "منهجية اصطناعية",
  },
}));

describe("pure helpers", () => {
  it("groups plan items in the ADR-0040 order and sends null for a blank input", () => {
    expect(itemsByKind(migration().items).map((g) => g.kind)).toEqual([
      "new_required_field",
      "reapproval",
      "unchanged_history",
    ]);
    expect(previewInputs(migration().items, {})).toEqual([{ stableKey: "t13.synthetic_owner_note", value: null }]);
    expect(previewInputs(migration().items, { "t13.synthetic_owner_note": "Synthetic value" })).toEqual([
      { stableKey: "t13.synthetic_owner_note", value: "Synthetic value" },
    ]);
  });
});

describe("Migration page", () => {
  for (const locale of LOCALES) {
    it(`${locale}: lists the new required field and the required G2 re-approval; history stays unchanged`, async () => {
      const cat = catalogues[locale].studio;
      mockApi(
        meRoute(ADM, locale),
        versionRoute,
        route("GET", new RegExp(`/methodology-migrations/${MIG}$`), () => ({ status: 200, body: migration() })),
      );
      renderApp(`/transformations/${TR_ID}/methodology-migrations/${MIG}`, { i18n: createI18n(locale) });
      expect(
        await screen.findByRole("heading", { level: 3, name: `${cat.migration.itemKind.new_required_field} (1)` }),
      ).toBeTruthy();
      expect(screen.getByRole("heading", { level: 3, name: `${cat.migration.itemKind.reapproval} (1)` })).toBeTruthy();
      expect(
        screen.getByRole("heading", { level: 3, name: `${cat.migration.itemKind.unchanged_history} (1)` }),
      ).toBeTruthy();
      expect(document.querySelector("[data-item-kind='reapproval']")!.textContent).toContain("G2");
      expect(screen.getByText(cat.migration.statusName.draft)).toBeTruthy();
      expect(screen.getAllByRole("note").some((n) => n.dataset["state"] === "business-approval")).toBe(true);
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    });
  }

  it("preview sends the inputs with If-Match; submit sends If-Match", async () => {
    const { requests } = mockApi(
      meRoute(ADM),
      versionRoute,
      route("GET", new RegExp(`/methodology-migrations/${MIG}$`), () => ({ status: 200, body: migration() })),
      route("POST", /\/preview$/, () => ({ status: 200, body: migration({ version: 4, planReady: true }) })),
      route("POST", /\/submit$/, () => ({ status: 200, body: migration({ version: 5, status: "submitted" }) })),
    );
    renderApp(`/transformations/${TR_ID}/methodology-migrations/${MIG}`, { i18n: createI18n("en") });
    fireEvent.change(await screen.findByLabelText(/t13\.synthetic_owner_note/), {
      target: { value: "Synthetic value" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.migration.preview }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/preview"))).toBe(true));
    const preview = requests.find((r) => r.url.endsWith("/preview"))!;
    expect(preview.headers["if-match"]).toBe('"3"');
    expect(preview.body).toEqual({ inputs: [{ stableKey: "t13.synthetic_owner_note", value: "Synthetic value" }] });
    fireEvent.click(screen.getByRole("button", { name: en.migration.submit }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/submit"))).toBe(true));
  });

  it("the requester deciding gets 403 methodology_migration.self_approval, translated, in the dialog", async () => {
    mockApi(
      meRoute(SP),
      versionRoute,
      route("GET", new RegExp(`/methodology-migrations/${MIG}$`), () => ({
        status: 200,
        body: migration({ status: "submitted" }),
      })),
      route("POST", /\/decision$/, () => problem(403, "methodology_migration.self_approval")),
    );
    renderApp(`/transformations/${TR_ID}/methodology-migrations/${MIG}`, { i18n: createI18n("en") });
    fireEvent.click(await screen.findByRole("button", { name: en.migration.decide }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(en.review.outcome)), { target: { value: "approve" } });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(en.migration.rationale)), {
      target: { value: "Synthetic rationale" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: en.review.record }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      catalogues.en.problems.methodology_migration__self_approval,
    );
  });

  it("execute on a moved pin shows 409 methodology_migration.pin_moved translated", async () => {
    const { requests } = mockApi(
      meRoute(ADM),
      versionRoute,
      route("GET", new RegExp(`/methodology-migrations/${MIG}$`), () => ({
        status: 200,
        body: migration({ status: "approved", planReady: true }),
      })),
      route("POST", /\/execute$/, () => problem(409, "methodology_migration.pin_moved")),
    );
    renderApp(`/transformations/${TR_ID}/methodology-migrations/${MIG}`, { i18n: createI18n("en") });
    fireEvent.click(await screen.findByRole("button", { name: en.migration.execute }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      catalogues.en.problems.methodology_migration__pin_moved,
    );
    expect(requests.find((r) => r.url.endsWith("/execute"))!.headers["if-match"]).toBe('"3"');
  });
});

describe("Migrations of a transformation and its pins", () => {
  it("plans a migration to a newer published version and lists the required re-approvals", async () => {
    const { requests, fetchMock } = mockApi(
      meRoute(ADM),
      route("GET", new RegExp(`/transformations/${TR_ID}$`), () => ({ status: 200, body: makeTransformation() })),
      route("GET", /\/methodology-migrations(\?|$)/, () => page([])),
      route("GET", /\/gate-reapprovals/, () =>
        page([
          {
            id: "01920000-0000-7000-e000-000000000001",
            migrationId: MIG,
            gateInstanceId: "01920000-0000-7000-e000-000000000002",
            gateCode: "G2",
            approvedDecisionId: "01920000-0000-7000-e000-000000000003",
            status: "required",
            satisfiedDecisionId: null,
            workItemId: null,
            resolvedAt: null,
            version: 1,
            createdAt: "2026-10-15T08:00:00Z",
          },
        ]),
      ),
      route("GET", /\/config-pins$/, () => ({
        status: 200,
        body: {
          items: [
            {
              kind: "methodology",
              versionId: V1,
              key: "playbook",
              versionNo: 1,
              pinned: true,
              lastMigrationId: null,
              pinnedAt: "2026-10-01T08:00:00Z",
              version: 1,
            },
          ],
        },
      })),
      route("GET", /\/admin\/methodology-versions\?/, () =>
        page([
          { id: V1, configKind: "methodology", key: "playbook", versionNo: 1, titleEn: "v1", titleAr: "الإصدار 1" },
          {
            id: V2,
            configKind: "methodology",
            key: "playbook",
            versionNo: 2,
            titleEn: "Synthetic v2",
            titleAr: "الإصدار 2",
          },
        ]),
      ),
      route("POST", /\/methodology-migrations$/, () => ({ status: 201, body: migration() })),
      versionRoute,
      route("GET", new RegExp(`/methodology-migrations/${MIG}$`), () => ({ status: 200, body: migration() })),
    );
    const { router } = renderApp(`/transformations/${TR_ID}/methodology-migrations`, { i18n: createI18n("en") });
    expect(await screen.findByText(en.reapproval.status.required)).toBeTruthy();
    expect(screen.getByText(en.migration.empty)).toBeTruthy();
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("status=published"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: en.migration.plan }));
    const dialog = await screen.findByRole("dialog");
    const target = within(dialog).getByLabelText(new RegExp(en.migration.target)) as HTMLSelectElement;
    // Only the newer published version is offered (v1 is the pinned one).
    await waitFor(() => expect([...target.options].map((o) => o.value)).toEqual(["", V2]));
    fireEvent.change(target, { target: { value: V2 } });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(en.migration.reason)), {
      target: { value: "Synthetic: adopt v2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: en.migration.planSubmit }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/transformations/${TR_ID}/methodology-migrations/${MIG}`),
    );
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({
      configKind: "methodology",
      toVersionId: V2,
      reason: "Synthetic: adopt v2",
    });
  });

  it("the pins page shows the pinned version and an empty history", async () => {
    mockApi(
      meRoute(ADM),
      route("GET", new RegExp(`/transformations/${TR_ID}$`), () => ({ status: 200, body: makeTransformation() })),
      route("GET", /\/config-pins$/, () => ({
        status: 200,
        body: {
          items: [
            {
              kind: "scoring_defaults",
              versionId: V1,
              key: "default",
              versionNo: 1,
              pinned: false,
              lastMigrationId: null,
              pinnedAt: null,
              version: null,
            },
          ],
        },
      })),
      route("GET", /\/config-pins\/history/, () => page([])),
    );
    renderApp(`/transformations/${TR_ID}/config-pins`, { i18n: createI18n("en") });
    expect(await screen.findByText(en.pins.notPinned)).toBeTruthy();
    expect(await screen.findByText(en.pins.historyEmpty)).toBeTruthy();
  });
});
