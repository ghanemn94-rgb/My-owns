// Governance forums and participants (ADR-0032 §1, §9, §11; T-DG4-BE-F) against a real PostgreSQL:
//  - REQ-PB-060 A01 "the five layers are seeded with cadence text verbatim": listForums on a NEW transformation (POST
//    /transformations runs p4_instantiate_transformation) returns the five B0093 layers in order, each with its
//    verbatim Layer, Cadence ("Monthly", "Bi-weekly", "Weekly", "Daily / 2-3x week", "Monthly"), Purpose,
//    Participants and Outputs texts and PROVISIONAL Arabic;
//  - REQ-S10-005 "participants, cut-off dates and agenda rules configurable": configuration is versioned and audited and
//    never changes the template;
//  - REQ-S16-019 "Forum": created and read through the API with authorization enforced;
//  - every mutation: authorization (TO positive; TL without forum.configure, AUD 403; ADM-only and another
//    organization 404; re-checked at commit time), validation (400/422 with the ADR-0032 §11 texts), If-Match 428/409,
//    its audit event.
// All data is SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { person } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { setupMeetingWorld, type MeetingWorld } from "./meeting-fixtures.ts";

let api: TestApi;
let w: World;
let x: MeetingWorld;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
}, 120_000);
afterAll(() => api.close());

const T = () => `/api/v1/transformations/${x.transformationId}`;

/** B0093, verbatim (Layer | Cadence | Purpose | Participants | Outputs). */
const B0093 = [
  [
    "executive_steerco",
    "Executive SteerCo",
    "Monthly",
    "Outcomes, major trade-offs, funding, escalation",
    "Sponsor + CxOs + Transformation Lead",
    "Decisions, unblockers, benefit view",
  ],
  [
    "transformation_review",
    "Transformation Review",
    "Bi-weekly",
    "Portfolio health, dependencies, risks, decisions",
    "Transformation Lead + workstream leads",
    "Integrated status, decision log",
  ],
  [
    "workstream_review",
    "Workstream Review",
    "Weekly",
    "Delivery, issues, actions",
    "Workstream lead + team",
    "Milestones, actions, RAID",
  ],
  [
    "rapid_response",
    "Rapid Response / Sprint",
    "Daily / 2-3x week",
    "Solve high-priority cross-functional issue",
    "Small empowered team",
    "Test, evidence, recommendation",
  ],
  [
    "value_review",
    "Value Review",
    "Monthly",
    "Validate realized benefits vs plan",
    "Finance + benefit owners",
    "Benefit evidence, forecast, corrective action",
  ],
];

const forumBody = (extra: Record<string, unknown> = {}) => ({
  nameEn: "Synthetic data council",
  nameAr: "مجلس بيانات اصطناعي",
  cadenceLabel: "Monthly",
  purpose: "Synthetic purpose",
  participantsLabel: "Data owners",
  outputsLabel: "Decisions",
  outputKinds: ["decision"],
  ...extra,
});

