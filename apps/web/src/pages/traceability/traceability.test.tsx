// Slice K screens, the RAG policy and the transformation chip (T-DG4-FE-G2; p4-work-split §J+K JK.7; ADR-0037 §3/§4,
// ADR-0038) with stubbed responses, in English (LTR) and Arabic (RTL). SYNTHETIC data only.
//  - REQ-PB-044 / REQ-S03-006: the graph's nodes open their records; links to records not in the answer are counted,
//    never listed; the orphan report names the expected step; the impact panel lists affected records, benefits whose
//    value is affected, dashboards, and a hidden count; an allocation set shows its total and unallocated share, and a
//    share that would take it to 110 % is refused with the translated message and the total it would reach.
//  - REQ-PB-005 / REQ-S03-005: missing links (blocking first), the waiver in force, G2 labelled Inherited (never
//    Approved), inherited records with the inherited label, create / read / withdraw.
//  - REQ-S03-001: portfolios and workstreams, one placement at a time (translated 422), WS-nn codes.
//  - The RAG policy: version 0 → If-Match "0"; 409 says nothing was saved; read-only without dashboard.configure.
//  - REQ-S13-002: the repeatable transformation chip sends each id; only readable transformations are offered.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { ORG_ID, TR_ID, USER_ID, makeMe, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, orgGrants, p4Handlers, page } from "../my-work/p4fixtures.ts";
import { executiveOverview } from "../dashboards/dashboardFixtures.ts";
import { ragPolicyBody } from "../dashboards/RagPolicyPage.tsx";
import { modularWaiverInForce } from "./ModularPage.tsx";
import { shareError, wouldTotal } from "./TracePanels.tsx";
import { apiHrefToWebPath, recordWebPath } from "./ui.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Waits until the selector matches (waitFor alone resolves on a null result). */
async function el(selector: string): Promise<Element> {
  return waitFor(() => {
    const e = document.querySelector(selector);
    if (!e) throw new Error(`not found: ${selector}`);
    return e;
  });
}

const u = (n: number) => `01920000-0000-7000-b000-${String(n).padStart(12, "0")}`;
const T0 = "2026-10-01T09:00:00Z";
const FINDING = u(1);
const GAP = u(2);
const INI = u(3);
const DEL = u(4);
const CAP = u(5);
const OUT = u(6);
const OKPI = u(7);
const BEN = u(8);
const HIDDEN = u(99);
const LINK_CAP_KPI = u(21);
const LINK_CONTRIB = u(22);

const node = (recordType: string, recordId: string, code: string | null, label: string, extra = {}) => ({
  recordType,
  recordId,
  code,
  label,
  status: "active",
  href: `/api/v1/x/${recordId}`,
  orphan: { upstream: false, downstream: false },
  allocation: null,
  ...extra,
});
const edge = (edgeKind: string, fromType: string, fromId: string, toType: string, toId: string, extra = {}) => ({
  edgeKind,
  fromType,
  fromId,
  toType,
  toId,
  linkTable: "trace_link",
  linkId: u(200 + fromId.charCodeAt(fromId.length - 1) + toId.charCodeAt(toId.length - 1)),
  contributionStatement: null,
  allocationShare: null,
  ...extra,
});

function graph() {
  return {
    transformationId: TR_ID,
    rootType: null,
    rootId: null,
    direction: "both",
    depth: 8,
    truncated: false,
    nodes: [
      node("diagnostic_finding", FINDING, null, "Synthetic queue complaints"),
      node("tom_gap", GAP, null, "Synthetic self-service gap"),
      node("initiative", INI, "INI-01", "Synthetic app relaunch", { orphan: { upstream: true, downstream: false } }),
      node("deliverable", DEL, null, "Synthetic app release"),
      node("capability", CAP, null, "Synthetic digital onboarding"),
      node("outcome", OUT, null, "Synthetic faster onboarding"),
      node("outcome_kpi", OKPI, null, "Synthetic onboarding time", {
        allocation: { total: "1.000000", unallocatedShare: "0.000000" },
      }),
      node("benefit", BEN, "BEN-01", "Synthetic cost saving", {
        allocation: { total: "0.400000", unallocatedShare: "0.600000" },
      }),
    ],
    edges: [
      edge("issue_gap", "diagnostic_finding", FINDING, "tom_gap", GAP),
      edge("initiative_deliverable", "initiative", INI, "deliverable", DEL, { linkTable: "deliverable" }),
      edge("deliverable_capability", "deliverable", DEL, "capability", CAP),
      edge("capability_kpi", "capability", CAP, "outcome_kpi", OKPI, {
        linkId: LINK_CAP_KPI,
        allocationShare: "0.600000",
      }),
      edge("initiative_kpi", "initiative", INI, "outcome_kpi", OKPI, {
        linkTable: "initiative_outcome_contribution",
        linkId: LINK_CONTRIB,
        allocationShare: "0.400000",
      }),
      edge("outcome_kpi_of", "outcome", OUT, "outcome_kpi", OKPI, { linkTable: "outcome_kpi" }),
      edge("kpi_benefit", "outcome_kpi", OKPI, "benefit", BEN, { allocationShare: "0.400000" }),
      // a link to a record the caller cannot see: counted, never listed
      edge("gap_initiative", "tom_gap", HIDDEN, "initiative", INI, { linkTable: "initiative_gap_link" }),
    ],
  };
}

