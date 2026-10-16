// FE-E screens (T-DG5-FE-E; slice F) with STUBBED responses, in English (LTR) and Arabic (RTL). The live paths against
// the real API are e2e/p5-reports-exports.spec.ts. SYNTHETIC data; nothing here is a business approval.
//  - REQ-S13-007 / S13-008: a generated snapshot says "Draft — not an issued report"; a provisional value carries
//    "Provisional"/"مؤقت"; an Unknown or Stale value shows its label and NO number (never 0); content labels come from
//    the shared export table; issue sends If-Match; 409 report_snapshot.series_changed is translated; an issued
//    snapshot offers the reissue (reason required) and the superseded v1 keeps its content.
//  - REQ-S13-004: generate posts the chosen output with its register filters and opens the snapshot.
//  - REQ-S13-005: the export form offers only the output's formats and sends an Idempotency-Key; the exports list
//    shows progress, a failed job's translated error code, and cancel with If-Match (422 not_cancellable translated).
//  - REQ-S09-011: a subject without an update shows "No update submitted"; writing creates then submits with If-Match;
//    403 owner_update.not_owner is translated; a saved draft is labelled as not submitted.
//  - REQ-S10-013: the presentation is live by default; a snapshot of another meeting is the translated 422.
//  - REQ-S13-010: a file shows SHA-256 and v1, and its versions list; a note shows "No checksum" and "Not stated".
//  - Problem texts: every refusal row of ADR-0045 §11 and ADR-0046 §8 (and the four job error codes) has its exact
//    English text and an Arabic text that differs.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { REPORT_CONTENT_LABELS } from "@mth/shared";
import { catalogues, createI18n } from "../../i18n/index.ts";
import { problemText } from "../../lib/problem.ts";
import { ORG_ID, TR_ID, makeMe, makeTransformation, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const en = catalogues.en.reportsP5;
const ar = catalogues.ar.reportsP5;
const grants = (permissions: Permission[]) => [
  { scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: false, permissions },
];
const meRoute = (permissions: Permission[], locale: "en" | "ar" = "en") =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe(grants(permissions), { preferredLocale: locale }),
  }));
const ok = (body: unknown) => () => ({ status: 200, body });
const found = (selector: string) =>
  waitFor(() => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`not found: ${selector}`);
    return el as HTMLElement;
  });
const trRoute = route("GET", new RegExp(`/transformations/${TR_ID}$`), ok(makeTransformation()));
const usersRoute = route("GET", /\/api\/v1\/users/, ok({ items: [], nextCursor: null }));

const SNAP = "01920000-0000-7000-9000-00000000a001";
const SNAP2 = "01920000-0000-7000-9000-00000000a002";
const MEETING = "01920000-0000-7000-9000-00000000b001";
const WS = "01920000-0000-7000-9000-00000000c001";
const USER = "01920000-0000-7000-9000-000000000203";
const UUIDX = (n: number) => `01920000-0000-7000-9000-${String(n).padStart(12, "0")}`;
const HASH = "a".repeat(64);

const DEFINITIONS = {
  items: [
    {
      code: "registers",
      ordinal: 6,
      outputKind: "generated_output",
      subjectType: "transformation",
      needsReportingPeriod: false,
      formats: ["xlsx", "csv", "pdf"],
      labelEn: "Registers",
      labelAr: "السجلات",
      descriptionEn: "A register of the transformation.",
      descriptionAr: "سجل من سجلات التحول.",
      sourceRef: "M0253",
      playbookRef: "B0122",
    },
    {
      code: "meeting_pack",
      ordinal: 12,
      outputKind: "meeting_pack",
      subjectType: "meeting",
      needsReportingPeriod: false,
      formats: ["pdf", "pptx"],
      labelEn: "Meeting pack",
      labelAr: "حزمة الاجتماع",
      descriptionEn: "The meeting pack.",
      descriptionAr: "حزمة الاجتماع.",
      sourceRef: "M0212",
      playbookRef: "B0093",
    },
  ],
};

