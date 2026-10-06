// code-security-reviewer DG2 round-2 VERIFICATION probes (T-DG2-REV-SEC-R2) for F-DG2-140/141/142 plus adversarial
// variants and DB-bypass checks. NOT part of the candidate: copied into a disposable clone at
// apps/api/test/integration/ and run against a disposable PostgreSQL 16 cluster. All data SYNTHETIC.
// Assertions encode the SECURE expectation (a failing assertion = the defect is still reproducible). Controls assert the
// fix does not over-block legitimate independent work.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest, call, createUser, grant, seedWorld, signIn, startApi, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
const rid = (x: { headers: Record<string, unknown> }) => String(x.headers["x-request-id"]);
async function denied(x: { headers: Record<string, unknown> }) {
  return (await auditOfRequest(api.db, rid(x))).map((a) => [a.action, a.outcome]);
}
const authorOf = async (id: string) =>
  (await api.db.selectFrom("evidence").select(["content_authored_by", "created_by"]).where("id", "=", id).executeTakeFirstOrThrow());

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());

const review = (id: string, session: unknown, version: number) =>
  call(api.app, "POST", `${T}/evidence/${id}/review`, {
    session: session as never,
    headers: ifm(version),
    body: { result: "verified", accessibilityStatus: "accessible", note: "probe review (synthetic)" },
  });

