// Playbook Studio screens (T-DG5-FE-B; ADR-0039, ADR-0040 §5) with STUBBED responses, in English (LTR) and Arabic
// (RTL). The live draft → review → publish path is e2e/p5-studio.spec.ts. SYNTHETIC data; a Studio version is
// configuration, never a business approval or an engineering delivery gate.
//  - REQ-S06-007: a draft is labelled "not published"; a check never run is "Not run", a run on older content "Stale",
//    never passed; publish sends If-Match; a refusal (422 config_version.review_required) is one translated alert.
//  - REQ-S06-004 / S06-006: an element edit sends PUT with If-Match and the attributes; a 422 stable_id_change and a
//    422 admin_approver_forbidden are shown translated.
//  - REQ-PB-093: default weights are decimal strings; the total is computed without floats; a 95 % total is flagged and
//    the publish refusal (422 config_version.weights_total) is translated; a null descriptor is "No descriptor defined".
//  - REQ-S02-001: the coverage report shows each set's expected and present counts; the run posts the version.
//  - REQ-S06-010: a reader without methodology.configure sees no edit action (read-only note).
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { LOCALES } from "@mth/shared";
import type { SourceCoverageReport, SourceSetCode } from "@mth/shared/schemas";
import { createI18n, catalogues } from "../../i18n/index.ts";
import { ORG_ID, makeMe, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { orderedSets } from "../source-coverage/SourceCoveragePage.tsx";
import { checkStatusOf, versionState, weightTotal, type ConfigCheckRun, type ConfigVersion } from "./api.ts";
import { elementPutAttributes } from "./ElementsSection.tsx";
import { bodyOf, draftOf } from "./ScoringDefaultsPage.tsx";
import { sortVersions } from "./StudioPage.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const en = catalogues.en.studio;
const ar = catalogues.ar.studio;
const grants = (permissions: Permission[]) => [
  { scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: false, permissions },
];
const ADM: Permission[] = [
  "organization.read",
  "methodology.read",
  "methodology.configure",
  "methodology.publish",
  "source_coverage.run",
];
const AUD: Permission[] = ["organization.read", "methodology.read"];
const meRoute = (permissions: Permission[], locale: "en" | "ar" = "en") =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe(grants(permissions), { preferredLocale: locale }),
  }));

const V1 = "01920000-0000-7000-b000-000000000001";
const V2 = "01920000-0000-7000-b000-000000000002";
const HASH = "a".repeat(64);
const OLD = "b".repeat(64);

function version(over: Partial<ConfigVersion> = {}): ConfigVersion {
  return {
    id: V2,
    configKind: "methodology",
    key: "playbook",
    versionNo: 2,
    status: "draft",
    draftStage: "editing",
    origin: "draft",
    basedOnVersionId: V1,
    rollbackOfVersionId: null,
    titleEn: "Synthetic methodology v2",
    titleAr: "منهجية اصطناعية الإصدار 2",
    changeSummary: null,
    definition: {},
    contentSha256: HASH,
    isNewestPublished: false,
    latestChecks: { preview: null, compatibility: null, sourceCoverage: null },
    pendingReviewId: null,
    reviewRequired: true,
    publishedAt: null,
    publishedBy: null,
    discardedAt: null,
    version: 4,
    createdAt: "2026-10-15T08:00:00Z",
    createdBy: null,
    updatedAt: "2026-10-15T08:00:00Z",
    updatedBy: null,
    ...over,
  };
}
function run(
  kind: ConfigCheckRun["checkKind"],
  result: ConfigCheckRun["result"],
  hash = HASH,
  at = "2026-10-15T09:00:00Z",
): ConfigCheckRun {
  return {
    id: `01920000-0000-7000-c000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`,
    versionId: V2,
    checkKind: kind,
    contentSha256: hash,
    result,
    report: {},
    runBy: ORG_ID,
    createdAt: at,
  };
}
const gateG3 = {
  elementType: "gate",
  stableKey: "G3",
  origin: "source",
  removed: false,
  ordinal: 3,
  sourceRef: "B0023",
  catalogueAttributes: { labelEn: "Design approval", labelAr: "اعتماد التصميم" },
  attributes: {},
  overridden: false,
};
const page = <T,>(items: T[]) => ({ status: 200, body: { items, nextCursor: null } });

