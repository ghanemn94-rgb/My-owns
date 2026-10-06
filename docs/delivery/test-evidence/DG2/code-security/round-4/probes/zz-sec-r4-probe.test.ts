// code-security-reviewer DG2 round-4 probes (T-DG2-REV-SEC-R4). NOT part of the candidate: copied into a disposable
// clone at apps/api/test/integration/ and run against a disposable PostgreSQL 16. All data SYNTHETIC. G1 is a PRODUCT
// gate, unrelated to DG0-DG7.
//  A. Register archive (register-kit.ts, now the shared `reasonRequest`): authz, If-Match 409/428, audit, and an
//     invisible-only reason (incl. mixed NEL/RLM/WJ/NBSP) is 400 at /reason with nothing written and no audit.
//  B. Evidence-link removal (evidence/routes.ts, now `reasonRequest`): the same.
//  C. Residual of the F-DG2-160 class: Default_Ignorable_Code_Point characters OUTSIDE \p{Cf} (variation selectors
//     U+FE00-FE0F, COMBINING GRAPHEME JOINER U+034F, Mongolian FVS U+180B-180F, Khmer inherent vowels U+17B4/17B5) render
//     as nothing but are counted as content. Assertions in C encode the SECURE expectation (a FAILING test = residual).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, auditOfRequest, call, seedWorld, startApi, type Res, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
const rid = (r: Res) => String(r.headers["x-request-id"]);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());

const INVISIBLE_REASONS = ["‏‏‏", "\u0085⁠ ​", "؜؜؜؜", "ㅤㅤㅤ", "‮⁦⁩"];

async function blank400(res: Res, pointer: string, tag: string) {
  const errs = (res.body?.errors ?? []) as { pointer: string; code: string }[];
  const audit = await auditOfRequest(api.db, rid(res));
  log(tag, [res.status, res.body?.code, errs.map((e) => `${e.pointer}:${e.code}`), audit.length]);
  expect(res.status).toBe(400);
  expect(errs).toContainEqual(expect.objectContaining({ pointer, code: "validation.blank" }));
  expect(audit).toEqual([]);
}

describe("A. register archive (T03 TOM gap): shared reasonRequest keeps authz / If-Match / audit; blank 400 writes nothing", () => {
  it("auditor 403 (+1 denial audit), outsider refused, blank 400, missing 428, stale 409, valid 200 audited once", async () => {
    const gap = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.lead.session,
      body: { dimensionCode: "technology", gap: "Synthetic gap (sec r4)" },
    });
    expect(gap.status).toBe(201);
    const G = `${T}/tom-gaps/${gap.body.id}`;
    const before = await auditOf(api.db, gap.body.id);

    const aud = await call(api.app, "POST", `${G}/archive`, { session: p.auditor.session, headers: ifm(gap.body.version), body: { reason: "auditor (synthetic)" } });
    const audA = await auditOfRequest(api.db, rid(aud));
    log("A.auditor", [aud.status, aud.body?.code, audA.map((x: any) => [x.action, x.outcome])]);
    expect(aud.status).toBe(403);
    expect(audA.length).toBe(1);

    const q = await setupP2World(api, w);
    const out = await call(api.app, "POST", `${G}/archive`, { session: q.lead.session, headers: ifm(gap.body.version), body: { reason: "outsider (synthetic)" } });
    log("A.outsider", [out.status, out.body?.code]);
    expect([403, 404]).toContain(out.status);

    // blank reason by an authorized writer, with a valid If-Match
    for (const reason of INVISIBLE_REASONS) await blank400(await call(api.app, "POST", `${G}/archive`, { session: p.lead.session, headers: ifm(gap.body.version), body: { reason } }), "/reason", `A.blank.${JSON.stringify(reason)}`);
    // blank reason by the auditor: authz runs first (403), never a 400 that reveals validation to an unauthorized caller
    const audBlank = await call(api.app, "POST", `${G}/archive`, { session: p.auditor.session, headers: ifm(gap.body.version), body: { reason: "‏‏‏" } });
    log("A.auditor.blank", [audBlank.status, audBlank.body?.code]);
    expect(audBlank.status).toBe(403);

    const missing = await call(api.app, "POST", `${G}/archive`, { session: p.lead.session, body: { reason: "Synthetic valid reason" } });
    const stale = await call(api.app, "POST", `${G}/archive`, { session: p.lead.session, headers: ifm(gap.body.version + 7), body: { reason: "Synthetic valid reason" } });
    log("A.ifmatch", [missing.status, missing.body?.code, stale.status, stale.body?.code]);
    expect(missing.status).toBe(428);
    expect(stale.status).toBe(409);

    const still = await call(api.app, "GET", G, { session: p.lead.session });
    expect([still.body.version, still.body.status, still.body.archiveReason]).toEqual([gap.body.version, "open", null]);
    // only the auditor's denial row (recorded against the request, not necessarily the record) may have appeared
    const mid = await auditOf(api.db, gap.body.id);
    log("A.audit.mid", mid.map((x: any) => [x.action, x.outcome]));
    expect(mid.filter((x: any) => x.outcome !== "denied" && x.outcome !== "deny")).toEqual(before.filter((x: any) => x.outcome !== "denied" && x.outcome !== "deny"));

    const ok = await call(api.app, "POST", `${G}/archive`, { session: p.lead.session, headers: ifm(gap.body.version), body: { reason: "  Synthetic: superseded (sec r4)  " } });
    log("A.ok", [ok.status, ok.body?.status, ok.body?.archiveReason, ok.body?.version]);
    expect(ok.status).toBe(200);
    expect([ok.body.status, ok.body.archiveReason, ok.body.version]).toEqual(["archived", "Synthetic: superseded (sec r4)", gap.body.version + 1]);
    const after = await auditOf(api.db, gap.body.id);
    expect(after.filter((x: any) => x.action === "tom_gap.archive").length).toBe(1);
  });
});

