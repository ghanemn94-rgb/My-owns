// DG2 round-1 repairs (T-DG2-BE3), reproduced and fixed against a real PostgreSQL:
//   F-DG2-140 (REQ-S13-012)  nobody verifies evidence content they supplied (creator, note/URL author, file uploader);
//                            another user's evidence content can be edited/replaced only by its creator or owner;
//                            the 0019 trigger refuses such a review even if the API is bypassed.
//   F-DG2-142 (REQ-S10-001)  removing an evidence link needs the same record-level edit rights as creating it.
//   F-DG2-203 (REQ-PB-030)   an incomplete thesis is flagged on the charter and keeps G2 g2.outcome_tree incomplete.
//   F-DG2-204 (REQ-PB-033)   the charter shows the CURRENT North Star after a refinement (stale link flagged).
//   F-DG2-205 (REQ-S04-005)  product gates run in sequence; an approval advances the phase by exactly one step.
// All data is synthetic. Product gates G1-G6 are business approvals inside the product; the demo decisions here
// approve nothing real, and nothing touches the engineering delivery gates DG0-DG7.
import { createHash } from "node:crypto";
import { sql } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { record } from "../../src/modules/audit/index.ts";
import { advancePhaseOnGateApproval } from "../../src/modules/transformations/index.ts";
import { auditOf, auditOfRequest, call, seedWorld, startApi, type TestApi, type World } from "../support/harness.ts";
import { gateVersion, ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
});
afterAll(() => api.close());

