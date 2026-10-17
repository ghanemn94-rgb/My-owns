// The twelve extension-field hosts that FE-C3 typechecked but did not test (T-DG5-FE-D3; D-165; FE-C3 handback §9.3;
// REQ-S06-004; ADR-0041 §1, §4, §5), with STUBBED responses, in English (LTR) and Arabic (RTL). SYNTHETIC data;
// nothing here grants or records a G1-G6 business approval, and no DG0-DG7 label is shown.
// For each host, one test asserts that:
//  - the published extension field's input renders in the host's CREATE form (tom_canvas has no create path: its ten
//    cells exist from the transformation's creation, FE-C3 handback §2, so only its record view is asserted);
//  - the RECORD VIEW shows the stored value of an existing record;
//  - saving the value from the record's Form tools sends `PUT …/form-records/<type>/<id>/custom-fields` with the
//    custom-value row's `If-Match` (the create path's `If-Match: "0"` is FE-C2's and FE-C3's tests, on the same lines).
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import type { FormField, FormSchema } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, mockApi, problem, renderApp, route, type Handler } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers, page } from "../../pages/my-work/p4fixtures.ts";
import { baseline, canvasCell, charterView, evidence, valuePool } from "../../test/p2fixtures.ts";
import { HANDOVER_ID, handover } from "../../pages/adoption/adoptionFixtures.ts";
import { meeting } from "../../pages/meetings/governanceFixtures.ts";
import { correctiveCase } from "../../pages/raid/raidFixtures.ts";
import { initiative } from "../../pages/portfolio/p3fixtures.ts";
import { INI, roadmapView } from "../../pages/prioritization/fe-b.fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EVIDENCE_ID = "01920000-0000-7000-b000-0000000d3001";
const BASELINE_ID = "01920000-0000-7000-b000-0000000d3002";
const POOL_ID = "01920000-0000-7000-b000-0000000d3003";
const DEMAND_ID = "01920000-0000-7000-b000-0000000d3004";
const FUNDING_ID = "01920000-0000-7000-b000-0000000d3005";
const CR_ID = "01920000-0000-7000-b000-0000000d3006";
const MEETING_ID = "01920000-0000-7000-b000-0000000d3007";
const CASE_ID = "01920000-0000-7000-b000-0000000d3008";
const CONTROL_ID = "01920000-0000-7000-b000-0000000d3009";
const CHARTER_ID = "01920000-0000-7000-b000-0000000d300a";
const AREA_ID = "01920000-0000-7000-b000-0000000d300b";
const FSV = "01920000-0000-7000-9000-0000000f5d03";
const T0 = "2026-10-15T08:00:00Z";
const NO_DG = /\bDG[0-7]\b/;
const KEY = "qa_d3_score";
const LABEL = { en: "Synthetic D3 score", ar: "درجة تجريبية D3" } as const;

const field = (): FormField => ({
  key: KEY,
  origin: "admin",
  protected: false,
  extension: true,
  fieldType: "number",
  labelEn: LABEL.en,
  labelAr: LABEL.ar,
  helpEn: null,
  helpAr: null,
  required: false,
  bulkEditable: false,
  storageKind: null,
  sourceRef: null,
  ordinal: null,
  settings: { min: "0", max: "100" },
});

const schemaOf = (code: string, writePermission: string): FormSchema => ({
  recordType: {
    code,
    ordinal: 30,
    kind: "extension",
    titleEn: code,
    titleAr: code,
    titleArProvisional: true,
    sourceRef: "M0149",
    writePermission,
    extensionBadge: true,
    customFieldsAllowed: true,
    bulkEditAllowed: false,
    featureStatus: "working",
  },
  formSchemaVersionId: FSV,
  versionNo: 2,
  labelEn: code,
  labelAr: code,
  helpEn: null,
  helpAr: null,
  fields: [field()],
});

const custom = (recordType: string, recordId: string, version: number, value: string) => ({
  recordType,
  recordId,
  formSchemaVersionId: FSV,
  values: { [KEY]: value },
  calculated: {},
  version,
  updatedAt: T0,
  updatedBy: USER_ID,
});

const list = (resource: string, items: unknown[]) =>
  route("GET", new RegExp(`${esc(TRP)}/${resource}(\\?.*)?$`), () => page(items));
const audit = { createdAt: T0, createdBy: USER_ID, updatedAt: T0, updatedBy: USER_ID };

