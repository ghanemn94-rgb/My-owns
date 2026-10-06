// F-DG2-150 root cause (T-DG2-BE5) and F-DG2-160 (T-DG2-BE6): blank free text (no visible content) is never stored
// as content, on a real PostgreSQL.
//  - A whitespace-only value for a representative field of each P2 kind (charter inScope / caseForChange / a thesis part,
//    a T01 diagnostic item's currentState, a T03 TOM gap, a T04 decision, a KPI definition name, an evidence note) is
//    a 400 validation problem with a JSON pointer to the field and code `validation.blank`: nothing is written (row
//    and version unchanged, no new row) and the request leaves no audit event.
//  - Valid text still succeeds (stored exactly as entered) and `null` still clears a nullable field.
//  - Defense in depth: blank text that reaches the database some other way (written here with SQL, as legacy data)
//    is still "not present" for G1 readiness, the charter pre-checks and the thesis warning.
// All data is SYNTHETIC. G1 is a PRODUCT gate (business approval), unrelated to the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  auditOfRequest,
  call,
  seedWorld,
  startApi,
  type Res,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());

const BLANKS = ["   ", "\n\t \r\n", " 　"] as const;

/** A 400 validation problem pointing at `pointer` with `validation.blank`, and no audit row for the request. */
async function expectBlankRejected(res: Res, pointer: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  const body = res.body as { code: string; errors: { pointer: string; code: string }[] };
  expect(body.code).toBe("validation");
  expect(body.errors).toContainEqual(expect.objectContaining({ pointer, code: "validation.blank" }));
  expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([]);
}

async function countOf(table: "tom_gap" | "decision" | "kpi_definition" | "evidence"): Promise<number> {
  const r = await sql<{ n: string }>`
    SELECT count(*) AS n FROM ${sql.table(table)} WHERE transformation_id = ${p.transformationId}`.execute(api.db);
  return Number(r.rows[0]!.n);
}

/** An audited system write (source 'migration') that stores blank text directly, simulating pre-BE5 data. */
async function legacyBlankWrite(
  table: "charter" | "diagnostic_item",
  id: string,
  version: number,
  values: Record<string, string>,
) {
  await api.db.transaction().execute(async (tx) => {
    await sql`INSERT INTO audit_event (id, action, record_type, record_id, actor_type, source, prior_version, new_version)
              VALUES (gen_random_uuid(), ${`${table}.update`}, ${table}, ${id}, 'system', 'migration',
                      ${version}, ${version + 1})`.execute(tx);
    const sets = Object.entries(values).map(([k, v]) => sql`${sql.ref(k)} = ${v}`);
    await sql`UPDATE ${sql.table(table)} SET ${sql.join(sets)}, version = version + 1
              WHERE id = ${id} AND version = ${version}`.execute(tx);
    // A charter version also needs its immutable snapshot (ADR-0017): the previous one with the same blank values.
    if (table === "charter") {
      const over = JSON.stringify({
        ...values,
        version_no: version + 1,
        change_summary: "Legacy blank data (synthetic)",
      });
      await sql`INSERT INTO charter_version
                SELECT (jsonb_populate_record(NULL::charter_version,
                          to_jsonb(cv) || jsonb_build_object('id', gen_random_uuid()) || ${over}::jsonb)).*
                FROM charter_version cv WHERE cv.charter_id = ${id} AND cv.version_no = ${version}`.execute(tx);
    }
  });
}

