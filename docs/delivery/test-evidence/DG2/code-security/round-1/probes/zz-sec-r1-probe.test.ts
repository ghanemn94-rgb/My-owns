// code-security-reviewer DG2 round-1 reproduction probes (T-DG2-REV-SEC-R1). NOT part of the candidate: copied into a
// disposable clone at apps/api/test/integration/ and run against a disposable PostgreSQL 16 cluster. All data SYNTHETIC.
// Each `it` RECORDS the observed behaviour (console.log PROBE lines) and asserts the SECURE expectation, so a failing
// assertion = a reproduced defect.
import pg from "pg";
import { inject } from "vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest, call, createUser, grant, seedWorld, signIn, startApi, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let q: P2World; // a second transformation (other team) in the same org
let T: string;
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  q = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());

describe("SEC-1 evidence separation of duties: reviewer must not verify content they supplied", () => {
  it("note: TL rewrites a WL-created note, then verifies it himself", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, {
      session: p.contributor.session,
      body: { kind: "note", title: "WL note (synthetic)", noteBody: "Original WL text", ownerUserId: p.contributor.id },
    });
    expect(e.status).toBe(201);
    const edit = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { noteBody: "Text written by the TL who will verify it" },
    });
    log("SEC-1.note.tl_edit_other_users_evidence", [edit.status, edit.body.noteBody, edit.body.createdBy === p.contributor.id]);
    const v = await call(api.app, "POST", `${T}/evidence/${e.body.id}/review`, {
      session: p.lead.session,
      headers: ifm(edit.body.version),
      body: { result: "verified", accessibilityStatus: "accessible", note: "self-verify of own text (synthetic)" },
    });
    log("SEC-1.note.tl_verifies_own_text", [v.status, v.body.reviewStatus, v.body.reviewedBy === p.lead.id]);
    expect(v.status).toBe(403);
  });

  it("file: TL uploads a new revision to a WL-created file evidence, then verifies his own upload", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, {
      session: p.contributor.session,
      body: { kind: "file", title: "WL extract (synthetic)", ownerUserId: p.contributor.id },
    });
    const up = await call(api.app, "POST", `${T}/evidence/${e.body.id}/content`, {
      session: p.lead.session,
      headers: { ...ifm(1), "content-type": "application/octet-stream", "x-file-name": "tl.csv" },
      body: Buffer.from("a,b\n9,9\n"),
    });
    const up2 = await api.db.selectFrom("evidence_content").select(["uploaded_by"]).where("evidence_id", "=", e.body.id).execute();
    log("SEC-1.file.tl_uploads", [up.status, up2.map((r) => r.uploaded_by === p.lead.id)]);
    const v = await call(api.app, "POST", `${T}/evidence/${e.body.id}/review`, {
      session: p.lead.session,
      headers: ifm(up.body.version),
      body: { result: "verified", accessibilityStatus: "accessible", note: "self-verify of own upload (synthetic)" },
    });
    log("SEC-1.file.tl_verifies_own_upload", [v.status, v.body.reviewStatus, v.body.reviewedContentId === up.body.currentContentId]);
    expect(v.status).toBe(403);
  });
});

