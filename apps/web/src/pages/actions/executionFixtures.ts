// SYNTHETIC fixtures of the slice E execution panels (T-DG4-FE-D2). No real initiative, person, amount or plan.
// Shapes follow the OpenAPI 1.3.0-p4 schemas BudgetLine, InitiativeExecution and ScheduleNetwork (each fixture is
// parsed with the shared zod mirror in the tests). The network is the ADR-0031 §8 fixture:
// INI-01 (5) → INI-02 (10) → INI-04 (3); INI-01 → INI-03 (4) → INI-04; P = 18; INI-03 has total float 6.
import type { Permission } from "@mth/shared";
import type { BudgetLine, InitiativeExecution, ScheduleNetwork } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, mockApi, renderApp, route, type Handler } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers, page } from "../my-work/p4fixtures.ts";
import { initiative } from "../portfolio/p3fixtures.ts";

export const T0 = "2026-10-01T09:00:00Z";
export const INI_1 = "01920000-0000-7000-b000-000000000001";
export const INI_2 = "01920000-0000-7000-b000-000000000002";
export const INI_3 = "01920000-0000-7000-b000-000000000003";
export const INI_4 = "01920000-0000-7000-b000-000000000004";
export const LINE_ID = "01920000-0000-7000-b000-000000000101";
export const LINE_USD = "01920000-0000-7000-b000-000000000102";

/** The initiative whose page is rendered (INI-02, on the critical path of the fixture network). */
export const THIS_INITIATIVE = initiative({
  id: INI_2,
  code: "INI-02",
  name: "Synthetic billing platform",
  status: "launched",
});

export function budgetLine(over: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: LINE_ID,
    transformationId: TR_ID,
    initiativeId: INI_2,
    label: "Synthetic vendor licences",
    periodMonth: null,
    currency: "SAR",
    budgetAmount: "100000.0000",
    actualAmount: "0.1000",
    forecastAmount: null,
    ownerUserId: USER_ID,
    note: null,
    status: "active",
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    version: 3,
    createdAt: T0,
    createdBy: USER_ID,
    updatedAt: T0,
    updatedBy: USER_ID,
    ...over,
  };
}

const known = (amount: string) => ({
  status: "known" as const,
  amount,
  knownAmount: amount,
  missingCount: 0,
  reason: null,
});
const unknown = (knownAmount: string | null, missingCount: number) => ({
  status: "unknown" as const,
  amount: null,
  knownAmount,
  missingCount,
  reason: "missing_amounts",
});

export function execution(over: Partial<InitiativeExecution> = {}): InitiativeExecution {
  return {
    initiativeId: INI_2,
    calendarId: "01920000-0000-7000-b000-000000000201",
    milestones: [
      {
        milestoneId: "01920000-0000-7000-b000-000000000301",
        title: "Synthetic design sign-off",
        approvedDate: "2026-10-08",
        forecastDate: "2026-10-15",
        status: "planned",
        calendarVarianceDays: 7,
        slipWorkingDays: { status: "known", value: 5, reason: null },
      },
      {
        milestoneId: "01920000-0000-7000-b000-000000000302",
        title: "Synthetic pilot launch",
        approvedDate: "2026-10-15",
        forecastDate: "2026-10-08",
        status: "planned",
        calendarVarianceDays: -7,
        slipWorkingDays: { status: "known", value: -5, reason: null },
      },
      {
        milestoneId: "01920000-0000-7000-b000-000000000303",
        title: "Synthetic data migration",
        approvedDate: "2026-11-01",
        forecastDate: null,
        status: "planned",
        calendarVarianceDays: null,
        slipWorkingDays: { status: "unknown", value: null, reason: "forecast_date_missing" },
      },
      {
        milestoneId: "01920000-0000-7000-b000-000000000304",
        title: "Synthetic go-live",
        approvedDate: "2026-12-01",
        forecastDate: "2026-12-01",
        status: "planned",
        calendarVarianceDays: 0,
        slipWorkingDays: { status: "known", value: 0, reason: null },
      },
    ],
    deliverables: [
      {
        deliverableId: "01920000-0000-7000-b000-000000000401",
        title: "Synthetic billing API",
        dueDate: "2026-11-15",
        acceptanceStatus: "submitted",
      },
    ],
    budgetLineCount: 2,
    budgetUnknownReason: null,
    budgetTotals: [
      {
        currency: "SAR",
        budget: known("100000.3000"),
        actual: known("0.3000"),
        forecast: unknown("2500.0000", 1),
        forecastVariance: unknown(null, 1),
        actualVariance: known("-100000.0000"),
      },
      {
        currency: "USD",
        budget: known("500.0000"),
        actual: unknown(null, 1),
        forecast: known("450.0000"),
        forecastVariance: known("-50.0000"),
        actualVariance: unknown(null, 1),
      },
    ],
    demand: [
      {
        resourceDemandId: "01920000-0000-7000-b000-000000000501",
        resourceRoleId: "01920000-0000-7000-b000-000000000601",
        periodMonth: "2026-11-01",
        demandFte: "1.50",
        status: "planned",
        availableFte: null,
        capacityStatus: "unknown",
      },
    ],
    dependencies: [
      {
        dependencyId: "01920000-0000-7000-b000-000000000701",
        code: "DEP-01",
        direction: "incoming",
        status: "open",
        neededBy: "2026-11-01",
        impact: null,
      },
    ],
    decisions: [
      {
        decisionId: "01920000-0000-7000-b000-000000000801",
        code: "D-01",
        kind: "design",
        status: "decided",
        title: "Synthetic billing vendor choice",
      },
    ],
    onCriticalPath: true,
    ...over,
  };
}

