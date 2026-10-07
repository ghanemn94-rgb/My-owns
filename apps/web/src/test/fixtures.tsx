// Test helpers: SYNTHETIC fixtures only (no real people or Mobily data) and a render helper with the real providers
// and routes. The network is replaced by a scripted fetch that records requests.
import { render } from "@testing-library/react";
import type { i18n as I18n } from "i18next";
import { StrictMode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import type { Permission } from "@mth/shared";
import { setCsrfToken } from "../api/client.ts";
import type { Me, Transformation } from "../api/types.ts";
import { AppProviders, createQueryClient } from "../app/App.tsx";
import { routes } from "../app/router.tsx";
import { createI18n } from "../i18n/index.ts";

export const ORG_ID = "01920000-0000-7000-9000-000000000001";
export const BU_ID = "01920000-0000-7000-9000-000000000101";
export const USER_ID = "01920000-0000-7000-9000-000000000201";
export const TR_ID = "01920000-0000-7000-9000-000000000301";

export function makeMe(
  grants: {
    scope: { type: "organization" | "business_unit" | "transformation"; id: string };
    inheritsDownward: boolean;
    permissions: Permission[];
  }[],
  overrides: Partial<Me["user"]> = {},
): Me {
  return {
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      displayName: "Synthetic Test User",
      email: "synthetic.user@example.invalid",
      preferredLocale: "ar",
      timezone: null,
      status: "active",
      identities: [],
      version: 3,
      createdAt: "2026-09-01T08:00:00Z",
      updatedAt: "2026-09-01T08:00:00Z",
      ...overrides,
    },
    authMode: "dev",
    csrfToken: "c".repeat(43),
    productName: "Mobily Transformation Hub",
    organization: {
      id: ORG_ID,
      code: "SYN-DEV",
      nameEn: "Synthetic Organization",
      nameAr: "جهة اصطناعية",
      defaultTimezone: "Asia/Riyadh",
      defaultCurrency: "SAR",
      defaultLocale: "ar",
      status: "active",
      version: 1,
      createdAt: "2026-09-01T08:00:00Z",
      updatedAt: "2026-09-01T08:00:00Z",
    },
    assignments: [],
    effectivePermissions: grants,
  };
}

export const ADMIN_GRANTS = [
  {
    scope: { type: "organization" as const, id: ORG_ID },
    inheritsDownward: false,
    permissions: [
      "organization.read",
      "organization.manage",
      "business_unit.read",
      "business_unit.manage",
      "role.read",
      "user.read",
      "user.manage",
      "access.read",
      "access.assign",
    ] as Permission[],
  },
];

export const OFFICE_GRANTS = [
  {
    scope: { type: "organization" as const, id: ORG_ID },
    inheritsDownward: true,
    permissions: [
      "organization.read",
      "business_unit.read",
      "role.read",
      "transformation.read",
      "transformation.create",
      "transformation.update",
      "transformation.archive",
      "audit.read",
    ] as Permission[],
  },
];

/** A Workstream Lead: business read access only. */
export const WL_GRANTS = [
  {
    scope: { type: "transformation" as const, id: TR_ID },
    inheritsDownward: false,
    permissions: ["organization.read", "business_unit.read", "role.read", "transformation.read"] as Permission[],
  },
];

export function makeTransformation(overrides: Partial<Transformation> = {}): Transformation {
  return {
    id: TR_ID,
    organizationId: ORG_ID,
    businessUnitId: BU_ID,
    code: "TR-0001",
    name: "Synthetic retail journey",
    description: null,
    mode: "modular",
    entryPhase: "design",
    standaloneDeliverableType: null,
    status: "draft",
    currentPhase: "design",
    sponsorUserId: null,
    leadUserId: null,
    timezone: "Asia/Riyadh",
    currency: "SAR",
    archivedAt: null,
    archiveReason: null,
    version: 1,
    createdAt: "2026-09-30T09:00:00Z",
    createdBy: USER_ID,
    updatedAt: "2026-09-30T09:00:00Z",
    updatedBy: USER_ID,
    ...overrides,
  };
}

export const BUSINESS_UNIT = {
  id: BU_ID,
  organizationId: ORG_ID,
  parentBusinessUnitId: null,
  code: "SYN-OPS",
  nameEn: "Synthetic Operations",
  nameAr: "العمليات (اصطناعي)",
  status: "active" as const,
  version: 1,
  createdAt: "2026-09-01T08:00:00Z",
  updatedAt: "2026-09-01T08:00:00Z",
};

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

export type Handler = (
  req: RecordedRequest,
) => { status: number; body?: unknown; headers?: Record<string, string> } | undefined;

/** Replaces fetch; the first handler returning a response wins, else 404 problem. */
export function mockApi(...handlers: Handler[]) {
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const req: RecordedRequest = {
      method: init?.method ?? "GET",
      url,
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(req);
    for (const h of handlers) {
      const res = h(req);
      if (res) {
        const isProblem = res.status >= 400;
        return new Response(res.status === 204 ? null : JSON.stringify(res.body ?? {}), {
          status: res.status,
          headers: { "Content-Type": isProblem ? "application/problem+json" : "application/json", ...res.headers },
        });
      }
    }
    return new Response(
      JSON.stringify({
        type: "urn:mth:problem:not-found",
        title: "Not found",
        status: 404,
        code: "not_found",
        requestId: "req-test",
      }),
      { status: 404, headers: { "Content-Type": "application/problem+json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

export const route =
  (
    method: string,
    pattern: RegExp,
    respond: (req: RecordedRequest) => { status: number; body?: unknown } | undefined,
  ): Handler =>
  (req) =>
    req.method === method && pattern.test(req.url) ? respond(req) : undefined;

export function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  const type =
    status === 409 && code === "version_conflict"
      ? "urn:mth:problem:version-conflict"
      : status === 403
        ? "urn:mth:problem:forbidden"
        : status === 404
          ? "urn:mth:problem:not-found"
          : "urn:mth:problem:validation";
  return { status, body: { type, title: code, status, code, requestId: "req-test-1", ...extra } };
}

/**
 * `retryDelayMs`: the delay between query retries. Queries that set their own `retry` policy (e.g. `useMeQuery`
 * retries a 5xx twice) otherwise wait TanStack Query's default exponential back-off (1 s + 2 s) in real time; a test
 * of that path can pass 0 so the same retries run immediately (F-DG2-143). Unset keeps the library default.
 * `strict` wraps the app in <StrictMode> as src/main.tsx does in production, so React runs state updaters and render
 * functions twice and an impure updater shows up in the test (F-DG2-430).
 */
export function renderApp(
  path: string,
  options: { i18n?: I18n; retryDelayMs?: number; strict?: boolean | undefined } = {},
) {
  setCsrfToken(null);
  const i18n = options.i18n ?? createI18n("ar");
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: {
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
      ...(options.retryDelayMs !== undefined ? { retryDelay: options.retryDelayMs } : {}),
    },
  });
  const app = (
    <AppProviders i18n={i18n} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
  const utils = render(options.strict ? <StrictMode>{app}</StrictMode> : app);
  return { ...utils, router, i18n, queryClient };
}