describe("SEC-2 T02 trajectory approval: approver must not approve a target they set", () => {
  it("BO changes the TL-created target value, then approves the trajectory himself", async () => {
    const bo = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, bo.id, "BO", { type: "transformation", id: p.transformationId }, w.orgA.id);
    const boS = await signIn(api.app, bo.subject);
    const outcome = await call(api.app, "POST", `${T}/outcomes`, { session: p.lead.session, body: { statement: "Synthetic outcome: raise roaming revenue 10% by 2027." } });
    const def = await call(api.app, "POST", `${T}/kpi-definitions`, {
      session: p.lead.session,
      body: { name: "Synthetic roaming revenue", unitKind: "percentage", polarity: "higher_is_better", ownerUserId: p.lead.id },
    });
    log("SEC-2.setup", [outcome.status, def.status, def.status >= 300 ? def.body : null]);
    const row = await call(api.app, "POST", `${T}/outcome-kpis`, {
      session: p.lead.session,
      body: { outcomeId: outcome.body.id, kpiDefinitionId: def.body.id, targetDate: "2027-12-31", targetValue: "100" },
    });
    log("SEC-2.t02_created_by_tl", [row.status, row.status >= 300 ? row.body : row.body.targetValue]);
    const edit = await call(api.app, "PATCH", `${T}/outcome-kpis/${row.body.id}`, { session: boS, headers: ifm(row.body.version), body: { targetValue: "5" } });
    log("SEC-2.bo_sets_target", [edit.status, edit.body.targetValue]);
    const ok = await call(api.app, "POST", `${T}/outcome-kpis/${row.body.id}/trajectory-approval`, {
      session: boS,
      headers: ifm(edit.body.version),
      body: { note: "approving the target I just set (synthetic)" },
    });
    log("SEC-2.bo_approves_own_target", [ok.status, ok.body.trajectoryStatus, ok.body.trajectoryApprovedBy === bo.id]);
    expect(ok.status).toBe(403);
  });
});

describe("SEC-3 evidence-link removal needs the same edit rights as creating the link", () => {
  it("WL (diagnostic.contribute own-only) removes the TL's evidence link on a seeded T01 row", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.lead.session, body: { kind: "note", title: "n", noteBody: "n", ownerUserId: p.lead.id } });
    const items = await call(api.app, "GET", `${T}/diagnostic-items?limit=50`, { session: p.lead.session });
    const item = items.body.items.find((i: { isSeeded: boolean }) => i.isSeeded);
    const wlCreate = await call(api.app, "POST", `${T}/evidence-links`, { session: p.contributor.session, body: { evidenceId: e.body.id, recordType: "diagnostic_item", recordId: item.id } });
    const link = await call(api.app, "POST", `${T}/evidence-links`, { session: p.lead.session, body: { evidenceId: e.body.id, recordType: "diagnostic_item", recordId: item.id } });
    const rm = await call(api.app, "POST", `${T}/evidence-links/${link.body.id}/remove`, { session: p.contributor.session, headers: ifm(1), body: { reason: "WL removes TL link (synthetic)" } });
    log("SEC-3", { wlCreateStatus: wlCreate.status, tlCreateStatus: link.status, wlRemoveStatus: rm.status, after: rm.body.status });
    expect(wlCreate.status).toBe(403);
    expect(rm.status).toBe(403);
  });
});

