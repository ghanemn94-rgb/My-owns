// The playbook reader's search, provenance, element profiles, guiding questions and the reader namespaces in Studio
// (p5-work-split §I.2 "Tests (literal)"; ADR-0049 §2, §3, §5-§7, §10-§11; REQ-S03-010, REQ-PB-001, REQ-PB-002,
// REQ-PB-011, REQ-PB-077, REQ-S02-004 (Studio link edits); T-DG5-BE-Q2), against the real migrated database:
//  - REQ-S03-010: "value pools" returns the Diagnose blocks; an Arabic query returns hits from search_ar; q of 1
//    character gives 400 validation.search_query; snippets are plain text with highlight offsets (never HTML);
//  - REQ-PB-001: statement.textEn equals B0004 verbatim; REQ-PB-077: realizeNote.textEn contains "aligns with PMI
//    Benefits Realization Management logic";
//  - REQ-PB-002: every B0158-B0162 element returns provenance=custom_extension from
//    listMethodologyElements?provenance=custom_extension (50 rows), and none is labelled a PMI standard;
//  - REQ-PB-011: the four questions render verbatim in en (with ar), and each of the 16 templates has exactly one
//    questionTag;
//  - Studio: profile.phase.diagnose with a questionTag gives 422 methodology_reader.invalid_override, a note claiming
//    certification gives 422 methodology_reader.prohibited_text; AUD gets 403 on these Studio writes.
// Every value is synthetic. Nothing here is a business approval, and nothing touches the engineering gates.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeHeadline, searchTerm } from "../../../src/modules/methodology/search.ts";
import { mapDatabaseGuardError } from "../../../src/modules/platform/db-errors.ts";
import {
  auditOf,
  call,
  createTransformationRow,
  seedWorld,
  signIn,
  startApi,
  type RequestOptions,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";
import { freshKey, pinFixture, seedPublishedVersion } from "./migration-fixtures.ts";

let api: TestApi;
let w: World;
let office: Session;
let nobody: Session;
let auditor: Session;
let admin: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const req = (m: string, u: string, o?: RequestOptions) => call<Body>(api.app, m, u, o);
const M = "/api/v1/methodology";
const V = "/api/v1/admin/methodology-versions";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const fieldCode = (r: { status: number; body: Body }) => [r.status, r.body?.errors?.[0]?.code];
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code, r.body?.detail];
const enc = encodeURIComponent;

/** The SQL claim and engineering-gate rules over a text (ADR-0049 §7). */
async function prohibited(text: string): Promise<boolean> {
  const r = await sql<{ bad: boolean }>`
    SELECT p5_claims_official_pmi(${text}) OR p5_mentions_engineering_gate(${text}) AS bad`.execute(api.db);
  return r.rows[0]!.bad;
}

async function blockText(ref: string): Promise<{ text_en: string; text_ar: string }> {
  return api.db
    .selectFrom("playbook_block")
    .select(["text_en", "text_ar"])
    .where("block_ref", "=", ref)
    .executeTakeFirstOrThrow();
}

/** Every page of a search, following the cursor. */
async function searchAll(query: string, session: Session = nobody): Promise<Body[]> {
  const out: Body[] = [];
  let cursor: string | null = null;
  do {
    const page: { status: number; body: Body } = await req(
      "GET",
      `${M}/search?${query}&limit=5${cursor === null ? "" : `&cursor=${cursor}`}`,
      { session },
    );
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    out.push(...page.body.items);
    cursor = page.body.nextCursor;
  } while (cursor !== null);
  return out;
}