describe("B. evidence-link removal: shared reasonRequest keeps authz / If-Match / audit; blank 400 writes nothing", () => {
  it("auditor 403, outsider refused, blank 400, missing 428, stale 409, valid removes once", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.lead.session, body: { kind: "note", title: "Synthetic note (sec r4)", noteBody: "Synthetic", ownerUserId: p.lead.id } });
    expect(e.status).toBe(201);
    const items = await call(api.app, "GET", `${T}/diagnostic-items`, { session: p.lead.session });
    const link = await call(api.app, "POST", `${T}/evidence-links`, { session: p.lead.session, body: { evidenceId: e.body.id, recordType: "diagnostic_item", recordId: items.body.items[0].id } });
    expect(link.status).toBe(201);
    const L = `${T}/evidence-links/${link.body.id}/remove`;
    const before = await auditOf(api.db, link.body.id);

    const aud = await call(api.app, "POST", L, { session: p.auditor.session, headers: ifm(1), body: { reason: "auditor (synthetic)" } });
    const audA = await auditOfRequest(api.db, rid(aud));
    log("B.auditor", [aud.status, aud.body?.code, audA.map((x: any) => [x.action, x.outcome])]);
    expect(aud.status).toBe(403);
    expect(audA.length).toBe(1);
    const audBlank = await call(api.app, "POST", L, { session: p.auditor.session, headers: ifm(1), body: { reason: "⁠⁠⁠" } });
    log("B.auditor.blank", [audBlank.status, audBlank.body?.code]);
    expect(audBlank.status).toBe(403);

    const q = await setupP2World(api, w);
    const out = await call(api.app, "POST", L, { session: q.lead.session, headers: ifm(1), body: { reason: "outsider (synthetic)" } });
    log("B.outsider", [out.status, out.body?.code]);
    expect([403, 404]).toContain(out.status);

    for (const reason of INVISIBLE_REASONS) await blank400(await call(api.app, "POST", L, { session: p.lead.session, headers: ifm(1), body: { reason } }), "/reason", `B.blank.${JSON.stringify(reason)}`);
    const extra = await call(api.app, "POST", L, { session: p.lead.session, headers: ifm(1), body: { reason: "Synthetic", extra: 1 } });
    log("B.strict", [extra.status, extra.body?.code]);
    expect(extra.status).toBe(400);

    const missing = await call(api.app, "POST", L, { session: p.lead.session, body: { reason: "Synthetic unlink" } });
    const stale = await call(api.app, "POST", L, { session: p.lead.session, headers: ifm(9), body: { reason: "Synthetic unlink" } });
    log("B.ifmatch", [missing.status, missing.body?.code, stale.status, stale.body?.code]);
    expect(missing.status).toBe(428);
    expect(stale.status).toBe(409);

    const still = await api.db.selectFrom("evidence_link").select(["status", "version", "remove_reason"]).where("id", "=", link.body.id).executeTakeFirstOrThrow();
    expect(still).toEqual({ status: "active", version: 1, remove_reason: null });

    const ok = await call(api.app, "POST", L, { session: p.lead.session, headers: ifm(1), body: { reason: "Synthetic unlink (sec r4)" } });
    log("B.ok", [ok.status, ok.body?.status, ok.body?.version]);
    expect(ok.body).toMatchObject({ status: "removed", version: 2 });
    const after = await auditOf(api.db, link.body.id);
    log("B.audit", after.map((x: any) => [x.action, x.outcome]));
    expect(after.filter((x: any) => x.action === "evidence_link.remove").length).toBe(1);
    expect(after.length - before.length).toBeGreaterThanOrEqual(1);
  });
});