const base = (p: P2World) => `/api/v1/transformations/${p.transformationId}`;
const deniedOnly = async (res: { headers: Record<string, unknown> }) =>
  (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((x) => x.action);
const verify = { result: "verified", accessibilityStatus: "accessible", note: "Synthetic: opened and read." };

// ---------------------------------------------------------------------------------------------------- F-DG2-140
describe("F-DG2-140 evidence separation of duties (REQ-S13-012)", () => {
  let p: P2World;
  let T: string;
  beforeAll(async () => {
    p = await setupP2World(api, w);
    T = base(p);
  });
  const create = (body: Record<string, unknown>, session = p.contributor.session) =>
    call(api.app, "POST", `${T}/evidence`, { session, body });
  const upload = (id: string, version: number, session: P2World["lead"]["session"]) =>
    call(api.app, "POST", `${T}/evidence/${id}/content`, {
      session,
      headers: { ...ifm(version), "content-type": "application/octet-stream", "x-file-name": "synthetic.csv" },
      body: Buffer.from("a,b\n1,2\n"),
    });
  const review = (id: string, version: number, session: P2World["lead"]["session"]) =>
    call(api.app, "POST", `${T}/evidence/${id}/review`, { session, headers: ifm(version), body: verify });

  it("repro (note): a TL can no longer replace a WL's note text (403 + denial audit), so cannot verify own text", async () => {
    const e = await create({ kind: "note", title: "WL note", noteBody: "WL's text", ownerUserId: p.contributor.id });
    expect(e.status).toBe(201);
    const patch = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { noteBody: "TL's own text" },
    });
    expect(patch.status).toBe(403);
    expect(await deniedOnly(patch)).toEqual(["authorization.denied"]);
    expect((await auditOf(api.db, e.body.id)).map((x) => x.action)).toEqual(["evidence.create"]);
    // Archiving another user's item: refused for a contributor without evidence.review ...
    const other = await create(
      { kind: "note", title: "TL note", noteBody: "x", ownerUserId: p.lead.id },
      p.lead.session,
    );
    const wlArchive = await call(api.app, "POST", `${T}/evidence/${other.body.id}/archive`, {
      session: p.contributor.session,
      headers: ifm(1),
      body: { reason: "Synthetic archive attempt" },
    });
    expect(wlArchive.status).toBe(403);
    // ... and the creator still edits their own item (positive case).
    const own = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, {
      session: p.contributor.session,
      headers: ifm(1),
      body: { noteBody: "WL's revised text" },
    });
    expect(own.status).toBe(200);
  });

  it("repro (file): a TL can no longer upload a revision to a WL's file evidence (403)", async () => {
    const f = await create({ kind: "file", title: "WL file", ownerUserId: p.contributor.id });
    const up = await upload(f.body.id, 1, p.lead.session);
    expect(up.status).toBe(403);
    expect(await deniedOnly(up)).toEqual(["authorization.denied"]);
    const rows = await api.db
      .selectFrom("evidence_content")
      .select("id")
      .where("evidence_id", "=", f.body.id)
      .execute();
    expect(rows).toEqual([]);
  });

  it("the author of the current note/URL text (the named owner who edited it) cannot verify it: 403 reviewer_is_author", async () => {
    for (const kind of ["note", "external_link"] as const) {
      const payload = kind === "note" ? { noteBody: "WL text" } : { url: "https://intranet.example.invalid/wl-report" };
      const e = await create({ kind, title: `Owned by TL (${kind})`, ownerUserId: p.lead.id, ...payload });
      const edit = kind === "note" ? { noteBody: "TL text" } : { url: "https://intranet.example.invalid/tl-report" };
      const patched = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, {
        session: p.lead.session,
        headers: ifm(1),
        body: edit,
      });
      expect(patched.status, kind).toBe(200);
      const self = await review(e.body.id, 2, p.lead.session);
      expect([self.status, self.body.code], kind).toEqual([403, "evidence.reviewer_is_author"]);
      expect(await deniedOnly(self)).toEqual(["authorization.denied"]);
      const row = await api.db
        .selectFrom("evidence")
        .select(["review_status", "content_authored_by"])
        .where("id", "=", e.body.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ review_status: "unverified", content_authored_by: p.lead.id });
      // An independent reviewer (TO) verifies it.
      const ok = await review(e.body.id, 2, p.office.session);
      expect([ok.status, ok.body.reviewStatus, ok.body.reviewedBy], kind).toEqual([200, "verified", p.office.id]);
    }
  });

  it("the uploader of the current file revision cannot verify it: 403 reviewer_is_author; another reviewer can", async () => {
    const f = await create({ kind: "file", title: "Owned by TL (file)", ownerUserId: p.lead.id });
    const up = await upload(f.body.id, 1, p.lead.session);
    expect(up.status).toBe(200);
    const self = await review(f.body.id, 2, p.lead.session);
    expect([self.status, self.body.code]).toEqual([403, "evidence.reviewer_is_author"]);
    const ok = await review(f.body.id, 2, p.office.session);
    expect(ok.body).toMatchObject({ reviewStatus: "verified", reviewedContentId: up.body.currentContentId });
  });

  it("the creator still cannot review (403 reviewer_is_creator, now with a denial audit)", async () => {
    const e = await create({ kind: "note", title: "TL own", noteBody: "x", ownerUserId: p.lead.id }, p.lead.session);
    const self = await review(e.body.id, 1, p.lead.session);
    expect([self.status, self.body.code]).toEqual([403, "evidence.reviewer_is_creator"]);
    expect(await deniedOnly(self)).toEqual(["authorization.denied"]);
  });

  it("database guard (0019): content_authored_by is trigger-maintained, and a self-review is refused even bypassing the API", async () => {
    const e = await create({ kind: "note", title: "Guarded", noteBody: "WL text", ownerUserId: p.lead.id });
    const patched = await call(api.app, "PATCH", `${T}/evidence/${e.body.id}`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { noteBody: "TL text" },
    });
    expect(patched.status).toBe(200);
    // A forged content author is overwritten by the trigger (the title is not content, so the author stays the TL).
    const forged = await api.db
      .transaction()
      .execute(async (tx) => {
        const r = await tx
          .updateTable("evidence")
          .set({ title: "Forged", content_authored_by: p.office.id, version: sql<number>`version + 1` })
          .where("id", "=", e.body.id)
          .returning("content_authored_by")
          .executeTakeFirstOrThrow();
        throw Object.assign(new Error("rollback"), { seen: r.content_authored_by });
      })
      .catch((err: { seen?: string }) => err.seen);
    expect(forged).toBe(p.lead.id);
    // Direct self-verification by the content author: refused by evidence_review_separation.
    const err = await api.db
      .updateTable("evidence")
      .set({
        review_status: "verified",
        accessibility_status: "accessible",
        reviewed_by: p.lead.id,
        reviewed_at: sql<Date>`now()`,
        version: sql<number>`version + 1`,
      })
      .where("id", "=", e.body.id)
      .execute()
      .then(
        () => null,
        (x: { constraint?: string }) => x.constraint,
      );
    expect(err).toBe("evidence_review_separation");
  });
});

