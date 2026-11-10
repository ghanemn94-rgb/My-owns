// T-DG6-BE-Z6 (D-213; REQ-S12-019, REQ-S20-022): when acknowledge or resolve on the exception page gets a real 409
// (another administrator changed the exception after this page loaded it; a system recurrence alone is no longer a
// conflict, apps/api operations/exceptions.ts `rebaseOverSystemOccurrences`), the page is not silent: it shows the
// one form-level conflict alert in the page language ("someone else changed this record; nothing was saved; the
// latest version has been loaded") and the CURRENT state of the exception, reloaded from the API. English LTR and
// Arabic RTL, against a scripted API (SYNTHETIC data only). Acknowledging approves nothing (not a business approval).
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { catalogues, createI18n } from "../../../i18n/index.ts";
import { ORG_ID, USER_ID, makeMe, mockApi, problem, renderApp, route } from "../../../test/fixtures.tsx";

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
const PERMISSIONS: Permission[] = ["organization.read", "operations.read", "operations.acknowledge"];
const meRoute = (locale: "en" | "ar") =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe([{ scope: { type: "organization", id: ORG_ID }, inheritsDownward: false, permissions: PERMISSIONS }], {
      preferredLocale: locale,
    }),
  }));

const EXC_ID = "01920000-0000-7000-9000-00000000e001";
const OTHER_ADMIN = "01920000-0000-7000-9000-00000000e0aa";
const event = (recordVersion: number, eventKind: string, status: string, actorUserId: string | null) => ({
  recordVersion,
  eventKind,
  status,
  occurrenceCount: Math.min(recordVersion, 3),
  errorCode: "operations.heartbeat_missed",
  actorUserId,
  note: null,
  occurredAt: `2026-11-05T10:0${recordVersion}:00Z`,
});
const detail = (overrides: Record<string, unknown> = {}) => ({
  id: EXC_ID,
  organizationId: null,
  sourceKind: "worker",
  sourceCode: "worker",
  failureClass: "heartbeat_missed",
  dedupKey: "worker:worker:heartbeat_missed",
  status: "open",
  occurrenceCount: 1,
  firstOccurredAt: "2026-11-05T10:01:00Z",
  lastOccurredAt: "2026-11-05T10:01:00Z",
  lastErrorCode: "operations.heartbeat_missed",
  lastErrorMessage: "No worker heartbeat for 300 seconds.",
  serviceIdentityId: null,
  acknowledgedAt: null,
  acknowledgedBy: null,
  acknowledgeNote: null,
  resolvedAt: null,
  resolvedBy: null,
  resolution: null,
  resolutionNote: null,
  linkedKpiCount: 0,
  version: 1,
  linkedKpis: [],
  hiddenKpiCount: 0,
  events: [event(1, "opened", "open", null)],
  ...overrides,
});
/** What another administrator's acknowledgement (after this page loaded) left: acknowledged at version 3. */
const acknowledgedByOther = detail({
  status: "acknowledged",
  occurrenceCount: 2,
  lastOccurredAt: "2026-11-05T10:02:00Z",
  acknowledgedAt: "2026-11-05T10:03:00Z",
  acknowledgedBy: OTHER_ADMIN,
  acknowledgeNote: "Synthetic: the other administrator",
  version: 3,
  events: [
    event(1, "opened", "open", null),
    event(2, "recurred", "open", null),
    event(3, "acknowledged", "acknowledged", OTHER_ADMIN),
  ],
});
/** What a resolution by another administrator left: resolved at version 4. */
const resolvedByOther = detail({
  ...acknowledgedByOther,
  status: "resolved",
  resolvedAt: "2026-11-05T10:04:00Z",
  resolvedBy: OTHER_ADMIN,
  resolution: "manual",
  resolutionNote: "Synthetic: resolved elsewhere",
  version: 4,
});