describe("F-DG2-140 evidence SoD", () => {
  it("R1 path (note): TL can no longer rewrite a WL-created note; WL text stays authored by WL", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.contributor.session, body: { kind: "note", title: "WL note", noteBody: "WL text", ownerUserId: p.contributor.id } });
    const edit = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, { session: p.lead.session, headers: ifm(1), body: { noteBody: "TL text" } });
    const a = await authorOf(e.body.id);
    log("140.note.tl_edit_other", [edit.status, edit.body.code, await denied(edit), a.content_authored_by === p.contributor.id]);
    expect(edit.status).toBe(403);
    expect(a.content_authored_by).toBe(p.contributor.id);
    // control: TL verifying the WL's own text is legitimate SoD (TL supplied nothing)
    const v = await review(e.body.id, p.lead.session, 1);
    log("140.note.control_tl_verifies_wl_text", [v.status, v.body.reviewStatus]);
    expect(v.status).toBe(200);
  });

  it("R1 path (file): TL can no longer upload a revision to a WL-created file evidence", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.contributor.session, body: { kind: "file", title: "WL file", ownerUserId: p.contributor.id } });
    const up = await call(api.app, "POST", `${T}/evidence/${e.body.id}/content`, { session: p.lead.session, headers: { ...ifm(1), "content-type": "application/octet-stream", "x-file-name": "tl.csv" }, body: Buffer.from("a,b\n9,9\n") });
    const n = await api.db.selectFrom("evidence_content").select("id").where("evidence_id", "=", e.body.id).execute();
    log("140.file.tl_upload_other", [up.status, up.body.code, n.length, await denied(up)]);
    expect(up.status).toBe(403);
    expect(n.length).toBe(0);
  });

  it("owner-edit variant (note): WL creates a note naming TL owner; TL rewrites it, then tries to verify -> 403 + audit", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.contributor.session, body: { kind: "note", title: "owned by TL", noteBody: "WL text", ownerUserId: p.lead.id } });
    const edit = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, { session: p.lead.session, headers: ifm(1), body: { noteBody: "TL wrote this" } });
    const a = await authorOf(e.body.id);
    const v = await review(e.body.id, p.lead.session, edit.body.version);
    log("140.owner_note", [edit.status, a.content_authored_by === p.lead.id, v.status, v.body.code, await denied(v)]);
    expect(edit.status).toBe(200);
    expect(v.status).toBe(403);
    expect(v.body.code).toBe("evidence.reviewer_is_author");
    expect((await denied(v)).length).toBe(1);
  });

  it("owner-edit variant (url): TL (named owner) changes the URL then tries to verify -> 403", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.contributor.session, body: { kind: "external_link", title: "link", url: "https://example.invalid/wl", ownerUserId: p.lead.id } });
    const edit = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, { session: p.lead.session, headers: ifm(1), body: { url: "https://example.invalid/tl" } });
    const v = await review(e.body.id, p.lead.session, edit.body.version);
    log("140.owner_url", [e.status, edit.status, v.status, v.body.code]);
    expect(v.status).toBe(403);
  });

  it("owner-edit variant (file): TL (named owner) uploads a revision then tries to verify -> 403", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.contributor.session, body: { kind: "file", title: "file owned by TL", ownerUserId: p.lead.id } });
    const up = await call(api.app, "POST", `${T}/evidence/${e.body.id}/content`, { session: p.lead.session, headers: { ...ifm(1), "content-type": "application/octet-stream", "x-file-name": "tl.csv" }, body: Buffer.from("x,y\n1,2\n") });
    const v = await review(e.body.id, p.lead.session, up.body.version);
    log("140.owner_file", [up.status, v.status, v.body.code]);
    expect(up.status).toBe(200);
    expect(v.status).toBe(403);
  });

  it("laundering: after TL's text edit the creator changes only the title -> TL still the content author -> 403", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.contributor.session, body: { kind: "note", title: "t", noteBody: "WL text", ownerUserId: p.lead.id } });
    const edit = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, { session: p.lead.session, headers: ifm(1), body: { noteBody: "TL text" } });
    const t2 = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, { session: p.contributor.session, headers: ifm(edit.body.version), body: { title: "renamed by WL" } });
    const a = await authorOf(e.body.id);
    const v = await review(e.body.id, p.lead.session, t2.body.version);
    log("140.launder_title", [edit.status, t2.status, a.content_authored_by === p.lead.id, v.status]);
    expect(v.status).toBe(403);
    // control: when the creator rewrites the text, TL supplied nothing current -> TL may verify
    const t3 = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, { session: p.contributor.session, headers: ifm(t2.body.version), body: { noteBody: "WL rewrote" } });
    const v2 = await review(e.body.id, p.lead.session, t3.body.version);
    log("140.control_rewritten_by_creator", [t3.status, v2.status]);
    expect(v2.status).toBe(200);
  });

  it("DB bypass (mth_app): a review by the content author / current uploader is refused by the 0019 trigger, even when content_authored_by is spoofed in the same UPDATE", async () => {
    const pool = new pg.Pool({ connectionString: api.config.databaseUrl!, max: 1 });
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.contributor.session, body: { kind: "note", title: "db", noteBody: "WL", ownerUserId: p.lead.id } });
    const edit = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, { session: p.lead.session, headers: ifm(1), body: { noteBody: "TL" } });
    const f = await call(api.app, "POST", `${T}/evidence`, { session: p.contributor.session, body: { kind: "file", title: "dbf", ownerUserId: p.lead.id } });
    const up = await call(api.app, "POST", `${T}/evidence/${f.body.id}/content`, { session: p.lead.session, headers: { ...ifm(1), "content-type": "application/octet-stream", "x-file-name": "x.csv" }, body: Buffer.from("1\n") });
    expect([edit.status, up.status]).toEqual([200, 200]);
    async function tx(sqlText: string, args: unknown[], id: string): Promise<string> {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await c.query(sqlText, args);
        await c.query(
          "INSERT INTO audit_event (id, occurred_at, actor_type, actor_user_id, request_id, source, action, record_type, record_id, organization_id, transformation_id, prior_version, new_version) VALUES (mth_uuid_v7(), now(), 'user', $2, 'sec-r2-probe', 'api', 'evidence.review', 'evidence', $1, $3, $4, $5, $6)",
          [id, p.lead.id, w.orgA.id, p.transformationId, r.rows[0].version - 1, r.rows[0].version],
        );
        await c.query("COMMIT");
        return "COMMITTED";
      } catch (err) {
        await c.query("ROLLBACK").catch(() => undefined);
        const x = err as { code?: string; constraint?: string; message: string };
        return `${x.code}:${x.constraint ?? ""}`;
      } finally {
        c.release();
      }
    }
    const out: Record<string, string> = {};
    out.note_author_reviews = await tx("UPDATE evidence SET review_status='verified', accessibility_status='accessible', reviewed_by=$2, reviewed_at=now(), version=version+1, updated_by=$2 WHERE id=$1 RETURNING version", [e.body.id, p.lead.id], e.body.id);
    out.note_author_spoofs_content_author = await tx("UPDATE evidence SET content_authored_by=$3, review_status='verified', accessibility_status='accessible', reviewed_by=$2, reviewed_at=now(), version=version+1, updated_by=$2 WHERE id=$1 RETURNING version", [e.body.id, p.lead.id, p.sponsor.id], e.body.id);
    out.file_uploader_reviews = await tx("UPDATE evidence SET review_status='verified', accessibility_status='accessible', reviewed_by=$2, reviewed_at=now(), reviewed_content_id=current_content_id, version=version+1, updated_by=$2 WHERE id=$1 RETURNING version", [f.body.id, p.lead.id], f.body.id);
    out.insert_prereviewed_by_creator = await (async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("INSERT INTO evidence (id, organization_id, transformation_id, kind, title, note_body, owner_user_id, created_by, updated_by, review_status, accessibility_status, reviewed_by, reviewed_at) VALUES (mth_uuid_v7(), $1, $2, 'note', 't', 'b', $3, $3, $3, 'verified', 'accessible', $3, now())", [w.orgA.id, p.transformationId, p.lead.id]);
        await c.query("COMMIT");
        return "COMMITTED";
      } catch (err) {
        await c.query("ROLLBACK").catch(() => undefined);
        const x = err as { code?: string; constraint?: string };
        return `${x.code}:${x.constraint ?? ""}`;
      } finally {
        c.release();
      }
    })();
    out.control_independent_reviewer = await tx("UPDATE evidence SET review_status='verified', accessibility_status='accessible', reviewed_by=$2, reviewed_at=now(), version=version+1, updated_by=$2 WHERE id=$1 RETURNING version", [e.body.id, p.sponsor.id], e.body.id);
    log("140.db_bypass", out);
    await pool.end();
    expect(out.note_author_reviews).toBe("23514:evidence_review_separation");
    expect(out.note_author_spoofs_content_author).toBe("23514:evidence_review_separation");
    expect(out.file_uploader_reviews).toBe("23514:evidence_review_separation");
    expect(out.insert_prereviewed_by_creator.startsWith("COMMITTED")).toBe(false);
    expect(out.control_independent_reviewer).toBe("COMMITTED");
  });
});