function versionHandlers(v: ConfigVersion, runs: ConfigCheckRun[] = []) {
  return [
    route("GET", new RegExp(`/methodology-versions/${v.id}$`), () => ({ status: 200, body: v })),
    route("GET", /\/check-runs/, () => page(runs)),
    route("GET", /\/elements/, () => page([gateG3])),
    route("GET", /\/diff/, () => ({
      status: 200,
      body: {
        fromVersionId: V1,
        toVersionId: v.id,
        titleChanged: false,
        definitionChanged: false,
        entries: [
          {
            elementType: "gate",
            stableKey: "G3",
            change: "changed",
            fields: [{ field: "labelEn", from: "Design approval", to: "Design sign-off" }],
          },
        ],
      },
    })),
    route("GET", /\/affected-records/, () => ({
      status: 200,
      body: {
        versionId: v.id,
        transformations: [
          {
            transformationId: "01920000-0000-7000-9000-000000000301",
            code: "SYN-TR-01",
            pinnedVersionId: V1,
            records: [{ recordType: "T13", count: null, unknownReason: "not_countable" }],
          },
        ],
      },
    })),
    route("GET", /\/reviews(\?|$)/, () => page([])),
  ];
}

describe("pure helpers", () => {
  it("a check is Not run without a run, Stale on older content, its result on the current content (never pass by default)", () => {
    expect(checkStatusOf([], "preview", HASH).status).toBe("not_run");
    expect(checkStatusOf([run("preview", "pass", OLD)], "preview", HASH).status).toBe("stale");
    expect(
      checkStatusOf(
        [run("preview", "pass", OLD, "2026-10-15T08:00:00Z"), run("preview", "fail", HASH, "2026-10-15T09:00:00Z")],
        "preview",
        HASH,
      ).status,
    ).toBe("fail");
    expect(checkStatusOf([run("compatibility", "pass")], "preview", HASH).status).toBe("not_run");
  });

  it("totals decimal weights exactly (no floats) and flags invalid input as unknown", () => {
    expect(weightTotal(["30", "20", "20", "15", "15"])).toBe("100.00");
    expect(weightTotal(["33.33", "33.33", "33.34"])).toBe("100.00");
    expect(weightTotal(["0.1", "0.2"])).toBe("0.30");
    expect(weightTotal(["25", "25", "20", "15", "10"])).toBe("95.00");
    expect(weightTotal(["abc"])).toBeNull();
  });

  it("a draft is never in a published state; published versions are labelled current or earlier", () => {
    expect(versionState(version())).toBe("editing");
    expect(versionState(version({ draftStage: "review" }))).toBe("review");
    expect(versionState(version({ status: "published", draftStage: null, isNewestPublished: true }))).toBe(
      "newest_published",
    );
    expect(versionState(version({ status: "published", draftStage: null }))).toBe("published");
  });

  it("an element put keeps the version's own attributes, drops emptied ones, validates role codes", () => {
    const e = { elementType: "gate" as const, attributes: { helpEn: "Old help" }, catalogueAttributes: {} };
    expect(elementPutAttributes(e, { labelEn: "Design sign-off", helpEn: "", defaultApproverRoleCode: "SP" })).toEqual({
      attributes: { labelEn: "Design sign-off", defaultApproverRoleCode: "SP" },
    });
    expect(elementPutAttributes(e, { defaultApproverRoleCode: "sp lower" })).toEqual({
      fieldErrors: { defaultApproverRoleCode: "validation.code" },
    });
    // An approver route keeps exactly one approver form: the catalogue's when the admin did not set one.
    const route = {
      elementType: "approver_route" as const,
      attributes: {},
      catalogueAttributes: { approverRoleCode: "SP" },
    };
    expect(elementPutAttributes(route, { labelEn: "Charter approval" })).toEqual({
      attributes: { labelEn: "Charter approval", approverRoleCode: "SP" },
    });
  });

  it("sorts versions by the chosen column", () => {
    const a = version({ id: V1, versionNo: 1, createdAt: "2026-10-01T00:00:00Z" });
    const b = version({ versionNo: 2, createdAt: "2026-10-15T00:00:00Z" });
    expect(sortVersions([a, b], [{ id: "versionNo", desc: true }]).map((v) => v.versionNo)).toEqual([2, 1]);
    expect(sortVersions([b, a], [{ id: "createdAt", desc: false }]).map((v) => v.versionNo)).toEqual([1, 2]);
  });

  it("the scoring-defaults body sends decimal strings and null for an empty descriptor", () => {
    const d = draftOf({
      versionId: V2,
      versionNo: 2,
      status: "draft",
      isNewestPublished: false,
      weights: [
        { criterionCode: "strategic_fit", weightPercent: "25" },
        { criterionCode: "financial_value", weightPercent: "25" },
      ],
      weightTotal: "50.00",
      rubrics: [
        {
          criterionCode: "feasibility",
          levels: [1, 2, 3, 4, 5].map((score) => ({ score, descriptorEn: null, descriptorAr: null })),
        },
      ],
      version: 3,
    });
    d.weights.strategic_fit = "30";
    d.rubrics.feasibility.en[0] = "Synthetic: not feasible";
    const body = bodyOf(d, ["feasibility"]);
    expect(body.weights).toEqual([
      { criterionCode: "strategic_fit", weightPercent: "30" },
      { criterionCode: "financial_value", weightPercent: "25" },
    ]);
    expect(body.rubrics[0]!.levels[0]).toEqual({
      score: 1,
      descriptorEn: "Synthetic: not feasible",
      descriptorAr: null,
    });
    expect(body.rubrics[0]!.levels[1]).toEqual({ score: 2, descriptorEn: null, descriptorAr: null });
  });
});

