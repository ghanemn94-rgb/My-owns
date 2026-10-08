// Capacity editing (T-DG3-FE-E; REQ-PB-059, REQ-S09-004; ADR-0023 §6; T-DG3-BE-E §7) with stubbed responses, English
// LTR and Arabic RTL. SYNTHETIC data.
//  - resourcing roles: create; a taken code (409 resource_role.code_taken) is translated; edit labels (If-Match);
//    archive (PATCH status, If-Match);
//  - capacity rows: create a decimal FTE row (sent as a string); a duplicate (409 capacity.duplicate) is translated;
//  - resource demand: create; edit a planned one (If-Match); 422 resource_demand.not_planned translated;
//  - after a save the plan is re-read, so the conflict indicator follows; Unknown stays Unknown;
//  - the auditor gets no editing control.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
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
import { monthLabel, monthOptions } from "./editing.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROLE = {
  id: "01920000-0000-7000-aa00-000000000001",
  transformationId: TR_ID,
  code: "data_engineer",
  labelEn: "Data engineer",
  labelAr: "مهندس بيانات",
  status: "active",
  version: 2,
};
const ROW = {
  id: "01920000-0000-7000-aa00-000000000201",
  transformationId: TR_ID,
  resourceRoleId: ROLE.id,
  periodMonth: "2026-11-01",
  availableFte: "2.00",
  ownerUserId: null,
  note: null,
  status: "active",
  version: 3,
};
const DEMAND = {
  id: "01920000-0000-7000-aa00-000000000101",
  transformationId: TR_ID,
  initiativeId: INI(1),
  resourceRoleId: ROLE.id,
  periodMonth: "2026-11-01",
  demandFte: "2.50",
  ownerUserId: null,
  note: null,
  status: "planned",
  committedBy: null,
  committedAt: null,
  version: 7,
};
const cell = (over: Record<string, unknown>) => ({
  resourceRoleId: ROLE.id,
  periodMonth: "2026-11-01",
  availableFte: "2.00",
  demandFte: "1.00",
  committedDemandFte: "0.00",
  shortfallFte: null,
  flag: null,
  ...over,
});

const ALL = ["capacity.edit", "capacity.commit"] as const;
const tr = (l: "en" | "ar") => createI18n(l).t;
/** A label that starts with this catalogue text (it may be followed by the required marker). */
const lbl = (s: string) => new RegExp(`^${esc(s)}`);

function handlers(state: { over: boolean }) {
  return [
    route("GET", new RegExp(`${esc(TR)}/capacity-plan`), () => ({
      status: 200,
      body: {
        transformationId: TR_ID,
        roles: [ROLE],
        cells: [
          state.over ? cell({ demandFte: "3.50", shortfallFte: "1.50", flag: "capacity.over_allocated" }) : cell({}),
          cell({ periodMonth: "2026-12-01", availableFte: null, flag: "capacity.unknown" }),
        ],
      },
    })),
    route("GET", new RegExp(`${esc(TR)}/resource-roles$`), () => ({ status: 200, body: { items: [ROLE] } })),
    route("GET", /\/api\/v1\/capacity\?/, () => page([ROW])),
    route("GET", /\/api\/v1\/resource-demands\?/, () => page([DEMAND])),
    route("GET", new RegExp(`${esc(TR)}/roadmap$`), () => ({ status: 200, body: roadmapView() })),
  ];
}

const sectionOf = async (sid: string) => {
  await waitFor(() => expect(document.getElementById(sid)).not.toBeNull());
  return document.getElementById(sid)!.closest("section") as HTMLElement;
};

describe("month helpers", () => {
  it("offer first-of-month periods around today plus the recorded ones, labelled by locale", () => {
    const opts = monthOptions("en", ["2020-01-01"], new Date(Date.UTC(2026, 9, 8)));
    expect(opts[0]!.value).toBe("2020-01-01");
    expect(opts.map((o) => o.value)).toContain("2026-04-01");
    expect(opts.map((o) => o.value)).toContain("2028-10-01");
    expect(opts.every((o) => /^\d{4}-\d{2}-01$/.test(o.value))).toBe(true);
    expect(monthLabel("en", "2026-11-01")).toBe("Nov 2026");
  });
});

