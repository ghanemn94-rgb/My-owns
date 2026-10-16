// FE-G screens (T-DG5-FE-G; slices I and J) with STUBBED responses, in English (LTR) and Arabic (RTL). The live paths
// against the real API are e2e/p5-reader-branding-demo.spec.ts. SYNTHETIC data; nothing here is a business approval.
//  - REQ-PB-001: "About this methodology" shows B0004 verbatim, the B0024 note and the read-only Source / Used for
//    table; the Arabic view labels its provisional translation and keeps the English verbatim text.
//  - REQ-PB-002 / PB-011: the element badges say "Custom extension (playbook v1.0)" in en and ar, never "PMI standard";
//    the four questions render verbatim; the T01 form header shows its badge, question tag and "Source: B0031".
//  - REQ-PB-077: the Realize phase shows the B0124 note.
//  - REQ-S03-010: a 1-character query is refused in the field with the validation.search_query text; results mark the
//    server's highlight offsets (plain text, no HTML).
//  - REQ-S02-004: block B0031 lists the link to the T01 register; a launchable procedure offers Launch, which sends one
//    launchProcedureInstance with an Idempotency-Key.
//  - REQ-S15-004 / S01-002: Branding Settings publishes with If-Match "0", shows a 409 conflict and the translated 422,
//    and a user without branding.configure gets the no-permission state; the shell shows the configured product name.
//  - REQ-S18-001 / PB-089 / S21-001: the banner, record badge and approval label appear only when /environment says
//    synthetic; the walkthrough and the reset show environment.not_demo by its text.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { catalogues, createI18n } from "../../i18n/index.ts";
import { ORG_ID, TR_ID, makeMe, makeTransformation, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { highlightParts } from "./api.ts";
import { bodyOf, validate } from "../branding/BrandingPage.tsx";
import { parseMarkdownTable } from "./ui.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Lang = "en" | "ar";
const LANGS: readonly Lang[] = ["en", "ar"];
const P = (lang: Lang) => catalogues[lang].playbookP5;
/** Waits until `selector` matches (waitFor retries only while the callback throws). */
const found = (selector: string) =>
  waitFor(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`not found: ${selector}`);
    return el;
  });
const PROBLEMS = (lang: Lang) => catalogues[lang].problems as unknown as Record<string, string>;
const VERSION = { versionId: "01995000-0000-7000-8000-0000000000aa", key: "playbook", versionNo: 1 };
const B0004 =
  "Practical synthesis inspired by PMI Organizational Transformation, Brightline Transformation Compass and PMI Benefits Realization Management; extended with a custom Target Operating Model toolkit.";
const B0124 =
  "This phase aligns with PMI Benefits Realization Management logic: identify expected benefits, deliver/measure them during execution, and sustain benefits after transition to the business.";

const meRoute = (lang: Lang, permissions: Permission[] = ["organization.read", "transformation.read"]) =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe([{ scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: true, permissions }], {
      preferredLocale: lang,
    }),
  }));