describe("Studio home", () => {
  for (const locale of LOCALES) {
    it(`${locale}: lists versions with their state; a draft is labelled not published; New draft for the admin`, async () => {
      const cat = locale === "en" ? en : ar;
      mockApi(
        meRoute(ADM, locale),
        route("GET", /\/admin\/methodology-versions(\?|$)/, () =>
          page([
            version(),
            version({
              id: V1,
              versionNo: 1,
              status: "published",
              draftStage: null,
              origin: "seed",
              basedOnVersionId: null,
              isNewestPublished: true,
            }),
          ]),
        ),
      );
      renderApp("/admin/studio", { i18n: createI18n(locale) });
      expect(await screen.findByText(cat.state.editing)).toBeTruthy();
      expect(screen.getByText(cat.state.newest_published)).toBeTruthy();
      expect(screen.getByRole("button", { name: cat.create.action })).toBeTruthy();
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
      // Sorting is announced (aria-sort) and the column picker is keyboard reachable.
      const sort = screen.getByRole("button", { name: new RegExp(cat.field.versionNo) });
      fireEvent.click(sort);
      await waitFor(() => expect(sort.closest("th")?.getAttribute("aria-sort")).not.toBe("none"));
      expect(screen.getByRole("button", { name: catalogues[locale].common.table.columns })).toBeTruthy();
    });
  }

  it("a reader without methodology.configure sees no New draft and the read-only note (AUD)", async () => {
    mockApi(
      meRoute(AUD),
      route("GET", /\/admin\/methodology-versions/, () => page([version()])),
    );
    renderApp("/admin/studio", { i18n: createI18n("en") });
    expect(await screen.findByText(en.state.editing)).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.create.action })).toBeNull();
    expect(screen.getByText(en.readOnly)).toBeTruthy();
  });

  it("New draft posts the chosen base version and opens the draft", async () => {
    const published = version({ id: V1, versionNo: 1, status: "published", draftStage: null, isNewestPublished: true });
    const { requests } = mockApi(
      meRoute(ADM),
      route("GET", /\/admin\/methodology-versions(\?|$)/, () => page([published])),
      route("POST", /\/admin\/methodology-versions$/, () => ({ status: 201, body: version() })),
      ...versionHandlers(version()),
    );
    const { router } = renderApp("/admin/studio", { i18n: createI18n("en") });
    fireEvent.click(await screen.findByRole("button", { name: en.create.action }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(en.create.base)), { target: { value: V1 } });
    fireEvent.click(within(dialog).getByRole("button", { name: en.create.submit }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/admin/studio/versions/${V2}`));
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({ basedOnVersionId: V1 });
  });
});

describe("Version page: pipeline, elements, diff, affected records", () => {
  it("shows Not run / Stale / Pass per check of the current content, never passed by default", async () => {
    mockApi(meRoute(ADM), ...versionHandlers(version(), [run("preview", "pass"), run("compatibility", "pass", OLD)]));
    renderApp(`/admin/studio/versions/${V2}`, { i18n: createI18n("en") });
    const checks = await screen.findByRole("table", { name: en.check.caption });
    await waitFor(() => expect(within(checks).getAllByRole("row")).toHaveLength(4));
    const row = (kind: string) =>
      checks.querySelector(`[data-check-kind='${kind}'] [data-check]`)!.getAttribute("data-check");
    expect(row("preview")).toBe("pass");
    expect(row("compatibility")).toBe("stale");
    expect(row("source_coverage")).toBe("not_run");
    expect(screen.getByText(en.version.draftNote)).toBeTruthy();
  });

  it("publish sends If-Match; 422 config_version.review_required is one translated alert", async () => {
    const { requests } = mockApi(
      meRoute(ADM),
      route("POST", /\/publish$/, () => problem(422, "config_version.review_required")),
      ...versionHandlers(version()),
    );
    renderApp(`/admin/studio/versions/${V2}`, { i18n: createI18n("en") });
    fireEvent.click(await screen.findByRole("button", { name: en.publish.action }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(catalogues.en.problems.config_version__review_required);
    expect(requests.find((r) => r.url.endsWith("/publish"))!.headers["if-match"]).toBe('"4"');
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("renaming G3's label sends PUT with If-Match; changing an approver to ADM_METHOD shows the translated refusal", async () => {
    const { requests } = mockApi(
      meRoute(ADM),
      route("PUT", /\/elements\/gate\/G3$/, (req) =>
        (req.body as { attributes: Record<string, unknown> }).attributes["defaultApproverRoleCode"] === "ADM_METHOD"
          ? problem(422, "config_version.admin_approver_forbidden")
          : { status: 200, body: version({ version: 5 }) },
      ),
      ...versionHandlers(version()),
    );
    renderApp(`/admin/studio/versions/${V2}`, { i18n: createI18n("en") });
    const edit = await screen.findByRole("button", { name: /^Edit\s+Design approval$/ });
    fireEvent.click(edit);
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(en.elements.labelEn), { target: { value: "Design sign-off" } });
    fireEvent.click(within(dialog).getByRole("button", { name: en.elements.save }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"4"');
    expect(put.body).toEqual({ attributes: { labelEn: "Design sign-off", labelAr: "اعتماد التصميم" } });

    fireEvent.click(screen.getByRole("button", { name: /^Edit\s+Design approval$/ }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(en.elements.attr.defaultApproverRoleCode)), {
      target: { value: "ADM_METHOD" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: en.elements.save }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      catalogues.en.problems.config_version__admin_approver_forbidden,
    );
  });

  it("the diff shows before and after side by side; an uncountable affected count is Unknown, never 0", async () => {
    mockApi(meRoute(AUD), ...versionHandlers(version()));
    renderApp(`/admin/studio/versions/${V2}`, { i18n: createI18n("en") });
    const diff = await screen.findByRole("table", { name: en.diff.caption });
    expect(within(diff).getByText("Design approval")).toBeTruthy();
    expect(within(diff).getByText("Design sign-off")).toBeTruthy();
    const affected = document.querySelector("[data-table='affected']")!;
    await waitFor(() => expect(affected.querySelector("[data-health='unknown']")).toBeTruthy());
    // AUD: read-only, no publish or edit action.
    expect(screen.queryByRole("button", { name: en.publish.action })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit Design approval/ })).toBeNull();
  });

  it("a published version is immutable and offers rollback with a required reason", async () => {
    const published = version({ id: V1, versionNo: 1, status: "published", draftStage: null, basedOnVersionId: null });
    const { requests } = mockApi(
      meRoute(ADM),
      route("POST", /\/rollback$/, () => ({ status: 201, body: version({ id: V2, origin: "rollback" }) })),
      ...versionHandlers(published),
      ...versionHandlers(version({ origin: "rollback" })),
    );
    const { router } = renderApp(`/admin/studio/versions/${V1}`, { i18n: createI18n("en") });
    expect(await screen.findByText(en.version.immutable)).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.publish.action })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: en.rollback.action }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: en.rollback.submit }));
    expect(await within(dialog).findByText(catalogues.en.problems.validation__required)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(new RegExp(en.rollback.reason)), {
      target: { value: "Synthetic: restore the shipped wording" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: en.rollback.submit }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/admin/studio/versions/${V2}`));
    const post = requests.find((r) => r.url.endsWith("/rollback"))!;
    expect(post.body).toEqual({ reason: "Synthetic: restore the shipped wording" });
    expect(post.headers["if-match"]).toBe('"4"');
  });
});