// One existing record per host (synthetic). Shapes follow the @mth/shared mirrors; fields a screen does not read are
// omitted only where the fixture builders of the host's own tests omit them too.
const SELECTED = initiative({ code: "INI-02", name: "Synthetic selected initiative", status: "selected" });
const CELLS = Array.from({ length: 10 }, (_, i) => canvasCell(i));
const CELL = CELLS[0]!;
const DEMAND = {
  id: DEMAND_ID,
  transformationId: TR_ID,
  initiativeId: INI(1),
  resourceRoleId: "01920000-0000-7000-aa00-000000000001",
  periodMonth: "2026-11-01",
  demandFte: "2.50",
  ownerUserId: null,
  note: null,
  status: "planned",
  committedBy: null,
  committedAt: null,
  version: 7,
};
const FUNDING = {
  id: FUNDING_ID,
  organizationId: "o",
  transformationId: TR_ID,
  initiativeId: SELECTED.id,
  decisionId: "01920000-0000-7000-b000-0000000d300c",
  decisionCode: "DEC-07",
  outcome: "approved",
  amount: null,
  currency: "SAR",
  fundingSource: null,
  conditions: null,
  rationale: "Synthetic: approved in the funding committee",
  businessCaseId: null,
  approverRoleCode: "FIN",
  decidedBy: USER_ID,
  onBehalfOfUserId: null,
  decidedAt: T0,
};
const CHANGE_REQUEST = {
  id: CR_ID,
  transformationId: TR_ID,
  code: "CR-01",
  changeKind: "schedule_rebaseline",
  subjectType: "milestone",
  subjectId: "01920000-0000-7000-b000-0000000d300d",
  subjectVersion: 3,
  proposedRecordType: null,
  proposedRecordId: null,
  proposedChange: { approvedDate: { from: "2026-11-30", to: "2027-01-29" } },
  reason: "Synthetic: the vendor moved the cut-over.",
  origin: "manual",
  materiality: null,
  materialityBasis: null,
  routePartyCode: null,
  decisionRightId: null,
  approvalId: null,
  status: "draft",
  raisedBy: USER_ID,
  submittedBy: null,
  submittedAt: null,
  currentImpactAssessmentId: null,
  decidedAt: null,
  appliedAt: null,
  appliedRecordType: null,
  appliedRecordId: null,
  appliedVersion: null,
  withdrawnAt: null,
  version: 1,
  ...audit,
};
const CONTROL = {
  id: CONTROL_ID,
  transformationId: TR_ID,
  performanceAreaId: AREA_ID,
  code: "CTL-01",
  name: "Synthetic control",
  description: null,
  ownerUserId: USER_ID,
  frequency: "monthly",
  frequencyInterval: 1,
  nextCheckDate: "2026-11-01",
  status: "active",
  retiredAt: null,
  retireReason: null,
  version: 2,
  ...audit,
};

const CF = (recordType: string, id: string) => `${TRP}/form-records/${recordType}/${id}/custom-fields`;

type T = ReturnType<typeof createI18n>["t"];
interface Host {
  /** The form record type code (ADR-0041 §1). */
  readonly type: string;
  /** The record type's write permission, and any read permission the screen needs. */
  readonly writePermission: string;
  readonly permissions: Permission[];
  /** The screen that shows the record view (and, unless `createPath` says otherwise, the create form). */
  readonly path: string;
  /** Where the create form is, when it is on another screen than the record view. */
  readonly createPath?: string;
  /** The register's own routes, with one existing record whose id is `recordId`. */
  readonly routes: Handler[];
  /** Routes for the create screen when it differs (e.g. the charter, before one exists). */
  readonly createRoutes?: Handler[];
  readonly recordId: string;
  /** Opens the create form and returns its root (a dialog or the inline form). Absent: no create path. */
  readonly openCreate?: (t: T) => Promise<HTMLElement>;
  /** Navigates to the record view inside the screen, if it is not shown at once. */
  readonly openRecord?: (t: T) => Promise<void>;
}

const el = (selector: string, root: ParentNode = document) =>
  waitFor(
    () => {
      const e = root.querySelector(selector);
      expect(e, selector).toBeTruthy();
      return e as HTMLElement;
    },
    { timeout: 5000 },
  );
const clickButton = async (name: string | RegExp) => {
  fireEvent.click(await screen.findByRole("button", { name }, { timeout: 5000 }));
};
const dialog = () => screen.findByRole("dialog", {}, { timeout: 5000 });

function harness(host: Host, locale: "en" | "ar", extra: Handler[] = [], routes: Handler[] = host.routes) {
  return mockApi(
    ...p4Handlers(locale, [...host.permissions, host.writePermission, "form_record.comment"] as Permission[], [
      route("GET", new RegExp(`${esc(TRP)}/form-schemas/${host.type}$`), () =>
        json(schemaOf(host.type, host.writePermission)),
      ),
      route("GET", new RegExp(`${esc(CF(host.type, host.recordId))}$`), () =>
        json(custom(host.type, host.recordId, 1, "42")),
      ),
      route("GET", new RegExp(`${esc(TRP)}/form-drafts\\?`), () => page([])),
      ...extra,
      ...routes,
    ]),
  );
}