describe("searchMethodology (REQ-S03-010; ADR-0049 §3)", () => {
  it('searching "value pools" returns the Diagnose blocks, ranked, with plain-text snippets and highlights', async () => {
    const res = await req("GET", `${M}/search?q=${enc("value pools")}&lang=en`, { session: nobody });
    expect(res.status).toBe(200);
    expect(res.body.methodologyVersion).toMatchObject({ key: "playbook" });
    const refs = res.body.items.map((h: Body) => h.blockRef);
    // The stemmed English match on the Diagnose section (probe PB03: B0029), and the other source mentions.
    expect(refs).toContain("B0029");
    const diagnose = await searchAll(`q=${enc("value pools")}&lang=en&phase=diagnose`);
    expect(diagnose.length).toBeGreaterThan(0);
    expect(diagnose.map((h) => h.blockRef)).toContain("B0029");
    for (const h of diagnose) expect(h.phaseCode).toBe("diagnose");
    // Every phase-less hit is outside the six phase sections; every Diagnose block that mentions value pools is found.
    const mentions = await api.db
      .selectFrom("playbook_block")
      .select("block_ref")
      .where("phase_code", "=", "diagnose")
      .where(sql<boolean>`text_en ILIKE '%value pools%'`)
      .execute();
    expect(diagnose.map((h) => h.blockRef)).toEqual(expect.arrayContaining(mentions.map((m) => m.block_ref)));
    for (const h of res.body.items) {
      expect(h.lang).toBe("en");
      expect(h.snippet).not.toMatch(/<\/?b>|[\uE000\uE001]/);
      expect(h.highlights.length).toBeGreaterThan(0);
      for (const hl of h.highlights) {
        const word = h.snippet.slice(hl.offset, hl.offset + hl.length).toLowerCase();
        expect(["value", "values", "pool", "pools"]).toContain(word);
      }
      // The snippet is an excerpt of the verbatim block.
      const words = h.snippet.split(/\s+/).filter((x: string) => /^[A-Za-z]{4,}$/.test(x));
      const source = (await blockText(h.blockRef)).text_en;
      for (const x of words) expect(source).toContain(x);
    }
    // Ordered by rank, then block_ref: the pages of the full walk never repeat a block.
    const walk = await searchAll(`q=${enc("value pools")}&lang=en`);
    expect(new Set(walk.map((h) => h.blockRef)).size).toBe(walk.length);
    expect(walk.map((h) => h.blockRef)).toEqual(expect.arrayContaining(refs));
  });

  it("an Arabic query returns hits from search_ar (and the English column does not match it)", async () => {
    const realize = await blockText("B0124");
    // A long Arabic word of the provisional B0124 translation (the Realize note), standing between spaces: in the C
    // locale cluster the default parser keeps Arabic punctuation (U+060C) on a word, so a word followed by it is
    // indexed with it (reported in the BE-Q2 handback).
    const word = realize.text_ar
      .split(/\s+/)
      .filter((x) => /^[\u0621-\u064A]{6,}$/.test(x))
      .sort((a, b) => b.length - a.length)[0]!;
    expect(word).toBeDefined();
    const hits = await searchAll(`q=${enc(word)}&lang=ar`);
    expect(hits.map((h) => h.blockRef)).toContain("B0124");
    for (const h of hits) {
      expect(h.lang).toBe("ar");
      expect((await blockText(h.blockRef)).text_ar.length).toBeGreaterThan(0);
      for (const hl of h.highlights)
        expect(h.snippet.slice(hl.offset, hl.offset + hl.length)).toMatch(/[\u0600-\u06FF]/);
    }
    const en = await req("GET", `${M}/search?q=${enc(word)}&lang=en`, { session: nobody });
    expect(en.body.items).toEqual([]);
    // Without lang, the caller's interface language decides (a new user's preferred_locale defaults to ar).
    const byLocale = await req("GET", `${M}/search?q=${enc(word)}`, { session: nobody });
    expect(byLocale.body.items.length).toBeGreaterThan(0);
    expect(byLocale.body.items[0].lang).toBe("ar");
  });

  it("q of 1 character (or blank, missing, too long, NUL) gives 400 validation.search_query", async () => {
    const detail = "Enter a search term of 2 to 200 characters.";
    for (const q of ["v", " v ", "   ", "\u200F\u200F", "x".repeat(201)]) {
      const r = await req("GET", `${M}/search?q=${enc(q)}`, { session: nobody });
      expect(fieldCode(r), JSON.stringify(q)).toEqual([400, "validation.search_query"]);
      expect(r.body.errors[0].message).toBe(detail);
    }
    expect(fieldCode(await req("GET", `${M}/search`, { session: nobody }))).toEqual([400, "validation.search_query"]);
    expect(fieldCode(await req("GET", `${M}/search?q=ab&q=cd`, { session: nobody }))).toEqual([
      400,
      "validation.search_query",
    ]);
    // Two characters and 200 characters are accepted; websearch syntax never fails.
    expect((await req("GET", `${M}/search?q=G1`, { session: nobody })).status).toBe(200);
    expect((await req("GET", `${M}/search?q=${"x".repeat(200)}`, { session: nobody })).status).toBe(200);
    expect(
      (await req("GET", `${M}/search?q=${enc('"value pools" -nothing OR (&|!')}`, { session: nobody })).status,
    ).toBe(200);
    expect((await req("GET", `${M}/search?q=gate`)).status).toBe(401);
    expect(() => searchTerm("a\u0000b")).toThrow();
    expect(searchTerm("  ab ")).toBe("ab");
  });

  it("decodes the private sentinels into highlight offsets in UTF-16 code units", () => {
    expect(decodeHeadline("a \uE000value\uE001 and \uE000pools\uE001")).toEqual({
      snippet: "a value and pools",
      highlights: [
        { offset: 2, length: 5 },
        { offset: 12, length: 5 },
      ],
    });
    expect(decodeHeadline("😀 \uE000x\uE001")).toEqual({ snippet: "😀 x", highlights: [{ offset: 3, length: 1 }] });
    expect(decodeHeadline("\uE001broken\uE000")).toEqual({ snippet: "broken", highlights: [] });
  });

  it("with transformationId: the pinned version is named, and an unreadable transformation is 404", async () => {
    const tx = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const pinned = await req("GET", `${M}/search?q=gate&lang=en&transformationId=${tx}`, { session: office });
    expect(pinned.status).toBe(200);
    expect(pinned.body.methodologyVersion.key).toBe("playbook");
    expect((await req("GET", `${M}/search?q=gate&transformationId=${tx}`, { session: nobody })).status).toBe(404);
    expect((await req("GET", `${M}/search?q=gate&transformationId=${tx}`, { session: auditor })).status).toBe(200);
  });
});