describe("blank free text is rejected (400 + pointer), nothing is written and nothing is audited", () => {
  let C: string;
  let charterId: string;
  beforeAll(async () => {
    C = `${T}/charter`;
    const created = await call(api.app, "POST", C, {
      session: p.lead.session,
      body: { transformationName: "Synthetic charter", inScope: "Retail onboarding (synthetic)" },
    });
    expect(created.status).toBe(201);
    charterId = created.body.charter.id;
  });

  it.each([
    ["inScope", "/inScope"],
    ["caseForChange", "/caseForChange"],
    ["thesisBecause", "/thesisBecause"],
  ])("charter %s", async (field, pointer) => {
    const before = await auditOf(api.db, charterId);
    for (const blank of BLANKS) {
      const res = await call(api.app, "PATCH", C, {
        session: p.lead.session,
        headers: ifm(1),
        body: { [field]: blank, changeSummary: "Synthetic blank attempt" },
      });
      await expectBlankRejected(res, pointer);
    }
    const after = await call(api.app, "GET", C, { session: p.lead.session });
    expect(after.body.charter.version).toBe(1);
    expect(after.body.charter.inScope).toBe("Retail onboarding (synthetic)");
    expect(await auditOf(api.db, charterId)).toEqual(before);
  });

  it("charter create with a blank field writes no charter", async () => {
    const q = await setupP2World(api, w);
    const QC = `/api/v1/transformations/${q.transformationId}/charter`;
    const res = await call(api.app, "POST", QC, {
      session: q.lead.session,
      body: { transformationName: "Synthetic", caseForChange: "  " },
    });
    await expectBlankRejected(res, "/caseForChange");
    expect((await call(api.app, "GET", QC, { session: q.lead.session })).status).toBe(404);
  });

  it("T01 diagnostic item currentState", async () => {
    const items = await call(api.app, "GET", `${T}/diagnostic-items`, { session: p.lead.session });
    const item = items.body.items[0] as { id: string; version: number; currentState: string | null };
    const before = await auditOf(api.db, item.id);
    const res = await call(api.app, "PATCH", `${T}/diagnostic-items/${item.id}`, {
      session: p.lead.session,
      headers: ifm(item.version),
      body: { currentState: "   " },
    });
    await expectBlankRejected(res, "/currentState");
    const after = await call(api.app, "GET", `${T}/diagnostic-items/${item.id}`, { session: p.lead.session });
    expect([after.body.version, after.body.currentState]).toEqual([item.version, item.currentState]);
    expect(await auditOf(api.db, item.id)).toEqual(before);
  });

  it("T03 TOM gap (create and update)", async () => {
    const n = await countOf("tom_gap");
    await expectBlankRejected(
      await call(api.app, "POST", `${T}/tom-gaps`, {
        session: p.lead.session,
        body: { dimensionCode: "technology", gap: "\t\t" },
      }),
      "/gap",
    );
    expect(await countOf("tom_gap")).toBe(n);
    const gap = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.lead.session,
      body: { dimensionCode: "technology", gap: "Synthetic gap" },
    });
    expect(gap.status).toBe(201);
    const before = await auditOf(api.db, gap.body.id);
    await expectBlankRejected(
      await call(api.app, "PATCH", `${T}/tom-gaps/${gap.body.id}`, {
        session: p.lead.session,
        headers: ifm(gap.body.version),
        body: { targetState: "  " },
      }),
      "/targetState",
    );
    expect(await auditOf(api.db, gap.body.id)).toEqual(before);
  });

  it("T04 decision (create title, update context)", async () => {
    const n = await countOf("decision");
    await expectBlankRejected(
      await call(api.app, "POST", "/api/v1/decisions", {
        session: p.lead.session,
        body: { transformationId: p.transformationId, title: "   " },
      }),
      "/title",
    );
    expect(await countOf("decision")).toBe(n);
    const d = await call(api.app, "POST", "/api/v1/decisions", {
      session: p.lead.session,
      body: { transformationId: p.transformationId, title: "Synthetic decision" },
    });
    expect(d.status).toBe(201);
    const before = await auditOf(api.db, d.body.id);
    await expectBlankRejected(
      await call(api.app, "PATCH", `/api/v1/decisions/${d.body.id}`, {
        session: p.lead.session,
        headers: ifm(1),
        body: { context: " \n " },
      }),
      "/context",
    );
    expect(await auditOf(api.db, d.body.id)).toEqual(before);
  });

  it("KPI definition name", async () => {
    const n = await countOf("kpi_definition");
    await expectBlankRejected(
      await call(api.app, "POST", `${T}/kpi-definitions`, {
        session: p.lead.session,
        body: { name: "    ", unitKind: "count", polarity: "higher_is_better" },
      }),
      "/name",
    );
    expect(await countOf("kpi_definition")).toBe(n);
  });

  it("evidence note body", async () => {
    const n = await countOf("evidence");
    await expectBlankRejected(
      await call(api.app, "POST", `${T}/evidence`, {
        session: p.lead.session,
        body: { kind: "note", title: "Synthetic note", ownerUserId: p.lead.id, noteBody: "  \n  " },
      }),
      "/noteBody",
    );
    expect(await countOf("evidence")).toBe(n);
  });
});

