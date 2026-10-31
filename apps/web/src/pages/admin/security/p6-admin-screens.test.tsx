// T-DG6-FE-B (p6-work-split §E/F.12, §J/C.13): the P6 Administration screens of slices E, F, J and C, the sensitivity
// panel, the safe evidence preview and the deep-link landing, in English LTR and Arabic RTL, against a scripted API
// (SYNTHETIC data only). What is asserted, per requirement:
//  - REQ-S16-032: the audit trail is read-only (no write control), a redacted event shows "Redacted", never a reason.
//  - REQ-S13-011: the upload policy saves with If-Match (0 creates) and the organization query; the auditor reads it
//    without a form; a preview is an <img> of the preview route for raster files only, never an iframe/object.
//  - REQ-S10-002: the sensitivity panel marks with a reason and If-Match; a reader without the grant right sees it read
//    only; "Includes restricted records" appears only when the total says so.
//  - REQ-S12-024: a forwarded link answered 403 shows the refusal text and nothing of the target; a malformed token is
//    never sent; an unsafe linkPath is never followed.
//  - REQ-S12-019: the heartbeat `unknown` is never "Running"; a linked KPI without a value is Unknown (never 0) and
//    keeps its Stale label; a resolved exception offers no action; acknowledge sends If-Match.
//  - REQ-S16-006 / REQ-S16-007 / REQ-S12-023: storage never shows a public URL and takes secret references only;
//    identity shows no client secret; enterprise messaging cannot be enabled; the inbox is always on.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { resetSessionStateForTests } from "../../../api/client.ts";
import { AppProviders, createQueryClient } from "../../../app/App.tsx";
import { RequireSession } from "../../../auth/session.tsx";
import { EvidencePreview } from "../../../components/evidence-preview/EvidencePreview.tsx";
import { RestrictedRecordsLabel } from "../../../components/sensitivity/RestrictedRecordsLabel.tsx";
import { SensitivityPanel } from "../../../components/sensitivity/SensitivityPanel.tsx";
import { catalogues, createI18n } from "../../../i18n/index.ts";
import { ORG_ID, TR_ID, USER_ID, makeMe, mockApi, problem, renderApp, route } from "../../../test/fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOCALES = ["en", "ar"] as const;
type Tree = { [k: string]: string | Tree };
const tx = (locale: "en" | "ar", path: string): string => {
  let node: string | Tree = catalogues[locale] as unknown as Tree;
  for (const part of path.split(".")) node = (node as Tree)[part]!;
  return node as string;
};
const orgGrants = (permissions: Permission[]) => [
  { scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: false, permissions },
];
const meRoute = (permissions: Permission[], locale: "en" | "ar" = "en") =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe(orgGrants(permissions), { preferredLocale: locale }),
  }));
const noTransformations = route("GET", /\/api\/v1\/transformations\?/, () => ({
  status: 200,
  body: { items: [], nextCursor: null },
}));

const EVENT_ID = "01920000-0000-7000-9000-00000000a001";
const RECORD_ID = "01920000-0000-7000-9000-00000000b001";
const auditEvent = (overrides: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  seq: "42",
  occurredAt: "2026-10-20T08:00:00Z",
  organizationId: ORG_ID,
  action: "benefit.updated",
  recordType: "benefit",
  recordId: RECORD_ID,
  transformationId: TR_ID,
  actor: { type: "user", userId: USER_ID, displayName: "Synthetic Actor" },
  onBehalfOfUserId: null,
  priorVersion: 2,
  newVersion: 3,
  reason: "Synthetic reason text",
  requestId: "req-1",
  source: "api",
  changes: { title: { from: "A", to: "B" } },
  redacted: false,
  ...overrides,
});