const dec = (value: string | null, validation: string, reason: string | null = null) => ({
  type: "decimal",
  value,
  unitKind: "currency",
  currency: value === null ? null : "SAR",
  valueBasis: "submitted",
  validation,
  reason,
});

function doc(definitionCode = "registers") {
  return {
    schemaVersion: 1,
    definitionCode,
    transformation: { id: TR_ID, code: "TR-0001", name: "Synthetic transformation" },
    subject: { type: "transformation", id: TR_ID, code: "TR-0001", label: "Synthetic transformation" },
    period: null,
    asOf: "2026-10-16T09:00:00Z",
    methodology: { versionId: UUIDX(901), key: "playbook", versionNo: 1 },
    approvalState: "mixed",
    sections: [
      {
        key: "benefits",
        titleKey: "report.registers.benefits.title",
        kind: "table",
        sources: [],
        columns: [
          { key: "title", labelKey: "report.registers.benefits.title", valueKind: "text", unitKind: null },
          { key: "pending", labelKey: "report.registers.benefits.pending", valueKind: "decimal", unitKind: "currency" },
        ],
        rows: [
          {
            recordType: "benefit",
            recordId: UUIDX(801),
            recordVersion: 3,
            cells: [
              {
                type: "text",
                value: "Synthetic pending benefit",
                authored: "user",
                validation: "not_applicable",
                reason: null,
              },
              dec("1250000", "provisional"),
            ],
          },
          {
            recordType: "benefit",
            recordId: UUIDX(802),
            recordVersion: 1,
            cells: [
              {
                type: "text",
                value: "Synthetic unknown benefit",
                authored: "user",
                validation: "not_applicable",
                reason: null,
              },
              dec(null, "unknown", "missing"),
            ],
          },
          {
            recordType: "benefit",
            recordId: UUIDX(803),
            recordVersion: 1,
            cells: [
              {
                type: "text",
                value: "Synthetic stale benefit",
                authored: "user",
                validation: "not_applicable",
                reason: null,
              },
              dec(null, "stale", "stale"),
            ],
          },
        ],
        totals: [],
        emptyKey: null,
      },
      {
        key: "raid",
        titleKey: "report.registers.raid.title",
        kind: "table",
        sources: [],
        columns: [{ key: "title", labelKey: "report.registers.raid.title", valueKind: "text", unitKind: null }],
        rows: [],
        totals: [],
        emptyKey: "report.empty.no_records",
      },
    ],
  };
}

function snapshot(over: Record<string, unknown> = {}) {
  return {
    id: SNAP,
    transformationId: TR_ID,
    definitionCode: "registers",
    subjectType: "transformation",
    subjectId: TR_ID,
    reportingPeriodId: null,
    periodLabel: null,
    periodStart: null,
    periodEnd: null,
    asOf: "2026-10-16T09:00:00Z",
    methodologyVersionId: UUIDX(901),
    approvalState: "mixed",
    provisionalValueCount: 1,
    unknownValueCount: 2,
    contentSha256: HASH,
    seriesId: UUIDX(700),
    reissueOfId: null,
    reissueReason: null,
    status: "generated",
    issueVersion: null,
    issuedAt: null,
    issuedBy: null,
    issueNote: null,
    supersededAt: null,
    supersededById: null,
    discardedAt: null,
    discardedBy: null,
    discardReason: null,
    version: 1,
    createdAt: "2026-10-16T09:00:00Z",
    createdBy: USER,
    parameters: { register: "benefits", filters: {} },
    content: doc(),
    ...over,
  };
}

