// Transformation > Team (REQ-PB-012, REQ-S10-008) against a scripted API in the contract's shapes (SYNTHETIC data):
//  - the six minimum governance roles in playbook order, each with its B0018 accountability text verbatim (read from
//    docs/source/playbook.md) and its assigned people; an unassigned role says so in words;
//  - names resolve from the user directory where readable, else as "team member (role, ref.)", never a raw id alone;
//  - the team table shows the accountability on each assignment and whether it is inherited;
//  - a Transformation Lead assigns a non-approver role (POST with an Idempotency-Key; never to themself); approver
//    roles are left to an access administrator; a 403 is shown in words;
//  - the read-only auditor (AUD) sees everything and no assign control;
//  - English LTR and Arabic RTL.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleAccountability, TeamAssignment } from "../../api/types.ts";
import { createI18n } from "../../i18n/index.ts";
import {
  BUSINESS_UNIT,
  ORG_ID,
  TR_ID,
  USER_ID,
  makeMe,
  makeTransformation,
  mockApi,
  problem,
  renderApp,
  route,
  type Handler,
} from "../../test/fixtures.tsx";
import { AUDITOR_GRANTS, METHODOLOGY, OTHER_USER, leadGrants } from "../../test/p2fixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const T = "2026-09-30T09:00:00Z";
const TR = `/api/v1/transformations/${TR_ID}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const OFFICE_USER = "01920000-0000-7000-9000-000000000202";
const NAMED_USER = "01920000-0000-7000-9000-000000000298";

/** B0018 of the playbook: role -> accountability, read from the source document. */
function playbookAccountabilities(): Record<string, string> {
  const md = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "..", "..", "docs", "source", "playbook.md"),
    "utf8",
  );
  const lines = md.slice(md.indexOf("<!-- B0018 table -->")).split("\n").slice(1);
  const out: Record<string, string> = {};
  for (const line of lines) {
    if (!line.startsWith("|")) {
      if (Object.keys(out).length > 0) break;
      continue;
    }
    const [role, text] = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (!role || role === "Role" || /^-+$/.test(role)) continue;
    out[role] = text!;
  }
  return out;
}
const SOURCE = playbookAccountabilities();
const SOURCE_ROLE: Record<string, string> = {
  SP: "Executive Sponsor",
  TL: "Transformation Lead",
  BO: "Business Owners",
  WL: "Workstream Leads",
  FIN: "Finance / Value Office",
  TO: "Transformation Office",
};

const PLATFORM: Record<string, string> = {
  KDS: "Maintains KPI definitions, baselines and data quality for assigned KPIs.",
  TD: "Contributes technology and data input to target-state design and dependencies.",
  CM: "Participates in governance forums and their decisions.",
  SEC: "Prepares agendas and records attendance, minutes and actions for governance forums.",
  AUD: "Reviews records and audit trails read-only; can never change data.",
};
let n = 0;
const uuid = () => `01920000-0000-7000-b000-${String(++n).padStart(12, "0")}`;
function accountability(roleCode: string): RoleAccountability {
  const isSource = roleCode in SOURCE_ROLE;
  return {
    roleId: uuid(),
    accountabilityEn: isSource ? SOURCE[SOURCE_ROLE[roleCode]!]! : PLATFORM[roleCode]!,
    accountabilityAr: `مسؤولية الدور ${roleCode} (ترجمة مؤقتة)`,
    isSourceText: isSource,
    sourceRef: isSource ? "B0018" : "M0187",
    version: 1,
    createdAt: T,
    createdBy: null,
    updatedAt: T,
    updatedBy: null,
    roleCode: roleCode as RoleAccountability["roleCode"],
  };
}
const ACCOUNTABILITIES = [...Object.keys(SOURCE_ROLE), ...Object.keys(PLATFORM)].map(accountability);

function member(userId: string, roleCode: string, scope: "transformation" | "organization" = "transformation") {
  return {
    assignment: {
      id: uuid(),
      organizationId: ORG_ID,
      userId,
      roleCode,
      scope: { type: scope, id: scope === "transformation" ? TR_ID : ORG_ID },
      effectiveFrom: T,
      effectiveTo: null,
      reason: "Synthetic team set-up",
      grantedBy: USER_ID,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
      version: 1,
      createdAt: T,
    },
    accountability: ACCOUNTABILITIES.find((a) => a.roleCode === roleCode) ?? null,
    inherited: scope !== "transformation",
  } as TeamAssignment;
}
const TEAM = [
  member(USER_ID, "TL"),
  member(OTHER_USER, "SP"),
  member(NAMED_USER, "WL"),
  member(OFFICE_USER, "TO", "organization"),
];

function render(
  grants: ReturnType<typeof leadGrants> | typeof AUDITOR_GRANTS,
  locale: "en" | "ar",
  extra: Handler[] = [],
  options: { strict?: boolean } = {},
) {
  const api = mockApi(
    ...extra,
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(grants, { preferredLocale: locale }) })),
    route("GET", /\/business-units/, () => ({ status: 200, body: { items: [BUSINESS_UNIT], nextCursor: null } })),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({ status: 200, body: makeTransformation() })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
    route("GET", new RegExp(`${esc(TR)}/scoped-assignments(\\?|$)`), () => ({
      status: 200,
      body: { items: TEAM, nextCursor: null },
    })),
    route("GET", /\/api\/v1\/role-accountabilities$/, () => ({ status: 200, body: { items: ACCOUNTABILITIES } })),
    // One teammate is readable by id; the others are not (no user.read): their names fall back to role + ref.
    route("GET", new RegExp(`/api/v1/users/${NAMED_USER}$`), () => ({
      status: 200,
      body: { ...makeMe([]).user, id: NAMED_USER, displayName: "Synthetic Named Teammate" },
    })),
  );
  const utils = renderApp(`/transformations/${TR_ID}/team`, { i18n: createI18n(locale), strict: options.strict });
  return { ...api, ...utils };
}

describe("Team (English LTR)", () => {
  it("shows the six governance roles with B0018 accountability text verbatim and who holds each", async () => {
    render(leadGrants(), "en");
    const governance = await screen.findByRole("region", { name: "Minimum governance roles" });
    const cards = await waitFor(() => {
      const found = [...governance.querySelectorAll<HTMLElement>("[data-role]")];
      expect(found).toHaveLength(6);
      return found;
    });
    expect(cards.map((c) => c.dataset["role"])).toEqual(["SP", "TL", "BO", "WL", "FIN", "TO"]);
    for (const card of cards) {
      const code = card.dataset["role"]!;
      const text = card.querySelector(`[data-accountability='${code}'] .accountability__text`)!;
      expect(text.textContent, code).toBe(SOURCE[SOURCE_ROLE[code]!]);
      expect(card.textContent).toContain("Playbook source text (B0018)");
    }
    expect(within(cards[1]!).getByRole("heading", { name: "Transformation Lead" })).toBeTruthy();
    expect(cards[1]!.querySelector("[data-accountability='TL']")!.textContent).toContain(
      "Integrates workstreams, drives cadence, ensures outcome realization.",
    );
    // Holders: the signed-in user, a readable name, a role+ref fallback, an inherited assignment.
    await waitFor(() =>
      expect(governance.querySelector("[data-holders='WL']")!.textContent).toContain("Synthetic Named Teammate"),
    );
    expect(governance.querySelector("[data-holders='TL']")!.textContent).toContain("Synthetic Test User · you");
    expect(governance.querySelector("[data-holders='SP']")!.textContent).toContain(
      "Team member (Executive Sponsor, ref. 0299)",
    );
    expect(governance.querySelector("[data-holders='TO']")!.textContent).toContain("Inherited from Organization level");
    // An unmapped role is stated in words (never blank).
    expect(governance.querySelector("[data-holders='BO'] [data-state='unassigned']")!.textContent).toContain(
      "No one is assigned to this role for this transformation.",
    );
    // Approver roles are assigned by an access administrator; WL can be assigned here.
    const sp = cards[0]!;
    expect(within(sp).queryByRole("button", { name: /^Assign/ })).toBeNull();
    expect(sp.textContent).toContain("An access administrator assigns this role");
    expect(within(cards[3]!).getByRole("button", { name: "Assign: Workstream Lead" })).toBeTruthy();

    // Implementation roles carry platform text, labelled as such.
    const implementation = screen.getByRole("region", { name: "Implementation roles" });
    const kds = implementation.querySelector("[data-accountability='KDS']")!;
    expect(kds.textContent).toContain(PLATFORM["KDS"]);
    expect(kds.textContent).toContain("Platform text (M0187)");
    // Workstream Lead is a governance role: listed once, not repeated among the implementation roles.
    expect([...implementation.querySelectorAll<HTMLElement>("[data-role]")].map((c) => c.dataset["role"])).toEqual([
      "KDS",
      "TD",
      "CM",
      "SEC",
    ]);
    expect(document.querySelectorAll("[data-role='WL']")).toHaveLength(1);
  });

  it("lists team members with the accountability on each assignment, sortable and filterable", async () => {
    render(leadGrants(), "en");
    const members = await screen.findByRole("region", { name: "Team members" });
    const table = await within(members).findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    const tlRow = rows.find((r) => r.textContent!.includes("Transformation Lead"))!;
    expect(tlRow.textContent).toContain("Integrates workstreams, drives cadence, ensures outcome realization.");
    expect(tlRow.textContent).toContain("This transformation");
    expect(within(table).getByRole("columnheader", { name: /^Role/ }).getAttribute("aria-sort")).toBe("ascending");
    fireEvent.change(within(members).getByLabelText("Search"), { target: { value: "dependencies" } });
    // "Deliver initiatives and manage dependencies." (WL) and the TO text both mention dependencies.
    await waitFor(() => expect(within(table).getAllByRole("row").slice(1)).toHaveLength(2));
  });

  it("a Transformation Lead assigns a Workstream Lead: Idempotency-Key, reason, accountability preview", async () => {
    const created = { ...member(OTHER_USER, "WL").assignment };
    const { requests } = render(leadGrants(), "en", [
      route("POST", new RegExp(`${esc(TR)}/scoped-assignments$`), () => ({ status: 201, body: created })),
    ]);
    const governance = await screen.findByRole("region", { name: "Minimum governance roles" });
    fireEvent.click(await within(governance).findByRole("button", { name: "Assign: Workstream Lead" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-preview-role='WL']")!.textContent).toContain(
      "Deliver initiatives and manage dependencies.",
    );
    const person = within(dialog).getByLabelText(/^Person/) as HTMLSelectElement;
    // Never the signed-in user (a self-grant is refused by the server anyway).
    const values = [...person.options].map((o) => o.value);
    expect(values).not.toContain(USER_ID);
    expect(values).toContain(OTHER_USER);
    expect(within(dialog).getByText(/Only people already on this team are listed/)).toBeTruthy();
    const role = within(dialog).getByLabelText(/^Role/) as HTMLSelectElement;
    expect(role.value).toBe("WL");
    expect([...role.options].map((o) => o.value).filter(Boolean)).toEqual(["WL", "KDS", "TD", "CM", "SEC"]);
    fireEvent.change(person, { target: { value: OTHER_USER } });
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "Synthetic: leads billing" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign role" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.url).toBe(`${TR}/scoped-assignments`);
    expect(post.body).toEqual({ userId: OTHER_USER, roleCode: "WL", reason: "Synthetic: leads billing" });
    expect(post.headers["idempotency-key"]).toMatch(/.{16,}/);
    expect((await screen.findByRole("status")).textContent).toContain("Role assigned: Workstream Lead.");
  });

  it("shows a 403 from the server in words; nothing is assigned", async () => {
    render(leadGrants(), "en", [
      route("POST", new RegExp(`${esc(TR)}/scoped-assignments$`), () => problem(403, "forbidden")),
    ]);
    const members = await screen.findByRole("region", { name: "Team members" });
    fireEvent.click(await within(members).findByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Person/), { target: { value: OTHER_USER } });
    fireEvent.change(within(dialog).getByLabelText(/^Role/), { target: { value: "KDS" } });
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "Synthetic: data steward" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign role" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/permission/i);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("Team: read-only auditor (AUD)", () => {
  it("sees the roles, accountabilities and members, a read-only note, and no assign control", async () => {
    render(AUDITOR_GRANTS, "en");
    const governance = await screen.findByRole("region", { name: "Minimum governance roles" });
    await waitFor(() => expect(governance.querySelectorAll("[data-role]")).toHaveLength(6));
    expect(document.querySelector("[data-state='read-only']")!.textContent).toContain("Read-only view");
    expect(governance.querySelector("[data-accountability='SP']")!.textContent).toContain(SOURCE["Executive Sponsor"]);
    expect(await screen.findByRole("region", { name: "Team members" })).toBeTruthy();
    const main = document.querySelector("main#main")!;
    const enabledAssign = [...main.querySelectorAll("button")]
      .filter((b) => !b.disabled)
      // "Assign" alone or "Assign: <role>" (the hidden role suffix); not e.g. the "Assigned at" column's sort button.
      .filter((b) => /^Assign(?:\s*:.*)?$/.test((b.textContent ?? "").replace(/\s+/g, " ").trim()));
    expect(enabledAssign).toEqual([]);
    expect(main.textContent).not.toContain("An access administrator assigns this role");
  });
});

describe("Team (Arabic RTL)", () => {
  it("shows Arabic role names and the provisional Arabic accountability text", async () => {
    render(leadGrants(), "ar");
    const governance = await screen.findByRole("region", { name: "الحد الأدنى من أدوار الحوكمة" });
    await waitFor(() => expect(governance.querySelectorAll("[data-role]")).toHaveLength(6));
    expect(document.documentElement.dir).toBe("rtl");
    expect(within(governance).getByRole("heading", { name: "قائد التحوّل" })).toBeTruthy();
    const tl = governance.querySelector("[data-accountability='TL']")!;
    expect(tl.textContent).toContain("مسؤولية الدور TL (ترجمة مؤقتة)");
    expect(tl.textContent).toContain("ترجمة مؤقتة لنص الدليل (B0018)");
    expect(within(governance).getByRole("button", { name: "إسناد: قائد مسار العمل" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "أعضاء الفريق" })).toBeTruthy();
  });
});

// F-DG2-430: the assign dialog's accountability preview follows the Role select. RecordForm reports value changes from
// an effect, never from inside a state updater. The app is rendered in <StrictMode> (as src/main.tsx does), so React
// double-invokes updaters, and the unit-web guard (test/react-warning-guard.ts) fails the test on any "Cannot update a
// component ... while rendering a different component" warning.
describe("Team assign dialog: accountability preview follows the selected role (F-DG2-430)", () => {
  const cases = [
    {
      locale: "en" as const,
      assignWl: "Assign: Workstream Lead",
      roleLabel: /^Role/,
      previewHeading: "Accountability of the selected role",
      text: (code: string) => (code in SOURCE_ROLE ? SOURCE[SOURCE_ROLE[code]!]! : PLATFORM[code]!),
    },
    {
      locale: "ar" as const,
      assignWl: "إسناد: قائد مسار العمل",
      roleLabel: /^الدور/,
      previewHeading: "مسؤولية الدور المختار",
      text: (code: string) => `مسؤولية الدور ${code} (ترجمة مؤقتة)`,
    },
  ];
  for (const c of cases) {
    it(`${c.locale}: WL on open, then KDS, TD, none and WL again, in StrictMode with no React warning`, async () => {
      const { requests } = render(leadGrants(), c.locale, [], { strict: true });
      expect(document.documentElement.dir).toBe(c.locale === "ar" ? "rtl" : "ltr");
      fireEvent.click(await screen.findByRole("button", { name: c.assignWl }));
      const dialog = await screen.findByRole("dialog");
      const preview = () => dialog.querySelector<HTMLElement>("[data-preview-role]");
      const expectPreview = async (code: string) =>
        waitFor(() => {
          const p = preview();
          expect(p?.dataset["previewRole"]).toBe(code);
          expect(p!.textContent).toContain(c.previewHeading);
          expect(p!.textContent).toContain(c.text(code));
        });

      // Opened from the Workstream Lead card: the preview starts on WL (the default, not a reported change).
      await expectPreview("WL");
      const role = within(dialog).getByLabelText(c.roleLabel) as HTMLSelectElement;
      expect(role.value).toBe("WL");
      for (const code of ["KDS", "TD"]) {
        fireEvent.change(role, { target: { value: code } });
        expect(role.value).toBe(code);
        await expectPreview(code);
      }
      // No role selected: no preview at all (never a stale one).
      fireEvent.change(role, { target: { value: "" } });
      await waitFor(() => expect(preview()).toBeNull());
      fireEvent.change(role, { target: { value: "WL" } });
      await expectPreview("WL");
      // Editing another field keeps the preview on the selected role.
      fireEvent.change(within(dialog).getByLabelText(c.locale === "ar" ? /^السبب/ : /^Reason/), {
        target: { value: "Synthetic: preview check" },
      });
      await expectPreview("WL");
      // Previewing never sends anything.
      expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
    });
  }
});