describe.each(["en", "ar"] as const)("capacity editing (%s)", (locale) => {
  const t = tr(locale);

  it("creates a role; a taken code (409) is the form's translated alert; then the role is created", async () => {
    let n = 0;
    const { api } = renderWorkspace("capacity", locale, grants([...ALL]), [
      ...handlers({ over: false }),
      route("POST", new RegExp(`${esc(TR)}/resource-roles$`), () => {
        n += 1;
        return n === 1 ? problem(409, "resource_role.code_taken") : { status: 201, body: ROLE };
      }),
    ]);
    const sec = await sectionOf("roles");
    fireEvent.click(await within(sec).findByRole("button", { name: new RegExp(t("capacity.roles.add")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(lbl(t("capacity.roles.code"))), {
      target: { value: "data_engineer" },
    });
    fireEvent.change(within(dialog).getByLabelText(lbl(t("capacity.roles.labelEn"))), {
      target: { value: "Data engineer" },
    });
    fireEvent.change(within(dialog).getByLabelText(lbl(t("capacity.roles.labelAr"))), {
      target: { value: "مهندس بيانات" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("capacity.roles.add") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("capacity.problem.resource_role__code_taken"));
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: t("capacity.roles.add") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const posts = api.requests.filter((r) => r.method === "POST");
    expect(posts[1]!.body).toEqual({ code: "data_engineer", labelEn: "Data engineer", labelAr: "مهندس بيانات" });
    // The same Idempotency-Key for the retry of the same form.
    expect(posts[1]!.headers["idempotency-key"]).toBe(posts[0]!.headers["idempotency-key"]);
  });

  it("edits a role's labels and archives it, each with If-Match", async () => {
    const { api } = renderWorkspace("capacity", locale, grants([...ALL]), [
      ...handlers({ over: false }),
      route("PATCH", new RegExp(`${esc(TR)}/resource-roles/${ROLE.id}$`), () => ({
        status: 200,
        body: { ...ROLE, version: 3 },
      })),
    ]);
    const table = await screen.findByTestId("roles");
    fireEvent.click(within(table).getByRole("button", { name: lbl(t("capacity.edit.edit")) }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText(lbl(t("capacity.roles.code"))) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(lbl(t("capacity.roles.labelEn"))), {
      target: { value: "Senior data engineer" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const edit = api.requests.find((r) => r.method === "PATCH")!;
    expect(edit.body).toEqual({ labelEn: "Senior data engineer" });
    expect(edit.headers["if-match"]).toBe('"2"');
    fireEvent.click(within(table).getByRole("button", { name: lbl(t("capacity.roles.archive")) }));
    const confirm = await screen.findByRole("dialog");
    fireEvent.click(within(confirm).getByRole("button", { name: t("capacity.roles.archive") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const archive = api.requests.filter((r) => r.method === "PATCH")[1]!;
    expect(archive.body).toEqual({ status: "archived" });
    expect(archive.headers["if-match"]).toBe('"2"');
  });

  it("creates a capacity row with a decimal FTE string; a duplicate (409) is translated", async () => {
    let n = 0;
    const { api } = renderWorkspace("capacity", locale, grants([...ALL]), [
      ...handlers({ over: false }),
      route("POST", /\/api\/v1\/capacity$/, () => {
        n += 1;
        return n === 1 ? problem(409, "capacity.duplicate") : { status: 201, body: ROW };
      }),
    ]);
    const sec = await sectionOf("capacity-rows");
    await within(sec).findByTestId("capacity-rows");
    fireEvent.click(within(sec).getByRole("button", { name: new RegExp(t("capacity.rows.add")) }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("option", { name: locale === "ar" ? ROLE.labelAr : ROLE.labelEn })).toBeTruthy(),
    );
    fireEvent.change(within(dialog).getByLabelText(lbl(t("capacity.grid.role"))), {
      target: { value: ROLE.id },
    });
    fireEvent.change(within(dialog).getByLabelText(lbl(t("capacity.demands.month"))), {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(within(dialog).getByLabelText(lbl(t("capacity.edit.availableFte"))), {
      target: { value: "2.50" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("capacity.rows.add") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("capacity.problem.capacity__duplicate"));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({
      resourceRoleId: ROLE.id,
      periodMonth: "2026-11-01",
      availableFte: "2.50",
      transformationId: TR_ID,
    });
  });

  it("creates a demand; after the save the plan is re-read and the conflict with its shortfall appears; Unknown stays Unknown", async () => {
    const state = { over: false };
    const { api } = renderWorkspace("capacity", locale, grants([...ALL]), [
      ...handlers(state),
      route("POST", /\/api\/v1\/resource-demands$/, () => {
        state.over = true;
        return { status: 201, body: DEMAND };
      }),
    ]);
    const grid = await screen.findByTestId("capacity-grid");
    expect(grid.querySelector("[data-flag='capacity.over_allocated']")).toBeNull();
    const sec = await sectionOf("demands");
    fireEvent.click(within(sec).getByRole("button", { name: new RegExp(t("capacity.demands.add")) }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getAllByRole("option").length).toBeGreaterThan(3));
    fireEvent.change(within(dialog).getByLabelText(lbl(t("capacity.demands.initiative"))), {
      target: { value: INI(1) },
    });
    fireEvent.change(within(dialog).getByLabelText(lbl(t("capacity.grid.role"))), {
      target: { value: ROLE.id },
    });
    fireEvent.change(within(dialog).getByLabelText(lbl(t("capacity.demands.month"))), {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(within(dialog).getByLabelText(lbl(t("capacity.edit.demandFte"))), {
      target: { value: "2.50" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("capacity.demands.add") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.requests.find((r) => r.method === "POST")!.body).toEqual({
      initiativeId: INI(1),
      resourceRoleId: ROLE.id,
      periodMonth: "2026-11-01",
      demandFte: "2.50",
    });
    await waitFor(() =>
      expect(screen.getByTestId("capacity-grid").querySelector("[data-flag='capacity.over_allocated']")).not.toBeNull(),
    );
    const g = screen.getByTestId("capacity-grid");
    expect(g.querySelector("[data-testid='shortfall']")?.textContent).toContain("1.5");
    expect(g.querySelector("[data-month='2026-12-01'] [data-health='unknown']")).not.toBeNull();
  });

  it("edits a planned demand with If-Match; 422 resource_demand.not_planned is translated", async () => {
    let n = 0;
    const { api } = renderWorkspace("capacity", locale, grants([...ALL]), [
      ...handlers({ over: false }),
      route("PATCH", new RegExp(`/resource-demands/${DEMAND.id}$`), () => {
        n += 1;
        return n === 1
          ? problem(422, "resource_demand.not_planned", { type: "urn:mth:problem:invalid-transition" })
          : { status: 200, body: { ...DEMAND, version: 8 } };
      }),
    ]);
    const table = await screen.findByTestId("demands");
    fireEvent.click(within(table).getByRole("button", { name: lbl(t("capacity.edit.edit")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(lbl(t("capacity.edit.demandFte"))), {
      target: { value: "1.75" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("capacity.problem.resource_demand__not_planned"));
    const patch = api.requests.find((r) => r.method === "PATCH")!;
    expect(patch.body).toEqual({ demandFte: "1.75" });
    expect(patch.headers["if-match"]).toBe('"7"');
  });

  it("the read-only auditor sees roles and capacity rows with no editing control", async () => {
    renderWorkspace("capacity", locale, AUDITOR_GRANTS, handlers({ over: false }));
    await screen.findByTestId("roles");
    await screen.findByTestId("capacity-rows");
    for (const key of ["capacity.roles.add", "capacity.rows.add", "capacity.demands.add"])
      expect(screen.queryByRole("button", { name: new RegExp(t(key)) })).toBeNull();
    expect(screen.queryByRole("button", { name: lbl(t("capacity.edit.edit")) })).toBeNull();
  });
});