// ---------------------------------------------------------------------------------------------------- F-DG2-142
describe("F-DG2-142 evidence-link removal needs edit rights on the record (REQ-S10-001)", () => {
  it("repro: a WL cannot remove the TL's link on a T01 row they may not edit (403 + denial audit); the TL can", async () => {
    const p = await setupP2World(api, w);
    const T = base(p);
    const e = await call(api.app, "POST", `${T}/evidence`, {
      session: p.lead.session,
      body: { kind: "note", title: "Linked", noteBody: "x", ownerUserId: p.lead.id },
    });
    const items = await call(api.app, "GET", `${T}/diagnostic-items`, { session: p.lead.session });
    const body = { evidenceId: e.body.id, recordType: "diagnostic_item", recordId: items.body.items[0].id };
    const wlCreate = await call(api.app, "POST", `${T}/evidence-links`, { session: p.contributor.session, body });
    const link = await call(api.app, "POST", `${T}/evidence-links`, { session: p.lead.session, body });
    expect([wlCreate.status, link.status]).toEqual([403, 201]);
    const wlRemove = await call(api.app, "POST", `${T}/evidence-links/${link.body.id}/remove`, {
      session: p.contributor.session,
      headers: ifm(1),
      body: { reason: "Synthetic unlink attempt" },
    });
    expect(wlRemove.status).toBe(403);
    expect(await deniedOnly(wlRemove)).toEqual(["authorization.denied"]);
    const still = await api.db
      .selectFrom("evidence_link")
      .select(["status", "version"])
      .where("id", "=", link.body.id)
      .executeTakeFirstOrThrow();
    expect(still).toEqual({ status: "active", version: 1 });
    const tlRemove = await call(api.app, "POST", `${T}/evidence-links/${link.body.id}/remove`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic unlink" },
    });
    expect(tlRemove.body).toMatchObject({ status: "removed", version: 2 });
    expect((await auditOf(api.db, link.body.id)).map((x) => x.action)).toEqual([
      "evidence_link.create",
      "evidence_link.remove",
    ]);
  });
});