describe("valid text still succeeds (stored as entered) and null still clears", () => {
  it("charter: text with surrounding spaces is kept verbatim; null clears; each change is audited once", async () => {
    const q = await setupP2World(api, w);
    const QC = `/api/v1/transformations/${q.transformationId}/charter`;
    const created = await call(api.app, "POST", QC, {
      session: q.lead.session,
      body: { transformationName: "Synthetic", inScope: "  Retail onboarding (synthetic)  " },
    });
    expect(created.status).toBe(201);
    expect(created.body.charter.inScope).toBe("  Retail onboarding (synthetic)  ");
    const cleared = await call(api.app, "PATCH", QC, {
      session: q.lead.session,
      headers: ifm(1),
      body: { inScope: null, changeSummary: "Clear in scope (synthetic)" },
    });
    expect(cleared.status).toBe(200);
    expect([cleared.body.charter.version, cleared.body.charter.inScope]).toEqual([2, null]);
    const audit = await auditOf(api.db, created.body.charter.id as string);
    expect(audit.map((e) => [e.action, e.new_version])).toEqual([
      ["charter.create", 1],
      ["charter.update", 2],
    ]);
  });

  it("T01: valid currentState saves, then null clears it", async () => {
    const items = await call(api.app, "GET", `${T}/diagnostic-items`, { session: p.lead.session });
    const item = items.body.items[1] as { id: string; version: number };
    const set = await call(api.app, "PATCH", `${T}/diagnostic-items/${item.id}`, {
      session: p.lead.session,
      headers: ifm(item.version),
      body: { currentState: "Manual billing (synthetic)" },
    });
    expect([set.status, set.body.currentState]).toEqual([200, "Manual billing (synthetic)"]);
    const clear = await call(api.app, "PATCH", `${T}/diagnostic-items/${item.id}`, {
      session: p.lead.session,
      headers: ifm(set.body.version),
      body: { currentState: null },
    });
    expect([clear.status, clear.body.currentState]).toEqual([200, null]);
    const audit = await auditOf(api.db, item.id);
    expect(audit.slice(-2).map((e) => e.new_version)).toEqual([set.body.version, clear.body.version]);
  });
});