describe("F-DG2-141 T02 trajectory approval SoD", () => {
  let bo: { id: string; subject: string };
  let boS: unknown;
  let outcomeId: string;
  let defId: string;
  beforeAll(async () => {
    bo = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, bo.id, "BO", { type: "transformation", id: p.transformationId }, w.orgA.id);
    boS = await signIn(api.app, bo.subject);
    const outcome = await call(api.app, "POST", `${T}/outcomes`, { session: p.lead.session, body: { statement: "Synthetic outcome: raise roaming revenue 10% by 2027." } });
    const def = await call(api.app, "POST", `${T}/kpi-definitions`, { session: p.lead.session, body: { name: "Synthetic roaming revenue", unitKind: "percentage", polarity: "higher_is_better", ownerUserId: p.lead.id } });
    outcomeId = outcome.body.id;
    defId = def.body.id;
  });
  const newRow = async (ordinal: number) => {
    const r = await call(api.app, "POST", `${T}/outcome-kpis`, { session: p.lead.session, body: { outcomeId, kpiDefinitionId: defId, targetDate: "2027-12-31", targetValue: "100", ordinal } });
    expect(r.status).toBe(201);
    return r.body as { id: string; version: number };
  };
  const patch = (id: string, s: unknown, v: number, body: object) => call(api.app, "PATCH", `${T}/outcome-kpis/${id}`, { session: s as never, headers: ifm(v), body });
  const approve = (id: string, s: unknown, v: number) => call(api.app, "POST", `${T}/outcome-kpis/${id}/trajectory-approval`, { session: s as never, headers: ifm(v), body: { note: "probe (synthetic)" } });

  it("R1 repro: BO sets targetValue, then approves -> 403 kpi.target_author_cannot_approve + denied audit", async () => {
    const row = await newRow(11);
    const e = await patch(row.id, boS, row.version, { targetValue: "5" });
    const a = await approve(row.id, boS, e.body.version);
    log("141.r1", [e.status, a.status, a.body.code, await denied(a)]);
    expect(e.status).toBe(200);
    expect(a.status).toBe(403);
    expect(a.body.code).toBe("kpi.target_author_cannot_approve");
    expect((await denied(a)).length).toBe(1);
  });
  for (const [label, body] of [
    ["targetDate", { targetDate: "2028-06-30" }],
    ["trajectoryPoints", { trajectoryPoints: [{ date: "2027-06-30", value: "50" }] }],
    ["baselineValue", { baselineValue: "1" }],
  ] as const)
    it(`variant: BO changes only ${label}, then approves -> 403`, async () => {
      const row = await newRow(20 + label.length);
      const e = await patch(row.id, boS, row.version, body);
      const a = await approve(row.id, boS, e.body.version);
      log(`141.${label}`, [e.status, e.status >= 300 ? e.body.code : null, a.status, a.body.code]);
      expect(e.status).toBe(200);
      expect(a.status).toBe(403);
    });
  it("variant: BO sets target, then TL changes only targetDate -> BO still authored the target -> 403", async () => {
    const row = await newRow(31);
    const e = await patch(row.id, boS, row.version, { targetValue: "7" });
    const t = await patch(row.id, p.lead.session, e.body.version, { targetDate: "2028-01-31" });
    const a = await approve(row.id, boS, t.body.version);
    log("141.bo_then_tl_date", [e.status, t.status, a.status]);
    expect(a.status).toBe(403);
  });
  it("variant: SP approves legitimately; BO edits target (resets to draft) then approves -> 403", async () => {
    const row = await newRow(32);
    const sp = await approve(row.id, p.sponsor.session, row.version);
    const e = await patch(row.id, boS, sp.body.version, { targetValue: "6" });
    const a = await approve(row.id, boS, e.body.version);
    log("141.after_approval", [sp.status, e.status, e.body.trajectoryStatus, a.status]);
    expect(sp.status).toBe(200);
    expect(e.body.trajectoryStatus).toBe("draft");
    expect(a.status).toBe(403);
  });
  it("controls: BO edits a non-trajectory field -> may approve; TL overwrites BO's target -> BO may approve", async () => {
    const r1 = await newRow(33);
    const e1 = await patch(r1.id, boS, r1.version, { leadingIndicatorText: "BO wording (synthetic)" });
    const a1 = await approve(r1.id, boS, e1.body.version);
    const r2 = await newRow(34);
    const e2 = await patch(r2.id, boS, r2.version, { targetValue: "8" });
    const t2 = await patch(r2.id, p.lead.session, e2.body.version, { targetValue: "9" });
    const a2 = await approve(r2.id, boS, t2.body.version);
    log("141.controls", [e1.status, a1.status, a1.body.code ?? null, e2.status, t2.status, a2.status]);
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(200);
  });
});