describe("Administration > Audit (REQ-S16-032)", () => {
  it.each(LOCALES)("%s: lists events read-only; a redacted event shows Redacted, never its reason", async (locale) => {
    const { requests } = mockApi(
      meRoute(["organization.read", "audit_event.read"], locale),
      noTransformations,
      route("GET", /\/api\/v1\/audit-events\?/, () => ({
        status: 200,
        body: {
          items: [
            auditEvent(),
            auditEvent({
              id: "01920000-0000-7000-9000-00000000a002",
              seq: "43",
              reason: null,
              changes: null,
              redacted: true,
            }),
          ],
          nextCursor: "next-1",
        },
      })),
    );
    renderApp("/admin/audit", { i18n: createI18n(locale) });
    const table = await screen.findByRole("table", { name: tx(locale, "adminP6.audit.listTitle") });
    expect(within(table).getByText("Synthetic reason text")).toBeTruthy();
    expect(within(table).getByText(tx(locale, "adminP6.audit.redacted"))).toBeTruthy();
    expect(
      within(table).getAllByText(
        tx(locale, "adminP6.audit.versionsValue").replace("{{prior}}", "2").replace("{{next}}", "3"),
      ).length,
    ).toBe(2);
    expect(screen.getByText(tx(locale, "adminP6.audit.appendOnly"))).toBeTruthy();
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    // The organization is always sent; no write request is ever made from this screen.
    expect(requests.find((r) => r.url.includes("/audit-events?"))!.url).toContain(`organizationId=${ORG_ID}`);
    // Cursor paging follows nextCursor.
    fireEvent.click(screen.getByRole("button", { name: tx(locale, "adminP6.common.nextPage") }));
    await waitFor(() => expect(requests.some((r) => r.url.includes("cursor=next-1"))).toBe(true));
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("an invalid filter shows one alert and sends nothing", async () => {
    const { requests } = mockApi(
      meRoute(["organization.read", "audit_event.read"]),
      noTransformations,
      route("GET", /\/api\/v1\/audit-events\?/, () => ({ status: 200, body: { items: [], nextCursor: null } })),
    );
    renderApp("/admin/audit", { i18n: createI18n("en") });
    await screen.findByText(tx("en", "adminP6.audit.empty"));
    const before = requests.filter((r) => r.url.includes("/audit-events?")).length;
    fireEvent.change(screen.getByLabelText(tx("en", "adminP6.audit.recordType")), { target: { value: "Bad Type!" } });
    fireEvent.click(screen.getByRole("button", { name: tx("en", "adminP6.common.apply") }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(requests.filter((r) => r.url.includes("/audit-events?")).length).toBe(before);
  });

  it("the event detail shows the field changes, and Redacted instead of them when redacted", async () => {
    mockApi(
      meRoute(["organization.read", "audit_event.read"]),
      route("GET", /\/api\/v1\/audit-events\/[^?]+$/, () => ({ status: 200, body: auditEvent() })),
    );
    renderApp(`/admin/audit/${EVENT_ID}`, { i18n: createI18n("en") });
    const changes = await screen.findByRole("table", { name: "Changes" });
    expect(within(changes).getByText("title")).toBeTruthy();
    expect(within(changes).getByText("B")).toBeTruthy();
  });
});

const policy = (overrides: Record<string, unknown> = {}) => ({
  organizationId: ORG_ID,
  allowedTypes: ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "png", "jpeg", "gif", "svg"],
  maxBytes: 26214400,
  isDefault: true,
  inlinePreviewTypes: ["png", "jpeg", "gif"],
  reason: null,
  version: 0,
  updatedAt: null,
  ...overrides,
});

describe("Administration > Security > Upload policy (REQ-S13-011)", () => {
  it.each(LOCALES)("%s: the auditor reads the default policy with no form", async (locale) => {
    const { requests } = mockApi(
      meRoute(["organization.read", "security.read", "audit_event.read"], locale),
      route("GET", /\/api\/v1\/admin\/upload-policy\?/, () => ({ status: 200, body: policy() })),
    );
    renderApp("/admin/upload-policy", { i18n: createI18n(locale) });
    expect(await screen.findByText(tx(locale, "adminP6.uploadPolicy.isDefault"))).toBeTruthy();
    expect(screen.getByText(tx(locale, "adminP6.common.readOnly"))).toBeTruthy();
    expect(document.querySelector("form[data-form='upload-policy']")).toBeNull();
    expect(screen.queryByRole("button", { name: tx(locale, "adminP6.common.save") })).toBeNull();
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("a technical admin narrows the policy: If-Match 0 creates it, with the organization query and a reason", async () => {
    const { requests } = mockApi(
      meRoute(["organization.read", "security.read", "upload_policy.configure"]),
      route("GET", /\/api\/v1\/admin\/upload-policy\?/, () => ({ status: 200, body: policy() })),
      route("PUT", /\/api\/v1\/admin\/upload-policy\?/, (req) => ({
        status: 200,
        body: policy({ ...(req.body as object), isDefault: false, version: 1, updatedAt: "2026-10-30T10:00:00Z" }),
      })),
    );
    renderApp("/admin/upload-policy", { i18n: createI18n("en") });
    const form = await screen.findByRole("button", { name: "Save" });
    fireEvent.click(screen.getByLabelText("SVG image (download only)"));
    fireEvent.change(screen.getByLabelText(/Maximum file size/), { target: { value: "10" } });
    // No reason: inline error, nothing sent.
    fireEvent.click(form);
    expect(await screen.findByText(tx("en", "adminP6.common.reasonInvalid"))).toBeTruthy();
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
    fireEvent.change(screen.getByLabelText(/Reason for the change/), { target: { value: "Synthetic narrowing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PUT")).toBe(true));
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.url).toContain(`organizationId=${ORG_ID}`);
    expect(put.headers["if-match"]).toBe('"0"');
    expect(put.body).toEqual({
      allowedTypes: ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "png", "jpeg", "gif"],
      maxBytes: 10 * 1024 * 1024,
      reason: "Synthetic narrowing",
    });
  });

  it("a 409 shows the translated conflict and reloads the policy", async () => {
    let gets = 0;
    const { requests } = mockApi(
      meRoute(["organization.read", "security.read", "upload_policy.configure"]),
      route("GET", /\/api\/v1\/admin\/upload-policy\?/, () => {
        gets += 1;
        return { status: 200, body: policy(gets > 1 ? { version: 2, isDefault: false } : {}) };
      }),
      route("PUT", /\/api\/v1\/admin\/upload-policy\?/, () => problem(409, "version_conflict", { currentVersion: 2 })),
    );
    renderApp("/admin/upload-policy", { i18n: createI18n("en") });
    await screen.findByRole("button", { name: "Save" });
    fireEvent.change(screen.getByLabelText(/Reason for the change/), { target: { value: "Synthetic change" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect(gets).toBeGreaterThan(1));
    expect(requests.filter((r) => r.method === "PUT")).toHaveLength(1);
  });
});

describe("Administration > Security (rate limits)", () => {
  it("shows each class with its per-minute budget, read-only", async () => {
    mockApi(
      meRoute(["organization.read", "security.read"]),
      route("GET", /\/api\/v1\/admin\/security\/rate-limits\?/, () => ({
        status: 200,
        body: {
          classes: [
            {
              name: "upload",
              variable: "RATE_LIMIT_UPLOAD_PER_MINUTE",
              perMinute: 20,
              keyedBy: "user_or_ip",
              operationIds: ["uploadEvidenceContent"],
            },
          ],
        },
      })),
    );
    renderApp("/admin/security", { i18n: createI18n("en") });
    const table = await screen.findByRole("table", { name: "Rate-limit classes" });
    expect(within(table).getByText("Uploads")).toBeTruthy();
    expect(within(table).getByText("20")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upload policy" }).getAttribute("href")).toBe("/admin/upload-policy");
  });
});

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456";

describe("The deep-link landing (REQ-S12-024)", () => {
  it.each(LOCALES)("%s: a 403 shows only the refusal text, nothing of the target", async (locale) => {
    mockApi(
      meRoute(["organization.read"], locale),
      route("GET", /\/api\/v1\/links\//, () => problem(403, "deep_link.forbidden")),
    );
    renderApp(`/l/${TOKEN}`, { i18n: createI18n(locale) });
    const refusal = await screen.findByRole("alert");
    expect(refusal.dataset["state"]).toBe("deep-link-forbidden");
    expect(within(refusal).getByText(tx(locale, "problems.deep_link__forbidden"))).toBeTruthy();
    expect(within(refusal).getByText(tx(locale, "adminP6.deepLink.forbiddenTitle"))).toBeTruthy();
  });

  it("a malformed token is never sent", async () => {
    const { requests } = mockApi(meRoute(["organization.read"]));
    renderApp("/l/short", { i18n: createI18n("en") });
    expect((await screen.findByRole("alert")).dataset["state"]).toBe("deep-link-malformed");
    expect(requests.some((r) => r.url.includes("/api/v1/links/"))).toBe(false);
  });

  it("an authorized link navigates inside the app; an unsafe path is never followed", async () => {
    mockApi(
      meRoute(["organization.read"]),
      route("GET", /\/api\/v1\/links\//, () => ({
        status: 200,
        body: { linkPath: "/admin/security", recordType: null, recordId: null },
      })),
      route("GET", /\/api\/v1\/admin\/security\/rate-limits\?/, () => ({ status: 200, body: { classes: [] } })),
    );
    const { router } = renderApp(`/l/${TOKEN}`, { i18n: createI18n("en") });
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/security"));
    cleanup();
    vi.unstubAllGlobals();
    mockApi(
      meRoute(["organization.read"]),
      route("GET", /\/api\/v1\/links\//, () => ({
        status: 200,
        body: { linkPath: "//evil.example/x", recordType: null, recordId: null },
      })),
    );
    const second = renderApp(`/l/${TOKEN}`, { i18n: createI18n("en") });
    expect((await screen.findByRole("alert")).dataset["state"]).toBe("deep-link-unsafe");
    expect(second.router.state.location.pathname).toBe(`/l/${TOKEN}`);
  });
});

const EXC_ID = "01920000-0000-7000-9000-00000000c001";
const exception = (overrides: Record<string, unknown> = {}) => ({
  id: EXC_ID,
  organizationId: ORG_ID,
  sourceKind: "data_freshness",
  sourceCode: "kpi.freshness_scan",
  failureClass: "data_stale",
  dedupKey: "k",
  status: "open",
  occurrenceCount: 3,
  firstOccurredAt: "2026-10-20T08:00:00Z",
  lastOccurredAt: "2026-10-21T08:00:00Z",
  lastErrorCode: "data.stale",
  lastErrorMessage: "Synthetic stale data",
  serviceIdentityId: null,
  acknowledgedAt: null,
  acknowledgedBy: null,
  acknowledgeNote: null,
  resolvedAt: null,
  resolvedBy: null,
  resolution: null,
  resolutionNote: null,
  linkedKpiCount: 2,
  version: 4,
  ...overrides,
});
const detail = (overrides: Record<string, unknown> = {}) => ({
  ...exception(overrides),
  linkedKpis: [
    {
      kpiDefinitionId: "01920000-0000-7000-9000-00000000d001",
      transformationId: TR_ID,
      name: "Synthetic KPI with value",
      unitKind: "percentage",
      freshness: "stale",
      lastValue: "12.5",
      lastValueAt: "2026-09-01T00:00:00Z",
    },
    {
      kpiDefinitionId: "01920000-0000-7000-9000-00000000d002",
      transformationId: TR_ID,
      name: "Synthetic KPI without value",
      unitKind: "count",
      freshness: "unknown",
      lastValue: null,
      lastValueAt: null,
    },
  ],
  hiddenKpiCount: 1,
  events: [
    {
      recordVersion: 1,
      eventKind: "opened",
      status: "open",
      occurrenceCount: 1,
      errorCode: "data.stale",
      actorUserId: null,
      note: null,
      occurredAt: "2026-10-20T08:00:00Z",
    },
  ],
});

describe("Administration > Operations (REQ-S12-019)", () => {
  it.each(LOCALES)("%s: an unknown heartbeat is Unknown, never Running", async (locale) => {
    mockApi(
      meRoute(["organization.read", "operations.read"], locale),
      route("GET", /\/api\/v1\/admin\/operations\/heartbeat$/, () => ({
        status: 200,
        body: {
          status: "unknown",
          checkedAt: "2026-10-30T10:00:00Z",
          staleAfterSeconds: 90,
          newestBeatAt: null,
          instances: [],
        },
      })),
      route("GET", /\/api\/v1\/admin\/operations\/exceptions\?/, () => ({
        status: 200,
        body: { items: [exception()], nextCursor: null },
      })),
    );
    renderApp("/admin/operations", { i18n: createI18n(locale) });
    const hb = await screen.findByText(tx(locale, "adminP6.operations.heartbeatStatus.unknown"));
    expect(hb.closest("[data-status]")!.getAttribute("data-status")).toBe("unknown");
    expect(hb.closest(".status-chip")!.className).not.toContain("on-track");
    expect(screen.queryByText(tx(locale, "adminP6.operations.heartbeatStatus.alive"))).toBeNull();
    expect(await screen.findByText(tx(locale, "adminP6.operations.failureClassValue.data_stale"))).toBeTruthy();
  });

  it("sends the two default statuses as repeated query parameters", async () => {
    const { requests } = mockApi(
      meRoute(["organization.read", "operations.read"]),
      route("GET", /\/api\/v1\/admin\/operations\/heartbeat$/, () => problem(403, "forbidden")),
      route("GET", /\/api\/v1\/admin\/operations\/exceptions\?/, () => ({
        status: 200,
        body: { items: [], nextCursor: null },
      })),
    );
    renderApp("/admin/operations", { i18n: createI18n("en") });
    await screen.findByText(tx("en", "adminP6.operations.empty"));
    const url = requests.find((r) => r.url.includes("/operations/exceptions?"))!.url;
    expect(url).toContain("status=open&status=acknowledged");
  });

  it("a linked KPI without a value is Unknown (never 0) and keeps its label; acknowledge sends If-Match", async () => {
    const { requests } = mockApi(
      meRoute(["organization.read", "operations.read", "operations.acknowledge"]),
      route("GET", /\/api\/v1\/admin\/operations\/exceptions\/[^/?]+$/, () => ({ status: 200, body: detail() })),
      route("POST", /\/acknowledge$/, () => ({ status: 200, body: exception({ status: "acknowledged", version: 5 }) })),
    );
    renderApp(`/admin/operations/exceptions/${EXC_ID}`, { i18n: createI18n("en") });
    const table = await screen.findByRole("table", { name: "Linked KPIs" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).getByText("12.5")).toBeTruthy();
    expect(within(rows[1]!).getByText("Stale")).toBeTruthy();
    expect(within(rows[2]!).getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(within(rows[2]!).queryByText("0")).toBeNull();
    expect(screen.getByText(/Linked KPIs not shown because you cannot read them: 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    const ack = await screen.findAllByRole("button", { name: "Acknowledge" });
    fireEvent.click(ack[ack.length - 1]!);
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"4"');
    expect(post.body).toEqual({ note: null });
  });

  it("a resolved exception is final: no action is offered", async () => {
    mockApi(
      meRoute(["organization.read", "operations.read", "operations.acknowledge"]),
      route("GET", /\/api\/v1\/admin\/operations\/exceptions\/[^/?]+$/, () => ({
        status: 200,
        body: detail({ status: "resolved", resolution: "recovered", resolvedAt: "2026-10-22T08:00:00Z" }),
      })),
    );
    renderApp(`/admin/operations/exceptions/${EXC_ID}`, { i18n: createI18n("en") });
    expect(await screen.findByText(tx("en", "adminP6.operations.resolvedFinal"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
  });
});

describe("Administration > Identity, Storage, Notifications (REQ-S16-007, REQ-S16-006, REQ-S12-023)", () => {
  it("identity shows whether a client secret is configured, never a secret value", async () => {
    mockApi(
      meRoute(["organization.read", "identity.read"]),
      route("GET", /\/api\/v1\/admin\/identity$/, () => ({
        status: 200,
        body: {
          authMode: "oidc",
          issuer: "https://idp.example.invalid/realms/mth-test",
          clientId: "mth-web",
          clientSecretConfigured: true,
          scopes: ["openid", "email", "profile"],
          expectedAudience: "mth-web",
          pkceMethod: "S256",
          claimMapping: { subject: "sub", email: "email", displayName: "name" },
          samlBrokerDocument: "docs/operations/identity-saml-broker.md",
        },
      })),
    );
    renderApp("/admin/identity", { i18n: createI18n("en") });
    expect(await screen.findByText("Configured (never shown)")).toBeTruthy();
    expect(screen.getByText("https://idp.example.invalid/realms/mth-test")).toBeTruthy();
    // The identity screen itself has no field at all (no secret can be typed or shown in one). The shell's global
    // search box (slice H, REQ-S15-010; T-DG6-FE-D) is on every page, so the check is scoped to the screen, and the
    // document-wide check admits that one search field only (T-DG6-FE-X1).
    const screenRoot = document.querySelector('[data-p6-screen="identity"]')!;
    expect(screenRoot).toBeTruthy();
    expect(screenRoot.querySelector("input, textarea, select, [contenteditable]")).toBeNull();
    const fields = Array.from(document.querySelectorAll("input, textarea, select, [contenteditable]"));
    expect(fields.every((f) => f.getAttribute("data-global-search") === "true")).toBe(true);
  });

  it("storage states no public URL, takes secret references only, and tests before saving", async () => {
    const { requests } = mockApi(
      meRoute(["organization.read", "storage.configure"]),
      route("GET", /\/api\/v1\/admin\/storage$/, () => ({
        status: 200,
        body: {
          driver: "filesystem",
          source: "environment",
          s3: null,
          publicUrls: false,
          reason: null,
          version: 0,
          updatedAt: null,
        },
      })),
      route("POST", /\/api\/v1\/admin\/storage\/test$/, () => ({
        status: 200,
        body: {
          outcome: "passed",
          driver: "s3",
          checks: [
            { name: "write", outcome: "passed" },
            { name: "anonymous_read_refused", outcome: "passed" },
          ],
          errorCode: null,
          durationMs: 12,
          testedAt: "2026-10-30T10:00:00Z",
        },
      })),
    );
    renderApp("/admin/storage", { i18n: createI18n("en") });
    expect(await screen.findByText(tx("en", "adminP6.storage.publicUrlsValue"))).toBeTruthy();
    fireEvent.click(screen.getByLabelText("S3-compatible object store"));
    expect(screen.queryByLabelText(/secret value/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Endpoint URL/), { target: { value: "https://s3.example.invalid" } });
    fireEvent.change(screen.getByLabelText(/Region/), { target: { value: "me-central-1" } });
    fireEvent.change(screen.getByLabelText(/Bucket/), { target: { value: "mth-evidence" } });
    const providers = screen.getAllByLabelText("Secret provider");
    const names = screen.getAllByLabelText("Secret name");
    fireEvent.change(providers[0]!, { target: { value: "env" } });
    fireEvent.change(names[0]!, { target: { value: "S3_ACCESS_KEY" } });
    fireEvent.change(providers[1]!, { target: { value: "env" } });
    fireEvent.change(names[1]!, { target: { value: "S3_SECRET_KEY" } });
    fireEvent.click(screen.getByRole("button", { name: "Test these values" }));
    expect(await screen.findByText(/Anonymous read refused/)).toBeTruthy();
    const test = requests.find((r) => r.method === "POST")!;
    expect(test.body).toEqual({
      candidate: {
        endpoint: "https://s3.example.invalid",
        region: "me-central-1",
        bucket: "mth-evidence",
        keyPrefix: null,
        forcePathStyle: false,
        accessKeyRef: { provider: "env", name: "S3_ACCESS_KEY" },
        secretKeyRef: { provider: "env", name: "S3_SECRET_KEY" },
      },
    });
  });

  it.each(LOCALES)("%s: the inbox is always on; enterprise messaging cannot be enabled", async (locale) => {
    const channel = (kind: string, adapterAvailable: boolean) => ({
      organizationId: ORG_ID,
      channelKind: kind,
      configured: false,
      enabled: false,
      adapterAvailable,
      smtp: null,
      reason: null,
      version: 0,
      updatedAt: null,
    });
    mockApi(
      meRoute(["organization.read", "notification_channel.configure"], locale),
      route("GET", /\/api\/v1\/admin\/notification-channels\?/, () => ({
        status: 200,
        body: { items: [channel("email", true), channel("enterprise_messaging", false)], nextCursor: null },
      })),
      route("GET", /\/api\/v1\/admin\/notification-channels\/enterprise_messaging\?/, () => ({
        status: 200,
        body: channel("enterprise_messaging", false),
      })),
    );
    renderApp("/admin/notification-channels", { i18n: createI18n(locale) });
    expect(await screen.findByText(tx(locale, "adminP6.channels.inAppNote"))).toBeTruthy();
    expect(await screen.findByText(tx(locale, "adminP6.channels.statusUnavailable"))).toBeTruthy();
    cleanup();
    renderApp("/admin/notification-channels/enterprise_messaging", { i18n: createI18n(locale) });
    expect(await screen.findByText(tx(locale, "adminP6.channels.adapterUnavailable"))).toBeTruthy();
    expect(document.querySelector("form[data-form='email-channel']")).toBeNull();
  });

  it("the auditor (operations.read) reads storage read-only: no form, no test, no save", async () => {
    const { requests } = mockApi(
      meRoute(["organization.read", "operations.read", "identity.read", "audit_event.read"]),
      route("GET", /\/api\/v1\/admin\/storage$/, () => ({
        status: 200,
        body: {
          driver: "filesystem",
          source: "environment",
          s3: null,
          publicUrls: false,
          reason: null,
          version: 0,
          updatedAt: null,
        },
      })),
    );
    renderApp("/admin/storage", { i18n: createI18n("en") });
    expect(await screen.findByText(tx("en", "adminP6.storage.publicUrlsValue"))).toBeTruthy();
    expect(screen.getByText(tx("en", "adminP6.common.readOnly"))).toBeTruthy();
    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryByRole("button", { name: "Test these values" })).toBeNull();
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  });
});

/** Renders one component inside the real providers and a signed-in session. */
function renderInSession(element: React.ReactNode, locale: "en" | "ar" = "en") {
  resetSessionStateForTests();
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false } });
  const router = createMemoryRouter([{ path: "*", element: <RequireSession>{element}</RequireSession> }], {
    initialEntries: ["/x"],
  });
  return render(
    <AppProviders i18n={createI18n(locale)} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

const sensitivity = (overrides: Record<string, unknown> = {}) => ({
  transformationId: TR_ID,
  recordType: "benefit",
  recordId: RECORD_ID,
  isSensitive: false,
  reason: null,
  version: 0,
  updatedAt: null,
  updatedBy: null,
  canManage: true,
  ...overrides,
});

describe("The sensitivity panel and the restricted-records label (REQ-S10-002)", () => {
  it("a manager marks the record with a reason and If-Match 0", async () => {
    const { requests } = mockApi(
      meRoute(["organization.read", "sensitive_record.grant", "sensitive_record.read"]),
      route("GET", /\/sensitivity$/, () => ({ status: 200, body: sensitivity() })),
      route("PUT", /\/sensitivity$/, () => ({ status: 200, body: sensitivity({ isSensitive: true, version: 1 }) })),
    );
    renderInSession(<SensitivityPanel tid={TR_ID} recordType="benefit" recordId={RECORD_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark as sensitive" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Synthetic sensitivity reason" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as sensitive" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PUT")).toBe(true));
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.url).toBe(`/api/v1/transformations/${TR_ID}/records/benefit/${RECORD_ID}/sensitivity`);
    expect(put.headers["if-match"]).toBe('"0"');
    expect(put.body).toEqual({ isSensitive: true, reason: "Synthetic sensitivity reason" });
  });

  it.each(LOCALES)("%s: a reader without the grant right sees the status only", async (locale) => {
    const { requests } = mockApi(
      meRoute(["organization.read", "sensitive_record.read"], locale),
      route("GET", /\/sensitivity$/, () => ({
        status: 200,
        body: sensitivity({ isSensitive: true, canManage: false, version: 2, reason: "hidden reason" }),
      })),
    );
    renderInSession(<SensitivityPanel tid={TR_ID} recordType="benefit" recordId={RECORD_ID} />, locale);
    expect(await screen.findByText(tx(locale, "adminP6.sensitivity.sensitive"))).toBeTruthy();
    expect(screen.getByText(tx(locale, "adminP6.sensitivity.cannotManage"))).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/hidden reason/)).toBeNull();
    expect(requests.some((r) => r.url.includes("/sensitive-grants"))).toBe(false);
  });

  it("a record the caller cannot read (404) renders nothing", async () => {
    mockApi(
      meRoute(["organization.read"]),
      route("GET", /\/sensitivity$/, () => problem(404, "not_found")),
    );
    const { container } = renderInSession(
      <div data-testid="host">
        <SensitivityPanel tid={TR_ID} recordType="evidence" recordId={RECORD_ID} />
      </div>,
    );
    await waitFor(() => expect(screen.getByTestId("host")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("[data-sensitivity]")).toBeNull();
  });

  it.each(LOCALES)("%s: the label shows only for includesRestrictedRecords true", async (locale) => {
    mockApi(meRoute(["organization.read"], locale));
    renderInSession(
      <>
        <RestrictedRecordsLabel value={true} />
        <RestrictedRecordsLabel value={false} />
        <RestrictedRecordsLabel value={undefined} />
      </>,
      locale,
    );
    const labels = await screen.findAllByText(tx(locale, "access.includesRestrictedRecords"));
    expect(labels).toHaveLength(1);
    expect(document.querySelectorAll("[data-restricted-records]")).toHaveLength(1);
  });
});

describe("The safe evidence preview (REQ-S13-011)", () => {
  const ev = (fileName: string) => ({
    id: RECORD_ID,
    title: "Synthetic evidence",
    kind: "file",
    fileName,
    currentContentId: "01920000-0000-7000-9000-00000000e001",
  });

  it("a PNG is an <img> of the preview route; never an iframe, object or embed", async () => {
    mockApi(meRoute(["organization.read"]));
    renderInSession(<EvidencePreview tid={TR_ID} evidence={ev("chart.png")} />);
    const img = (await screen.findByRole("img")) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(`/api/v1/transformations/${TR_ID}/evidence/${RECORD_ID}/preview`);
    expect(document.querySelector("iframe, object, embed")).toBeNull();
    // A failed preview (422 evidence.preview_unavailable) falls back to the download offer.
    fireEvent.error(img);
    expect(await screen.findByText(tx("en", "adminP6.preview.failed"))).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it.each(["drawing.svg", "report.pdf", "tool.exe.png.svg"])(
    "%s is download-only (no inline content)",
    async (name) => {
      mockApi(meRoute(["organization.read"]));
      renderInSession(<EvidencePreview tid={TR_ID} evidence={ev(name)} />);
      expect(await screen.findByText(tx("en", "adminP6.preview.noPreview"))).toBeTruthy();
      expect(screen.queryByRole("img")).toBeNull();
      expect(document.querySelector("iframe, object, embed, svg[data-evidence]")).toBeNull();
      const link = screen.getByRole("link", { name: /Download/ });
      expect(link.getAttribute("href")).toBe(`/api/v1/transformations/${TR_ID}/evidence/${RECORD_ID}/content`);
      expect(link.hasAttribute("download")).toBe(true);
    },
  );
});