const block = (ref: string, text: string, extra: Record<string, unknown> = {}) => ({
  blockRef: ref,
  ordinal: Number(ref.slice(1)),
  blockKind: "text",
  isHeading: false,
  sectionBlockRef: null,
  phaseCode: null,
  textEn: text,
  textAr: `ع ${text}`,
  arProvisional: true,
  guidanceEn: null,
  guidanceAr: null,
  linkCount: 0,
  methodologyVersion: VERSION,
  ...extra,
});
const provenance = {
  statement: { blockRef: "B0004", textEn: B0004, textAr: "خلاصة عملية مستوحاة", arProvisional: true },
  connectionNote: {
    blockRef: "B0024",
    textEn: "PMI/Brightline connection note.",
    textAr: "ملاحظة",
    arProvisional: true,
  },
  foundations: [
    {
      code: "pmi_ot",
      ordinal: 1,
      sourceEn: "PMI Organizational Transformation Series",
      sourceAr: "سلسلة PMI للتحول المؤسسي",
      usedForEn: "Transformation lifecycle",
      usedForAr: "دورة حياة التحول",
      sourceRef: "B0156",
    },
  ],
  customExtensions: [
    { blockRef: "B0158", textEn: "The 6-phase integrated methodology.", textAr: "المنهجية", arProvisional: true },
  ],
  realizeNote: { blockRef: "B0124", textEn: B0124, textAr: "تتوافق هذه المرحلة", arProvisional: true },
  note: null,
  methodologyVersion: VERSION,
};
const profileT01 = {
  elementRef: "template.T01",
  kind: "template",
  stableKey: "T01",
  ordinal: 1,
  labelEn: "T01 Diagnostic",
  labelAr: "ن01 التشخيص",
  provenance: "custom_extension",
  provenanceSourceRef: "B0160",
  questionTag: "why_change",
  sourceRefs: ["B0030", "B0031"],
  overridden: false,
};
const readerRoutes = [
  route("GET", /\/api\/v1\/methodology\/provenance/, () => ({ status: 200, body: provenance })),
  route("GET", /\/api\/v1\/methodology\/guiding-questions/, () => ({
    status: 200,
    body: {
      items: [
        { code: "why_change", ordinal: 1, textEn: "Why change?", textAr: "لماذا التغيير؟", sourceRef: "B0016" },
        { code: "what_different", ordinal: 2, textEn: "What must become different?", textAr: "ما", sourceRef: "B0016" },
        { code: "how_execute", ordinal: 3, textEn: "How will we execute?", textAr: "كيف", sourceRef: "B0016" },
        { code: "how_prove_value", ordinal: 4, textEn: "How will we prove value?", textAr: "كيف", sourceRef: "B0016" },
      ],
    },
  })),
  route("GET", /\/api\/v1\/methodology\/blocks\?/, (req) => ({
    status: 200,
    body: {
      items: req.url.includes("phase=realize")
        ? [block("B0117", "Realize", { phaseCode: "realize", isHeading: true })]
        : [block("B0029", "Value pools and diagnostics", { phaseCode: "diagnose" })],
      nextCursor: null,
    },
  })),
  route("GET", /\/api\/v1\/methodology\/elements/, () => ({
    status: 200,
    body: { methodologyVersion: VERSION, items: [profileT01] },
  })),
  route("GET", /\/api\/v1\/methodology\/search\?/, () => ({
    status: 200,
    body: {
      items: [
        {
          blockRef: "B0029",
          phaseCode: "diagnose",
          sectionBlockRef: "B0025",
          lang: "en",
          snippet: "Size the value pools first",
          highlights: [{ offset: 9, length: 11 }],
        },
      ],
      nextCursor: null,
      methodologyVersion: VERSION,
    },
  })),
];

describe("pure helpers", () => {
  it("splits a snippet by the server's offsets, clipping overlaps and out-of-range marks", () => {
    expect(highlightParts("Size the value pools", [{ offset: 9, length: 11 }])).toEqual([
      { text: "Size the ", mark: false },
      { text: "value pools", mark: true },
    ]);
    expect(
      highlightParts("abcdef", [
        { offset: 1, length: 2 },
        { offset: 2, length: 2 },
        { offset: 10, length: 3 },
      ]),
    ).toEqual([
      { text: "a", mark: false },
      { text: "bc", mark: true },
      { text: "d", mark: true },
      { text: "ef", mark: false },
    ]);
  });

  it("reads a table block's Markdown rows (separator dropped) and leaves prose alone", () => {
    expect(parseMarkdownTable("| Source | Used for |\n|---|---|\n| PMI | Lifecycle |")).toEqual([
      ["Source", "Used for"],
      ["PMI", "Lifecycle"],
    ]);
    expect(parseMarkdownTable("Plain text.")).toBeNull();
  });

  it("validates branding before sending and builds the complete PUT body (bundled fonts, logo mode, nulls)", () => {
    const d = {
      productNameEn: "Hub",
      productNameAr: "منصة",
      primaryColour: "#0078ff",
      secondaryColour: "#003B73",
      colourApprovalReference: "",
      logoMode: "keep" as const,
      pngBase64: "",
      altEn: "",
      altAr: "",
      reportHeaderEn: "Header",
      reportHeaderAr: "",
      reportFooterEn: "",
      reportFooterAr: "",
      changeNote: "",
    };
    expect(validate(d)).toEqual({
      primaryColour: "branding__colour_invalid",
      reportHeaderEn: "branding__text_pair_required",
    });
    const ok = { ...d, primaryColour: "#0078FF", reportHeaderEn: "" };
    expect(validate(ok)).toEqual({});
    expect(bodyOf(ok)).toEqual({
      productNameEn: "Hub",
      productNameAr: "منصة",
      primaryColour: "#0078FF",
      secondaryColour: "#003B73",
      colourApprovalReference: null,
      fontLatin: "IBM Plex Sans",
      fontArabic: "IBM Plex Sans Arabic",
      logo: { mode: "keep" },
      reportHeaderEn: null,
      reportHeaderAr: null,
      reportFooterEn: null,
      reportFooterAr: null,
      changeNote: null,
    });
  });
});