describe("REQ-PB-060 A01: the five operating-system layers on a new transformation", () => {
  it("listForums returns the five B0093 layers, in order, with the cadence (and every source text) verbatim", async () => {
    const res = await send("GET", `${T()}/forums`, { session: x.auditor.session });
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();
    expect(
      res.body.items.map((f: Body) => [
        f.templateKey,
        f.source.layerEn,
        f.source.cadenceEn,
        f.source.purposeEn,
        f.source.participantsEn,
        f.source.outputsEn,
      ]),
    ).toEqual(B0093);
    expect(res.body.items.map((f: Body) => f.source.cadenceEn)).toEqual([
      "Monthly",
      "Bi-weekly",
      "Weekly",
      "Daily / 2-3x week",
      "Monthly",
    ]);
    // The transformation's copy starts with the verbatim texts as its labels; Arabic is flagged provisional.
    for (const f of res.body.items) {
      expect([f.nameEn, f.cadenceLabel, f.purpose, f.participantsLabel, f.outputsLabel]).toEqual([
        f.source.layerEn,
        f.source.cadenceEn,
        f.source.purposeEn,
        f.source.participantsEn,
        f.source.outputsEn,
      ]);
      expect(f.source.arProvisional).toBe(true);
      expect(f.source.sourceRef).toMatch(/^B0093;M019[1-5]$/);
      expect(f.status).toBe("active");
      expect(f.activeSeriesId).toBeNull();
    }
    const [steerco, , , , value] = res.body.items;
    expect([steerco.executiveAsksOnly, steerco.chairPartyCode, steerco.outputKinds]).toEqual([
      true,
      "SP",
      ["decision", "unblocker", "benefit_view"],
    ]);
    expect(value.publishRequiresAnyOutput).toEqual(["benefit_evidence", "forecast"]);
  });

  it("a forum read returns the same source texts; the forum ids are per transformation", async () => {
    const res = await send("GET", `${T()}/forums/${x.forums.rapid_response}`, { session: x.contributor.session });
    expect([res.status, res.headers.etag, res.body.source.cadenceEn]).toEqual([200, '"1"', "Daily / 2-3x week"]);
  });

  it("ADM-only and another organization get 404 on every read; nobody else's forum is visible", async () => {
    const outsider = await signIn(api.app, w.officeB.subject);
    for (const session of [x.admin, outsider]) {
      expect((await send("GET", `${T()}/forums`, { session })).status).toBe(404);
      expect((await send("GET", `${T()}/forums/${x.forums.value_review}`, { session })).status).toBe(404);
      expect((await send("GET", `${T()}/forums/${x.forums.value_review}/participants`, { session })).status).toBe(404);
    }
  });

  it("the status filter and paging", async () => {
    const page = await send("GET", `${T()}/forums?limit=2`, { session: x.auditor.session });
    expect([page.body.items.length, typeof page.body.nextCursor]).toEqual([2, "string"]);
    const next = await send("GET", `${T()}/forums?limit=2&cursor=${encodeURIComponent(page.body.nextCursor)}`, {
      session: x.auditor.session,
    });
    expect(next.body.items[0].templateKey).toBe("workstream_review");
    const archived = await send("GET", `${T()}/forums?status=archived`, { session: x.auditor.session });
    expect(archived.body.items.every((f: Body) => f.status === "archived")).toBe(true);
    expect((await send("GET", `${T()}/forums?status=closed`, { session: x.auditor.session })).status).toBe(400);
  });
});