const page = (items: unknown[]) => ({ items, nextCursor: null });
const snapshotRoutes = (s: unknown) => [
  route("GET", new RegExp(`/report-snapshots/${SNAP}$`), ok(s)),
  route("GET", /\/sources/, ok(page([]))),
  route(
    "GET",
    /\/report-snapshots\/[^/]+\/versions/,
    ok({
      items: [{ versionKind: "calculation_engine", referenceId: null, referenceKey: "formula", versionLabel: "1.0.0" }],
    }),
  ),
  route("GET", /\/report-snapshots\/[^/]+\/evidence/, ok(page([]))),
  route("GET", /\/report-definitions/, ok(DEFINITIONS)),
  route("GET", /\/api\/v1\/exports/, ok(page([]))),
  trRoute,
  usersRoute,
];

describe("REQ-S13-007 / S13-008: one snapshot", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`${locale}: draft banner, Provisional label, Unknown and Stale without a number, shared content labels`, async () => {
      mockApi(
        meRoute(["transformation.read", "report.generate", "report.issue", "export.create"], locale),
        ...snapshotRoutes(snapshot()),
      );
      renderApp(`/transformations/${TR_ID}/reports/${SNAP}`, { i18n: createI18n(locale) });
      const c = locale === "en" ? en : ar;
      expect(await screen.findByRole("heading", { level: 1, name: c.snapshot.title })).toBeTruthy();
      expect((await found("[data-state='draft-not-issued']")).textContent).toContain(c.snapshot.draftBanner);
      const table = await found("[data-report-table='benefits']");
      // The column heading is the shared export label table's text in this language.
      expect(within(table).getByText(REPORT_CONTENT_LABELS[locale]["report.registers.benefits.pending"]!)).toBeTruthy();
      const rows = table.querySelectorAll("tbody tr");
      expect(rows[0]!.querySelector("[data-status='provisional']")!.textContent).toContain(c.validation.provisional);
      expect(c.validation.provisional).toBe(locale === "en" ? "Provisional" : "مؤقت");
      const unknown = rows[1]!.querySelector("[data-validation='unknown']")!;
      expect(unknown.textContent).toContain(c.validation.unknown);
      expect(unknown.textContent).not.toMatch(/\d/);
      const stale = rows[2]!.querySelector("[data-validation='stale']")!;
      expect(stale.textContent).toContain(c.validation.stale);
      expect(stale.textContent).not.toMatch(/\d/);
      // Never a green chip for a value without a number.
      expect(table.querySelectorAll(".status-chip--on-track").length).toBe(0);
      expect(document.querySelector("[data-legend='validation']")).toBeTruthy();
      // An empty section's frame key is never shown raw: it is "No records" in the screen's language.
      expect((await found("[data-empty-table='raid']")).textContent).toBe(c.noRecords);
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    });
  }

  it("issue sends If-Match; the 409 series_changed is translated and stays visible after the reload", async () => {
    let refused = false;
    const { requests } = mockApi(
      meRoute(["transformation.read", "report.generate", "report.issue", "export.create"]),
      route("POST", /\/issue$/, () => {
        refused = true;
        return problem(409, "report_snapshot.series_changed");
      }),
      // After the refusal the reload finds the snapshot issued meanwhile (by someone else).
      route("GET", new RegExp(`/report-snapshots/${SNAP}$`), () =>
        refused
          ? {
              status: 200,
              body: snapshot({
                status: "issued",
                issueVersion: 1,
                issuedAt: "2026-10-16T10:00:00Z",
                issuedBy: USER,
                version: 2,
              }),
            }
          : undefined,
      ),
      ...snapshotRoutes(snapshot()),
    );
    renderApp(`/transformations/${TR_ID}/reports/${SNAP}`, { i18n: createI18n("en") });
    const form = await found("form[data-form='issue-snapshot']");
    fireEvent.click(within(form).getByRole("button", { name: en.snapshot.issue }));
    await found("form[data-form='reissue-snapshot']");
    const alert = await found("[data-snapshot-actions='issued'] [role='alert']");
    expect(alert.textContent).toContain(catalogues.en.problems.report_snapshot__series_changed);
    const issue = requests.find((r) => r.method === "POST" && r.url.endsWith("/issue"))!;
    expect(issue.headers["if-match"]).toBe('"1"');
  });

  it("an issued snapshot offers the reissue (a reason is required) and opens the new snapshot", async () => {
    const issued = snapshot({
      status: "issued",
      issueVersion: 1,
      issuedAt: "2026-10-16T10:00:00Z",
      issuedBy: USER,
      version: 2,
    });
    const { requests } = mockApi(
      meRoute(["transformation.read", "report.generate", "report.issue", "export.create"]),
      route("POST", /\/reissue$/, () => ({
        status: 201,
        body: snapshot({ id: SNAP2, reissueOfId: SNAP, reissueReason: "KPI restated" }),
      })),
      route(
        "GET",
        new RegExp(`/report-snapshots/${SNAP2}$`),
        ok(snapshot({ id: SNAP2, reissueOfId: SNAP, reissueReason: "KPI restated" })),
      ),
      ...snapshotRoutes(issued),
    );
    renderApp(`/transformations/${TR_ID}/reports/${SNAP}`, { i18n: createI18n("en") });
    expect((await found("[data-issue-version='1']")).textContent).toContain("v1");
    expect(document.querySelector("form[data-form='issue-snapshot']")).toBeNull();
    const form = await found("form[data-form='reissue-snapshot']");
    fireEvent.click(within(form).getByRole("button", { name: en.snapshot.reissue }));
    expect(
      await within(form).findByText(en.textLength.replace("{{min}}", "3").replace("{{max}}", "1000")),
    ).toBeTruthy();
    expect(requests.some((r) => r.url.endsWith("/reissue"))).toBe(false);
    fireEvent.change(within(form).getByLabelText(new RegExp(en.field.reason)), { target: { value: "KPI restated" } });
    fireEvent.click(within(form).getByRole("button", { name: en.snapshot.reissue }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/reissue"))).toBe(true));
    const reissue = requests.find((r) => r.url.endsWith("/reissue"))!;
    expect(reissue.headers["if-match"]).toBe('"2"');
    expect(reissue.body).toEqual({ reason: "KPI restated" });
    expect(await found(`[data-snapshot-status='generated']`)).toBeTruthy();
  });
});

