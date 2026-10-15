// The playbook reader's blocks and links (p5-work-split §I.1 "Tests (literal)"; ADR-0049 §1, §4, §10-§11; REQ-S02-004,
// REQ-S03-010; T-DG5-BE-Q), against the real migrated database:
//  - 165/165 blocks equal docs/source/playbook.md (read once: a fixed source file, never a growing delivery folder,
//    D-138), parsed here independently of the 0092 generator; text_en cannot be changed (playbook_block_immutable);
//  - REQ-S02-004: block B0031 lists a link that opens the T01 register; listTemplateSourceLinks(T01) returns B0031;
//  - a version adding a procedure link and removing a seeded one changes only that version's resolved list;
//  - a pinned read without transformation.read gives 404; `launchable` follows the slice C launch check.
// Every value is synthetic. Nothing here is a business approval, and nothing touches the engineering gates.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, type Tx } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "../../../src/modules/platform/db-errors.ts";
import {
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
import { freshKey, pinFixture, seedPublishedVersion } from "./migration-fixtures.ts";

const PLAYBOOK = fileURLToPath(new URL("../../../../../docs/source/playbook.md", import.meta.url));

let api: TestApi;
let w: World;
let office: Session;
let nobody: Session;
let auditor: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  auditor = await signIn(api.app, w.auditor.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const req = (m: string, u: string, o?: RequestOptions) => call<Body>(api.app, m, u, o);
const B = "/api/v1/methodology/blocks";
const T = "/api/v1/methodology/templates";
const keysOf = (items: { targetKind: string; targetKey: string }[]) =>
  items.map((l) => `${l.targetKind}:${l.targetKey}`);

/**
 * The anchored blocks of the source file, by a second reading independent of the generator: each anchor ends the
 * text since the previous block (leading newlines and the one space before the anchor dropped); a table anchor
 * starts the Markdown rows that follow it.
 */
function sourceBlocks(): Map<string, { kind: "text" | "table"; text: string }> {
  const src = readFileSync(PLAYBOOK, "utf8");
  const out = new Map<string, { kind: "text" | "table"; text: string }>();
  const header = src.indexOf("-->", src.indexOf("<!-- footer1:")) + "-->".length;
  let from = header;
  for (const m of src.matchAll(/<!-- (B0\d{3})( table)? -->/g)) {
    const at = m.index;
    if (m[2] === undefined) {
      const raw = src.slice(from, at);
      expect(raw.endsWith(" "), m[1]).toBe(true);
      out.set(m[1]!, { kind: "text", text: raw.replace(/^\n+/, "").slice(0, -1) });
      from = at + m[0].length;
    } else {
      expect(src.slice(from, at).trim(), `${m[1]} is preceded by text`).toBe("");
      const rest = src.slice(at + m[0].length + 1).split("\n");
      const rows: string[] = [];
      for (const line of rest) {
        if (!line.startsWith("|")) break;
        rows.push(line);
      }
      out.set(m[1]!, { kind: "table", text: rows.join("\n") });
      from = at + m[0].length + 1 + rows.join("\n").length;
    }
  }
  return out;
}

describe("the 165 verbatim playbook blocks (0092)", () => {
  it("165/165 blocks equal docs/source/playbook.md at their anchors; the Arabic is provisional", async () => {
    const source = sourceBlocks();
    expect(source.size).toBe(165);
    const rows = await api.db.selectFrom("playbook_block").selectAll().orderBy("ordinal").execute();
    expect(rows).toHaveLength(165);
    let equal = 0;
    for (const r of rows) {
      const s = source.get(r.block_ref);
      expect(s, r.block_ref).toBeDefined();
      expect(r.text_en, r.block_ref).toBe(s!.text);
      expect(r.block_kind, r.block_ref).toBe(s!.kind);
      expect(r.ordinal).toBe(Number(r.block_ref.slice(1)));
      expect(r.ar_provisional, r.block_ref).toBe(true);
      expect(r.text_ar.trim().length, r.block_ref).toBeGreaterThan(0);
      if (r.block_kind === "table") expect(r.text_ar.split("\n").length, r.block_ref).toBe(s!.text.split("\n").length);
      if (r.text_en === s!.text) equal += 1;
    }
    expect(equal).toBe(165);
    // Spot checks of the source itself (B0004 is REQ-PB-001's statement; B0031 the T01 table).
    expect(rows[3]!.text_en).toBe(
      "Practical synthesis inspired by PMI Organizational Transformation, Brightline Transformation Compass and PMI Benefits Realization Management; extended with a custom Target Operating Model toolkit.",
    );
    expect(rows[30]!.text_en.split("\n")[0]).toBe(
      "| Dimension | Current state | Evidence / baseline | Root cause | Impact | Confidence |",
    );
  });

  it("follows the playbook's structure: the six phase sections, headings and the section each block sits under", async () => {
    const rows = await api.db
      .selectFrom("playbook_block")
      .select(["block_ref", "is_heading", "section_block_ref", "phase_code", "text_en"])
      .orderBy("ordinal")
      .execute();
    const phase = (from: number, to: number) => rows.slice(from - 1, to).map((r) => r.phase_code);
    const ranges: [string, number, number][] = [
      ["diagnose", 25, 43],
      ["define", 44, 51],
      ["design", 52, 65],
      ["mobilize", 66, 88],
      ["transform", 89, 116],
      ["realize", 117, 131],
    ];
    for (const [code, from, to] of ranges) {
      expect(new Set(phase(from, to)), code).toEqual(new Set([code]));
      expect(rows[from - 1]!.text_en).toMatch(/^PHASE [1-6]$/);
    }
    expect(new Set([...phase(1, 24), ...phase(132, 165)])).toEqual(new Set([null]));
    const byRef = new Map(rows.map((r) => [r.block_ref, r]));
    expect(byRef.get("B0030")).toMatchObject({ is_heading: true, section_block_ref: "B0026" });
    expect(byRef.get("B0031")).toMatchObject({ is_heading: false, section_block_ref: "B0030" });
    expect(byRef.get("B0026")).toMatchObject({ is_heading: true, section_block_ref: "B0025" });
    expect(byRef.get("B0025")).toMatchObject({ is_heading: true, section_block_ref: null });
    for (const r of rows) if (r.section_block_ref !== null) expect(r.section_block_ref < r.block_ref).toBe(true);
  });

  it("text_en, position and section can never change and no block is deleted (playbook_block_immutable)", async () => {
    const owner = createDb(api.owner);
    const attempt = async (fn: (tx: Tx) => Promise<unknown>) => {
      try {
        await owner.transaction().execute(fn);
        return null;
      } catch (err) {
        return err as { code?: string; constraint?: string };
      }
    };
    const change = await attempt((tx) =>
      tx.updateTable("playbook_block").set({ text_en: "Changed" }).where("block_ref", "=", "B0031").execute(),
    );
    expect([change?.code, change?.constraint]).toEqual(["23514", "playbook_block_immutable"]);
    const move = await attempt((tx) =>
      tx.updateTable("playbook_block").set({ section_block_ref: "B0001" }).where("block_ref", "=", "B0031").execute(),
    );
    expect(move?.constraint).toBe("playbook_block_immutable");
    const drop = await attempt((tx) => tx.deleteFrom("playbook_block").where("block_ref", "=", "B0165").execute());
    expect(drop?.constraint).toBe("playbook_block_immutable");
    const link = await attempt((tx) => tx.deleteFrom("playbook_block_link").where("block_ref", "=", "B0031").execute());
    expect(link).not.toBeNull();
    // Only the provisional Arabic may be corrected (by a migration, as the owner); rolled back here.
    const rolledBack = new Error("rollback");
    const ar = await attempt(async (tx) => {
      await tx.updateTable("playbook_block").set({ text_ar: "تصحيح" }).where("block_ref", "=", "B0031").execute();
      throw rolledBack;
    });
    expect(ar).toBe(rolledBack);
    // mth_app (the server's role) holds SELECT only.
    const app = await api.db
      .updateTable("playbook_block")
      .set({ text_ar: "x" })
      .where("block_ref", "=", "B0031")
      .execute()
      .then(
        () => null,
        (err: { code?: string }) => err.code,
      );
    expect(app).toBe("42501");
    // The API maps these guards to a 500 (a programming error), never to a user-facing refusal.
    expect(mapDatabaseGuardError({ code: "23514", constraint: "playbook_block_immutable" })?.status).toBe(500);
    expect(mapDatabaseGuardError({ code: "23514", constraint: "playbook_block_link_target_shape" })?.status).toBe(500);
  });

  it("lists the blocks in source order with a phase filter and cursor pages; gets one block; 404 for an unknown ref", async () => {
    const all: Body[] = [];
    let cursor: string | null = null;
    do {
      const page: { status: number; body: Body } = await req(
        "GET",
        `${B}?limit=100${cursor === null ? "" : `&cursor=${cursor}`}`,
        { session: nobody },
      );
      expect(page.status).toBe(200);
      all.push(...page.body.items);
      cursor = page.body.nextCursor;
    } while (cursor !== null);
    expect(all.map((b) => b.blockRef)).toEqual(
      Array.from({ length: 165 }, (_, i) => `B${String(i + 1).padStart(4, "0")}`),
    );
    expect(all[0].methodologyVersion).toMatchObject({ key: "playbook" });
    const diagnose = await req("GET", `${B}?phase=diagnose&limit=100`, { session: nobody });
    expect(diagnose.body.items.map((b: Body) => b.blockRef)).toEqual(
      Array.from({ length: 19 }, (_, i) => `B${String(i + 25).padStart(4, "0")}`),
    );
    const one = await req("GET", `${B}/B0031`, { session: nobody });
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({
      blockRef: "B0031",
      blockKind: "table",
      isHeading: false,
      sectionBlockRef: "B0030",
      phaseCode: "diagnose",
      arProvisional: true,
      guidanceEn: null,
      guidanceAr: null,
    });
    expect(one.body.linkCount).toBeGreaterThanOrEqual(1);
    const unknown = await req("GET", `${B}/B0166`, { session: nobody });
    expect([unknown.status, unknown.body.code, unknown.body.detail]).toEqual([
      404,
      "methodology_block.not_found",
      "This playbook block does not exist.",
    ]);
    expect((await req("GET", B)).status).toBe(401);
  });
});

describe("block <-> template, procedure and requirement links (REQ-S02-004)", () => {
  it("block B0031 lists a link that opens the T01 register; listTemplateSourceLinks(T01) returns B0031", async () => {
    const tx = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const links = await req("GET", `${B}/B0031/links`, { session: nobody });
    expect(links.status).toBe(200);
    const t01 = links.body.items.find((l: Body) => l.targetKind === "template" && l.targetKey === "T01");
    expect(t01).toMatchObject({
      labelEn: "Template 1 — Current-State Diagnostic",
      labelAr: "النموذج 1 — تشخيص الوضع الحالي",
      origin: "seed",
      launchable: false,
      route: "/transformations",
    });
    // The register's requirement row (REQ-PB-026 cites B0031) is linked too.
    expect(keysOf(links.body.items)).toContain("requirement:REQ-PB-026");
    // In a transformation the link opens that transformation's T01 register.
    const inTx = await req("GET", `${B}/B0031/links?transformationId=${tx}`, { session: office });
    expect(inTx.body.items.find((l: Body) => l.targetKey === "T01").route).toBe(`/transformations/${tx}/diagnose`);
    // The other direction: the T01 form's source link back to its playbook text.
    const back = await req("GET", `${T}/T01/source-links`, { session: nobody });
    expect(back.status).toBe(200);
    expect(back.body.items.map((b: Body) => b.blockRef)).toEqual(["B0030", "B0031"]);
    expect(back.body.items[1]).toMatchObject({ blockRef: "B0031", ordinal: 31, phaseCode: "diagnose" });
    expect(back.body.items[1].excerptEn.startsWith("| Dimension | Current state |")).toBe(true);
    // Every template T01-T16 links back to its heading and table blocks.
    for (let n = 1; n <= 16; n += 1) {
      const code = `T${String(n).padStart(2, "0")}`;
      const r = await req("GET", `${T}/${code}/source-links`, { session: nobody });
      expect(r.body.items.length, code).toBe(2);
    }
    // The procedure links of the seed: gate review on the stage gates (B0023).
    const gates = await req("GET", `${B}/B0023/links`, { session: nobody });
    expect(gates.body.items.find((l: Body) => l.targetKind === "procedure")).toMatchObject({
      targetKey: "gate_review",
      labelEn: "Gate review",
      route: "/admin/procedures/gate_review",
      origin: "seed",
    });
  });

  it("launchable follows the slice C launch check: launch role and scope in the reader's context", async () => {
    const tx = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const launchable = async (session: Session, query: string) =>
      (await req("GET", `${B}/B0023/links${query}`, { session })).body.items.find(
        (l: Body) => l.targetKey === "gate_review",
      ).launchable;
    // TO launches gate_review (launch roles TL, TO) inside a transformation it can read.
    expect(await launchable(office, `?transformationId=${tx}`)).toBe(true);
    // Without a transformation the transformation-scoped procedure does not match the scope.
    expect(await launchable(office, "")).toBe(false);
    // AUD reads the transformation but holds no launch role; nobody holds nothing.
    expect(await launchable(auditor, `?transformationId=${tx}`)).toBe(false);
    expect(await launchable(nobody, "")).toBe(false);
  });

  it("a version adding a procedure link and removing a seeded one changes only that version's resolved list", async () => {
    const versionId = await seedPublishedVersion(api, "methodology", freshKey("methodology"), 1, [
      {
        elementType: "methodology_text",
        stableKey: "block.B0031",
        origin: "admin",
        attributes: {
          bodyEn: "Synthetic guidance: start with the financial dimension.",
          bodyAr: "إرشاد تجريبي: ابدأ بالبُعد المالي.",
          linksAdded: [{ targetKind: "procedure", targetKey: "baseline_validation" }],
          linksRemoved: [
            { targetKind: "requirement", targetKey: "REQ-PB-026" },
            { targetKind: "template", targetKey: "T01" },
          ],
        },
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
    const linksOf = async (query: string) => req("GET", `${B}/B0031/links${query}`, { session: office });

    const v = await linksOf(`?transformationId=${pinned}`);
    expect(v.status).toBe(200);
    expect(v.body.methodologyVersion.versionId).toBe(versionId);
    expect(keysOf(v.body.items)).toContain("procedure:baseline_validation");
    expect(keysOf(v.body.items)).not.toContain("requirement:REQ-PB-026");
    expect(keysOf(v.body.items)).not.toContain("template:T01");
    expect(v.body.items.find((l: Body) => l.targetKey === "baseline_validation").origin).toBe("version");

    // The published playbook and another transformation's (v1) list keep the seed.
    for (const query of ["", `?transformationId=${other}`]) {
      const seed = await linksOf(query);
      expect(seed.body.methodologyVersion.key, query).toBe("playbook");
      expect(keysOf(seed.body.items), query).toContain("requirement:REQ-PB-026");
      expect(keysOf(seed.body.items), query).toContain("template:T01");
      expect(keysOf(seed.body.items), query).not.toContain("procedure:baseline_validation");
    }

    // The block's guidance and link count are that version's too; the verbatim text is the same.
    const block = await req("GET", `${B}/B0031?transformationId=${pinned}`, { session: office });
    const base = await req("GET", `${B}/B0031`, { session: office });
    expect(block.body.guidanceEn).toBe("Synthetic guidance: start with the financial dimension.");
    expect(block.body.guidanceAr).toBe("إرشاد تجريبي: ابدأ بالبُعد المالي.");
    expect(block.body.textEn).toBe(base.body.textEn);
    expect(block.body.linkCount).toBe(v.body.items.length);
    expect(base.body.linkCount).toBe((await linksOf("")).body.items.length);
    expect(base.body.guidanceEn).toBeNull();

    // The reverse direction follows the version: T01's source links lose B0031 only there.
    const back = await req("GET", `${T}/T01/source-links?transformationId=${pinned}`, { session: office });
    expect(back.body.items.map((b: Body) => b.blockRef)).toEqual(["B0030"]);
    const backSeed = await req("GET", `${T}/T01/source-links?transformationId=${other}`, { session: office });
    expect(backSeed.body.items.map((b: Body) => b.blockRef)).toEqual(["B0030", "B0031"]);
  });

  it("a pinned read without transformation.read gives 404 on all four operations (never disclosed)", async () => {
    const tx = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const missing = crypto.randomUUID();
    for (const url of [
      `${B}?transformationId=${tx}`,
      `${B}/B0031?transformationId=${tx}`,
      `${B}/B0031/links?transformationId=${tx}`,
      `${T}/T01/source-links?transformationId=${tx}`,
    ]) {
      const denied = await req("GET", url, { session: nobody });
      const unknown = await req("GET", url.replace(tx, missing), { session: office });
      expect([denied.status, denied.body.code], url).toEqual([404, "not_found"]);
      expect([unknown.status, unknown.body.code], url).toEqual([404, "not_found"]);
      // The same caller reads it once it may (TO in the organization), and AUD reads it read-only.
      expect((await req("GET", url, { session: office })).status, url).toBe(200);
      expect((await req("GET", url, { session: auditor })).status, url).toBe(200);
    }
    // Another organization's TO cannot read org A's transformation either.
    const officeB = await signIn(api.app, w.officeB.subject);
    expect((await req("GET", `${B}?transformationId=${tx}`, { session: officeB })).status).toBe(404);
  });
});