const allocationSet = () => ({
  targetType: "outcome_kpi",
  targetId: OKPI,
  total: "1.000000",
  unallocatedShare: "0.000000",
  members: [
    {
      linkTable: "trace_link",
      linkId: LINK_CAP_KPI,
      fromType: "capability",
      fromId: CAP,
      allocationShare: "0.600000",
      allocationBasis: "Synthetic estimate",
      version: 2,
    },
    {
      linkTable: "initiative_outcome_contribution",
      linkId: LINK_CONTRIB,
      fromType: "initiative",
      fromId: INI,
      allocationShare: "0.400000",
      allocationBasis: null,
      version: 3,
    },
  ],
});

const traceHandlers = (extra: ReturnType<typeof route>[] = []) => [
  ...extra,
  route("GET", new RegExp(`${esc(TRP)}/traceability`), () => json(graph())),
  route("GET", new RegExp(`${esc(TRP)}/orphans`), () =>
    json({
      items: [
        {
          recordType: "initiative",
          recordId: INI,
          code: "INI-01",
          label: "Synthetic app relaunch",
          href: `/api/v1/initiatives/${INI}`,
          missing: "upstream",
          expected: ["tom_gap → initiative"],
        },
      ],
      nextCursor: null,
    }),
  ),
  route("GET", new RegExp(`${esc(TRP)}/allocation-sets/outcome_kpi/${OKPI}`), () => json(allocationSet())),
  route("GET", new RegExp(`/api/v1/records/kpi_definition/${u(70)}/impact`), () =>
    json({
      recordType: "kpi_definition",
      recordId: u(70),
      records: [
        {
          recordType: "benefit",
          recordId: BEN,
          code: "BEN-01",
          label: "Synthetic cost saving",
          href: `${TRP}/benefits/${BEN}`,
          distance: 1,
          edgeKinds: ["kpi_benefit"],
          valueAffected: true,
        },
      ],
      dashboards: [
        { dashboard: "transformation", areaCode: "outcomes", transformationId: TR_ID, workstreamId: null },
        { dashboard: "finance", areaCode: "value", transformationId: null, workstreamId: null },
        { dashboard: "executive", areaCode: null, transformationId: null, workstreamId: null },
      ],
      hiddenCount: 2,
      nextCursor: null,
    }),
  ),
  route("GET", new RegExp(`${esc(TRP)}/kpi-definitions`), () =>
    page([{ id: u(70), name: "Synthetic onboarding time KPI" }]),
  ),
];