describe("the playbook reader", () => {
  for (const lang of LANGS) {
    it(`${lang}: About, questions, badges and the Realize note; B0004 stays verbatim in English`, async () => {
      mockApi(meRoute(lang), ...readerRoutes);
      renderApp("/playbook/reader", { i18n: createI18n(lang) });
      expect(await screen.findByRole("heading", { level: 1, name: P(lang).reader.title })).toBeTruthy();
      const statement = await found("[data-source-text='statement']");
      expect(statement.querySelector("[data-verbatim='en']")!.textContent).toContain(B0004);
      if (lang === "ar") expect(within(statement).getByText(P("ar").arProvisional)).toBeTruthy();
      const table = document.querySelector("[data-table='source-foundations']")!;
      expect(within(table as HTMLElement).getByText(P(lang).about.usedFor)).toBeTruthy();
      expect(table.querySelector("input, button")).toBeNull();
      expect((await screen.findAllByText("Why change?", { exact: false })).length).toBeGreaterThan(0);
      const row = await found("[data-element='template.T01']");
      expect(within(row).getByText(P(lang).provenance.custom_extension)).toBeTruthy();
      expect(within(row).getByText(P(lang).question.why_change)).toBeTruthy();
      // No element is labelled a PMI standard (REQ-PB-002); the page names no engineering delivery gate.
      expect(document.querySelector("[data-table='element-profiles']")!.textContent).not.toMatch(
        /PMI standard|certified/i,
      );
      expect(document.body.textContent).not.toMatch(/PMI certified|\bDG[0-7]\b/);
      // Realize phase guidance (REQ-PB-077).
      const phase = document.querySelector<HTMLSelectElement>("select[data-filter='phase']")!;
      fireEvent.change(phase, { target: { value: "realize" } });
      const realize = await found("[data-state='realize-guidance']");
      expect(realize.textContent).toContain("aligns with PMI Benefits Realization Management logic");
      expect(document.documentElement.dir).toBe(lang === "ar" ? "rtl" : "ltr");
    });
  }

  it("refuses a 1-character search in the field, then marks the highlights of the results", async () => {
    const { requests } = mockApi(meRoute("en"), ...readerRoutes);
    renderApp("/playbook/reader", { i18n: createI18n("en") });
    const input = await screen.findByLabelText(new RegExp(P("en").search.query));
    fireEvent.change(input, { target: { value: "v" } });
    fireEvent.click(screen.getByRole("button", { name: P("en").search.submit }));
    expect(await screen.findByText(PROBLEMS("en")["validation__search_query"]!)).toBeTruthy();
    expect(requests.some((r) => r.url.includes("/methodology/search"))).toBe(false);
    fireEvent.change(input, { target: { value: "value pools" } });
    fireEvent.click(screen.getByRole("button", { name: P("en").search.submit }));
    const hit = await found("[data-hit='B0029']");
    expect(hit.querySelector("mark")!.textContent).toBe("value pools");
    expect(hit.getAttribute("data-phase")).toBe("diagnose");
    const sent = requests.find((r) => r.url.includes("/methodology/search"))!;
    expect(sent.url).toContain("q=value+pools");
    expect(sent.url).toContain("lang=en");
  });
});

