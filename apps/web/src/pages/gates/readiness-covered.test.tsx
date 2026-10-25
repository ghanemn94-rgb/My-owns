// The readiness line when accepted exceptions cover incomplete mandatory outputs (T-DG5-FE-V1B; D-170, the web need of
// F-DG5-120 in T-DG5-BE-V3's handback §5; ADR-0035 §4). SYNTHETIC data. Every gate is a business approval inside the
// product (G1-G6), never an engineering delivery gate (DG0-DG7); nothing here approves anything real.
//  - covered: the gate page and the gates list say, in the same line, that the other outputs are covered by accepted
//    exceptions (en LTR and ar RTL), and the ready icon follows the server's rule (complete or covered);
//  - no exception: the line reads exactly as before ("N of M mandatory outputs complete");
//  - an expired exception (accepted, `covering: false` from the server) does not count.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GateView } from "../../api/types.ts";
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
import { METHODOLOGY, OTHER_USER, gateViews, id, leadGrants } from "../../test/p2fixtures.ts";
import { readiness, readinessText } from "./GatesPage.tsx";
import type { GateException } from "./p4api.ts";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Locale = "ar" | "en";
const TR = `/api/v1/transformations/${TR_ID}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const T = "2026-10-01T08:00:00.000Z";

/** G1 of the fixtures: every mandatory output complete except g1.baseline. Here it is an approved gate. */
function views(): GateView[] {
  const all = gateViews();
  const g1 = all[0]!;
  all[0] = { ...g1, gate: { ...g1.gate, status: "approved", approvedAt: T }, canSubmit: false };
  return all;
}
const G1 = views()[0]!;
const TOTAL = G1.criteria.filter((c) => c.mandatory).length;
const COMPLETE = G1.criteria.filter((c) => c.mandatory && c.completeness === "complete").length;

function exception(over: Partial<GateException> = {}): GateException {
  return {
    id: id(),
    transformationId: TR_ID,
    gateInstanceId: id(),
    gateCode: "G1",
    criterionKey: "g1.baseline",
    reason: "Synthetic: the baseline is signed off after the gate.",
    scope: "Synthetic: baseline only",
    compensatingAction: "Synthetic: weekly baseline review",
    compensatingOwnerUserId: USER_ID,
    expiresOn: "2026-12-31",
    status: "accepted",
    covering: true,
    requestedBy: OTHER_USER,
    requestedAt: T,
    decidedBy: USER_ID,
    decidedOnBehalfOf: null,
    decidedAt: T,
    decisionNote: "Synthetic demo decision.",
    revokedBy: null,
    revokedAt: null,
    revokeReason: null,
    expiryNotifiedAt: null,
    version: 2,
    createdAt: T,
    createdBy: OTHER_USER,
    updatedAt: T,
    updatedBy: USER_ID,
    ...over,
  };
}

const TEXT = {
  en: {
    plain: `${COMPLETE} of ${TOTAL} mandatory outputs complete`,
    covered: `${COMPLETE} of ${TOTAL} mandatory outputs complete; the other 1 are covered by accepted exceptions`,
  },
  ar: {
    plain: `${COMPLETE} من ${TOTAL} مخرجات إلزامية مكتملة`,
    covered: `${COMPLETE} من ${TOTAL} مخرجات إلزامية مكتملة؛ أما الـ 1 الأخرى فتغطيها استثناءات مقبولة`,
  },
} as const;

/** The SVG path of the "check" icon (components/Icon.tsx). */
const CHECK_PATH = "M4 10.5l4 4 8-9";

function render(path: "list" | "G1", locale: Locale, exceptions: GateException[]) {
  const vs = views();
  const handlers: Handler[] = [
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(leadGrants(["gate.submit"]), { preferredLocale: locale }),
    })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({ status: 200, body: makeTransformation() })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
    route("GET", new RegExp(`${esc(TR)}/gates$`), () => ({ status: 200, body: { items: vs } })),
    route("GET", new RegExp(`${esc(TR)}/gates/G1$`), () => ({ status: 200, body: vs[0] })),
    // listGateExceptions: the server filters by gateCode when the gate page asks; the list asks for all of them.
    route("GET", new RegExp(`${esc(TR)}/gate-exceptions(\\?.*)?$`), (req) => {
      const code = new URL(req.url, "http://x").searchParams.get("gateCode");
      return page(code ? exceptions.filter((e) => e.gateCode === code) : exceptions);
    }),
    (req) => (req.method === "GET" && req.url.startsWith("/api/v1/") ? page([]) : undefined),
  ];
  const api = mockApi(...handlers);
  renderApp(path === "list" ? `/transformations/${TR_ID}/gates` : `/transformations/${TR_ID}/gates/G1`, {
    i18n: createI18n(locale),
  });
  return api;
}

async function gateLine(): Promise<HTMLElement> {
  const section = await screen.findByRole("region", { name: /Readiness|الجاهزية/ });
  return section.querySelector<HTMLElement>("[data-readiness]")!;
}
async function listChip(): Promise<HTMLElement> {
  const card = await waitFor(() => {
    const c = document.querySelector<HTMLElement>('[data-gate="G1"]');
    expect(c).not.toBeNull();
    return c!;
  });
  return card.querySelector<HTMLElement>("[data-readiness]")!;
}

describe.each(["en", "ar"] as const)("readiness line with accepted exceptions (%s)", (locale) => {
  const tx = TEXT[locale];

  it("gate page: an approved gate whose missing output is covered says so in the readiness line; ready follows it", async () => {
    render("G1", locale, [exception()]);
    await waitFor(async () => expect((await gateLine()).textContent).toContain(tx.covered));
    const line = await gateLine();
    expect(line.getAttribute("data-readiness")).toBe(`${COMPLETE}/${TOTAL}`);
    expect(line.getAttribute("data-readiness-covered")).toBe("1");
    expect(line.className).toContain("banner--success");
    expect(line.innerHTML).toContain(CHECK_PATH);
    const status = document.querySelector<HTMLElement>('[data-gate-status="approved"]');
    expect(status?.textContent).toContain(locale === "en" ? "Approved" : "موافق عليها");
  });

  it("gates list: the G1 chip says the rest is covered and is on track", async () => {
    render("list", locale, [exception()]);
    await waitFor(async () => expect((await listChip()).textContent).toContain(tx.covered));
    const chip = await listChip();
    expect(chip.className).toContain("status-chip--on-track");
    expect(chip.className).toContain("status-chip--wrap");
    expect(chip.innerHTML).toContain(CHECK_PATH);
    // The other gates have no exception: their lines are unchanged.
    const g2 = document.querySelector<HTMLElement>('[data-gate="G2"] [data-readiness]');
    if (g2) expect(g2.getAttribute("data-readiness-covered")).toBe("0");
  });

  it.each(["G1", "list"] as const)("%s: without exceptions the line is unchanged", async (path) => {
    render(path, locale, []);
    const line = path === "G1" ? await gateLine() : await listChip();
    await waitFor(() => expect(line.textContent?.trim()).toBe(tx.plain));
    expect(line.getAttribute("data-readiness-covered")).toBe("0");
    expect(line.innerHTML).not.toContain(CHECK_PATH);
  });

  it.each(["G1", "list"] as const)("%s: an expired exception (covering false) does not count", async (path) => {
    const api = render(path, locale, [exception({ expiresOn: "2026-01-31", covering: false })]);
    // Wait until the exceptions were read and rendered (the gate page lists the expired one in its own section).
    await waitFor(() => expect(api.requests.some((r) => r.url.includes("/gate-exceptions"))).toBe(true));
    if (path === "G1") await screen.findByText(/Synthetic: baseline only/);
    else await new Promise((r) => setTimeout(r, 50));
    const line = path === "G1" ? await gateLine() : await listChip();
    expect(line.textContent?.trim()).toBe(tx.plain);
    expect(line.getAttribute("data-readiness-covered")).toBe("0");
    expect(line.innerHTML).not.toContain(CHECK_PATH);
    expect(within(line).queryByText(/exceptions|استثناءات/)).toBeNull();
  });
});

describe("readiness() and readinessText(): coverage is the server's `covering`, counted only for incomplete outputs", () => {
  const t = createI18n("en").t;
  const two: GateView = {
    ...G1,
    criteria: G1.criteria.map((c, i) => (c.mandatory && i < 2 ? { ...c, completeness: "incomplete" as const } : c)),
  };
  const missing = two.criteria.filter((c) => c.mandatory && c.completeness === "incomplete").map((c) => c.key);

  it("counts a covering exception on an incomplete output; ignores pending, rejected, expired, other gates and complete outputs", () => {
    const completeKey = two.criteria.find((c) => c.mandatory && c.completeness === "complete")!.key;
    const r = readiness(two, [
      exception({ criterionKey: missing[0]! }),
      exception({ criterionKey: missing[1]!, status: "pending", covering: false }),
      exception({ criterionKey: missing[1]!, status: "rejected", covering: false }),
      exception({ criterionKey: missing[1]!, covering: false, expiresOn: "2026-01-01" }),
      exception({ criterionKey: missing[1]!, gateCode: "G2" }),
      exception({ criterionKey: completeKey }),
    ]);
    expect(r.covered).toBe(1);
    expect(r.satisfied).toBe(false);
    expect(r.ready).toBe(false);
    const rest = r.total - r.complete;
    expect(readinessText(r, t)).toBe(
      `${r.complete} of ${r.total} mandatory outputs complete; 1 of the other ${rest} are covered by accepted exceptions`,
    );
    expect(readinessText(r, createI18n("ar").t)).toBe(
      `${r.complete} من ${r.total} مخرجات إلزامية مكتملة؛ وتغطي استثناءات مقبولة 1 من الـ ${rest} الأخرى`,
    );
  });

  it("is satisfied when every incomplete output is covered; without exceptions it is the DG2 result", () => {
    const all = readiness(
      two,
      missing.map((k) => exception({ criterionKey: k })),
    );
    expect(all.covered).toBe(missing.length);
    expect(all.satisfied).toBe(true);
    expect(all.ready).toBe(false);
    const none = readiness(two);
    expect(none.covered).toBe(0);
    expect(none.satisfied).toBe(false);
    expect(readinessText(none, t)).toBe(`${none.complete} of ${none.total} mandatory outputs complete`);
  });
});