describe("slice K pure helpers", () => {
  it("shares are exact decimal fractions in (0, 1]; totals are decimal, never floats", () => {
    expect(shareError("0.4")).toBeNull();
    expect(shareError("1")).toBeNull();
    expect(shareError("1.000000")).toBeNull();
    expect(shareError("")).toBeNull();
    expect(shareError("0")).toBe("validation.share_range");
    expect(shareError("1.1")).toBe("validation.share_range");
    expect(shareError("40%")).toBe("validation.share_range");
    expect(shareError("0.1234567")).toBe("validation.share_range");
    const set = allocationSet() as Parameters<typeof wouldTotal>[0];
    expect(wouldTotal(set, null, "0.1")).toBe("1.100000");
    expect(wouldTotal(set, LINK_CAP_KPI, "0.3")).toBe("0.700000");
    expect(wouldTotal(set, LINK_CAP_KPI, "")).toBe("0.400000");
  });

  it("a node opens its record; a deliverable opens its initiative through the graph", () => {
    const g = graph() as unknown as Parameters<typeof recordWebPath>[3];
    expect(recordWebPath("initiative", INI, TR_ID)).toBe(`/transformations/${TR_ID}/initiatives/${INI}`);
    expect(recordWebPath("deliverable", DEL, TR_ID, g)).toBe(`/transformations/${TR_ID}/initiatives/${INI}`);
    expect(recordWebPath("deliverable", DEL, TR_ID)).toBe(`/transformations/${TR_ID}/portfolio`);
    expect(recordWebPath("benefit", BEN, TR_ID)).toBe(`/transformations/${TR_ID}/benefits/${BEN}`);
    expect(recordWebPath("outcome_kpi", OKPI, TR_ID)).toBe(`/transformations/${TR_ID}/define`);
    expect(apiHrefToWebPath(`${TRP}/baselines`, TR_ID)).toBe(`/transformations/${TR_ID}/define`);
    expect(apiHrefToWebPath(null, TR_ID)).toBeNull();
  });

  it("the Modular-links waiver in force: accepted G3 waiver, no initiative, expiry on or after the business date", () => {
    const d = (over: Record<string, unknown>) =>
      ({
        id: u(500),
        kind: "waiver",
        gateCode: "G3",
        initiativeId: null,
        status: "accepted",
        expiresOn: "2026-10-10",
        ...over,
      }) as unknown as Parameters<typeof modularWaiverInForce>[0][number];
    expect(modularWaiverInForce([d({})], "2026-10-10")?.id).toBe(u(500)); // inclusive
    expect(modularWaiverInForce([d({})], "2026-10-11")).toBeNull();
    expect(modularWaiverInForce([d({ initiativeId: INI })], "2026-10-01")).toBeNull();
    expect(modularWaiverInForce([d({ gateCode: "G2" })], "2026-10-01")).toBeNull();
    expect(modularWaiverInForce([d({ status: "revoked" })], "2026-10-01")).toBeNull();
    expect(modularWaiverInForce([d({}), d({ id: u(501), expiresOn: "2026-12-31" })], "2026-10-01")?.id).toBe(u(501));
  });

  it("the RAG policy body sends only changed members; empty means default (null)", () => {
    const stored = {
      valueGapAmberRatio: null,
      valueGapRedRatio: "0.200000",
      milestoneSlipAmberWorkingDays: null,
      milestoneSlipRedWorkingDays: null,
      dependencyDueSoonWorkingDays: null,
      decisionDueSoonWorkingDays: null,
      topInitiativeCount: null,
      deadlineHorizonWorkingDays: 10,
      note: null,
    } as unknown as Parameters<typeof ragPolicyBody>[0];
    const values = {
      valueGapAmberRatio: "0.1",
      valueGapRedRatio: "",
      milestoneSlipAmberWorkingDays: "",
      milestoneSlipRedWorkingDays: "",
      dependencyDueSoonWorkingDays: "",
      decisionDueSoonWorkingDays: "",
      topInitiativeCount: "",
      deadlineHorizonWorkingDays: "12",
      note: "",
    };
    expect(ragPolicyBody(stored, values)).toEqual({
      valueGapAmberRatio: "0.1",
      valueGapRedRatio: null,
      deadlineHorizonWorkingDays: 12,
    });
  });
});