describe("a block and its links", () => {
  const linkRoutes = [
    route("GET", /\/api\/v1\/methodology\/blocks\/B0031\?|\/api\/v1\/methodology\/blocks\/B0031$/, () => ({
      status: 200,
      body: block("B0031", "| Template | Fields |\n|---|---|\n| T01 | Value pool |", {
        blockKind: "table",
        phaseCode: "diagnose",
        linkCount: 3,
      }),
    })),
    route("GET", /\/api\/v1\/methodology\/blocks\/B0031\/links/, () => ({
      status: 200,
      body: {
        blockRef: "B0031",
        methodologyVersion: VERSION,
        items: [
          {
            targetKind: "template",
            targetKey: "T01",
            labelEn: "Diagnostic register",
            labelAr: "سجل التشخيص",
            route: `/transformations/${TR_ID}/diagnose`,
            origin: "seed",
            launchable: false,
          },
          {
            targetKind: "procedure",
            targetKey: "gate_review",
            labelEn: "Gate review",
            labelAr: "مراجعة البوابة",
            route: "/admin/procedures/gate_review",
            origin: "seed",
            launchable: true,
          },
          {
            targetKind: "requirement",
            targetKey: "REQ-S06-001",
            labelEn: "REQ-S06-001",
            labelAr: "REQ-S06-001",
            route: "/playbook/requirements/REQ-S06-001",
            origin: "seed",
            launchable: false,
          },
        ],
      },
    })),
    route("GET", /\/api\/v1\/methodology\/elements/, () => ({
      status: 200,
      body: { methodologyVersion: VERSION, items: [profileT01] },
    })),
    route("GET", /\/api\/v1\/transformations\?/, () => ({
      status: 200,
      body: { items: [makeTransformation()], nextCursor: null },
    })),
  ];

  for (const lang of LANGS) {
    it(`${lang}: B0031 shows its table, the T01 register link with badges, the requirement ID and Launch`, async () => {
      const { requests } = mockApi(
        meRoute(lang),
        ...linkRoutes,
        route("POST", /\/api\/v1\/procedure-instances$/, () => problem(403, "procedure.launch_role")),
      );
      renderApp("/playbook/reader/B0031", { i18n: createI18n(lang) });
      expect(await screen.findByRole("heading", { level: 1, name: new RegExp(P(lang).block.title) })).toBeTruthy();
      await waitFor(() => expect(document.querySelector("[data-block-table]")).toBeTruthy());
      const t01 = await found("[data-link='template:T01']");
      expect(within(t01).getByRole("link").getAttribute("href")).toBe(`/transformations/${TR_ID}/diagnose`);
      await waitFor(() => expect(within(t01).getByText(P(lang).question.why_change)).toBeTruthy());
      const req = document.querySelector<HTMLElement>("[data-link='requirement:REQ-S06-001']")!;
      expect(req.querySelector("a")).toBeNull();
      // Launch: one POST with an Idempotency-Key; the refusal is shown by its translated code.
      fireEvent.click(screen.getByRole("button", { name: P(lang).links.launch }));
      fireEvent.click(await screen.findByRole("button", { name: P(lang).links.launchConfirm }));
      expect(await screen.findByText(PROBLEMS(lang)["procedure__launch_role"]!, { exact: false })).toBeTruthy();
      const post = requests.filter((r) => r.method === "POST");
      expect(post).toHaveLength(1);
      expect(post[0]!.headers["idempotency-key"]).toBeTruthy();
      expect(post[0]!.body).toEqual({ procedureCode: "gate_review", transformationId: null });
    });
  }

  it("the T01 form header links back to B0031 with its badge and question tag", async () => {
    const { TemplateProvenance } = await import("../../components/provenance-badge/ProvenanceBadge.tsx");
    const { render } = await import("@testing-library/react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { I18nextProvider } = await import("react-i18next");
    const { MemoryRouter } = await import("react-router");
    mockApi(
      ...linkRoutes,
      route("GET", /\/api\/v1\/methodology\/templates\/T01\/source-links/, () => ({
        status: 200,
        body: {
          templateCode: "T01",
          methodologyVersion: VERSION,
          items: [
            { blockRef: "B0031", ordinal: 31, phaseCode: "diagnose", excerptEn: "Template 1", excerptAr: "النموذج 1" },
          ],
        },
      })),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={createI18n("en")}>
          <MemoryRouter>
            <TemplateProvenance templateCode="T01" />
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );
    const link = await screen.findByRole("link", { name: "B0031" });
    expect(link.getAttribute("href")).toBe("/playbook/reader/B0031");
    expect(await screen.findByText(P("en").provenance.custom_extension)).toBeTruthy();
    expect(screen.getByText(P("en").question.why_change)).toBeTruthy();
  });
});

const settings = (over: Record<string, unknown> = {}) => ({
  versionNo: 0,
  source: "default",
  productNameEn: "Mobily Transformation Hub",
  productNameAr: "منصة موبايلي للتحوّل",
  primaryColour: "#0078FF",
  secondaryColour: "#003B73",
  coloursProvisional: true,
  fontLatin: "IBM Plex Sans",
  fontArabic: "IBM Plex Sans Arabic",
  logo: null,
  wordmarkProvisional: true,
  reportHeaderEn: null,
  reportHeaderAr: null,
  reportFooterEn: null,
  reportFooterAr: null,
  colourApprovalReference: null,
  version: 0,
  updatedAt: null,
  updatedBy: null,
  ...over,
});
const BRANDING_ADMIN: Permission[] = ["organization.read", "branding.configure"];
const demo = (synthetic: boolean) =>
  route("GET", /\/api\/v1\/environment$/, () => ({
    status: 200,
    body: {
      kind: synthetic ? "demo" : "production",
      synthetic,
      datasetCode: synthetic ? "international_roaming" : null,
      datasetVersion: synthetic ? "1.0.0" : null,
      syntheticClockAt: synthetic ? "2026-09-01T06:00:00Z" : null,
    },
  }));

describe("Branding Settings", () => {
  for (const lang of LANGS) {
    it(`${lang}: publishes with If-Match "0", then a stale save shows the conflict; a 422 is shown by its code`, async () => {
      let puts = 0;
      const { requests } = mockApi(
        meRoute(lang, BRANDING_ADMIN),
        route("GET", /\/api\/v1\/admin\/branding$/, () => ({ status: 200, body: settings() })),
        route("GET", /\/api\/v1\/admin\/branding\/versions/, () => ({
          status: 200,
          body: { items: [], nextCursor: null },
        })),
        route("PUT", /\/api\/v1\/admin\/branding$/, () => {
          puts += 1;
          if (puts === 1) return problem(422, "branding.prohibited_claim");
          if (puts === 2)
            return {
              status: 200,
              body: settings({ versionNo: 1, version: 1, source: "configured", productNameEn: "Roaming Hub" }),
            };
          return {
            status: 409,
            body: { type: "urn:mth:problem:version-conflict", title: "c", status: 409, code: "version_conflict" },
          };
        }),
      );
      renderApp("/admin/branding", { i18n: createI18n(lang) });
      expect(await screen.findByRole("heading", { level: 1, name: P(lang).branding.title })).toBeTruthy();
      const name = await screen.findByLabelText(
        new RegExp(P(lang).branding.field.productNameEn.replace(/[()]/g, "\\$&")),
      );
      fireEvent.change(name, { target: { value: "Roaming Hub" } });
      const publish = screen.getByRole("button", { name: P(lang).branding.publish });
      fireEvent.click(publish);
      expect(await screen.findByText(PROBLEMS(lang)["branding__prohibited_claim"]!, { exact: false })).toBeTruthy();
      fireEvent.click(publish);
      expect(await screen.findByText(P(lang).branding.savedVersion.replace("{{n}}", "1"))).toBeTruthy();
      const sent = requests.filter((r) => r.method === "PUT");
      expect(sent[0]!.headers["if-match"]).toBe('"0"');
      expect(sent[1]!.headers["if-match"]).toBe('"0"');
      expect((sent[1]!.body as { productNameEn: string }).productNameEn).toBe("Roaming Hub");
      fireEvent.click(screen.getByRole("button", { name: P(lang).branding.publish }));
      await waitFor(() => expect(document.querySelector("[data-state='conflict']")).toBeTruthy());
      expect(requests.filter((r) => r.method === "PUT")[2]!.headers["if-match"]).toBe('"1"');
    });
  }

  it("a user without branding.configure gets the no-permission state (403)", async () => {
    mockApi(
      meRoute("en", ["organization.read", "user.read", "access.read"]),
      route("GET", /\/api\/v1\/admin\/branding$/, () => problem(403, "forbidden")),
    );
    renderApp("/admin/branding", { i18n: createI18n("en") });
    await waitFor(() => expect(document.querySelector("[data-state='no-permission']")).toBeTruthy());
    expect(document.querySelector("form[data-form='branding']")).toBeNull();
  });
});

describe("the shell: configured name, demo labels and server navigation", () => {
  const configured = route("GET", /\/api\/v1\/branding$/, () => ({
    status: 200,
    body: {
      versionNo: 2,
      source: "configured",
      productNameEn: "Roaming Hub",
      productNameAr: "منصة التجوال",
      primaryColour: "#0078FF",
      secondaryColour: "#003B73",
      coloursProvisional: true,
      fontLatin: "IBM Plex Sans",
      fontArabic: "IBM Plex Sans Arabic",
      logo: null,
      wordmarkProvisional: true,
      reportHeaderEn: null,
      reportHeaderAr: null,
      reportFooterEn: null,
      reportFooterAr: null,
    },
  }));
  for (const lang of LANGS) {
    it(`${lang}: the header shows the configured name; a demo database shows the banner on every screen`, async () => {
      mockApi(meRoute(lang), configured, demo(true));
      renderApp("/about", { i18n: createI18n(lang) });
      await waitFor(() =>
        expect(screen.getByTestId("wordmark").textContent).toContain(lang === "ar" ? "منصة التجوال" : "Roaming Hub"),
      );
      const banner = await found("[data-state='demo-synthetic']");
      expect(banner.textContent).toContain(P(lang).demo.banner);
      expect(screen.getByRole("link", { name: P(lang).walkthrough.navLabel })).toBeTruthy();
    });
  }

  it("production (or an unanswered /environment) shows no synthetic label", async () => {
    mockApi(meRoute("en"), demo(false));
    renderApp("/about", { i18n: createI18n("en") });
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(screen.getByTestId("wordmark")).toBeTruthy());
    expect(document.querySelector("[data-state='demo-synthetic']")).toBeNull();
    cleanup();
    mockApi(meRoute("en"));
    renderApp("/about", { i18n: createI18n("en") });
    await screen.findByRole("heading", { level: 1 });
    expect(document.querySelector("[data-state='demo-synthetic']")).toBeNull();
  });
});