describe("getMethodologyProvenance (REQ-PB-001, REQ-PB-077; ADR-0049 §5)", () => {
  it("statement.textEn equals B0004 verbatim; realizeNote contains the BRM alignment; no claim of official status", async () => {
    const res = await req("GET", `${M}/provenance`, { session: nobody });
    expect(res.status).toBe(200);
    expect(res.body.statement).toMatchObject({
      blockRef: "B0004",
      textEn:
        "Practical synthesis inspired by PMI Organizational Transformation, Brightline Transformation Compass and PMI Benefits Realization Management; extended with a custom Target Operating Model toolkit.",
      arProvisional: true,
    });
    expect(res.body.statement.textAr.length).toBeGreaterThan(0);
    expect(res.body.realizeNote.blockRef).toBe("B0124");
    expect(res.body.realizeNote.textEn).toContain("aligns with PMI Benefits Realization Management logic");
    expect(res.body.connectionNote.blockRef).toBe("B0024");
    expect(res.body.customExtensions.map((b: Body) => b.blockRef)).toEqual([
      "B0157",
      "B0158",
      "B0159",
      "B0160",
      "B0161",
      "B0162",
    ]);
    expect(res.body.foundations.map((f: Body) => [f.code, f.sourceEn])).toEqual([
      ["pmi_organizational_transformation", "PMI Organizational Transformation Series"],
      ["brightline_transformation_compass", "Brightline Initiative / Transformation Compass"],
      ["pmi_benefits_realization_management", "PMI Benefits Realization Management"],
    ]);
    expect(res.body.note).toBeNull();
    // Each quoted block is the verbatim catalogue text.
    for (const b of [res.body.statement, res.body.connectionNote, res.body.realizeNote, ...res.body.customExtensions])
      expect(b.textEn).toBe((await blockText(b.blockRef)).text_en);
    // No text of the response claims official PMI status or certification, or names DG0-DG7 (M0089).
    const texts: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") texts.push(v);
      else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(res.body);
    for (const t of texts) expect(await prohibited(t), t).toBe(false);
  });

  it("a version's provenance.note is shown beside the statement, which never changes; pinned read 404 without access", async () => {
    const versionId = await seedPublishedVersion(api, "methodology", freshKey("methodology"), 1, [
      {
        elementType: "methodology_text",
        stableKey: "provenance.note",
        origin: "admin",
        attributes: {
          bodyEn: "Synthetic note: adapted for Mobily.",
          bodyAr: "ملاحظة تجر\u064Aب\u064Aة: مك\u064Aّفة لموبا\u064Aل\u064A.",
        },
      },
    ]);
    const tx = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    await pinFixture(api, {
      organizationId: w.orgA.id,
      transformationId: tx,
      kind: "methodology",
      versionId,
      by: w.office.id,
    });
    const pinned = await req("GET", `${M}/provenance?transformationId=${tx}`, { session: office });
    expect(pinned.status).toBe(200);
    expect(pinned.body.methodologyVersion.versionId).toBe(versionId);
    expect(pinned.body.note).toEqual({
      bodyEn: "Synthetic note: adapted for Mobily.",
      bodyAr: "ملاحظة تجر\u064Aب\u064Aة: مك\u064Aّفة لموبا\u064Aل\u064A.",
    });
    const base = await req("GET", `${M}/provenance`, { session: office });
    expect(pinned.body.statement).toEqual(base.body.statement);
    expect(base.body.note).toBeNull();
    expect((await req("GET", `${M}/provenance?transformationId=${tx}`, { session: nobody })).status).toBe(404);
    expect((await req("GET", `${M}/provenance`)).status).toBe(401);
  });
});