describe.each(["en", "ar"] as const)("Traceability (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("graph: clickable nodes, orphan flags, allocation totals, unseen links counted; orphan report", async () => {
    mockApi(...p4Handlers(locale, ["traceability.link"], traceHandlers()));
    renderApp(`/transformations/${TR_ID}/traceability`, { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelector("[data-trace-graph]")).not.toBeNull());
    expect(document.querySelector("[data-tab='traceability']")?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelectorAll("[data-node-type]")).toHaveLength(8);
    const ini = document.querySelector(`[data-node='${INI}'] a[data-node-link]`)!;
    expect(ini.getAttribute("href")).toBe(`/transformations/${TR_ID}/initiatives/${INI}`);
    expect(document.querySelector(`[data-node='${DEL}'] a[data-node-link]`)!.getAttribute("href")).toBe(
      `/transformations/${TR_ID}/initiatives/${INI}`,
    );
    expect(document.querySelector(`[data-node='${BEN}'] a[data-node-link]`)!.getAttribute("href")).toBe(
      `/transformations/${TR_ID}/benefits/${BEN}`,
    );
    expect(document.querySelector(`[data-node='${INI}']`)!.textContent).toContain(t("traceability.orphan.upstream"));
    // benefit 40 % allocated, 60 % unallocated: shown from the decimal strings
    const ben = document.querySelector(`[data-node='${BEN}'] [data-allocation-total]`)!;
    expect(ben.textContent).toContain("40%");
    expect(ben.textContent).toContain("60%");
    // one link to a hidden record: counted, and its id never shown
    expect(document.querySelector("[data-hidden-count='1']")).not.toBeNull();
    expect(document.body.innerHTML).not.toContain(HIDDEN);
    // orphan report: the expected step is translated
    const orphan = await el(`[data-orphan-id='${INI}']`);
    expect(orphan.textContent).toContain(
      t("traceability.orphans.expectedStep", {
        from: t("traceability.nodeType.tom_gap"),
        to: t("traceability.nodeType.initiative"),
      }),
    );
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("impact of a KPI definition: affected benefit (value affected), dashboards and areas, hidden count", async () => {
    mockApi(...p4Handlers(locale, [], traceHandlers()));
    renderApp(`/transformations/${TR_ID}/traceability?impact=kpi_definition:${u(70)}`, { i18n: createI18n(locale) });
    const panel = await el(`[data-impact-root='kpi_definition:${u(70)}']`);
    expect(panel.querySelector("[data-impact-record='benefit']")!.textContent).toContain(
      t("traceability.impact.valueAffected"),
    );
    expect(panel.querySelector("[data-impact-dashboard='transformation'] a")!.getAttribute("href")).toBe(
      `/transformations/${TR_ID}/dashboard`,
    );
    expect(panel.querySelector("[data-impact-dashboard='finance']")!.textContent).toContain(
      t("traceability.area.value"),
    );
    expect(panel.querySelector("[data-impact-dashboard='executive'] a")!.getAttribute("href")).toBe(
      "/executive-overview",
    );
    expect(panel.querySelector("[data-hidden-count='2']")!.textContent).toContain(
      t("traceability.impact.hidden", { n: 2 }),
    );
  });

  it("allocation set: 100 % total, 0 % unallocated; a 110 % share is refused with the translated message", async () => {
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        ["traceability.link"],
        traceHandlers([
          route("PATCH", new RegExp(`${esc(TRP)}/trace-links/${LINK_CAP_KPI}$`), () =>
            problem(422, "trace_link.allocation_exceeds_total", {
              detail: "The allocations into this record would total 110%, more than 100%.",
              errors: [{ pointer: "/allocationShare", code: "trace_link.allocation_exceeds_total", message: "x" }],
            }),
          ),
        ]),
      ),
    );
    renderApp(`/transformations/${TR_ID}/traceability?alloc=outcome_kpi:${OKPI}`, { i18n: createI18n(locale) });
    const set = await el(`[data-allocation-set='outcome_kpi:${OKPI}']`);
    expect(set.querySelector("[data-total='1.000000']")!.textContent).toContain("100%");
    expect(set.querySelector("[data-unallocated='0.000000']")!.textContent).toContain("0%");
    fireEvent.click(set.querySelector(`[data-member='${LINK_CAP_KPI}'] [data-action='edit-share']`)!);
    const dialog = await screen.findByRole("dialog");
    const share = dialog.querySelector("[data-field='allocationShare']") as HTMLInputElement;
    fireEvent.change(share, { target: { value: "0.7" } });
    expect(dialog.querySelector("[data-would-total='1.100000']")!.textContent).toContain("110%");
    fireEvent.click(within(dialog).getByRole("button", { name: t("traceability.save") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("traceability.problem.trace_link__allocation_exceeds_total"));
    expect(alert.querySelector("[data-refused-total='1.100000']")!.textContent).toContain("110%");
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.headers["if-match"]).toBe('"2"');
    expect(patch.body).toEqual({ allocationShare: "0.7", allocationBasis: "Synthetic estimate" });
  });

  it("creates a trace link with its statement and a decimal share", async () => {
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        ["traceability.link"],
        traceHandlers([route("POST", new RegExp(`${esc(TRP)}/trace-links$`), () => ({ status: 201, body: {} }))]),
      ),
    );
    renderApp(`/transformations/${TR_ID}/traceability`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("traceability.links.create") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("[data-field='linkKind']")!, { target: { value: "kpi_benefit" } });
    await waitFor(() => expect(dialog.querySelector("[data-field='fromId']")).not.toBeNull());
    fireEvent.change(dialog.querySelector("[data-field='fromId']")!, { target: { value: OKPI } });
    fireEvent.change(dialog.querySelector("[data-field='toId']")!, { target: { value: BEN } });
    fireEvent.change(dialog.querySelector("[data-field='contributionStatement']")!, {
      target: { value: "Synthetic: faster onboarding lowers handling cost" },
    });
    fireEvent.change(dialog.querySelector("[data-field='allocationShare']")!, { target: { value: "0.25" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("traceability.links.createSubmit") }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({
      linkKind: "kpi_benefit",
      fromId: OKPI,
      toId: BEN,
      contributionStatement: "Synthetic: faster onboarding lowers handling cost",
      allocationShare: "0.25",
    });
  });

  it("read-only users get no write control", async () => {
    mockApi(...p4Handlers(locale, [], traceHandlers()));
    renderApp(`/transformations/${TR_ID}/traceability?alloc=outcome_kpi:${OKPI}`, { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelector("[data-allocation-set]")).not.toBeNull());
    expect(document.querySelector("[data-action='create-link']")).toBeNull();
    expect(document.querySelector("[data-action='edit-share']")).toBeNull();
    expect(document.querySelector("[data-state='read-only']")).not.toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ Modular entry

const missingLinks = () => ({
  transformationId: TR_ID,
  mode: "modular",
  entryPhase: "design",
  standaloneDeliverableType: null,
  gates: [
    { gateCode: "G1", status: "not_started", label: "not_started", inheritedApproval: null },
    { gateCode: "G2", status: "not_started", label: "inherited", inheritedApproval: null },
    { gateCode: "G3", status: "not_started", label: "not_started", inheritedApproval: null },
  ],
  items: [
    {
      code: "baseline_missing",
      severity: "blocking",
      recordType: null,
      recordId: null,
      label: null,
      href: `${TRP}/baselines`,
    },
    {
      code: "outcome_link_missing",
      severity: "blocking",
      recordType: null,
      recordId: null,
      label: null,
      href: `${TRP}/outcomes`,
    },
    { code: "benefit_missing", severity: "warning", recordType: null, recordId: null, label: null, href: null },
  ],
});
const INH = u(300);
const inherited = (over = {}) => ({
  id: INH,
  transformationId: TR_ID,
  kind: "evidence",
  label: "inherited",
  evidenceId: u(301),
  baselineId: null,
  gateDispensationId: null,
  gateCode: null,
  approvingBody: null,
  sourceDescription: "Synthetic prior programme pack",
  originalOwner: "Synthetic PMO",
  originalDate: "2026-03-01",
  recordedBy: USER_ID,
  status: "active",
  withdrawnAt: null,
  withdrawnBy: null,
  withdrawReason: null,
  version: 1,
  createdAt: T0,
  ...over,
});
const prior = inherited({
  id: u(302),
  kind: "prior_approval",
  evidenceId: u(303),
  gateDispensationId: u(304),
  gateCode: "G2",
  approvingBody: "Synthetic Steering Committee",
  sourceDescription: null,
  originalOwner: null,
  status: "accepted",
});

describe.each(["en", "ar"] as const)("Modular entry (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("missing links with the waiver in force; G2 Inherited, never Approved; inherited records labelled", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["inherited_record.record"],
        [
          route("GET", new RegExp(`${esc(TRP)}/missing-links`), () => json(missingLinks())),
          route("GET", new RegExp(`${esc(TRP)}/inherited-records/${INH}$`), () => json(inherited())),
          route("GET", new RegExp(`${esc(TRP)}/inherited-records`), () => page([inherited(), prior])),
          route("GET", new RegExp(`${esc(TRP)}/gate-dispensations`), () =>
            page([
              {
                id: u(400),
                kind: "waiver",
                gateCode: "G3",
                initiativeId: null,
                status: "accepted",
                expiresOn: "2099-12-31",
                reason: "Synthetic: baseline data arrives next quarter",
              },
            ]),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/modular-entry`, { i18n: createI18n(locale) });
    const g2 = await el("[data-gate='G2']");
    expect(g2.getAttribute("data-gate-label")).toBe("inherited");
    expect(g2.textContent).toContain(t("traceability.inheritedLabel"));
    expect(g2.textContent).not.toContain(t("traceability.gateLabel.approved"));
    expect(document.querySelector("[data-blocking='2']")).not.toBeNull();
    const items = [...document.querySelectorAll("[data-missing]")].map((x) => x.getAttribute("data-missing"));
    expect(items).toEqual(["baseline_missing", "outcome_link_missing", "benefit_missing"]);
    expect(document.querySelector("[data-missing='baseline_missing'] a")!.getAttribute("href")).toBe(
      `/transformations/${TR_ID}/define`,
    );
    const waiver = await el(`[data-waiver='${u(400)}']`);
    expect(waiver.getAttribute("data-waiver-expires")).toBe("2099-12-31");
    // inherited label on every entry; the prior approval is read-only and points to the dispensations
    await waitFor(() => expect(document.querySelectorAll("[data-inherited-label]").length).toBe(2));
    expect(document.querySelector("[data-inherited-label]")!.textContent).toContain(t("traceability.inheritedLabel"));
    if (locale === "en") expect(t("traceability.inheritedLabel")).toBe("Inherited - recorded, not granted in platform");
    else expect(document.querySelector("[data-provisional]")).not.toBeNull();
    expect(document.querySelector(`[data-prior-approval='${u(302)}']`)).not.toBeNull();
    // getInheritedRecord
    fireEvent.click(document.querySelector("[data-action='view-inherited']")!);
    const view = await el(`[data-inherited-view='${INH}'] [data-inherited-status]`);
    expect(view.getAttribute("data-inherited-status")).toBe("active");
  });

  it("records an inherited evidence item and withdraws one with If-Match", async () => {
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        ["inherited_record.record"],
        [
          route("GET", new RegExp(`${esc(TRP)}/missing-links`), () => json({ ...missingLinks(), items: [] })),
          route("GET", new RegExp(`${esc(TRP)}/inherited-records`), () => page([inherited()])),
          route("GET", new RegExp(`${esc(TRP)}/evidence`), () =>
            page([{ id: u(310), title: "Synthetic survey export", status: "active" }]),
          ),
          route("POST", new RegExp(`${esc(TRP)}/inherited-records$`), () => ({ status: 201, body: inherited() })),
          route("POST", new RegExp(`${esc(TRP)}/inherited-records/${INH}/withdraw$`), () => json(inherited())),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/modular-entry`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("traceability.inherited.create") }));
    let dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.querySelector(`[data-field='evidenceId'] option[value='${u(310)}']`)).not.toBeNull(),
    );
    fireEvent.change(dialog.querySelector("[data-field='evidenceId']")!, { target: { value: u(310) } });
    fireEvent.change(dialog.querySelector("[data-field='sourceDescription']")!, {
      target: { value: "Synthetic earlier programme" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("traceability.inherited.createSubmit") }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/inherited-records"))).toBe(true),
    );
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({
      kind: "evidence",
      evidenceId: u(310),
      sourceDescription: "Synthetic earlier programme",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(document.querySelector("[data-action='withdraw-inherited']")!);
    dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("[data-field='reason']")!, { target: { value: "Synthetic: superseded" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("traceability.inherited.withdraw") }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/withdraw"))).toBe(true));
    const w = requests.find((r) => r.url.endsWith("/withdraw"))!;
    expect(w.headers["if-match"]).toBe('"1"');
    expect(w.body).toEqual({ reason: "Synthetic: superseded" });
  });
});