describe("defense in depth: blank text already in the database is never 'present' (G1 readiness, pre-checks, thesis)", () => {
  type Miss = { code: string; pointer?: string };
  type Criterion = { key: string; missing: Miss[] };
  it("blank In scope, Case for change, thesis part and T01 texts read as missing", async () => {
    const q = await setupP2World(api, w);
    const Q = `/api/v1/transformations/${q.transformationId}`;
    const created = await call(api.app, "POST", `${Q}/charter`, {
      session: q.lead.session,
      body: {
        transformationName: "Synthetic",
        caseForChange: "Rework drives cost (synthetic)",
        inScope: "Retail onboarding (synthetic)",
        outOfScope: "Enterprise fixed-line (synthetic)",
        thesisChange: "the onboarding journey",
        thesisOutcomes: "first-time-right bills",
        thesisBenefits: "lower cost to serve",
        thesisBecause: "rework drives cost",
      },
    });
    expect(created.status).toBe(201);
    const g1 = async () =>
      (await call<{ criteria: Criterion[] }>(api.app, "GET", `${Q}/gates/G1`, { session: q.lead.session })).body
        .criteria;
    const has = (cs: Criterion[], key: string, pred: (m: Miss) => boolean) =>
      cs.find((c) => c.key === key)!.missing.some(pred);
    const items = await call(api.app, "GET", `${Q}/diagnostic-items`, { session: q.lead.session });
    const item = items.body.items[0] as { id: string; version: number; dimensionCode: string };
    const set = await call(api.app, "PATCH", `${Q}/diagnostic-items/${item.id}`, {
      session: q.lead.session,
      headers: ifm(item.version),
      body: { currentState: "Manual (synthetic)", rootCause: "Rework (synthetic)", impactText: "High (synthetic)" },
    });
    expect(set.status).toBe(200);

    // Valid text: present.
    let cs = await g1();
    expect(has(cs, "g1.case_for_change", () => true)).toBe(false);
    expect(has(cs, "g1.initial_charter", (m) => m.pointer === "/charter/inScope")).toBe(false);
    const at = `/diagnosticItems/${item.dimensionCode}`;
    expect(has(cs, "g1.diagnostic", (m) => m.pointer === at && m.code === "g1.diagnostic.current_state_missing")).toBe(
      false,
    );
    expect(has(cs, "g1.diagnostic", (m) => m.pointer === at && m.code === "g1.diagnostic.root_cause_missing")).toBe(
      false,
    );
    expect(has(cs, "g1.diagnostic", (m) => m.pointer === at && m.code === "g1.diagnostic.impact_missing")).toBe(false);
    const view = await call(api.app, "GET", `${Q}/charter`, { session: q.lead.session });
    expect(view.body.warnings.filter((x: Miss) => x.code === "charter.thesis_incomplete")).toEqual([]);

    // Legacy blank data (written around the API, which now refuses it).
    // Legacy blank data written around the API (which now refuses it), as an audited system/migration write: the
    // record guards require version + 1 and an audit event in the same transaction (ADR-0003, ADR-0004).
    const charterId = created.body.charter.id as string;
    await legacyBlankWrite("charter", charterId, 1, {
      case_for_change: "   ",
      in_scope: "\n\t",
      out_of_scope: "  ",
      thesis_because: "  ",
    });
    await legacyBlankWrite("diagnostic_item", item.id, set.body.version as number, {
      current_state: " ",
      root_cause: "\t",
      impact_text: "  ",
    });
    cs = await g1();
    expect(has(cs, "g1.case_for_change", (m) => m.pointer === "/charter/caseForChange")).toBe(true);
    expect(has(cs, "g1.initial_charter", (m) => m.pointer === "/charter/inScope")).toBe(true);
    expect(has(cs, "g1.initial_charter", (m) => m.pointer === "/charter/outOfScope")).toBe(true);
    expect(has(cs, "g1.diagnostic", (m) => m.pointer === at && m.code === "g1.diagnostic.current_state_missing")).toBe(
      true,
    );
    expect(has(cs, "g1.diagnostic", (m) => m.pointer === at && m.code === "g1.diagnostic.root_cause_missing")).toBe(
      true,
    );
    expect(has(cs, "g1.diagnostic", (m) => m.pointer === at && m.code === "g1.diagnostic.impact_missing")).toBe(true);
    expect(has(cs, "g1.root_causes", (m) => m.code === "g1.root_causes.t01_root_cause_missing")).toBe(true);
    const blankView = await call(api.app, "GET", `${Q}/charter`, { session: q.lead.session });
    expect(
      blankView.body.warnings.filter((x: Miss) => x.code === "charter.thesis_incomplete").map((x: Miss) => x.pointer),
    ).toEqual(["/charter/thesisBecause"]);
    const traced = blankView.body.scopeCheckPrechecks.find(
      (x: { code: string }) => x.code === "problem_traceability",
    ) as { result: string };
    expect(traced.result).toBe("unknown");
    const excl = blankView.body.scopeCheckPrechecks.find(
      (x: { code: string }) => x.code === "exclusions_documented",
    ) as { result: string };
    expect(excl.result).toBe("attention");
  });
});

