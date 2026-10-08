// Capacity screen with STUBBED responses (BE-E ships the API in parallel; its live e2e is the next wave), English LTR
// and Arabic RTL (T-DG3-FE-B; REQ-PB-059, REQ-S09-004). SYNTHETIC data.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { problem, route } from "../../test/fixtures.tsx";
import {
  AUDITOR_GRANTS,
  INI,
  TR,
  TR_ID,
  esc,
  grants,
  page,
  roadmapView,
  renderWorkspace,
} from "../prioritization/fe-b.fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROLE = "01920000-0000-7000-aa00-000000000001";
const PLAN = {
  transformationId: TR_ID,
  roles: [
    {
      id: ROLE,
      code: "data_engineer",
      labelEn: "Data engineer",
      labelAr: "مهندس بيانات",
      status: "active",
      version: 1,
    },
  ],
  cells: [
    {
      resourceRoleId: ROLE,
      periodMonth: "2026-11-01",
      availableFte: "2.00",
      demandFte: "3.50",
      committedDemandFte: "1.00",
      shortfallFte: "1.50",
      flag: "capacity.over_allocated",
    },
    {
      resourceRoleId: ROLE,
      periodMonth: "2026-12-01",
      availableFte: null,
      demandFte: "1.25",
      committedDemandFte: "0.00",
      shortfallFte: null,
      flag: "capacity.unknown",
    },
    {
      resourceRoleId: ROLE,
      periodMonth: "2027-01-01",
      availableFte: "4.00",
      demandFte: "1.00",
      committedDemandFte: "1.00",
      shortfallFte: null,
      flag: null,
    },
  ],
};
const DEMAND = {
  id: "01920000-0000-7000-aa00-000000000101",
  transformationId: TR_ID,
  initiativeId: INI(1),
  resourceRoleId: ROLE,
  periodMonth: "2026-11-01",
  demandFte: "2.50",
  ownerUserId: null,
  note: null,
  status: "planned",
  committedBy: null,
  committedAt: null,
  version: 7,
};

const TEXT = {
  en: {
    shortfall: "Conflict: short by 1.5 FTE",
    unknown: "Capacity Unknown",
    commit: "Commit capacity",
    conflict: "Someone else changed this record",
    role: "Data engineer",
  },
  ar: {
    shortfall: "تعارض: عجز بمقدار 1.5 مكافئ دوام كامل",
    unknown: "السعة غير معروفة",
    commit: "الالتزام بالسعة",
    conflict: "عدّل شخص آخر هذا السجل",
    role: "مهندس بيانات",
  },
} as const;

const handlers = () => [
  route("GET", new RegExp(`${esc(TR)}/capacity-plan`), () => ({ status: 200, body: PLAN })),
  route("GET", /\/api\/v1\/resource-demands\?/, () => page([DEMAND])),
  route("GET", new RegExp(`${esc(TR)}/roadmap$`), () => ({ status: 200, body: roadmapView() })),
];

describe.each(["en", "ar"] as const)("capacity (%s)", (locale) => {
  const tx = TEXT[locale];

  it("the role × month grid shows decimal FTE, the conflict with its shortfall, and Unknown capacity as Unknown (never 0)", async () => {
    renderWorkspace("capacity", locale, grants(["capacity.edit", "capacity.commit"]), handlers());
    const grid = await screen.findByTestId("capacity-grid");
    expect(grid.textContent).toContain(tx.role);
    const over = grid.querySelector("[data-month='2026-11-01']")!;
    expect(over.getAttribute("data-flag")).toBe("capacity.over_allocated");
    expect(over.textContent).toContain(tx.shortfall);
    expect(over.textContent).toContain("3.5");
    const unknown = grid.querySelector("[data-month='2026-12-01']")!;
    expect(unknown.textContent).toContain(tx.unknown);
    expect(unknown.querySelector("[data-health='unknown']")).not.toBeNull();
    expect(unknown.textContent).not.toMatch(/(Available|المتاح): 0/);
    const ok = grid.querySelector("[data-month='2027-01-01']")!;
    expect(ok.querySelector(".status-chip--at-risk")).toBeNull();
  });

  it("committing a demand POSTs with If-Match; a 409 shows the conflict notice and reloads", async () => {
    let calls = 0;
    const { api } = renderWorkspace("capacity", locale, grants(["capacity.edit", "capacity.commit"]), [
      ...handlers(),
      route("POST", /resource-demands\/[^/]+\/commit$/, () => {
        calls += 1;
        return calls === 1 ? problem(409, "version_conflict", { currentVersion: 8 }) : { status: 200, body: DEMAND };
      }),
    ]);
    const table = await screen.findByTestId("demands");
    fireEvent.click(within(table).getByRole("button", { name: tx.commit }));
    expect(await screen.findByText(tx.conflict)).toBeTruthy();
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"7"');
    expect(post.body).toEqual({});
    await waitFor(() =>
      expect(
        api.requests.filter((r) => r.method === "GET" && r.url.includes("resource-demands")).length,
      ).toBeGreaterThan(1),
    );
  });

  it("the read-only auditor sees the grid and no commit or release control", async () => {
    renderWorkspace("capacity", locale, AUDITOR_GRANTS, handlers());
    await screen.findByTestId("capacity-grid");
    expect(document.querySelector("[data-state='read-only']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: tx.commit })).toBeNull();
  });
});