// C. Residual class: assertions are the SECURE expectation (either 400 at input, or never counted as documented).
const RESIDUAL: [string, string][] = [
  ["U+FE0F VARIATION SELECTOR-16", "️"],
  ["U+034F COMBINING GRAPHEME JOINER x2", "͏͏"],
  ["U+180B MONGOLIAN FVS1", "᠋"],
  ["U+17B4 KHMER VOWEL INHERENT AQ", "឴"],
  ["RLM + VS16 (RTL input)", "‏️"],
];
describe("C. residual: Default_Ignorable (non-Cf) only Out of scope must not document an exclusion (B0041) or satisfy G1", () => {
  it.each(RESIDUAL)("%s", async (label, value) => {
    const q = await setupP2World(api, w);
    const Q = `/api/v1/transformations/${q.transformationId}`;
    const created = await call(api.app, "POST", `${Q}/charter`, { session: q.lead.session, body: { transformationName: "Synthetic", inScope: "Retail onboarding (synthetic)", outOfScope: value } });
    let precheck: string | undefined;
    let g1Missing: boolean | undefined;
    if (created.status === 201) {
      const v = await call(api.app, "GET", `${Q}/charter`, { session: q.lead.session });
      precheck = v.body.scopeCheckPrechecks.find((x: { code: string }) => x.code === "exclusions_documented")?.result;
      const g1 = await call(api.app, "GET", `${Q}/gates/G1`, { session: q.lead.session });
      g1Missing = g1.body.criteria.find((c: { key: string }) => c.key === "g1.initial_charter").missing.some((m: { pointer: string }) => m.pointer === "/charter/outOfScope");
    }
    log(`C.${label}`, { create: created.status, stored: created.body?.charter?.outOfScope === value, precheck, g1OutOfScopeMissing: g1Missing });
    if (created.status === 201) {
      expect(precheck).toBe("attention");
      expect(g1Missing).toBe(true);
    } else expect(created.status).toBe(400);
  });

  it("archive reason of three U+FE0F (renders as nothing) must be refused", async () => {
    const gap = await call(api.app, "POST", `${T}/tom-gaps`, { session: p.lead.session, body: { dimensionCode: "technology", gap: `Synthetic gap ${randomUUID().slice(0, 8)}` } });
    expect(gap.status, JSON.stringify(gap.body)).toBe(201);
    const r = await call(api.app, "POST", `${T}/tom-gaps/${gap.body.id}/archive`, { session: p.lead.session, headers: ifm(gap.body.version), body: { reason: "️️️" } });
    log("C.archive.reason.VS16x3", [r.status, r.body?.status, JSON.stringify(r.body?.archiveReason), (r.body?.errors ?? []).map((e: any) => `${e.pointer}:${e.code}`)]);
    expect(r.status).toBe(400);
  });
});