const HOSTS: Host[] = [
  {
    type: "evidence",
    writePermission: "evidence.create",
    permissions: ["evidence.read" as Permission],
    path: `/transformations/${TR_ID}/evidence`,
    routes: [route("GET", new RegExp(`${esc(TRP)}/evidence\\?`), () => page([evidence({ id: EVIDENCE_ID })]))],
    recordId: EVIDENCE_ID,
    openCreate: async (t) => {
      await clickButton(new RegExp(t("evidence.addKind.note")));
      return dialog();
    },
  },
  {
    type: "baseline",
    writePermission: "baseline.edit",
    permissions: [],
    path: `/transformations/${TR_ID}/diagnose`,
    routes: [list("baselines", [baseline({ id: BASELINE_ID })])],
    recordId: BASELINE_ID,
    openCreate: async (t) => {
      await clickButton(new RegExp(t("kpi.baseline.add")));
      return dialog();
    },
  },
  {
    type: "value_pool",
    writePermission: "diagnostic.edit",
    permissions: [],
    path: `/transformations/${TR_ID}/diagnose`,
    routes: [list("value-pools", [valuePool({ id: POOL_ID })])],
    recordId: POOL_ID,
    openCreate: async (t) => {
      await clickButton(new RegExp(t("kpi.valuePool.add")));
      return dialog();
    },
  },
  {
    type: "resource_plan",
    writePermission: "capacity.edit",
    permissions: [],
    path: `/transformations/${TR_ID}/capacity`,
    routes: [
      route("GET", new RegExp(`${esc(TRP)}/capacity-plan`), () =>
        json({
          transformationId: TR_ID,
          roles: [
            {
              id: DEMAND.resourceRoleId,
              code: "data_engineer",
              labelEn: "Data engineer",
              labelAr: "مهندس بيانات",
              status: "active",
              version: 1,
            },
          ],
          cells: [],
        }),
      ),
      route("GET", /\/api\/v1\/resource-demands\?/, () => page([DEMAND])),
      route("GET", new RegExp(`${esc(TRP)}/roadmap$`), () => json(roadmapView())),
    ],
    recordId: DEMAND_ID,
    openCreate: async (t) => {
      await clickButton(new RegExp(t("capacity.demands.add")));
      return dialog();
    },
  },
  {
    type: "funding_approval",
    writePermission: "funding.approve",
    permissions: ["initiative.edit" as Permission],
    path: `/transformations/${TR_ID}/initiatives/${SELECTED.id}`,
    routes: [
      route("GET", new RegExp(`/api/v1/initiatives/${SELECTED.id}$`), () => json(SELECTED)),
      route("GET", new RegExp(`/api/v1/initiatives/${SELECTED.id}/deliverables`), () =>
        json({ items: [], countWarning: null }),
      ),
      route("GET", new RegExp(`/api/v1/initiatives/${SELECTED.id}/milestones`), () => json({ items: [] })),
      route("GET", /\/api\/v1\/funding-decisions\?/, () => page([FUNDING])),
    ],
    recordId: FUNDING_ID,
    openCreate: async () => {
      fireEvent.click(await el("[data-action='record-funding']"));
      return dialog();
    },
  },
  {
    type: "change_request",
    writePermission: "change_request.raise",
    permissions: [],
    path: `/transformations/${TR_ID}/change-requests`,
    routes: [list("change-requests", [CHANGE_REQUEST])],
    recordId: CR_ID,
    openCreate: async () => {
      fireEvent.click(await el("[data-action='raise-change-request']"));
      return dialog();
    },
  },
  {
    type: "meeting_record",
    writePermission: "meeting.prepare",
    permissions: [],
    path: `/transformations/${TR_ID}/meetings`,
    routes: [list("meetings", [meeting({ id: MEETING_ID })])],
    recordId: MEETING_ID,
    openCreate: async (t) => {
      await clickButton(new RegExp(t("governanceP4.meetings.create")));
      return dialog();
    },
  },
  {
    type: "corrective_plan",
    writePermission: "corrective_action.manage",
    permissions: [],
    path: `/transformations/${TR_ID}/corrective-actions`,
    routes: [list("corrective-actions", [correctiveCase({ id: CASE_ID })])],
    recordId: CASE_ID,
    openCreate: async (t) => {
      await clickButton(new RegExp(t("raidP4.corrective.create")));
      return dialog();
    },
  },
  {
    type: "bau_handover",
    writePermission: "bau_handover.prepare",
    permissions: [],
    path: `/transformations/${TR_ID}/bau-handovers`,
    routes: [list("bau-handovers", [handover()])],
    recordId: HANDOVER_ID,
    openCreate: async (t) => {
      await clickButton(new RegExp(t("sustainP4.handover.create")));
      return dialog();
    },
  },
  {
    type: "control",
    writePermission: "control.manage",
    permissions: [],
    path: `/transformations/${TR_ID}/bau-controls`,
    routes: [list("controls", [CONTROL])],
    recordId: CONTROL_ID,
    openCreate: async (t) => {
      await clickButton(new RegExp(t("sustainP4.controls.create")));
      return dialog();
    },
  },
  {
    type: "charter",
    writePermission: "charter.edit",
    permissions: [],
    path: `/transformations/${TR_ID}/charter`,
    // Before a charter exists the screen offers its create form; after, the record view.
    createRoutes: [route("GET", new RegExp(`${esc(TRP)}/charter$`), () => problem(404, "charter_not_found"))],
    routes: [route("GET", new RegExp(`${esc(TRP)}/charter$`), () => json(charterView({ id: CHARTER_ID })))],
    recordId: CHARTER_ID,
    openCreate: async (t) => {
      await clickButton(new RegExp(t("define.charter.create")));
      return el("#charter-form");
    },
  },
  {
    // No create path (FE-C3 handback §2): the ten cells exist from the transformation's creation.
    type: "tom_canvas",
    writePermission: "tom.edit",
    permissions: [],
    path: `/transformations/${TR_ID}/design`,
    routes: [route("GET", new RegExp(`${esc(TRP)}/tom-canvas$`), () => json({ cells: CELLS }))],
    recordId: CELL.cell.id,
    openRecord: async () => {
      fireEvent.click(
        await el(`[data-dimension='${CELL.cell.dimensionCode}'] button[aria-controls='tom-dimension-view']`),
      );
    },
  },
];