// ------------------------------------------------------------------------------------------------ structure

const workstream = (n: number, over = {}) => ({
  id: u(600 + n),
  transformationId: TR_ID,
  code: `WS-0${n}`,
  name: `Synthetic workstream ${n}`,
  description: null,
  leadUserId: null,
  status: "active",
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
  version: 1,
  createdAt: T0,
  createdBy: USER_ID,
  updatedAt: T0,
  updatedBy: USER_ID,
  ...over,
});
const PORTFOLIO = u(700);
const portfolio = (over = {}) => ({
  id: PORTFOLIO,
  organizationId: ORG_ID,
  code: "PF-RETAIL",
  name: "Synthetic retail portfolio",
  description: null,
  ownerUserId: null,
  status: "active",
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
  version: 1,
  createdAt: T0,
  createdBy: USER_ID,
  updatedAt: T0,
  updatedBy: USER_ID,
  ...over,
});

describe.each(["en", "ar"] as const)("Portfolios and workstreams (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("workstreams list WS-nn codes; assigning an initiative twice shows the translated refusal", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["workstream.manage"],
        [
          route("GET", new RegExp(`${esc(TRP)}/workstreams/${u(601)}/initiatives`), () => page([])),
          route("GET", new RegExp(`${esc(TRP)}/workstreams/${u(601)}$`), () => json(workstream(1))),
          route("GET", new RegExp(`${esc(TRP)}/workstreams`), () => page([workstream(1), workstream(2)])),
          route("GET", /\/api\/v1\/initiatives\?/, () =>
            page([{ id: INI, code: "INI-01", name: "Synthetic app relaunch" }]),
          ),
          route("POST", new RegExp(`${esc(TRP)}/workstreams/${u(601)}/initiatives$`), () =>
            problem(422, "workstream.initiative_already_assigned"),
          ),
        ],
      ),
    );
    const { router } = renderApp(`/transformations/${TR_ID}/workstreams`, { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelector("[data-workstream='WS-02']")).not.toBeNull());
    expect(document.querySelector("[data-workstream='WS-01']")).not.toBeNull();
    await router.navigate(`/transformations/${TR_ID}/workstreams/${u(601)}`);
    fireEvent.click(await screen.findByRole("button", { name: t("traceability.workstreams.addInitiative") }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelector(`option[value='${INI}']`)).not.toBeNull());
    fireEvent.change(dialog.querySelector("[data-field='initiativeId']")!, { target: { value: INI } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("traceability.workstreams.addSubmit") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.workstream__initiative_already_assigned"));
  });

  it("portfolio: placing a transformation already in a portfolio shows the translated refusal", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["portfolio.manage"],
        [
          route("GET", new RegExp(`/api/v1/portfolios/${PORTFOLIO}/transformations`), () => page([])),
          route("GET", new RegExp(`/api/v1/portfolios/${PORTFOLIO}$`), () => json(portfolio())),
          route("GET", /\/api\/v1\/transformations\?/, () =>
            page([{ id: TR_ID, code: "TR-0001", name: "Synthetic retail journey" }]),
          ),
          route("POST", new RegExp(`/api/v1/portfolios/${PORTFOLIO}/transformations$`), () =>
            problem(422, "portfolio.transformation_already_placed"),
          ),
        ],
      ),
    );
    renderApp(`/portfolios/${PORTFOLIO}`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("traceability.portfolios.addTransformation") }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelector(`option[value='${TR_ID}']`)).not.toBeNull());
    fireEvent.change(dialog.querySelector("[data-field='transformationId']")!, { target: { value: TR_ID } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("traceability.portfolios.addSubmit") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.portfolio__transformation_already_placed"));
  });

  it("portfolios list is read-only without portfolio.manage", async () => {
    mockApi(...p4Handlers(locale, [], [route("GET", /\/organizations\/[^/]+\/portfolios/, () => page([portfolio()]))]));
    renderApp(`/portfolios`, { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelector("[data-portfolio='PF-RETAIL']")).not.toBeNull());
    expect(document.querySelector("[data-action='create-portfolio']")).toBeNull();
    expect(screen.getByText(t("traceability.portfolios.readOnly"))).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------ RAG policy, chip

const policy = (over = {}) => ({
  organizationId: ORG_ID,
  policySource: "default",
  valueGapAmberRatio: null,
  valueGapRedRatio: null,
  milestoneSlipAmberWorkingDays: null,
  milestoneSlipRedWorkingDays: null,
  dependencyDueSoonWorkingDays: null,
  decisionDueSoonWorkingDays: null,
  topInitiativeCount: null,
  deadlineHorizonWorkingDays: null,
  note: null,
  effective: {
    valueGapAmberRatio: "0.05",
    valueGapRedRatio: "0.15",
    milestoneSlipAmberWorkingDays: 1,
    milestoneSlipRedWorkingDays: 10,
    dependencyDueSoonWorkingDays: 10,
    decisionDueSoonWorkingDays: 3,
    topInitiativeCount: 10,
    deadlineHorizonWorkingDays: 10,
  },
  version: 0,
  updatedAt: null,
  updatedBy: null,
  ...over,
});

describe.each(["en", "ar"] as const)("RAG policy and transformation chip (%s)", (locale) => {
  const t = createI18n(locale).t;

  it('first save of the default policy sends If-Match "0"; a stale save says nothing was saved', async () => {
    let puts = 0;
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        ["dashboard.configure"],
        [
          route("GET", /\/dashboard-rag-policy$/, () => json(policy())),
          route("PUT", /\/dashboard-rag-policy$/, () =>
            ++puts === 1
              ? json(policy({ version: 1, policySource: "configured", valueGapAmberRatio: "0.1" }))
              : problem(409, "version_conflict"),
          ),
        ],
      ),
    );
    renderApp(`/dashboards/rag-policy`, { i18n: createI18n(locale) });
    const input = (await el("[data-field='valueGapAmberRatio']")) as HTMLInputElement;
    expect(document.querySelector("[data-policy-version='0']")!.textContent).toContain(
      t("dashboards.ragPolicy.notConfigured"),
    );
    fireEvent.change(input, { target: { value: "0.1" } });
    fireEvent.click(screen.getByRole("button", { name: t("dashboards.ragPolicy.save") }));
    await waitFor(() => expect(requests.some((r) => r.method === "PUT")).toBe(true));
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"0"');
    expect(put.body).toEqual({ valueGapAmberRatio: "0.1" });
    await screen.findByText(t("dashboards.ragPolicy.saved"));
    // a second, stale save
    fireEvent.change(input, { target: { value: "0.12" } });
    fireEvent.click(screen.getByRole("button", { name: t("dashboards.ragPolicy.save") }));
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-state")).toBe("conflict");
    expect(alert.textContent).toContain(t("myWork.ui.conflictReloaded"));
  });

  it("an invalid ratio is caught before sending; a threshold-order refusal is translated", async () => {
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        ["dashboard.configure"],
        [
          route("GET", /\/dashboard-rag-policy$/, () => json(policy())),
          route("PUT", /\/dashboard-rag-policy$/, () => problem(422, "dashboard_rag_policy.threshold_order")),
        ],
      ),
    );
    renderApp(`/dashboards/rag-policy`, { i18n: createI18n(locale) });
    const input = (await el("[data-field='valueGapAmberRatio']")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: t("dashboards.ragPolicy.save") }));
    await screen.findByText(t("problems.validation__ratio_range"));
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
    fireEvent.change(input, { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: t("dashboards.ragPolicy.save") }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(t("problems.dashboard_rag_policy__threshold_order"));
  });

  it("is read-only without dashboard.configure", async () => {
    mockApi(...p4Handlers(locale, [], [route("GET", /\/dashboard-rag-policy$/, () => json(policy()))]));
    renderApp(`/dashboards/rag-policy`, { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelector("[data-field='valueGapAmberRatio']")).not.toBeNull());
    expect(screen.queryByRole("button", { name: t("dashboards.ragPolicy.save") })).toBeNull();
    expect(screen.getByText(t("dashboards.ragPolicy.readOnly"))).toBeTruthy();
  });

  it("the transformation chip is repeatable, offers readable transformations and sends each id", async () => {
    const OTHER_TR = u(800);
    const { requests } = mockApi(
      route("GET", /\/api\/v1\/me$/, () => json(makeMe(orgGrants([]), { preferredLocale: locale }))),
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", /\/api\/v1\/overview\?/, () => json(executiveOverview())),
          route("GET", /\/api\/v1\/transformations\?/, () =>
            page([
              { id: TR_ID, code: "TR-0001", name: "Synthetic retail journey", businessUnitId: null },
              { id: OTHER_TR, code: "TR-0002", name: "Synthetic network refresh", businessUnitId: null },
            ]),
          ),
        ],
      ),
    );
    renderApp(`/executive-overview?tr=${TR_ID}`, { i18n: createI18n(locale) });
    const select = (await waitFor(() => {
      const s = document.querySelector("[data-filter='transformation']") as HTMLSelectElement;
      expect(s.querySelector(`option[value='${OTHER_TR}']`)).not.toBeNull();
      return s;
    })) as HTMLSelectElement;
    // the chosen one is a chip, not offered again
    expect(select.querySelector(`option[value='${TR_ID}']`)).toBeNull();
    expect(document.querySelector(`[data-chip='tr'][data-chip-id='${TR_ID}']`)).not.toBeNull();
    expect(document.querySelector("[data-filter-scope='organization']")!.textContent).toContain(
      locale === "ar" ? "جهة اصطناعية" : "Synthetic Organization",
    );
    fireEvent.change(select, { target: { value: OTHER_TR } });
    await waitFor(() =>
      expect(
        requests.some((r) => {
          if (!r.url.startsWith("/api/v1/overview?")) return false;
          const ids = new URLSearchParams(r.url.split("?")[1]).getAll("transformationId");
          return ids.includes(TR_ID) && ids.includes(OTHER_TR);
        }),
      ).toBe(true),
    );
    // removing a chip removes only that id
    fireEvent.click(document.querySelector(`[data-chip='tr'][data-chip-id='${TR_ID}']`)!);
    await waitFor(() => expect(document.querySelector(`[data-chip='tr'][data-chip-id='${TR_ID}']`)).toBeNull());
    expect(document.querySelector(`[data-chip='tr'][data-chip-id='${OTHER_TR}']`)).not.toBeNull();
  });
});