describe("F-DG2-142 evidence-link removal needs record edit rights", () => {
  it("WL cannot remove TL's link on a seeded T01 row (403 + audit); TL can (control)", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.lead.session, body: { kind: "note", title: "n", noteBody: "n", ownerUserId: p.lead.id } });
    const items = await call(api.app, "GET", `${T}/diagnostic-items?limit=50`, { session: p.lead.session });
    const item = items.body.items.find((i: { isSeeded: boolean }) => i.isSeeded);
    const wlCreate = await call(api.app, "POST", `${T}/evidence-links`, { session: p.contributor.session, body: { evidenceId: e.body.id, recordType: "diagnostic_item", recordId: item.id } });
    const link = await call(api.app, "POST", `${T}/evidence-links`, { session: p.lead.session, body: { evidenceId: e.body.id, recordType: "diagnostic_item", recordId: item.id } });
    const rm = await call(api.app, "POST", `${T}/evidence-links/${link.body.id}/remove`, { session: p.contributor.session, headers: ifm(1), body: { reason: "WL removes TL link (synthetic)" } });
    const still = await api.db.selectFrom("evidence_link").select(["status", "version"]).where("id", "=", link.body.id).executeTakeFirstOrThrow();
    const ok = await call(api.app, "POST", `${T}/evidence-links/${link.body.id}/remove`, { session: p.lead.session, headers: ifm(1), body: { reason: "TL removes own link (synthetic)" } });
    log("142", { wlCreate: wlCreate.status, tlCreate: link.status, wlRemove: rm.status, code: rm.body.code, audit: await denied(rm), after: still, tlRemove: ok.status });
    expect(wlCreate.status).toBe(403);
    expect(rm.status).toBe(403);
    expect(still.status).toBe("active");
    expect((await denied(rm)).length).toBe(1);
    expect(ok.status).toBe(200);
  });
  it("AUD cannot remove a link (403); unknown link id stays 404 for a member", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.lead.session, body: { kind: "note", title: "n2", noteBody: "n2", ownerUserId: p.lead.id } });
    const items = await call(api.app, "GET", `${T}/diagnostic-items?limit=50`, { session: p.lead.session });
    const item = items.body.items.find((i: { isSeeded: boolean }) => i.isSeeded);
    const link = await call(api.app, "POST", `${T}/evidence-links`, { session: p.lead.session, body: { evidenceId: e.body.id, recordType: "diagnostic_item", recordId: item.id } });
    const aud = await call(api.app, "POST", `${T}/evidence-links/${link.body.id}/remove`, { session: p.auditor.session, headers: ifm(1), body: { reason: "aud (synthetic)" } });
    const missing = await call(api.app, "POST", `${T}/evidence-links/0190f0f0-0000-7000-8000-000000000000/remove`, { session: p.lead.session, headers: ifm(1), body: { reason: "none (synthetic)" } });
    log("142.aud_404", [aud.status, missing.status]);
    expect(aud.status).toBe(403);
    expect(missing.status).toBe(404);
  });
});