/** No active line: no totals and the reason, never a total of 0 (ADR-0031 §7). */
export const NO_LINES = execution({ budgetLineCount: 0, budgetTotals: [], budgetUnknownReason: "no_budget_lines" });

const node = (
  initiativeId: string,
  code: string,
  d: number | null,
  o: [number, number, number, number, number] | null,
  critical: boolean | null,
) => ({
  initiativeId,
  code,
  name: `Synthetic initiative ${code}`,
  durationWorkingDays: d,
  earliestStart: o?.[0] ?? null,
  earliestFinish: o?.[1] ?? null,
  latestStart: o?.[2] ?? null,
  latestFinish: o?.[3] ?? null,
  totalFloat: o?.[4] ?? null,
  critical,
});

const edge = (n: string, from: string, to: string, critical: boolean | null) => ({
  dependencyId: `01920000-0000-7000-b000-0000000009${n}`,
  code: `DEP-${n}`,
  fromInitiativeId: from,
  toInitiativeId: to,
  critical,
});

export const NETWORK_COMPUTED: ScheduleNetwork = {
  transformationId: TR_ID,
  algorithm: "cpm-fs/1",
  status: "computed",
  reason: null,
  projectDurationWorkingDays: 18,
  missingDurations: [],
  nodes: [
    node(INI_1, "INI-01", 5, [0, 5, 0, 5, 0], true),
    node(INI_2, "INI-02", 10, [5, 15, 5, 15, 0], true),
    node(INI_3, "INI-03", 4, [5, 9, 11, 15, 6], false),
    node(INI_4, "INI-04", 3, [15, 18, 15, 18, 0], true),
  ],
  edges: [
    edge("01", INI_1, INI_2, true),
    edge("02", INI_2, INI_4, true),
    edge("03", INI_1, INI_3, false),
    edge("04", INI_3, INI_4, false),
  ],
  criticalPaths: [[INI_1, INI_2, INI_4]],
  truncated: false,
};

/** INI-03's duration removed: not computable, INI-03 listed, nothing critical (ADR-0031 §8). */
export const NETWORK_MISSING: ScheduleNetwork = {
  ...NETWORK_COMPUTED,
  status: "not_computable",
  reason: "missing_durations",
  projectDurationWorkingDays: null,
  missingDurations: [{ initiativeId: INI_3, code: "INI-03", name: "Synthetic initiative INI-03" }],
  nodes: [
    node(INI_1, "INI-01", 5, null, null),
    node(INI_2, "INI-02", 10, null, null),
    node(INI_3, "INI-03", null, null, null),
    node(INI_4, "INI-04", 3, null, null),
  ],
  edges: NETWORK_COMPUTED.edges.map((e) => ({ ...e, critical: null })),
  criticalPaths: [],
};

// ------------------------------------------------------------------------------------------------ rendering

/** Renders INI-02's initiative page with the workspace frame, the slice E reads and `extra` handlers first. */
export function renderInitiative(
  locale: "en" | "ar",
  permissions: Permission[],
  extra: Handler[] = [],
  reads: { execution?: InitiativeExecution; network?: ScheduleNetwork; lines?: BudgetLine[] } = {},
) {
  const api = mockApi(
    ...p4Handlers(locale, permissions, [
      ...extra,
      route("GET", new RegExp(`/api/v1/initiatives/${INI_2}$`), () => json(THIS_INITIATIVE)),
      route("GET", new RegExp(`/api/v1/initiatives/${INI_2}/deliverables`), () =>
        json({ items: [], countWarning: { code: "initiative.deliverable_count", message: "x" } }),
      ),
      route("GET", new RegExp(`/api/v1/initiatives/${INI_2}/execution$`), () => json(reads.execution ?? execution())),
      route("GET", new RegExp(`/api/v1/initiatives/${INI_2}/budget-lines\\?(.*&)?status=active`), () =>
        page(reads.lines ?? [budgetLine()]),
      ),
      route("GET", new RegExp(`${esc(TRP)}/schedule-network$`), () => json(reads.network ?? NETWORK_COMPUTED)),
    ]),
  );
  renderApp(`/transformations/${TR_ID}/initiatives/${INI_2}`, { i18n: createI18n(locale) });
  return api;
}