describe("SEC-4 cross-organization / wrong-scope actors", () => {
  it("TO of org B and WL of another transformation get 404 on reads and writes; nothing written", async () => {
    const officeB = await signIn(api.app, w.officeB.subject);
    const res: Record<string, number> = {};
    res.orgB_get_evidence = (await call(api.app, "GET", `${T}/evidence`, { session: officeB })).status;
    res.orgB_post_evidence = (await call(api.app, "POST", `${T}/evidence`, { session: officeB, body: { kind: "note", title: "x", noteBody: "x", ownerUserId: w.officeB.id } })).status;
    res.orgB_get_gate = (await call(api.app, "GET", `${T}/gates/G1`, { session: officeB })).status;
    res.orgB_decide = (await call(api.app, "POST", `${T}/gates/G1/decision`, { session: officeB, body: { submissionNo: 1, outcome: "approved", rationale: "xxx" } })).status;
    res.otherWL_get_charter = (await call(api.app, "GET", `${T}/charter`, { session: q.contributor.session })).status;
    res.otherWL_post_finding = (await call(api.app, "POST", `${T}/diagnostic-findings`, { session: q.contributor.session, body: { workstreamCode: "business_financial", kind: "symptom", statement: "x", status: "draft" } })).status;
    res.otherSP_decide = (await call(api.app, "POST", `${T}/gates/G1/decision`, { session: q.sponsor.session, body: { submissionNo: 1, outcome: "approved", rationale: "xxx" } })).status;
    res.nobody_get = (await call(api.app, "GET", `${T}/baselines`, { session: await signIn(api.app, w.nobody.subject) })).status;
    log("SEC-4", res);
    for (const [k, s] of Object.entries(res)) expect([k, s]).toEqual([k, 404]);
  });

  it("AUD: an evidence review and a gate submit are 403 with a denied-mutation audit event; AUD reads 200", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.lead.session, body: { kind: "note", title: "n", noteBody: "n", ownerUserId: p.lead.id } });
    const r = await call(api.app, "POST", `${T}/evidence/${e.body.id}/review`, { session: p.auditor.session, headers: ifm(1), body: { result: "verified", accessibilityStatus: "accessible", note: "x" } });
    const s = await call(api.app, "POST", `${T}/gates/G1/submissions`, { session: p.auditor.session, headers: ifm(1), body: {} });
    const rid = (x: { headers: Record<string, unknown> }) => String(x.headers["x-request-id"]);
    const ar = await auditOfRequest(api.db, rid(r));
    const as = await auditOfRequest(api.db, rid(s));
    const reads = [
      (await call(api.app, "GET", `${T}/evidence/${e.body.id}`, { session: p.auditor.session })).status,
      (await call(api.app, "GET", `${T}/gates`, { session: p.auditor.session })).status,
    ];
    log("SEC-4.aud", { review: r.status, submit: s.status, reviewAudit: ar.map((a) => [a.action, a.outcome]), submitAudit: as.map((a) => [a.action, a.outcome]), reads });
    expect([r.status, s.status]).toEqual([403, 403]);
    expect(ar.length).toBe(1);
    expect(as.length).toBe(1);
    expect(reads).toEqual([200, 200]);
  });
});