describe("activateKpiDefinition authorization (new op)", () => {
  it("WL, BO, AUD -> 403 with audit; TL -> 200 once; stale If-Match -> 409", async () => {
    const def = await call(api.app, "POST", `${T}/kpi-definitions`, { session: p.lead.session, body: { name: "Synthetic act KPI", unitKind: "percentage", polarity: "higher_is_better", ownerUserId: p.lead.id } });
    const bo = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, bo.id, "BO", { type: "transformation", id: p.transformationId }, w.orgA.id);
    const boS = await signIn(api.app, bo.subject);
    const P = `${T}/kpi-definitions/${def.body.id}/activate`;
    const r: Record<string, unknown> = {};
    for (const [k, s] of [["wl", p.contributor.session], ["bo", boS], ["aud", p.auditor.session]] as const) {
      const x = await call(api.app, "POST", P, { session: s, headers: ifm(def.body.version), body: {} });
      r[k] = [x.status, (await denied(x)).length];
    }
    const stale = await call(api.app, "POST", P, { session: p.lead.session, headers: ifm(def.body.version + 5), body: {} });
    const ok = await call(api.app, "POST", P, { session: p.lead.session, headers: ifm(def.body.version), body: {} });
    const again = await call(api.app, "POST", P, { session: p.lead.session, headers: ifm(ok.body.version), body: {} });
    r.stale = stale.status;
    r.ok = [ok.status, ok.body.status];
    r.again = [again.status, again.body.code];
    log("activate", r);
    expect(r.wl).toEqual([403, 1]);
    expect(r.bo).toEqual([403, 1]);
    expect(r.aud).toEqual([403, 1]);
    expect(stale.status).toBe(409);
    expect(ok.status).toBe(200);
    expect(again.status).toBe(422);
  });
});