describe("the walkthrough and the environment screen", () => {
  for (const lang of LANGS) {
    it(`${lang}: outside a demo database the walkthrough shows environment.not_demo; in one it lists 12 steps`, async () => {
      mockApi(
        meRoute(lang),
        route("GET", /\/api\/v1\/demo\/walkthrough/, () => problem(409, "environment.not_demo")),
      );
      renderApp("/walkthrough", { i18n: createI18n(lang) });
      const note = await found("[data-state='not-demo']");
      expect(note.textContent).toContain(PROBLEMS(lang)["environment__not_demo"]);
      cleanup();
      const steps = Array.from({ length: 12 }, (_, i) => ({
        code: `step_${i + 1}`,
        ordinal: i + 1,
        titleEn: `Step ${i + 1}`,
        titleAr: `الخطوة ${i + 1}`,
        areaCode: "transformations",
        route: "/transformations",
        completed: i === 0,
      }));
      mockApi(
        meRoute(lang),
        demo(true),
        route("GET", /\/api\/v1\/demo\/walkthrough/, () => ({
          status: 200,
          body: { transformationId: null, steps, completedCount: 1, total: 12 },
        })),
      );
      renderApp("/walkthrough", { i18n: createI18n(lang) });
      await waitFor(() => expect(document.querySelectorAll("[data-step]")).toHaveLength(12));
      expect(document.querySelector("[data-step='step_1']")!.getAttribute("data-completed")).toBe("yes");
      expect(await screen.findByText(P(lang).demo.approvalLabel, { exact: false })).toBeTruthy();
    });
  }

  it("the reset of a production database is refused with environment.not_demo, sent with If-Match", async () => {
    const { requests } = mockApi(
      meRoute("en", ["organization.read", "demo.reset"]),
      route("GET", /\/api\/v1\/admin\/environment$/, () => ({
        status: 200,
        body: { kind: "production", latestRun: null, resetConfigured: false, version: 0 },
      })),
      route("POST", /\/api\/v1\/admin\/environment\/demo-resets$/, () => problem(409, "environment.not_demo")),
    );
    renderApp("/admin/demo", { i18n: createI18n("en") });
    fireEvent.click(await screen.findByRole("button", { name: P("en").environment.requestReset }));
    fireEvent.click(await screen.findByRole("button", { name: P("en").environment.confirm }));
    expect(await screen.findByText(PROBLEMS("en")["environment__not_demo"]!, { exact: false })).toBeTruthy();
    expect(requests.find((r) => r.method === "POST")!.headers["if-match"]).toBe('"0"');
  });
});

describe("problem texts of slices I and J", () => {
  it("every refusal code of ADR-0049 §11 and ADR-0050 §9 has its exact English text and an Arabic text", () => {
    const exact: Record<string, string> = {
      validation__search_query: "Enter a search term of 2 to 200 characters.",
      methodology_block__not_found: "This playbook block does not exist.",
      branding__colour_invalid: "Colours must be six-digit hexadecimal values such as #0078FF.",
      branding__logo_not_found: "No logo is configured; the provisional text wordmark is shown.",
      environment__not_demo: "This is available only in the demo environment.",
      demo_reset__in_progress: "A demo reset is already running.",
      demo_reset__not_configured: "Demo reset is not configured for this deployment.",
    };
    for (const [k, v] of Object.entries(exact)) {
      expect(PROBLEMS("en")[k]).toBe(v);
      expect((PROBLEMS("ar")[k] ?? "").length).toBeGreaterThan(0);
    }
  });
});