describe("listMethodologyElements and listGuidingQuestions (REQ-PB-002, REQ-PB-011; ADR-0049 §2)", () => {
  it("every B0158-B0162 element returns provenance=custom_extension (50 rows); none is labelled a PMI standard", async () => {
    const res = await req("GET", `${M}/elements?provenance=custom_extension`, { session: nobody });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(50);
    const byKind = new Map<string, number>();
    for (const e of res.body.items) {
      expect(e.provenance).toBe("custom_extension");
      expect(["B0158", "B0159", "B0160", "B0161", "B0162"]).toContain(e.provenanceSourceRef);
      expect(e.overridden).toBe(false);
      byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
    }
    expect(Object.fromEntries(byKind)).toEqual({
      phase: 6,
      gate: 6,
      tom_dimension: 10,
      template: 16,
      scoring_model: 1,
      forum: 5,
      launch_window: 3,
      health_check: 1,
      roaming_example: 1,
      traceability_chain: 1,
    });
    const all = await req("GET", `${M}/elements`, { session: nobody });
    expect(all.body.items).toHaveLength(56);
    const inspired = all.body.items.filter((e: Body) => e.provenance === "foundation_inspired");
    expect(inspired.map((e: Body) => [e.kind, e.provenanceSourceRef])).toEqual(
      Array.from({ length: 6 }, () => ["benefit_lifecycle_step", "B0156"]),
    );
    for (const e of all.body.items) {
      expect(e.provenance).not.toMatch(/standard|official|certif/i);
      expect(`${e.labelEn} ${e.labelAr}`).not.toMatch(/PMI standard|official|certif/i);
      expect(await prohibited(e.labelEn)).toBe(false);
      expect(await prohibited(e.labelAr)).toBe(false);
      expect(e.labelEn.length).toBeGreaterThan(0);
      expect(e.labelAr.length).toBeGreaterThan(0);
    }
    expect(all.body.items[0]).toMatchObject({ elementRef: "phase.diagnose", kind: "phase", ordinal: 1 });
    expect((await req("GET", `${M}/elements?kind=template`, { session: nobody })).body.items).toHaveLength(16);
  });

  it("the four questions render verbatim in en (with ar); each of the 16 templates has exactly one questionTag", async () => {
    const res = await req("GET", `${M}/guiding-questions`, { session: nobody });
    expect(res.status).toBe(200);
    expect(res.body.items.map((q: Body) => [q.code, q.ordinal, q.textEn, q.sourceRef])).toEqual([
      ["why_change", 1, "Why change?", "B0016"],
      ["what_different", 2, "What must become different?", "B0016"],
      ["how_execute", 3, "How will we execute?", "B0016"],
      ["how_prove_value", 4, "How will we prove value?", "B0016"],
    ]);
    const b0016 = (await blockText("B0016")).text_en;
    for (const q of res.body.items) {
      expect(b0016).toContain(q.textEn);
      expect(q.textAr).toMatch(/[\u0600-\u06FF]/);
    }
    const templates = (await req("GET", `${M}/elements?kind=template`, { session: nobody })).body.items;
    expect(templates.map((t: Body) => t.stableKey)).toEqual(
      Array.from({ length: 16 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`),
    );
    const codes = new Set(res.body.items.map((q: Body) => q.code));
    for (const t of templates) expect(codes.has(t.questionTag), t.stableKey).toBe(true);
    expect(templates.find((t: Body) => t.stableKey === "T01").questionTag).toBe("why_change");
    const others = (await req("GET", `${M}/elements`, { session: nobody })).body.items.filter(
      (e: Body) => e.kind !== "template",
    );
    for (const e of others) expect(e.questionTag, e.elementRef).toBeNull();
    expect((await req("GET", `${M}/guiding-questions`)).status).toBe(401);
  });

  it("a version's profile overrides resolve per version, with overridden = true; other versions keep the seed", async () => {
    const versionId = await seedPublishedVersion(api, "methodology", freshKey("methodology"), 1, [
      {
        elementType: "methodology_text",
        stableKey: "profile.template.T05",
        origin: "admin",
        attributes: { questionTag: "how_prove_value" },
      },
      {
        elementType: "methodology_text",
        stableKey: "profile.benefit_lifecycle_step.measure",
        origin: "admin",
        attributes: { provenance: "custom_extension" },
      },
    ]);
    const pinned = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const other = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    await pinFixture(api, {
      organizationId: w.orgA.id,
      transformationId: pinned,
      kind: "methodology",
      versionId,
      by: w.office.id,
    });
    const v = await req("GET", `${M}/elements?transformationId=${pinned}`, { session: office });
    expect(v.body.methodologyVersion.versionId).toBe(versionId);
    const find = (items: Body[], ref: string) => items.find((e: Body) => e.elementRef === ref);
    expect(find(v.body.items, "template.T05")).toMatchObject({ questionTag: "how_prove_value", overridden: true });
    expect(find(v.body.items, "benefit_lifecycle_step.measure")).toMatchObject({
      provenance: "custom_extension",
      overridden: true,
    });
    expect(find(v.body.items, "template.T06")).toMatchObject({ questionTag: "how_execute", overridden: false });
    const custom = await req("GET", `${M}/elements?transformationId=${pinned}&provenance=custom_extension`, {
      session: office,
    });
    expect(custom.body.items).toHaveLength(51);
    for (const query of ["", `?transformationId=${other}`]) {
      const seed = (await req("GET", `${M}/elements${query}`, { session: office })).body.items;
      expect(find(seed, "template.T05")).toMatchObject({ questionTag: "how_execute", overridden: false });
      expect(find(seed, "benefit_lifecycle_step.measure").provenance).toBe("foundation_inspired");
    }
    expect((await req("GET", `${M}/elements?transformationId=${pinned}`, { session: nobody })).status).toBe(404);
  });
});

describe("the reader namespaces in Studio (ADR-0049 §6, §11)", () => {
  async function freshDraft(): Promise<{ id: string; version: number }> {
    const base = await seedStudioBase(api, "methodology");
    const res = await req("POST", V, { session: admin, body: { basedOnVersionId: base.id } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { id: res.body.id, version: res.body.version };
  }
  const put = (id: string, key: string, version: number, attributes: Record<string, unknown>, s = admin) =>
    req("PUT", `${V}/${id}/elements/methodology_text/${key}`, {
      session: s,
      headers: ifm(version),
      body: { attributes },
    });

  it("profile.phase.diagnose with a questionTag gives 422 methodology_reader.invalid_override (and the other refusals)", async () => {
    const d = await freshDraft();
    const override =
      "A provenance or question-tag override must name a seeded element, use an allowed value, and tag only a template.";
    const link =
      "A block link must name an existing block and a template, procedure or requirement in the allowed format.";
    const cases: [string, Record<string, unknown>, string, string][] = [
      ["profile.phase.diagnose", { questionTag: "why_change" }, "methodology_reader.invalid_override", override],
      ["profile.template.T01", { questionTag: "why_not" }, "methodology_reader.invalid_override", override],
      ["profile.template.T99", { provenance: "custom_extension" }, "methodology_reader.invalid_override", override],
      ["profile.gate.G1", { provenance: "pmi_standard" }, "methodology_reader.invalid_override", override],
      ["profile.gate.G1", { provenance: null }, "methodology_reader.invalid_override", override],
      [
        "profile.template.T01",
        { linksAdded: [{ targetKind: "template", targetKey: "T02" }] },
        "methodology_reader.invalid_override",
        override,
      ],
      ["help.charter", { provenance: "custom_extension" }, "methodology_reader.invalid_override", override],
      ["provenance.note", { questionTag: "why_change" }, "methodology_reader.invalid_override", override],
      ["block.B0999", { bodyEn: "Synthetic" }, "methodology_reader.invalid_block_link", link],
      ["block.B0031", { provenance: "custom_extension" }, "methodology_reader.invalid_block_link", link],
      [
        "block.B0031",
        { linksAdded: [{ targetKind: "form", targetKey: "T01" }] },
        "methodology_reader.invalid_block_link",
        link,
      ],
      [
        "block.B0031",
        { linksRemoved: [{ targetKind: "template", targetKey: "T17" }] },
        "methodology_reader.invalid_block_link",
        link,
      ],
      ["block.B0031", { linksAdded: "T01" }, "methodology_reader.invalid_block_link", link],
      [
        "block.B0031",
        { linksAdded: Array.from({ length: 51 }, () => ({ targetKind: "template", targetKey: "T01" })) },
        "methodology_reader.invalid_block_link",
        link,
      ],
      ["help.charter", { linksAdded: [] }, "methodology_reader.invalid_block_link", link],
    ];
    for (const [key, attributes, code, detail] of cases) {
      const r = await put(d.id, key, d.version, attributes);
      expect(codeOf(r), `${key} ${JSON.stringify(attributes).slice(0, 80)}`).toEqual([422, code, detail]);
    }
    // Nothing was written.
    const rows = await api.db
      .selectFrom("methodology_element")
      .select("stable_key")
      .where("methodology_version_id", "=", d.id)
      .execute();
    expect(rows).toEqual([]);
  });

  it("a note claiming certification gives 422 methodology_reader.prohibited_text (and a DG0-DG7 name too)", async () => {
    const d = await freshDraft();
    const detail =
      "Reader text must not claim official PMI status or certification, or name an engineering delivery gate.";
    for (const [key, attributes] of [
      ["provenance.note", { bodyEn: "This methodology is PMI certified." }],
      ["provenance.note", { bodyAr: "منهج\u064Aة معتمدة من PMI" }],
      ["provenance.note", { bodyEn: "This is an official PMI standard product." }],
      ["block.B0031", { bodyEn: "Release only after DG7 passes." }],
      ["profile.template.T01", { questionTag: "why_change", labelEn: "PMI-certified template" }],
    ] as const) {
      expect(codeOf(await put(d.id, key, d.version, attributes)), key).toEqual([
        422,
        "methodology_reader.prohibited_text",
        detail,
      ]);
    }
    // A true disclaimer is allowed, and so is ordinary text outside the reader namespaces (help.charter is untouched).
    const ok = await put(d.id, "provenance.note", d.version, {
      bodyEn: "Not an official PMI standard; a practical synthesis.",
      bodyAr: "ل\u064Aست مع\u064Aارًا رسم\u064Aًا من PMI؛ بل تول\u064Aفة عمل\u064Aة.",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("valid reader edits are accepted with one audit event each; If-Match is required (428) and current (409)", async () => {
    const d = await freshDraft();
    let version = d.version;
    const edits: [string, Record<string, unknown>][] = [
      ["profile.template.T05", { questionTag: "how_prove_value" }],
      ["profile.benefit_lifecycle_step.measure", { provenance: "foundation_inspired" }],
      [
        "block.B0031",
        {
          bodyEn: "Synthetic guidance.",
          bodyAr: "إرشاد تجر\u064Aب\u064A.",
          linksAdded: [{ targetKind: "procedure", targetKey: "baseline_validation" }],
          linksRemoved: [{ targetKind: "requirement", targetKey: "REQ-PB-026" }],
        },
      ],
      ["provenance.note", { bodyEn: "Synthetic note.", bodyAr: "ملاحظة تجر\u064Aب\u064Aة." }],
    ];
    for (const [key, attributes] of edits) {
      const r = await put(d.id, key, version, attributes);
      expect(r.status, `${key} ${JSON.stringify(r.body)}`).toBe(200);
      version = r.body.version;
      const row = await api.db
        .selectFrom("methodology_element")
        .select(["id", "attributes"])
        .where("methodology_version_id", "=", d.id)
        .where("stable_key", "=", key)
        .executeTakeFirstOrThrow();
      expect(row.attributes).toEqual(attributes);
      expect((await auditOf(api.db, row.id)).map((a) => a.action)).toHaveLength(1);
    }
    const missing = await req("PUT", `${V}/${d.id}/elements/methodology_text/profile.template.T06`, {
      session: admin,
      body: { attributes: { questionTag: "how_prove_value" } },
    });
    expect(missing.status).toBe(428);
    const stale = await put(d.id, "profile.template.T06", d.version, { questionTag: "how_prove_value" });
    expect(stale.status).toBe(409);
    // The draft's elements resolve the overrides for that draft only.
    const els = await req("GET", `${V}/${d.id}/elements?elementType=methodology_text`, { session: admin });
    expect(els.body.items.map((e: Body) => e.stableKey).sort()).toEqual(edits.map(([k]) => k).sort());
  });

  it("AUD gets 403 on these Studio writes; TO too; nothing is written", async () => {
    const d = await freshDraft();
    for (const s of [auditor, office]) {
      for (const [key, attributes] of [
        ["profile.template.T05", { questionTag: "how_prove_value" }],
        ["block.B0031", { linksAdded: [{ targetKind: "template", targetKey: "T02" }] }],
        ["provenance.note", { bodyEn: "Synthetic note." }],
      ] as const) {
        const r = await put(d.id, key, d.version, attributes, s);
        expect(r.status, key).toBe(403);
      }
    }
    const rows = await api.db
      .selectFrom("methodology_element")
      .select("id")
      .where("methodology_version_id", "=", d.id)
      .execute();
    expect(rows).toEqual([]);
  });

  it("the database guard is the last line, with the same codes (methodology_element_reader_*)", () => {
    const map = (constraint: string) => {
      const p = mapDatabaseGuardError({ code: "23514", constraint });
      return [p?.status, p?.code];
    };
    expect(map("methodology_element_reader_namespace")).toEqual([422, "methodology_reader.invalid_override"]);
    expect(map("methodology_element_reader_profile")).toEqual([422, "methodology_reader.invalid_override"]);
    expect(map("methodology_element_reader_block")).toEqual([422, "methodology_reader.invalid_block_link"]);
    expect(map("methodology_element_reader_text")).toEqual([422, "methodology_reader.prohibited_text"]);
    expect(mapDatabaseGuardError({ code: "23503", constraint: "methodology_element_reader_profile" })?.code).toBe(
      "methodology_reader.invalid_override",
    );
  });
});