describe("createForum (forum.configure)", () => {
  it("TO creates a forum (version 1, audited); the template stays unchanged", async () => {
    const res = await send("POST", `${T()}/forums`, {
      session: x.office.session,
      body: forumBody({ chairPartyCode: "TL", participantParties: ["TL", "WL"], quorumMin: 2, agendaMaxItems: 5 }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect([res.headers.etag, res.body.version, res.body.templateKey, res.body.source, res.body.ordinal]).toEqual([
      '"1"',
      1,
      null,
      null,
      6,
    ]);
    expect([res.body.cutoffWorkingDays, res.body.lateItemsRule, res.body.executiveAsksOnly]).toEqual([
      2,
      "flag",
      false,
    ]);
    expect(res.headers.location).toBe(`/api/v1/transformations/${x.transformationId}/forums/${res.body.id}`);
    const audit = await auditOf(api.db, res.body.id);
    expect(audit.map((a) => [a.action, a.actor_user_id, a.new_version])).toEqual([["forum.create", x.office.id, 1]]);
    const templates = await api.db
      .selectFrom("forum_template")
      .select(["key", "source_cadence_en"])
      .orderBy("ordinal")
      .execute();
    expect(templates.map((t) => t.source_cadence_en)).toEqual([
      "Monthly",
      "Bi-weekly",
      "Weekly",
      "Daily / 2-3x week",
      "Monthly",
    ]);
  });

  it("negative: AUD and TL (no forum.configure) 403, ADM-only and another organization 404; nothing written", async () => {
    const outsider = await signIn(api.app, w.officeB.subject);
    const before = await api.db
      .selectFrom("forum")
      .select("id")
      .where("transformation_id", "=", x.transformationId)
      .execute();
    for (const [session, status] of [
      [x.auditor.session, 403],
      [x.lead.session, 403],
      [x.sponsor.session, 403],
      [x.admin, 404],
      [outsider, 404],
    ] as const)
      expect((await send("POST", `${T()}/forums`, { session, body: forumBody() })).status).toBe(status);
    const after = await api.db
      .selectFrom("forum")
      .select("id")
      .where("transformation_id", "=", x.transformationId)
      .execute();
    expect(after.length).toBe(before.length);
  });

  it("validation: 400 for a missing or blank field and an unknown output kind; 422 with the ADR-0032 §11 texts", async () => {
    const missing = await send("POST", `${T()}/forums`, {
      session: x.office.session,
      body: { ...forumBody(), nameEn: undefined },
    });
    expect(missing.status).toBe(400);
    const blank = await send("POST", `${T()}/forums`, {
      session: x.office.session,
      body: forumBody({ purpose: "   " }),
    });
    expect([blank.status, blank.body.errors[0].pointer, blank.body.errors[0].code]).toEqual([
      400,
      "/purpose",
      "validation.blank",
    ]);
    const kind = await send("POST", `${T()}/forums`, {
      session: x.office.session,
      body: forumBody({ outputKinds: ["gossip"] }),
    });
    expect(kind.status).toBe(400);
    const none = await send("POST", `${T()}/forums`, {
      session: x.office.session,
      body: forumBody({ outputKinds: [] }),
    });
    expect(none.status).toBe(400);
    const party = await send("POST", `${T()}/forums`, {
      session: x.office.session,
      body: forumBody({ participantParties: ["TL", "ZZZ"] }),
    });
    expect([party.status, party.body.code, party.body.detail, party.body.errors[0].pointer]).toEqual([
      422,
      "forum.party_unknown",
      "ZZZ is not a known governance role.",
      "/participantParties",
    ]);
    const pub = await send("POST", `${T()}/forums`, {
      session: x.office.session,
      body: forumBody({ publishRequiresAnyOutput: ["forecast"] }),
    });
    expect([pub.status, pub.body.code, pub.body.detail]).toEqual([
      422,
      "forum.publish_output_not_listed",
      "A required publication output must be one of this forum's outputs.",
    ]);
    const secretary = await send("POST", `${T()}/forums`, {
      session: x.office.session,
      body: forumBody({ secretaryUserId: w.officeB.id }),
    });
    expect([secretary.status, secretary.body.errors[0].pointer]).toEqual([400, "/secretaryUserId"]);
  });

  it("commit-time: a TO whose grant is revoked while the request waits gets 403 and nothing is written", async () => {
    const to = await person(api, w, x.transformationId, "TO");
    const before = await api.db
      .selectFrom("forum")
      .select("id")
      .where("transformation_id", "=", x.transformationId)
      .execute();
    const res = await afterIdentity(
      api,
      to.id,
      () => call(api.app, "POST", `${T()}/forums`, { session: to.session, body: forumBody(), contract: false }),
      () => revokeAll(api, w.grantor.id, to.id),
    );
    expect(res.status).toBe(403);
    const after = await api.db
      .selectFrom("forum")
      .select("id")
      .where("transformation_id", "=", x.transformationId)
      .execute();
    expect(after.length).toBe(before.length);
  });
});

describe("updateForum (REQ-S10-005: participants, quorum, cut-off and agenda rules configurable)", () => {
  it("If-Match 428/409; a change is versioned and audited with its changes; the template never changes", async () => {
    const F = `${T()}/forums/${x.forums.workstream_review}`;
    const change = {
      quorumMin: 3,
      cutoffWorkingDays: 4,
      agendaMaxItems: 8,
      lateItemsRule: "refuse",
      participantParties: ["WL", "TL"],
    };
    expect((await send("PATCH", F, { session: x.office.session, body: change })).status).toBe(428);
    const stale = await send("PATCH", F, { session: x.office.session, headers: ifm(5), body: change });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const res = await send("PATCH", F, { session: x.office.session, headers: ifm(1), body: change });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([
      res.body.version,
      res.body.quorumMin,
      res.body.cutoffWorkingDays,
      res.body.lateItemsRule,
      res.headers.etag,
    ]).toEqual([2, 3, 4, "refuse", '"2"']);
    expect(res.body.source.cadenceEn).toBe("Weekly");
    const audit = await auditOf(api.db, x.forums.workstream_review);
    const last = audit.at(-1)!;
    expect([last.action, last.prior_version, last.new_version]).toEqual(["forum.update", 1, 2]);
    expect(last.changes).toMatchObject({ quorum_min: { from: null, to: 3 }, cutoff_working_days: { from: 2, to: 4 } });
    const template = await api.db
      .selectFrom("forum_template")
      .select("source_cadence_en")
      .where("key", "=", "workstream_review")
      .executeTakeFirstOrThrow();
    expect(template.source_cadence_en).toBe("Weekly");
  });

  it("negative: AUD 403 and ADM-only 404 on update; an empty patch is 400", async () => {
    const F = `${T()}/forums/${x.forums.rapid_response}`;
    expect(
      (await send("PATCH", F, { session: x.auditor.session, headers: ifm(1), body: { quorumMin: 2 } })).status,
    ).toBe(403);
    expect((await send("PATCH", F, { session: x.admin, headers: ifm(1), body: { quorumMin: 2 } })).status).toBe(404);
    expect((await send("PATCH", F, { session: x.office.session, headers: ifm(1), body: {} })).status).toBe(400);
    const bad = await send("PATCH", F, {
      session: x.office.session,
      headers: ifm(1),
      body: { outputKinds: ["test"], publishRequiresAnyOutput: ["evidence"] },
    });
    expect([bad.status, bad.body.code]).toEqual([422, "forum.publish_output_not_listed"]);
  });

  it("archiving is final: later edits and new participants are 422 forum.archived", async () => {
    const created = await send("POST", `${T()}/forums`, { session: x.office.session, body: forumBody() });
    const F = `${T()}/forums/${created.body.id}`;
    const archived = await send("PATCH", F, {
      session: x.office.session,
      headers: ifm(1),
      body: { status: "archived" },
    });
    expect([archived.status, archived.body.status]).toEqual([200, "archived"]);
    expect((await auditOf(api.db, created.body.id)).at(-1)!.action).toBe("forum.archive");
    const again = await send("PATCH", F, { session: x.office.session, headers: ifm(2), body: { nameEn: "Renamed" } });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "forum.archived",
      "This forum is archived and can no longer be changed.",
    ]);
    const p = await send("POST", `${F}/participants`, { session: x.office.session, body: { userId: x.bo.id } });
    expect([p.status, p.body.code]).toEqual([422, "forum.archived"]);
    const reopen = await send("PATCH", F, { session: x.office.session, headers: ifm(2), body: { status: "active" } });
    expect(reopen.status).toBe(400);
  });
});

describe("forum participants (REQ-S10-005 'participants')", () => {
  it("add a person and a group; duplicates are 409; list; remove is final and audited", async () => {
    const P = `${T()}/forums/${x.forums.value_review}/participants`;
    const fin = await send("POST", P, { session: x.office.session, body: { userId: x.fin.id } });
    expect([fin.status, fin.body.countsForQuorum, fin.body.userId, fin.body.groupId, fin.headers.etag]).toEqual([
      201,
      true,
      x.fin.id,
      null,
      '"1"',
    ]);
    const observer = await send("POST", P, {
      session: x.office.session,
      body: { userId: x.bo2.id, countsForQuorum: false },
    });
    expect([observer.status, observer.body.countsForQuorum]).toEqual([201, false]);
    const dup = await send("POST", P, { session: x.office.session, body: { userId: x.fin.id } });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "forum_participant.exists",
      "This person or group is already a participant of the forum.",
    ]);
    const both = await send("POST", P, { session: x.office.session, body: { userId: x.fin.id, groupId: x.fin.id } });
    expect(both.status).toBe(400);
    const foreign = await send("POST", P, { session: x.office.session, body: { userId: w.officeB.id } });
    expect([foreign.status, foreign.body.errors[0].pointer]).toEqual([400, "/userId"]);
    const unknownGroup = await send("POST", P, { session: x.office.session, body: { groupId: x.fin.id } });
    expect([unknownGroup.status, unknownGroup.body.errors[0].pointer]).toEqual([400, "/groupId"]);
    expect((await send("POST", P, { session: x.auditor.session, body: { userId: x.bo.id } })).status).toBe(403);
    expect((await send("POST", P, { session: x.admin, body: { userId: x.bo.id } })).status).toBe(404);

    const list = await send("GET", P, { session: x.auditor.session });
    expect(list.body.items.map((i: Body) => i.userId).sort()).toEqual([x.fin.id, x.bo2.id].sort());

    const R = `${P}/${fin.body.id}/remove`;
    expect((await send("POST", R, { session: x.office.session })).status).toBe(428);
    expect((await send("POST", R, { session: x.office.session, headers: ifm(4) })).status).toBe(409);
    expect((await send("POST", R, { session: x.auditor.session, headers: ifm(1) })).status).toBe(403);
    const removed = await send("POST", R, { session: x.office.session, headers: ifm(1) });
    expect([removed.status, removed.body.status, removed.body.removedBy]).toEqual([200, "removed", x.office.id]);
    expect((await auditOf(api.db, fin.body.id)).map((a) => a.action)).toEqual([
      "forum_participant.create",
      "forum_participant.remove",
    ]);
    const again = await send("POST", R, { session: x.office.session, headers: ifm(2) });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "forum_participant.removed",
      "This participant was removed and can no longer be changed.",
    ]);
    // After removal the person can be added again (one ACTIVE participation per person).
    expect((await send("POST", P, { session: x.office.session, body: { userId: x.fin.id } })).status).toBe(201);
  });
});
