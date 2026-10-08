// The inherited-approval annotation on the Gates list and the gate view (ADR-0021 §5; REQ-PB-004; F-DG3-120).
// SYNTHETIC data. A Modular inherited approval is evidence of an approval granted before the product was used:
//  - it is shown NEXT TO the gate's own status, which stays "Not submitted" (draft);
//  - pending, accepted (counting or not), rejected and revoked each read as a translated badge that says it does not
//    approve this gate, in English LTR and Arabic RTL;
//  - it never uses the approved colour (status-chip--on-track) or the approved check icon, and nothing reads "Approved";
//  - a gate without one shows no badge.
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import {
  BUSINESS_UNIT,
  TR_ID,
  makeMe,
  makeTransformation,
  mockApi,
  renderApp,
  route,
  type Handler,
} from "../../test/fixtures.tsx";
import { METHODOLOGY, gateViews, leadGrants } from "../../test/p2fixtures.ts";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Locale = "ar" | "en";
type Annotation = NonNullable<ReturnType<typeof gateViews>[number]["gate"]["inheritedApproval"]>;
const TR = `/api/v1/transformations/${TR_ID}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
/** The SVG path of the approved ("check") icon (components/Icon.tsx). */
const CHECK_PATH = "M4 10.5l4 4 8-9";

const TEXT = {
  en: {
    draft: "Not submitted",
    approved: "Approved",
    label: "Inherited approval",
    pending_verification: "Inherited approval: pending verification (does not approve this gate)",
    accepted: "Inherited approval: accepted, counts for sequencing (does not approve this gate)",
    acceptedNotCounting: "Inherited approval: accepted, does not count now (does not approve this gate)",
    rejected: "Inherited approval: rejected (does not approve this gate)",
    revoked: "Inherited approval: revoked (does not approve this gate)",
    source: /Synthetic executive committee/,
    view: "View gate dispensations",
  },
  ar: {
    draft: "لم تُقدَّم",
    approved: "موافق عليها",
    label: "اعتماد موروث",
    pending_verification: "اعتماد موروث: بانتظار التحقق (لا يعتمد هذه البوابة)",
    accepted: "اعتماد موروث: مقبول، يُحتسب في التسلسل (لا يعتمد هذه البوابة)",
    acceptedNotCounting: "اعتماد موروث: مقبول، لا يُحتسب حالياً (لا يعتمد هذه البوابة)",
    rejected: "اعتماد موروث: مرفوض (لا يعتمد هذه البوابة)",
    revoked: "اعتماد موروث: مُبطَل (لا يعتمد هذه البوابة)",
    source: /Synthetic executive committee/,
    view: "عرض إعفاءات البوابات",
  },
} as const;

const annotation = (over: Partial<Annotation> = {}): Annotation => ({
  dispensationId: "0190f0f0-0000-7000-8000-00000000d150",
  status: "pending_verification",
  counts: false,
  approvingBody: "Synthetic executive committee",
  approvedOn: "2026-01-15",
  ...over,
});

function render(path: "list" | "G1", locale: Locale, g1: Annotation | null) {
  const views = gateViews({ g1InheritedApproval: g1 });
  const handlers: Handler[] = [
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(leadGrants(["gate.submit"]), { preferredLocale: locale }),
    })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({ status: 200, body: makeTransformation() })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
    route("GET", new RegExp(`${esc(TR)}/gates$`), () => ({ status: 200, body: { items: views } })),
    route("GET", new RegExp(`${esc(TR)}/gates/G1$`), () => ({ status: 200, body: views[0] })),
    // Every other register of the transformation answers an empty page.
    (req) => (req.method === "GET" && req.url.startsWith("/api/v1/") ? page([]) : undefined),
  ];
  mockApi(...handlers);
  renderApp(path === "list" ? `/transformations/${TR_ID}/gates` : `/transformations/${TR_ID}/gates/G1`, {
    i18n: createI18n(locale),
  });
}

/** The badge never looks approved: neutral chip, info icon, never the on-track colour or the check icon. */
function expectNeverApproved(badge: HTMLElement) {
  expect(badge.className).toContain("status-chip--unknown");
  expect(badge.className).not.toContain("on-track");
  expect(badge.innerHTML).not.toContain(CHECK_PATH);
  expect(document.querySelector('[data-gate-status="approved"]')).toBeNull();
}

describe.each(["en", "ar"] as const)("inherited-approval annotation (%s)", (locale) => {
  const tx = TEXT[locale];

  it.each([
    ["pending_verification", false, "pending_verification"],
    ["accepted", true, "accepted"],
    ["accepted", false, "acceptedNotCounting"],
    ["rejected", false, "rejected"],
    ["revoked", false, "revoked"],
  ] as const)("Gates list: G1 %s (counts %s) is a badge next to 'Not submitted'", async (status, counts, key) => {
    render("list", locale, annotation({ status, counts }));
    const card = (await screen.findByText(tx[key])).closest("[data-gate]") as HTMLElement;
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    expect(card.getAttribute("data-gate")).toBe("G1");
    // The gate's own status is unchanged and shown first; the badge sits next to it in the same row.
    const statusChip = card.querySelector("[data-gate-status]") as HTMLElement;
    expect(statusChip.getAttribute("data-gate-status")).toBe("draft");
    expect(statusChip.textContent).toContain(tx.draft);
    const badge = within(card).getByText(tx[key]).closest("[data-inherited-approval]") as HTMLElement;
    expect(badge.getAttribute("data-inherited-approval")).toBe(status);
    expect(badge.getAttribute("data-counts")).toBe(String(counts));
    expect(badge.parentElement).toBe(statusChip.parentElement);
    expectNeverApproved(badge);
    // Visible text, not a tooltip: the approving body and date are stated as evidence.
    expect(card.querySelector("[data-inherited-approval-source]")!.textContent).toMatch(tx.source);
    expect(screen.queryByText(tx.approved)).toBeNull();
    // Only G1 carries one.
    expect(document.querySelectorAll("[data-inherited-approval]")).toHaveLength(1);
  });

  it("Gates list: no inherited approval, no badge", async () => {
    render("list", locale, null);
    await screen.findAllByText(tx.draft);
    expect(document.querySelectorAll("[data-inherited-approval]")).toHaveLength(0);
    expect(screen.queryByText(new RegExp(tx.label))).toBeNull();
  });

  it("gate view: an accepted inherited approval is a labelled row beside the 'Not submitted' status", async () => {
    render("G1", locale, annotation({ status: "accepted", counts: true }));
    const badgeText = await screen.findByText(tx.accepted);
    const row = badgeText.closest("[data-inherited-approval-row]") as HTMLElement;
    expect(within(row).getByText(tx.label).tagName).toBe("DT");
    expect(row.textContent).toMatch(tx.source);
    expect(within(row).getByRole("link", { name: tx.view }).getAttribute("href")).toBe(
      `/transformations/${TR_ID}/dispensations`,
    );
    expectNeverApproved(badgeText.closest("[data-inherited-approval]") as HTMLElement);
    const status = document.querySelector("[data-gate-status]") as HTMLElement;
    expect(status.getAttribute("data-gate-status")).toBe("draft");
    expect(status.textContent).toContain(tx.draft);
    expect(screen.queryByText(tx.approved)).toBeNull();
  });

  it("gate view: without an inherited approval there is no row", async () => {
    render("G1", locale, null);
    await screen.findAllByText(tx.draft);
    expect(document.querySelector("[data-inherited-approval-row]")).toBeNull();
  });
});