// ------------------------------------------------------------------------------------------ F-DG2-203 / F-DG2-204
describe("charter thesis (F-DG2-203) and current North Star (F-DG2-204)", () => {
  let p: P2World;
  let T: string;
  beforeAll(async () => {
    p = await setupP2World(api, w);
    T = base(p);
  });
  type Warn = { code: string; pointer?: string };
  const charter = () => call(api.app, "GET", `${T}/charter`, { session: p.lead.session });
  const thesisWarnings = (ws: Warn[]) => ws.filter((x) => x.code === "charter.thesis_incomplete").map((x) => x.pointer);

  it("REQ-PB-033: after a refinement the charter shows the CURRENT North Star, flags the stale link, and a save re-links it", async () => {
    const first = await call(api.app, "PUT", `${T}/north-star`, {
      session: p.lead.session,
      body: { statement: "Synthetic original star." },
    });
    const created = await call(api.app, "POST", `${T}/charter`, {
      session: p.lead.session,
      body: { transformationName: "Synthetic", northStarId: first.body.id },
    });
    expect(created.status).toBe(201);
    expect(created.body.warnings.map((x: Warn) => x.code)).not.toContain("charter.north_star_superseded");
    const refined = await call(api.app, "PUT", `${T}/north-star`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { statement: "Synthetic refined star." },
    });
    expect(refined.status).toBe(200);
    const view = await charter();
    expect(view.body.northStar).toMatchObject({ statement: "Synthetic refined star.", status: "current" });
    expect(view.body.warnings).toContainEqual(expect.objectContaining({ code: "charter.north_star_superseded" }));
    // Linking the superseded North Star explicitly is refused.
    const stale = await call(api.app, "PATCH", `${T}/charter`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { northStarId: first.body.id },
    });
    expect([stale.status, stale.body.code]).toEqual([422, "charter.north_star_not_current"]);
    // Any save re-links the current North Star, recorded in the diff and the new snapshot.
    const saved = await call(api.app, "PATCH", `${T}/charter`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { governanceForum: "Synthetic SteerCo" },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.charter.northStarId).toBe(refined.body.id);
    expect(saved.body.warnings.map((x: Warn) => x.code)).not.toContain("charter.north_star_superseded");
    const v2 = await call(api.app, "GET", `${T}/charter/versions/2`, { session: p.lead.session });
    expect(v2.body.northStarStatement).toBe("Synthetic refined star.");
  });

  it("REQ-PB-030: an empty thesis part is flagged on the charter and keeps G2 g2.outcome_tree incomplete", async () => {
    const view = await charter();
    expect(thesisWarnings(view.body.warnings)).toEqual([
      "/charter/thesisChange",
      "/charter/thesisOutcomes",
      "/charter/thesisBenefits",
      "/charter/thesisBecause",
    ]);
    const g2 = async () =>
      (await call(api.app, "GET", `${T}/gates/G2`, { session: p.lead.session })).body.criteria.find(
        (c: { key: string }) => c.key === "g2.outcome_tree",
      ) as { missing: Warn[] };
    expect((await g2()).missing.filter((m) => m.code === "g2.outcome_tree.thesis_incomplete").length).toBe(4);
    const partial = await call(api.app, "PATCH", `${T}/charter`, {
      session: p.lead.session,
      headers: ifm(view.headers.etag!.replace(/"/g, "")),
      body: {
        thesisChange: "the prepaid onboarding journey",
        thesisOutcomes: "first-week activation",
        thesisBenefits: "retained revenue",
      },
    });
    expect(thesisWarnings(partial.body.warnings)).toEqual(["/charter/thesisBecause"]);
    expect((await g2()).missing.filter((m) => m.code === "g2.outcome_tree.thesis_incomplete")).toEqual([
      expect.objectContaining({ pointer: "/charter/thesisBecause" }),
    ]);
    const full = await call(api.app, "PATCH", `${T}/charter`, {
      session: p.lead.session,
      headers: ifm(partial.headers.etag!.replace(/"/g, "")),
      body: { thesisBecause: "the synthetic diagnostic shows most churn happens in week one" },
    });
    expect(thesisWarnings(full.body.warnings)).toEqual([]);
    expect((await g2()).missing.map((m) => m.code)).not.toContain("g2.outcome_tree.thesis_incomplete");
  });
});

// ---------------------------------------------------------------------------------------------------- F-DG2-205
describe("F-DG2-205 sequential product gates (REQ-S04-005, B0009, B0023)", () => {
  const submit = async (p: P2World, code: string) =>
    call(api.app, "POST", `${base(p)}/gates/${code}/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, code)),
      body: { submissionNote: "Synthetic submission" },
    });

  it("End-to-End: G2 and G3 cannot be submitted before their predecessor is approved (422 gate.out_of_sequence), nothing written", async () => {
    const p = await setupP2World(api, w);
    for (const code of ["G2", "G3"]) {
      const before = await gateVersion(api, p, code);
      const res = await submit(p, code);
      expect([res.status, res.body.code], code).toEqual([422, "gate.out_of_sequence"]);
      expect(await gateVersion(api, p, code)).toBe(before);
      const view = await call(api.app, "GET", `${base(p)}/gates/${code}`, { session: p.lead.session });
      expect(view.body.canSubmit, code).toBe(false);
    }
  });

  /**
   * A G3 submission left pending from BEFORE this fix (the QA journey's state): inserted through the app role with
   * its audit events, exactly as the old API would have written it.
   */
  async function legacyPendingSubmission(p: P2World, gateCode: string): Promise<number> {
    return api.db.transaction().execute(async (tx) => {
      const audit = { actorUserId: p.lead.id, requestId: `legacy-${uuidv7()}` };
      const inst = await tx
        .selectFrom("gate_instance")
        .selectAll()
        .where("transformation_id", "=", p.transformationId)
        .where("gate_code", "=", gateCode)
        .executeTakeFirstOrThrow();
      const t = await tx
        .selectFrom("transformation")
        .select("organization_id")
        .where("id", "=", p.transformationId)
        .executeTakeFirstOrThrow();
      const id = uuidv7();
      const snapshot = JSON.stringify({ schema: "mth.gate-submission/1", gateCode, legacy: true });
      await tx
        .insertInto("gate_submission")
        .values({
          id,
          organization_id: t.organization_id,
          transformation_id: p.transformationId,
          gate_instance_id: inst.id,
          gate_code: gateCode,
          submission_no: 1,
          submitted_by: p.lead.id,
          submission_note: "Synthetic legacy submission",
          approver_role_code: "SP",
          approver_user_id: null,
          due_date: null,
          charter_id: null,
          charter_version_no: null,
          snapshot,
          snapshot_sha256: createHash("sha256").update(snapshot).digest("hex"),
          created_by: p.lead.id,
          updated_by: p.lead.id,
        })
        .execute();
      await record(tx, audit, {
        action: "gate_submission.create",
        recordType: "gate_submission",
        recordId: id,
        organizationId: t.organization_id,
        transformationId: p.transformationId,
        newVersion: 1,
      });
      const updated = await tx
        .updateTable("gate_instance")
        .set({
          status: "submitted",
          current_submission_id: id,
          latest_submission_no: 1,
          version: sql<number>`version + 1`,
          updated_by: p.lead.id,
        })
        .where("id", "=", inst.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "gate_instance.submit",
        recordType: "gate_instance",
        recordId: inst.id,
        organizationId: t.organization_id,
        transformationId: p.transformationId,
        priorVersion: inst.version,
        newVersion: updated.version,
      });
      return 1;
    });
  }

  it("repro: a pending G3 cannot be APPROVED while G2 is unapproved (422), the phase does not jump, nothing is written", async () => {
    const p = await setupP2World(api, w);
    const submissionNo = await legacyPendingSubmission(p, "G3");
    const decisionsBefore = await api.db
      .selectFrom("gate_decision")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .execute();
    const res = await call(api.app, "POST", `${base(p)}/gates/G3/decision`, {
      session: p.sponsor.session,
      body: { submissionNo, outcome: "approved", rationale: "Synthetic rationale for a demo decision." },
    });
    expect([res.status, res.body.code]).toEqual([422, "gate.out_of_sequence"]);
    const t = await call(api.app, "GET", base(p), { session: p.lead.session });
    expect(t.body.currentPhase).toBe("diagnose");
    expect(
      await api.db
        .selectFrom("gate_decision")
        .select("id")
        .where("transformation_id", "=", p.transformationId)
        .execute(),
    ).toEqual(decisionsBefore);
    // A non-approving outcome is still recorded (the stale submission can be sent back by its approver).
    const back = await call(api.app, "POST", `${base(p)}/gates/G3/decision`, {
      session: p.sponsor.session,
      body: { submissionNo, outcome: "changes_requested", rationale: "Synthetic: G2 must be approved first." },
    });
    expect(back.status).toBe(201);
  });

  it("an approval advances exactly one step from the gate's own phase; it never skips (define -> mobilize refused)", async () => {
    const p = await setupP2World(api, w);
    const audit = { actorUserId: p.lead.id, requestId: `phase-${uuidv7()}` };
    const run = (gatePhase: "diagnose" | "define" | "design", nextPhase: "define" | "design" | "mobilize") =>
      api.db
        .transaction()
        .execute(async (tx) => {
          const r = await advancePhaseOnGateApproval(tx, audit, {
            transformationId: p.transformationId,
            gatePhase,
            nextPhase,
            gateCode: "GX",
            decisionId: uuidv7(),
          });
          throw Object.assign(new Error("rollback"), { result: r });
        })
        .catch((e: { result?: unknown; code?: string; message: string }) =>
          e.message === "rollback" ? e.result : (e.code ?? e.message),
        );
    // In diagnose: the G3-like step (design -> mobilize) is refused; G1's step moves diagnose -> define.
    expect(await run("design", "mobilize")).toBe("gate.out_of_sequence");
    expect(await run("diagnose", "define")).toEqual({ from: "diagnose", to: "define" });
    // A catalogue that would skip a phase is a programming error, never a silent jump.
    expect(String(await run("define", "mobilize"))).toMatch(/does not follow/);
  });

  it("Modular entry stays valid: entering at design, G3 is not blocked by the earlier gates (only by its own criteria)", async () => {
    const p = await setupP2World(api, w);
    const m = await call(api.app, "POST", "/api/v1/transformations", {
      session: p.lead.session,
      body: { businessUnitId: w.a1, name: "Synthetic modular", mode: "modular", entryPhase: "design" },
    });
    expect(m.status).toBe(201);
    const q: P2World = { ...p, transformationId: m.body.id };
    expect(m.body.currentPhase).toBe("design");
    const res = await submit(q, "G3");
    expect([res.status, res.body.code]).toEqual([422, "gate_criteria_incomplete"]);
  });
});