describe("Scoring defaults", () => {
  const defaults = (over: Record<string, unknown> = {}) => ({
    versionId: V2,
    versionNo: 2,
    status: "draft",
    isNewestPublished: false,
    weights: [
      { criterionCode: "strategic_fit", weightPercent: "25" },
      { criterionCode: "financial_value", weightPercent: "25" },
      { criterionCode: "customer_impact", weightPercent: "20" },
      { criterionCode: "feasibility", weightPercent: "15" },
      { criterionCode: "time_to_value", weightPercent: "15" },
    ],
    weightTotal: "100.00",
    rubrics: [
      {
        criterionCode: "feasibility",
        levels: [1, 2, 3, 4, 5].map((score) => ({ score, descriptorEn: null, descriptorAr: null })),
      },
    ],
    version: 6,
    ...over,
  });

  it("edits weights to 30/20/20/15/15 (total 100.00) and a Feasibility descriptor; saves a draft with If-Match", async () => {
    const { requests } = mockApi(
      meRoute(ADM),
      route("GET", /\/admin\/scoring-defaults/, () => ({ status: 200, body: defaults() })),
      route("GET", /\/admin\/methodology-versions/, () => page([])),
      route("PUT", /\/scoring-defaults$/, () => ({ status: 200, body: defaults({ version: 7 }) })),
    );
    renderApp(`/admin/studio/scoring-defaults?versionId=${V2}`, { i18n: createI18n("en") });
    const strategic = await screen.findByLabelText(en.criterion.strategic_fit);
    fireEvent.change(strategic, { target: { value: "20" } });
    expect(document.querySelector("[data-weight-total]")!.getAttribute("data-weight-total")).toBe("95.00");
    expect(screen.getByText(en.defaults.totalNot100)).toBeTruthy();
    fireEvent.change(strategic, { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(en.criterion.financial_value), { target: { value: "20" } });
    expect(document.querySelector("[data-weight-total]")!.getAttribute("data-weight-total")).toBe("100.00");
    fireEvent.change(
      screen.getByLabelText(`${en.criterion.feasibility}, score 1, ${catalogues.en.common.language.name.en}`),
      { target: { value: "Synthetic: needs capabilities we do not have" } },
    );
    fireEvent.click(screen.getByRole("button", { name: en.defaults.saveDraft }));
    expect(await screen.findByText(en.defaults.savedDraft)).toBeTruthy();
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"6"');
    const body = put.body as { weights: { weightPercent: string }[]; rubrics: { levels: unknown[] }[] };
    expect(body.weights.map((w) => w.weightPercent)).toEqual(["30", "20", "20", "15", "15"]);
    expect(body.rubrics[0]!.levels[0]).toEqual({
      score: 1,
      descriptorEn: "Synthetic: needs capabilities we do not have",
      descriptorAr: null,
    });
  });

  it("a published version is read-only; a null descriptor reads 'No descriptor defined' (en and ar)", async () => {
    for (const locale of LOCALES) {
      mockApi(
        meRoute(AUD, locale),
        route("GET", /\/admin\/scoring-defaults/, () => ({
          status: 200,
          body: defaults({ status: "published", isNewestPublished: true }),
        })),
        route("GET", /\/admin\/methodology-versions/, () => page([])),
      );
      renderApp("/admin/studio/scoring-defaults", { i18n: createI18n(locale) });
      const cat = locale === "en" ? en : ar;
      expect((await screen.findAllByText(cat.defaults.noDescriptor)).length).toBe(10);
      expect(screen.queryByRole("button", { name: cat.defaults.saveDraft })).toBeNull();
      cleanup();
    }
  });
});

describe("Source coverage", () => {
  const counts: [SourceSetCode, number][] = [
    ["mode", 2],
    ["phase", 6],
    ["gate", 6],
    ["template", 16],
    ["tom_dimension", 10],
    ["forum", 5],
    ["benefit_lifecycle_step", 6],
    ["launch_window", 3],
    ["roaming_example", 1],
    ["health_question", 25],
  ];
  const report: SourceCoverageReport = {
    versionId: V1,
    contentSha256: HASH,
    result: "warn",
    sets: counts
      .map(([setCode, n]) => ({
        setCode,
        expected: n,
        present: n,
        removed: [],
        plannedFeatures: setCode === "launch_window" ? ["launch_plan"] : [],
        result: setCode === "launch_window" ? ("warn" as const) : ("pass" as const),
      }))
      .reverse(),
  };

  for (const locale of LOCALES) {
    it(`${locale}: shows the ten sets in source order with their counts, and runs the check for the version`, async () => {
      const cat = locale === "en" ? en : ar;
      const { requests } = mockApi(
        meRoute(ADM, locale),
        route("GET", /\/admin\/source-coverage(\?|$)/, () => ({ status: 200, body: report })),
        route("GET", /\/admin\/methodology-versions/, () => page([version({ id: V1 })])),
        route("POST", /\/admin\/source-coverage\/runs$/, () => ({
          status: 201,
          body: { ...run("source_coverage", "warn"), versionId: V1 },
        })),
      );
      renderApp("/admin/source-coverage", { i18n: createI18n(locale) });
      const table = await screen.findByRole("table", { name: cat.coverage.sets });
      const rows = within(table).getAllByRole("row").slice(1);
      expect(rows.map((r) => r.getAttribute("data-set"))).toEqual(counts.map(([c]) => c));
      expect(rows.map((r) => Number(r.querySelector("[data-present]")!.textContent))).toEqual(counts.map(([, n]) => n));
      expect(within(rows[7]!).getByText(cat.check.status.warn)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: cat.check.run.source_coverage }));
      expect(await screen.findByText(cat.coverage.ran)).toBeTruthy();
      expect(requests.find((r) => r.method === "POST")!.body).toEqual({ versionId: V1 });
    });
  }

  it("offers no run for a published (immutable) version, and says the check runs on drafts", async () => {
    mockApi(
      meRoute(ADM),
      route("GET", /\/admin\/source-coverage(\?|$)/, () => ({ status: 200, body: report })),
      route("GET", /\/admin\/methodology-versions/, () =>
        page([version({ id: V1, status: "published", draftStage: null, isNewestPublished: true })]),
      ),
    );
    renderApp("/admin/source-coverage", { i18n: createI18n("en") });
    expect(await screen.findByText(en.coverage.runDraftOnly)).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.check.run.source_coverage })).toBeNull();
  });

  it("orders unknown set codes last", () => {
    const r = { ...report, sets: [{ ...report.sets[0]!, setCode: "zzz" as never }, ...report.sets.slice(1)] };
    expect(orderedSets(r).at(-1)!.setCode).toBe("zzz");
  });
});