describe("REQ-S13-005: exports", () => {
  it("the export form offers only the output's formats and sends an Idempotency-Key", async () => {
    const job = {
      id: UUIDX(601),
      transformationId: TR_ID,
      snapshotId: SNAP,
      format: "xlsx",
      language: "ar",
      status: "queued",
      stage: "queued",
      percent: 0,
      sectionsDone: 0,
      sectionsTotal: null,
      attemptCount: 0,
      startedAt: null,
      finishedAt: null,
      fileName: null,
      contentType: null,
      fileSha256: null,
      fileSizeBytes: null,
      errorCode: null,
      cancelledAt: null,
      version: 1,
      createdAt: "2026-10-16T10:00:00Z",
    };
    let created = false;
    const { requests } = mockApi(
      meRoute(["transformation.read", "report.generate", "report.issue", "export.create"]),
      route("POST", /\/api\/v1\/exports$/, () => {
        created = true;
        return { status: 202, body: job };
      }),
      route("GET", /\/api\/v1\/exports/, () => ({ status: 200, body: page(created ? [job] : []) })),
      ...snapshotRoutes(snapshot()),
    );
    renderApp(`/transformations/${TR_ID}/reports/${SNAP}`, { i18n: createI18n("en") });
    const form = await found("form[data-form='create-export']");
    const select = within(form).getByLabelText(en.exports.format) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["xlsx", "csv", "pdf"]);
    expect(form.textContent).toContain(en.exports.draftNote);
    fireEvent.change(within(form).getByLabelText(en.exports.language), { target: { value: "ar" } });
    fireEvent.click(within(form).getByRole("button", { name: en.exports.start }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/exports"))).toBe(true));
    const post = requests.find((r) => r.method === "POST" && r.url.endsWith("/exports"))!;
    expect(post.body).toEqual({ snapshotId: SNAP, format: "xlsx", language: "ar" });
    expect(post.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect((await found(`[data-export='${job.id}']`)).dataset["exportStatus"]).toBe("queued");
  });

  it("an export of a snapshot discarded meanwhile: the translated 422 stays visible after the reload", async () => {
    let refused = false;
    mockApi(
      meRoute(["transformation.read", "report.generate", "report.issue", "export.create"]),
      route("POST", /\/api\/v1\/exports$/, () => {
        refused = true;
        return problem(422, "export.snapshot_discarded");
      }),
      route("GET", new RegExp(`/report-snapshots/${SNAP}$`), () =>
        refused
          ? { status: 200, body: snapshot({ status: "discarded", discardReason: "Synthetic", version: 2 }) }
          : undefined,
      ),
      ...snapshotRoutes(snapshot()),
    );
    renderApp(`/transformations/${TR_ID}/reports/${SNAP}`, { i18n: createI18n("en") });
    const form = await found("form[data-form='create-export']");
    fireEvent.click(within(form).getByRole("button", { name: en.exports.start }));
    await found("[data-state='export-discarded']");
    const alert = await found("#export [role='alert']");
    expect(alert.textContent).toContain(catalogues.en.problems.export__snapshot_discarded);
    expect(document.querySelector("form[data-form='create-export']")).toBeNull();
  });

  for (const locale of ["en", "ar"] as const) {
    it(`${locale}: the list shows progress, a failed job's translated error, and cancel with If-Match`, async () => {
      const base = {
        transformationId: TR_ID,
        snapshotId: SNAP,
        language: "en",
        attemptCount: 1,
        startedAt: "2026-10-16T10:00:01Z",
        finishedAt: null,
        fileName: null,
        contentType: null,
        fileSha256: null,
        fileSizeBytes: null,
        cancelledAt: null,
        createdAt: "2026-10-16T10:00:00Z",
      };
      const running = {
        ...base,
        id: UUIDX(611),
        format: "pdf",
        status: "running",
        stage: "rendering",
        percent: 40,
        sectionsDone: 2,
        sectionsTotal: 5,
        errorCode: null,
        version: 3,
      };
      const failed = {
        ...base,
        id: UUIDX(612),
        format: "docx",
        status: "failed",
        stage: "rendering",
        percent: 20,
        sectionsDone: 1,
        sectionsTotal: 5,
        errorCode: "export.render_failed",
        version: 4,
      };
      const { requests } = mockApi(
        meRoute(["transformation.read", "export.create"], locale),
        route("POST", /\/cancel$/, () => problem(422, "export.not_cancellable")),
        route("GET", /\/api\/v1\/exports/, ok(page([running, failed]))),
        usersRoute,
      );
      renderApp("/evidence-reports/exports", { i18n: createI18n(locale) });
      const c = locale === "en" ? en : ar;
      const row = await found(`[data-export='${running.id}']`);
      expect(row.querySelector("progress")!.getAttribute("value")).toBe("40");
      expect(row.textContent).toContain(c.exportStage.rendering);
      const fail = await found(`[data-export-error='export.render_failed']`);
      expect(fail.textContent).toContain(catalogues[locale].problems.export__render_failed);
      fireEvent.click(screen.getByRole("button", { name: c.exports.cancel }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(catalogues[locale].problems.export__not_cancellable);
      expect(requests.find((r) => r.url.endsWith("/cancel"))!.headers["if-match"]).toBe('"3"');
    });
  }
});

describe("REQ-S09-011: owner updates", () => {
  const PERIOD = UUIDX(501);
  const periods = page([
    {
      id: PERIOD,
      organizationId: ORG_ID,
      frequency: "monthly",
      periodLabel: "2026-10",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      lengthDays: 31,
      basis: "calendar",
      weekCount: null,
      updateDueDate: null,
      status: "open",
      openedAt: "2026-10-01T00:00:00Z",
      closedAt: null,
      version: 2,
      createdAt: "2026-09-01T00:00:00Z",
    },
  ]);
  const ws = page([{ id: WS, code: "WS-01", name: "Synthetic workstream", leadUserId: USER, status: "active" }]);
  const update = (over: Record<string, unknown>) => ({
    id: UUIDX(401),
    transformationId: TR_ID,
    subjectType: "workstream",
    subjectId: WS,
    reportingPeriodId: PERIOD,
    periodLabel: "2026-10",
    ownerUserId: USER,
    achievements: "Synthetic achievements",
    nextSteps: null,
    milestones: null,
    outcomes: null,
    adoption: null,
    risks: null,
    dependencies: null,
    asks: null,
    status: "draft",
    revisionNo: 0,
    submittedAt: null,
    submittedBy: null,
    reopenReason: null,
    version: 1,
    createdAt: "2026-10-16T09:00:00Z",
    updatedAt: "2026-10-16T09:00:00Z",
    ...over,
  });

  for (const locale of ["en", "ar"] as const) {
    it(`${locale}: "No update submitted" without an update; writing creates then submits with If-Match`, async () => {
      let created: Record<string, unknown> | null = null;
      const { requests } = mockApi(
        meRoute(["transformation.read", "owner_update.submit"], locale),
        route("GET", /\/reporting-periods/, ok(periods)),
        route("GET", /\/workstreams/, ok(ws)),
        route("POST", /\/updates$/, () => {
          created = update({});
          return { status: 201, body: created };
        }),
        route("POST", /\/updates\/[^/]+\/submit$/, () => ({
          status: 200,
          body: update({ status: "submitted", revisionNo: 1, version: 2 }),
        })),
        route("GET", /\/updates/, () => ({ status: 200, body: page(created ? [created] : []) })),
        trRoute,
        usersRoute,
      );
      renderApp(`/transformations/${TR_ID}/owner-updates`, { i18n: createI18n(locale) });
      const c = locale === "en" ? en : ar;
      const card = await found("[data-update-subject='WS-01']");
      await waitFor(() => expect(card.textContent).toContain(c.updates.status.none));
      expect(c.updates.status.none).toBe(locale === "en" ? "No update submitted" : "لم يُقدَّم تحديث");
      fireEvent.click(within(card).getByRole("button", { name: new RegExp(c.updates.write) }));
      fireEvent.change(within(card).getByLabelText(c.updates.field.achievements), {
        target: { value: "Synthetic achievements" },
      });
      fireEvent.click(within(card).getByRole("button", { name: c.updates.submit }));
      await waitFor(() => expect(requests.some((r) => r.url.endsWith("/submit"))).toBe(true));
      const post = requests.find((r) => r.method === "POST" && r.url.endsWith("/updates"))!;
      expect(post.body).toEqual({
        subjectType: "workstream",
        subjectId: WS,
        reportingPeriodId: PERIOD,
        achievements: "Synthetic achievements",
      });
      expect(requests.find((r) => r.url.endsWith("/submit"))!.headers["if-match"]).toBe('"1"');
    });
  }

  it("a saved draft is labelled not submitted; 403 owner_update.not_owner is translated", async () => {
    mockApi(
      meRoute(["transformation.read", "owner_update.submit"]),
      route("GET", /\/reporting-periods/, ok(periods)),
      route("GET", /\/workstreams/, ok(ws)),
      route("PATCH", /\/updates\//, () => problem(403, "owner_update.not_owner")),
      route("GET", /\/updates/, ok(page([update({})]))),
      trRoute,
      usersRoute,
    );
    renderApp(`/transformations/${TR_ID}/owner-updates`, { i18n: createI18n("en") });
    const card = await found("[data-update-status='draft']");
    expect(card.querySelector("[data-state='draft-not-submitted']")!.textContent).toContain(en.updates.draftBanner);
    fireEvent.click(within(card).getByRole("button", { name: new RegExp(en.updates.edit) }));
    fireEvent.change(within(card).getByLabelText(en.updates.field.risks), { target: { value: "Synthetic risk" } });
    fireEvent.click(within(card).getByRole("button", { name: en.updates.saveDraft }));
    const alert = await within(card).findByRole("alert");
    expect(alert.textContent).toContain(catalogues.en.problems.owner_update__not_owner);
  });
});

describe("REQ-S10-013: presentation mode", () => {
  it("is live by default; a snapshot of another meeting is the translated 422", async () => {
    mockApi(
      meRoute(["transformation.read", "report.generate"]),
      route("GET", /\/presentation\?snapshotId=/, () => problem(422, "presentation.snapshot_mismatch")),
      route(
        "GET",
        /\/presentation$/,
        ok({ meetingId: MEETING, mode: "live", snapshotId: null, document: doc("meeting_pack") }),
      ),
      route("GET", /\/report-snapshots/, ok(page([]))),
      trRoute,
      usersRoute,
    );
    renderApp(`/transformations/${TR_ID}/meetings/${MEETING}/presentation`, { i18n: createI18n("en") });
    expect((await found("[data-presentation-loaded='live']")).textContent).toContain("TR-0001");
    expect(document.querySelector("[data-state='live-mode']")!.textContent).toContain(en.presentation.liveNote);
    cleanup();
    mockApi(
      meRoute(["transformation.read"]),
      route("GET", /\/presentation\?snapshotId=/, () => problem(422, "presentation.snapshot_mismatch")),
      route("GET", /\/report-snapshots/, ok(page([]))),
      trRoute,
      usersRoute,
    );
    renderApp(`/transformations/${TR_ID}/meetings/${MEETING}/presentation?snapshotId=${SNAP}`, {
      i18n: createI18n("en"),
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      catalogues.en.problems.presentation__snapshot_mismatch,
    );
    expect(document.querySelector("form[data-form='generate-pack']")).toBeNull();
  });
});

describe("REQ-S13-010: the evidence register", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`${locale}: a file shows its SHA-256, v2 and both versions; a note shows no checksum and "Not stated"`, async () => {
      const file = {
        evidenceId: UUIDX(301),
        title: "Synthetic baseline extract",
        kind: "file",
        evidenceType: "data_extract",
        source: "Synthetic BI system",
        ownerUserId: USER,
        observationStart: "2026-09-01",
        observationEnd: "2026-09-30",
        uploadedAt: "2026-10-02T08:00:00Z",
        currentRevision: 2,
        recordVersion: 3,
        sha256: "b".repeat(64),
        reviewStatus: "unverified",
        accessibilityStatus: "accessible",
        status: "active",
        links: [{ recordType: "baseline", recordId: UUIDX(302), via: "evidence_link" }],
      };
      const note = {
        ...file,
        evidenceId: UUIDX(303),
        title: "Synthetic note",
        kind: "note",
        source: null,
        observationStart: null,
        observationEnd: null,
        currentRevision: null,
        recordVersion: 1,
        sha256: null,
        links: [],
      };
      const versions = page([
        {
          contentId: UUIDX(311),
          revision: 2,
          sha256: "b".repeat(64),
          sizeBytes: 2048,
          contentType: "text/csv",
          fileName: "extract-v2.csv",
          uploadedBy: USER,
          uploadedAt: "2026-10-02T08:00:00Z",
        },
        {
          contentId: UUIDX(312),
          revision: 1,
          sha256: "c".repeat(64),
          sizeBytes: 1024,
          contentType: "text/csv",
          fileName: "extract.csv",
          uploadedBy: USER,
          uploadedAt: "2026-10-01T08:00:00Z",
        },
      ]);
      mockApi(
        meRoute(["transformation.read"], locale),
        route("GET", /\/evidence-register/, ok(page([file, note]))),
        route("GET", /\/evidence\/[^/]+\/versions/, ok(versions)),
        trRoute,
        usersRoute,
      );
      renderApp(`/transformations/${TR_ID}/evidence-register`, { i18n: createI18n(locale) });
      const c = locale === "en" ? en : ar;
      const row = await found(`[data-evidence-row='${file.evidenceId}']`);
      expect(row.querySelector(`[data-sha256='${"b".repeat(64)}']`)).toBeTruthy();
      expect(row.querySelector("[data-evidence-version='2']")).toBeTruthy();
      const noteRow = await found(`[data-evidence-row='${note.evidenceId}']`);
      expect(noteRow.textContent).toContain(c.evidence.noChecksum);
      expect(noteRow.querySelectorAll("[data-not-stated]").length).toBe(3);
      fireEvent.click(within(row).getByRole("button", { name: new RegExp(c.evidence.versions) }));
      const list = await found("[data-table='evidence-versions']");
      await waitFor(() => expect(list.querySelectorAll("[data-evidence-revision]").length).toBe(2));
      expect(list.textContent).toContain("c".repeat(64));
    });
  }
});

describe("REQ-S13-004: generate", () => {
  it("posts the register output with its filters and opens the generated snapshot", async () => {
    const { requests } = mockApi(
      meRoute(["transformation.read", "report.generate", "report.issue", "export.create"]),
      route("POST", /\/reports\/registers\/generate$/, () => ({ status: 201, body: snapshot() })),
      route("GET", /\/report-snapshots\?/, ok(page([]))),
      route("GET", /\/reporting-periods/, ok(page([]))),
      route("GET", /\/gates$/, ok({ items: [] })),
      ...snapshotRoutes(snapshot()),
    );
    renderApp(`/transformations/${TR_ID}/reports`, { i18n: createI18n("en") });
    const form = await found("form[data-form='generate-report']");
    fireEvent.change(within(form).getByLabelText(new RegExp(en.generate.output)), { target: { value: "registers" } });
    fireEvent.change(within(form).getByLabelText(en.generate.register), { target: { value: "raid" } });
    fireEvent.change(within(form).getByLabelText(en.generate.raidStatus), { target: { value: "open" } });
    fireEvent.click(within(form).getByRole("button", { name: en.generate.submit }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/generate"))).toBe(true));
    expect(requests.find((r) => r.url.endsWith("/generate"))!.body).toEqual({
      parameters: { register: "raid", filters: { status: "open" } },
    });
    expect(await screen.findByRole("heading", { level: 1, name: en.snapshot.title })).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------ problem texts

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}
function adrText(n: string): string {
  const dir = join(repoRoot(), "docs", "architecture", "adr");
  const file = readdirSync(dir).find((f) => f.startsWith(`ADR-${n}-`))!;
  return readFileSync(join(dir, file), "utf8");
}
const ROW = /^\|\s*4\d\d\s*\|\s*`([a-z_][a-z0-9_.]*)`\s*\|\s*(.*?)\s*\|\s*$/;

describe("slice F problem texts (ADR-0045 §11, ADR-0046 §8)", () => {
  const rows = new Map<string, string>();
  for (const n of ["0045", "0046"])
    for (const line of adrText(n).split("\n")) {
      const m = ROW.exec(line);
      if (m) rows.set(m[1]!, m[2]!);
    }
  // ADR-0046 §8's job error codes are given in a sentence: `code` "text".
  for (const m of adrText("0046").matchAll(/`(export\.[a-z_]+)` "([^"]+)"/g)) rows.set(m[1]!, m[2]!);

  it("reads every table row and job error code", () => {
    expect(rows.size).toBe(24);
  });

  it("each code has the ADR's exact English text and a different Arabic text", () => {
    const tEn = createI18n("en").t;
    const tAr = createI18n("ar").t;
    for (const [code, text] of rows) {
      expect(problemText(tEn, code), code).toBe(text);
      const arText = problemText(tAr, code);
      expect(arText, code).not.toBe(text);
      expect(arText, code).toMatch(/[؀-ۿ]/);
    }
  });
});