describe("SEC-5 database guards (migration 0010/0012/0017) as mth_app and mth_owner", () => {
  const appPool = () => new pg.Pool({ connectionString: api.config.databaseUrl!, max: 1 });
  async function tx(pool: pg.Pool, stmts: (c: pg.PoolClient) => Promise<void>): Promise<string> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await stmts(c);
      await c.query("COMMIT");
      return "COMMITTED";
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      const err = e as { code?: string; constraint?: string; message: string };
      return `${err.code}:${err.constraint ?? ""}:${err.message.slice(0, 90)}`;
    } finally {
      c.release();
    }
  }
  it("audit-required at COMMIT, version step, append-only, cross-transformation record ref, org mismatch", async () => {
    const pool = appPool();
    const ev = await call(api.app, "POST", `${T}/evidence`, { session: p.lead.session, body: { kind: "note", title: "g", noteBody: "g", ownerUserId: p.lead.id } });
    const id = ev.body.id as string;
    const out: Record<string, string> = {};
    out.update_without_audit = await tx(pool, (c) => c.query("UPDATE evidence SET title='x', version=version+1 WHERE id=$1", [id]).then(() => undefined));
    out.insert_without_audit = await tx(pool, (c) =>
      c.query(
        "INSERT INTO evidence (id, organization_id, transformation_id, kind, title, note_body, owner_user_id, created_by, updated_by) VALUES (mth_uuid_v7(), $1, $2, 'note', 't', 'b', $3, $3, $3)",
        [w.orgA.id, p.transformationId, p.lead.id],
      ).then(() => undefined),
    );
    out.version_step_2 = await tx(pool, (c) => c.query("UPDATE evidence SET title='y', version=version+2 WHERE id=$1", [id]).then(() => undefined));
    out.version_unchanged = await tx(pool, (c) => c.query("UPDATE evidence SET title='z' WHERE id=$1", [id]).then(() => undefined));
    out.insert_version_2 = await tx(pool, (c) =>
      c.query(
        "INSERT INTO evidence (id, organization_id, transformation_id, kind, title, note_body, owner_user_id, created_by, updated_by, version) VALUES (mth_uuid_v7(), $1, $2, 'note', 't', 'b', $3, $3, $3, 2)",
        [w.orgA.id, p.transformationId, p.lead.id],
      ).then(() => undefined),
    );
    out.org_mismatch = await tx(pool, (c) =>
      c.query(
        "INSERT INTO evidence (id, organization_id, transformation_id, kind, title, note_body, owner_user_id, created_by, updated_by) VALUES (mth_uuid_v7(), $1, $2, 'note', 't', 'b', $3, $3, $3)",
        [w.orgB.id, p.transformationId, p.lead.id],
      ).then(() => undefined),
    );
    out.identity_change = await tx(pool, (c) => c.query("UPDATE evidence SET created_by=$2, version=version+1 WHERE id=$1", [id, p.sponsor.id]).then(() => undefined));
    const otherItem = await api.db.selectFrom("diagnostic_item").select("id").where("transformation_id", "=", q.transformationId).executeTakeFirstOrThrow();
    out.cross_transformation_link = await tx(pool, (c) =>
      c.query(
        "INSERT INTO evidence_link (id, organization_id, transformation_id, evidence_id, record_type, record_id, created_by, updated_by) VALUES (mth_uuid_v7(), $1, $2, $3, 'diagnostic_item', $4, $5, $5)",
        [w.orgA.id, p.transformationId, id, otherItem.id, p.lead.id],
      ).then(() => undefined),
    );
    out.app_update_charter_version = await tx(pool, (c) => c.query("UPDATE charter_version SET change_summary='x'").then(() => undefined));
    out.app_delete_gate_decision = await tx(pool, (c) => c.query("DELETE FROM gate_decision").then(() => undefined));
    out.app_delete_evidence = await tx(pool, (c) => c.query("DELETE FROM evidence WHERE id=$1", [id]).then(() => undefined));
    // Owner role holds table privileges; the append-only TRIGGERS must still refuse.
    // (round-1 probe fix: the first run had NO charter_version row, so a row trigger could not fire; create one first)
    const ch = await call(api.app, "POST", `${T}/charter`, { session: p.lead.session, body: { transformationName: "Synthetic charter for guard probe" } });
    const cvRows = await api.db.selectFrom("charter_version").select("id").where("transformation_id", "=", p.transformationId).execute();
    log("SEC-5.charter_versions_present", [ch.status, cvRows.length]);
    out.owner_update_charter_version = await tx(api.owner, (c) => c.query("UPDATE charter_version SET change_summary='x' WHERE transformation_id=$1", [p.transformationId]).then(() => undefined));
    out.owner_delete_evidence_content = await tx(api.owner, (c) => c.query("DELETE FROM evidence_content WHERE true").then(() => undefined));
    out.owner_truncate_gate_decision = await tx(api.owner, (c) => c.query("TRUNCATE gate_submission_criterion").then(() => undefined));
    // control: a correct update with its audit event commits
    out.control_update_with_audit = await tx(pool, async (c) => {
      const r = await c.query("UPDATE evidence SET title='ok', version=version+1, updated_at=now() WHERE id=$1 RETURNING version", [id]);
      await c.query(
        "INSERT INTO audit_event (id, occurred_at, actor_type, actor_user_id, request_id, source, action, record_type, record_id, organization_id, transformation_id, prior_version, new_version) VALUES (mth_uuid_v7(), now(), 'user', $2, 'sec-probe', 'api', 'evidence.update', 'evidence', $1, $3, $4, $5, $6)",
        [id, p.lead.id, w.orgA.id, p.transformationId, r.rows[0].version - 1, r.rows[0].version],
      );
    });
    log("SEC-5", out);
    await pool.end();
    for (const k of Object.keys(out).filter((k) => k !== "control_update_with_audit")) expect([k, out[k]!.startsWith("COMMITTED")]).toEqual([k, false]);
    void inject;
  });
});