// F-DG2-160 (T-DG2-BE6): "blank" means no visible content: White_Space (incl. U+0085), Cf format characters (ZWSP,
// word joiner, RLM, ALM, ...) and invisible fillers. One shared predicate (`hasVisibleContent` in @mth/shared) decides
// both the 400 and readiness, so the API, the B0041 pre-check, G1 and the web agree.
describe("invisible-only free text is blank (F-DG2-160)", () => {
  type Miss = { code: string; pointer?: string };
  type Criterion = { key: string; missing: Miss[] };
  const INVISIBLE = ["‏", "\u0085", "⁠⁠⁠", "؜"] as const;

  it.each(INVISIBLE.map((v) => [JSON.stringify(v), v]))(
    "Out of scope %s is 400 validation.blank at /outOfScope; nothing written, no audit",
    async (_label, invisible) => {
      const q = await setupP2World(api, w);
      const QC = `/api/v1/transformations/${q.transformationId}/charter`;
      // Create: rejected, so no charter exists.
      const createRes = await call(api.app, "POST", QC, {
        session: q.lead.session,
        body: { transformationName: "Synthetic", outOfScope: invisible },
      });
      await expectBlankRejected(createRes, "/outOfScope");
      expect((await call(api.app, "GET", QC, { session: q.lead.session })).status).toBe(404);
      // Update: rejected, so the charter keeps its version, value and audit trail.
      const created = await call(api.app, "POST", QC, {
        session: q.lead.session,
        body: { transformationName: "Synthetic", outOfScope: "Enterprise fixed-line (synthetic)" },
      });
      expect(created.status).toBe(201);
      const charterId = created.body.charter.id as string;
      const before = await auditOf(api.db, charterId);
      const res = await call(api.app, "PATCH", QC, {
        session: q.lead.session,
        headers: ifm(1),
        body: { outOfScope: invisible, changeSummary: "Synthetic invisible attempt" },
      });
      await expectBlankRejected(res, "/outOfScope");
      const after = await call(api.app, "GET", QC, { session: q.lead.session });
      expect([after.body.charter.version, after.body.charter.outOfScope]).toEqual([
        1,
        "Enterprise fixed-line (synthetic)",
      ]);
      expect(await auditOf(api.db, charterId)).toEqual(before);
    },
  );

  it("an Arabic Out of scope with RLM marks is accepted verbatim, the pre-check reads pass and G1 does not list it", async () => {
    const q = await setupP2World(api, w);
    const Q = `/api/v1/transformations/${q.transformationId}`;
    const arabic = "‏قطاع الشركات خارج النطاق (بيانات اصطناعية)‏";
    const created = await call(api.app, "POST", `${Q}/charter`, {
      session: q.lead.session,
      body: { transformationName: "Synthetic", outOfScope: arabic },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.charter.outOfScope).toBe(arabic);
    const view = await call(api.app, "GET", `${Q}/charter`, { session: q.lead.session });
    expect(view.body.charter.outOfScope).toBe(arabic);
    const excl = view.body.scopeCheckPrechecks.find((x: { code: string }) => x.code === "exclusions_documented") as {
      result: string;
    };
    expect(excl.result).toBe("pass");
    const g1 = await call<{ criteria: Criterion[] }>(api.app, "GET", `${Q}/gates/G1`, { session: q.lead.session });
    const charterCriterion = g1.body.criteria.find((c) => c.key === "g1.initial_charter")!;
    expect(charterCriterion.missing.some((m) => m.pointer === "/charter/outOfScope")).toBe(false);

    // Defense in depth: an invisible-only Out of scope that reaches the database around the API is not documented.
    await legacyBlankWrite("charter", created.body.charter.id as string, 1, { out_of_scope: "‏​" });
    const blankView = await call(api.app, "GET", `${Q}/charter`, { session: q.lead.session });
    expect(
      (
        blankView.body.scopeCheckPrechecks.find((x: { code: string }) => x.code === "exclusions_documented") as {
          result: string;
        }
      ).result,
    ).toBe("attention");
    const g1b = await call<{ criteria: Criterion[] }>(api.app, "GET", `${Q}/gates/G1`, { session: q.lead.session });
    expect(
      g1b.body.criteria
        .find((c) => c.key === "g1.initial_charter")!
        .missing.some((m) => m.pointer === "/charter/outOfScope"),
    ).toBe(true);
  });
});

// F-DG2-160 (T-DG2-BE7): the shared `reason` (and `name`) follow the same visible-content rule, and the two former
// inline reason parsers (register archive, evidence-link removal) now use the shared `reasonRequest`. An
// invisible-only reason is a 400 `validation.blank` at /reason: nothing is written and nothing is audited.
describe("invisible-only reasons are blank on every reason endpoint (F-DG2-160, T-DG2-BE7)", () => {
  const INVISIBLE_REASONS = ["‏‏‏", "⁠⁠⁠", "\u0085\u0085\u0085"] as const;

  it("P2 register archive (T03 TOM gap): invisible reason is 400 at /reason; a valid reason archives", async () => {
    const gap = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.lead.session,
      body: { dimensionCode: "technology", gap: "Synthetic gap to archive" },
    });
    expect(gap.status).toBe(201);
    const before = await auditOf(api.db, gap.body.id);
    for (const reason of INVISIBLE_REASONS) {
      const res = await call(api.app, "POST", `${T}/tom-gaps/${gap.body.id}/archive`, {
        session: p.lead.session,
        headers: ifm(gap.body.version),
        body: { reason },
      });
      await expectBlankRejected(res, "/reason");
    }
    const still = await call(api.app, "GET", `${T}/tom-gaps/${gap.body.id}`, { session: p.lead.session });
    expect([still.body.version, still.body.status, still.body.archiveReason]).toEqual([gap.body.version, "open", null]);
    expect(await auditOf(api.db, gap.body.id)).toEqual(before);

    const ok = await call(api.app, "POST", `${T}/tom-gaps/${gap.body.id}/archive`, {
      session: p.lead.session,
      headers: ifm(gap.body.version),
      body: { reason: "  ‏Synthetic: superseded gap‏  " },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect([ok.body.status, ok.body.archiveReason]).toEqual(["archived", "‏Synthetic: superseded gap‏"]);
    expect((await auditOf(api.db, gap.body.id)).map((x) => x.action)).toEqual([
      ...before.map((x) => x.action),
      "tom_gap.archive",
    ]);
  });

  it("evidence-link removal: invisible reason is 400 at /reason; a valid reason removes", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, {
      session: p.lead.session,
      body: { kind: "note", title: "Synthetic linked note", noteBody: "Synthetic", ownerUserId: p.lead.id },
    });
    expect(e.status).toBe(201);
    const items = await call(api.app, "GET", `${T}/diagnostic-items`, { session: p.lead.session });
    const link = await call(api.app, "POST", `${T}/evidence-links`, {
      session: p.lead.session,
      body: { evidenceId: e.body.id, recordType: "diagnostic_item", recordId: items.body.items[0].id },
    });
    expect(link.status).toBe(201);
    const before = await auditOf(api.db, link.body.id);
    for (const reason of INVISIBLE_REASONS) {
      const res = await call(api.app, "POST", `${T}/evidence-links/${link.body.id}/remove`, {
        session: p.lead.session,
        headers: ifm(1),
        body: { reason },
      });
      await expectBlankRejected(res, "/reason");
    }
    const still = await api.db
      .selectFrom("evidence_link")
      .select(["status", "version", "remove_reason"])
      .where("id", "=", link.body.id)
      .executeTakeFirstOrThrow();
    expect(still).toEqual({ status: "active", version: 1, remove_reason: null });
    expect(await auditOf(api.db, link.body.id)).toEqual(before);

    const ok = await call(api.app, "POST", `${T}/evidence-links/${link.body.id}/remove`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic unlink" },
    });
    expect(ok.body).toMatchObject({ status: "removed", version: 2 });
    expect((await auditOf(api.db, link.body.id)).map((x) => x.action)).toEqual([
      "evidence_link.create",
      "evidence_link.remove",
    ]);
  });

  it("P1 transformation archive (reasonRequest): invisible reason is 400 at /reason; a valid reason archives", async () => {
    const q = await setupP2World(api, w);
    const TR = `/api/v1/transformations/${q.transformationId}`;
    const current = await call(api.app, "GET", TR, { session: q.lead.session });
    expect(current.status).toBe(200);
    const before = await auditOf(api.db, q.transformationId);
    for (const reason of INVISIBLE_REASONS) {
      const res = await call(api.app, "POST", `${TR}/archive`, {
        session: q.lead.session,
        headers: ifm(current.body.version),
        body: { reason },
      });
      await expectBlankRejected(res, "/reason");
    }
    const still = await call(api.app, "GET", TR, { session: q.lead.session });
    expect([still.body.version, still.body.status]).toEqual([current.body.version, current.body.status]);
    expect(await auditOf(api.db, q.transformationId)).toEqual(before);

    const ok = await call(api.app, "POST", `${TR}/archive`, {
      session: q.lead.session,
      headers: ifm(current.body.version),
      body: { reason: "Synthetic archive with a valid reason" },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.version).toBe(current.body.version + 1);
    expect((await auditOf(api.db, q.transformationId)).length).toBe(before.length + 1);
  });
});