describe.each(["en", "ar"] as const)("extension fields on the twelve FE-C3 hosts (%s)", (locale) => {
  const t = createI18n(locale).t;
  for (const host of HOSTS) {
    it(`${host.type}: the input renders in the create form and the record view; Form tools saves with If-Match`, async () => {
      // 1. The create form offers the published extension field, labelled in the screen's language.
      if (host.openCreate) {
        harness(host, locale, [], host.createRoutes ?? host.routes);
        renderApp(host.createPath ?? host.path, { i18n: createI18n(locale) });
        const form = await host.openCreate(t);
        const input = (await el(
          `[data-extension-create='${host.type}'] [data-extension-field='${KEY}'] input`,
          form,
        )) as HTMLInputElement;
        expect(within(form).getByLabelText(LABEL[locale])).toBe(input);
        expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
        cleanup();
      }

      // 2. The record view shows the stored value; 3. Form tools saves it with the custom-value row's If-Match.
      const { requests } = harness(host, locale, [
        route("PUT", new RegExp(`${esc(CF(host.type, host.recordId))}$`), () =>
          json(custom(host.type, host.recordId, 2, "60")),
        ),
      ]);
      renderApp(host.path, { i18n: createI18n(locale) });
      if (host.openRecord) await host.openRecord(t);
      const view = await el(
        `[data-extension-values='${host.type}'][data-record-id='${host.recordId}'] [data-extension-value='${KEY}']`,
      );
      await waitFor(() => expect(view.textContent).toContain("42"));
      expect(view.textContent).toContain(LABEL[locale]);
      fireEvent.click(await el(`[data-form-tools='${host.recordId}']`));
      const ff = await el(`[data-form-framework='${host.type}']`);
      const input = () => ff.querySelector(`[data-extension-field='${KEY}'] input`) as HTMLInputElement | null;
      await waitFor(() => expect(input()?.value).toBe("42"));
      fireEvent.change(input()!, { target: { value: "60" } });
      fireEvent.click(within(ff).getByRole("button", { name: t("forms.edit.save") }));
      await waitFor(() => expect(requests.filter((r) => r.method === "PUT")).toHaveLength(1));
      const put = requests.find((r) => r.method === "PUT")!;
      expect(put.url).toContain(`/form-records/${host.type}/${host.recordId}/custom-fields`);
      expect(put.headers["if-match"]).toBe('"1"');
      expect(put.body).toEqual({ values: { [KEY]: "60" } });
      expect(document.body.textContent).not.toMatch(NO_DG);
    });
  }
});