/** The scripted API: GET answers `before` until the action is POSTed, then `after`; the action answers 409. */
function conflictApi(locale: "en" | "ar", verb: "acknowledge" | "resolve", before: object, after: object) {
  let current = before;
  return mockApi(
    meRoute(locale),
    route("GET", /\/api\/v1\/admin\/operations\/exceptions\/[^/?]+$/, () => ({ status: 200, body: current })),
    route("POST", new RegExp(`/${verb}$`), () => {
      current = after;
      return problem(409, "version_conflict", {
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
        currentVersion: (after as { version: number }).version,
      });
    }),
  );
}

async function submit(locale: "en" | "ar", verb: "acknowledge" | "resolve", note: string | null) {
  const label = tx(locale, `adminP6.operations.${verb}`);
  fireEvent.click(await screen.findByRole("button", { name: label }));
  if (note !== null)
    fireEvent.change(
      await screen.findByLabelText(
        tx(locale, `adminP6.operations.${verb === "acknowledge" ? "acknowledgeNote" : "resolveNote"}`),
        {
          exact: false,
        },
      ),
      { target: { value: note } },
    );
  const buttons = await screen.findAllByRole("button", { name: label });
  fireEvent.click(buttons[buttons.length - 1]!);
}

const facts = () => document.querySelector(`[data-exception='${EXC_ID}']`)!;

describe("the exception page on a 409 (T-DG6-BE-Z6)", () => {
  it.each(LOCALES)(
    "%s: acknowledge refused 409 shows the localized conflict alert and the current (acknowledged) state",
    async (locale) => {
      const { requests } = conflictApi(locale, "acknowledge", detail(), acknowledgedByOther);
      renderApp(`/admin/operations/exceptions/${EXC_ID}`, { i18n: createI18n(locale) });
      await waitFor(() => expect(facts().getAttribute("data-status")).toBe("open"));
      await submit(locale, "acknowledge", null);
      const alert = await screen.findByRole("alert");
      expect(alert.dataset["state"]).toBe("conflict");
      expect(alert.dataset["problem"]).toBe("version_conflict");
      expect(alert.textContent).toContain(tx(locale, "problems.version_conflict"));
      expect(alert.textContent).toContain(tx(locale, "myWork.ui.conflictReloaded"));
      // The current state, reloaded from the API: acknowledged by the other administrator, no Acknowledge action.
      await waitFor(() => expect(facts().getAttribute("data-status")).toBe("acknowledged"));
      expect(within(facts() as HTMLElement).getByText(/Synthetic: the other administrator/)).toBeTruthy();
      expect(document.querySelector("[data-action='acknowledge']")).toBeNull();
      expect(document.querySelector("[data-action='resolve']")).not.toBeNull();
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
      // The action was sent once, with the version this page loaded; the page reloaded the exception after the 409.
      const posts = requests.filter((r) => r.method === "POST");
      expect(posts).toHaveLength(1);
      expect(posts[0]!.headers["if-match"]).toBe('"1"');
      expect(
        requests.filter((r) => r.method === "GET" && r.url.endsWith(`/exceptions/${EXC_ID}`)).length,
      ).toBeGreaterThan(1);
      expect(USER_ID).not.toBe(OTHER_ADMIN);
    },
  );

  it.each(LOCALES)(
    "%s: resolve refused 409 shows the localized conflict alert and the current (resolved, final) state",
    async (locale) => {
      conflictApi(locale, "resolve", acknowledgedByOther, resolvedByOther);
      renderApp(`/admin/operations/exceptions/${EXC_ID}`, { i18n: createI18n(locale) });
      await waitFor(() => expect(facts().getAttribute("data-status")).toBe("acknowledged"));
      await submit(locale, "resolve", "Synthetic: my resolution");
      const alert = await screen.findByRole("alert");
      expect(alert.dataset["state"]).toBe("conflict");
      expect(alert.textContent).toContain(tx(locale, "problems.version_conflict"));
      expect(alert.textContent).toContain(tx(locale, "myWork.ui.conflictReloaded"));
      await waitFor(() => expect(facts().getAttribute("data-status")).toBe("resolved"));
      expect(screen.getByText(tx(locale, "adminP6.operations.resolvedFinal"))).toBeTruthy();
      expect(document.querySelector("[data-action='acknowledge'], [data-action='resolve']")).toBeNull();
    },
  );
});
