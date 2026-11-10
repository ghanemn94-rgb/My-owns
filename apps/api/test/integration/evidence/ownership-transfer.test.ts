// Evidence authorization through the parent record, including after an ownership transfer (ADR-0051 §4; REQ-S13-013;
// D-196 point 1, Option A; p6-work-split §E/F.4; T-DG6-BE-C) against a real PostgreSQL. ADR-0051 §4 (a)-(e):
//  (a) a transformation with file evidence linked to a benefit (a T14 attachment, the API link to a benefit);
//  (b) a BAU handover completed and accepted by a NEW owner holding a BO assignment on the transformation;
//  (c) the new owner downloads it (and reads its metadata): 200, the same bytes;
//  (d) a user with no assignment on the transformation is refused: 404 (Option A, the DG2 non-disclosure form), and a
//      user of another organization likewise;
//  (e) the evidence is marked sensitive: the new owner (not a named party) gets 403 evidence.parent_forbidden, then
//      200 with a grant; the same for a sensitive PARENT benefit: an in-scope reader without admission gets 403
//      ("a user without access to the parent gets 403 on the evidence download URL"), the list omits the item, and a
//      grant on the benefit restores it.
// The preview route is BE-D's (ADR-0052 §2) and calls the same requireEvidenceRead; this file proves the download and
// metadata halves, and that a deep link to the evidence agrees with the download. All data is SYNTHETIC; the handover
// acceptance is a synthetic in-product business approval of test data, never a real one; nothing here touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkItemOnce, issueDeepLink } from "../../../src/modules/tasks/index.ts";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser, financialBody } from "../benefits/fixtures.ts";
import {
  createArea,
  fullContent,
  insertControl,
  seedSustainmentWorld,
  type SustainmentWorld,
} from "../contract/p4-exercises-be-i.ts";

let api: TestApi;
let w: World;
let s: SustainmentWorld;
let office: Session; // TO @ org A: marks and grants (sensitive_record.grant)
let newOwner: { id: string; subject: string; session: Session }; // the receiving owner (BO on the transformation)
let stranger: Session; // org A user with an assignment on another transformation only
let benefitId: string;
let evidenceId: string;
const BYTES = Buffer.from("%PDF-1.4\n% synthetic SOP sign-off for the BAU handover\n", "utf8");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const WORKER = { actorType: "service", actorUserId: null, requestId: "job:ownership", source: "worker" } as const;
const CONTENT = () => `${s.b.base}/evidence/${evidenceId}/content`;
const ITEM = () => `${s.b.base}/evidence/${evidenceId}`;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  s = await seedSustainmentWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  newOwner = await extraUser(api, w, s.b, "BO");
  const elsewhere = await createUser(api.db, w.orgA.id);
  const otherT = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  await grant(api.db, w.grantor.id, elsewhere.id, "BO", { type: "transformation", id: otherT }, w.orgA.id);
  stranger = await signIn(api.app, elsewhere.subject);

  // (a) A benefit owned by the BO, and a FILE evidence item created, owned and uploaded by the WL (the preparer).
  const benefit = await send("POST", `${s.b.base}/benefits`, { session: s.b.s.bo, body: financialBody(s.b) });
  expect(benefit.status, JSON.stringify(benefit.body)).toBe(201);
  benefitId = benefit.body.id;
  const ev = await send("POST", `${s.b.base}/evidence`, {
    session: s.wl.session,
    body: {
      kind: "file",
      title: "Synthetic SOP sign-off",
      evidenceType: "data_extract",
      source: "Synthetic SOP repository",
      ownerUserId: s.wl.id,
    },
  });
  expect(ev.status, JSON.stringify(ev.body)).toBe(201);
  evidenceId = ev.body.id;
  const up = await send("POST", CONTENT(), {
    session: s.wl.session,
    headers: { ...ifm(ev.body.version), "content-type": "application/octet-stream", "x-file-name": "sop.pdf" },
    body: BYTES,
  });
  expect(up.status, JSON.stringify(up.body)).toBe(200);
  const attach = await send("POST", `${s.b.base}/form-records/T14/${benefitId}/attachments`, {
    session: s.b.s.bo,
    body: { evidenceId },
  });
  expect(attach.status, JSON.stringify(attach.body)).toBe(201);

  // (b) The performance area's BAU handover, prepared by the WL, accepted by the NEW owner.
  const area = await createArea((m, u, o) => call(api.app, m, u, o), s);
  await insertControl(api.db, s.b, area.id, null);
  const created = await send("POST", s.handovers, {
    session: s.wl.session,
    body: { performanceAreaId: area.id, receivingOwnerUserId: newOwner.id, ...fullContent(newOwner.id) },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const H = `${s.handovers}/${created.body.id}`;
  const linked = await send("POST", `${H}/evidence`, { session: s.wl.session, headers: ifm(1), body: { evidenceId } });
  expect(linked.status, JSON.stringify(linked.body)).toBe(201);
  const sub = await send("POST", `${H}/submit`, { session: s.wl.session, headers: ifm(linked.body.version) });
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  const acc = await send("POST", `${H}/accept`, {
    session: newOwner.session,
    headers: ifm(sub.body.version),
    body: {},
  });
  expect(acc.status, JSON.stringify(acc.body)).toBe(200);
  expect(acc.body).toMatchObject({ acceptedBy: newOwner.id });
}, 180_000);
afterAll(() => api.close());

/**
 * ADR-0051 §4 and D-196 point 1 give the download and the metadata GET a 403 `evidence.parent_forbidden`; the contract
 * declares it on downloadEvidenceContent and getEvidence (T-DG6-BE-X1, F-DG6-QA-B-1), so every response here, the 403s
 * included, is asserted against the OpenAPI document.
 */
const download = (session: Session) => send("GET", CONTENT(), { session });
const getItem = (session: Session) => send("GET", ITEM(), { session });
const listIds = async (session: Session) => {
  const res = await send("GET", `${s.b.base}/evidence?limit=100`, { session });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.items.map((i: Body) => i.id as string);
};
const mark = async (recordType: "benefit" | "evidence", recordId: string, isSensitive: boolean, version: number) => {
  const res = await send("PUT", `${s.b.base}/records/${recordType}/${recordId}/sensitivity`, {
    session: office,
    headers: { "if-match": `"${version}"` },
    body: { isSensitive, reason: "Synthetic commercial terms" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};
const grantTo = async (recordType: "benefit" | "evidence", recordId: string, granteeUserId: string) => {
  const res = await send("POST", "/api/v1/admin/sensitive-grants", {
    session: office,
    body: { transformationId: s.b.transformationId, recordType, recordId, granteeUserId, reason: "Synthetic need" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};
const revoke = async (grantId: string) => {
  const res = await send("POST", `/api/v1/admin/sensitive-grants/${grantId}/revoke`, {
    session: office,
    headers: { "if-match": '"1"' },
    body: { reason: "Synthetic need ended" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};
const expectParentForbidden = (res: { status: number; body: Body; raw: { body: string } }) => {
  expect(res.status, res.raw.body).toBe(403);
  expect(res.body).toMatchObject({
    code: "evidence.parent_forbidden",
    detail: "You do not have access to the record this evidence belongs to.",
  });
  expect(res.raw.body).not.toContain("Synthetic SOP sign-off");
};

describe("REQ-S13-013: evidence after a BAU handover (ADR-0051 §4 (a)-(e))", () => {
  it("(c) after the handover the new owner downloads the evidence and reads its metadata: 200, the same bytes", async () => {
    const res = await download(newOwner.session);
    expect(res.status, String(res.raw.body)).toBe(200);
    expect(res.raw.rawPayload.equals(BYTES)).toBe(true);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(String(res.headers["content-disposition"])).toMatch(/^attachment;/);
    expect((await getItem(newOwner.session)).status).toBe(200);
    expect(await listIds(newOwner.session)).toContain(evidenceId);
    // No rule reads the evidence owner or uploader for a non-sensitive item: the owner field still names the WL.
    expect((await getItem(newOwner.session)).body.ownerUserId).toBe(s.wl.id);
  });

  it("(d) a user with no assignment on the transformation is refused with the DG2 404 (Option A, D-196)", async () => {
    for (const session of [stranger, s.b.s.outsider]) {
      const res = await download(session);
      expect([res.status, res.body.code]).toEqual([404, "not_found"]);
      expect((await getItem(session)).status).toBe(404);
    }
  });

  it("(e) sensitive evidence: the new owner is refused with 403 until granted; the WL (named party) reads it", async () => {
    await mark("evidence", evidenceId, true, 0);
    try {
      expectParentForbidden(await download(newOwner.session));
      expectParentForbidden(await download(s.b.s.auditor)); // AUD admits nothing by itself
      // The metadata GET keeps the §2 404 for a sensitive item itself; the list omits it.
      expect((await getItem(newOwner.session)).status).toBe(404);
      expect(await listIds(newOwner.session)).not.toContain(evidenceId);
      expect((await download(s.wl.session)).status).toBe(200); // owner and creator: named party
      expect((await download(office)).status).toBe(200); // holds sensitive_record.grant
      const g = await grantTo("evidence", evidenceId, newOwner.id);
      expect((await download(newOwner.session)).status).toBe(200);
      expect((await getItem(newOwner.session)).status).toBe(200);
      await revoke(g);
      expectParentForbidden(await download(newOwner.session));
      // Out of scope stays 404 whatever the sensitivity (non-disclosure).
      expect((await download(stranger)).status).toBe(404);
    } finally {
      await mark("evidence", evidenceId, false, 1);
    }
    expect((await download(newOwner.session)).status).toBe(200);
  });

  it("(e) a sensitive parent benefit: 403 on the download URL for an in-scope reader without access to it", async () => {
    await mark("benefit", benefitId, true, 0);
    try {
      // The new owner reads the transformation but is no party of the benefit (owner: the BO) and holds no grant.
      expectParentForbidden(await download(newOwner.session));
      expectParentForbidden(await getItem(newOwner.session));
      expect(await listIds(newOwner.session)).not.toContain(evidenceId);
      // The benefit's owner (named party) still reads the evidence; so does the TO.
      expect((await download(s.b.s.bo)).status).toBe(200);
      expect(await listIds(s.b.s.bo)).toContain(evidenceId);
      expect((await download(office)).status).toBe(200);
      // A grant on the PARENT restores access to its evidence.
      const g = await grantTo("benefit", benefitId, newOwner.id);
      expect((await download(newOwner.session)).status).toBe(200);
      expect(await listIds(newOwner.session)).toContain(evidenceId);
      await revoke(g);
      expectParentForbidden(await download(newOwner.session));
    } finally {
      await mark("benefit", benefitId, false, 1);
    }
  });

  it("a deep link to the evidence agrees with the download (the two enumerations of linked records)", async () => {
    const created = await api.db.transaction().execute((tx) =>
      createWorkItemOnce(tx, WORKER, {
        organizationId: w.orgA.id,
        transformationId: s.b.transformationId,
        kind: "kpi_update_due",
        assigneeUserId: newOwner.id,
        subjectType: "evidence",
        subjectId: evidenceId,
        linkPath: `/transformations/${s.b.transformationId}/evidence/${evidenceId}`,
        messageKey: "tasks.kpi_update_due",
        messageParams: { title: "Synthetic SOP sign-off" },
        dedupeKey: uniq("ownership.deep_link:"),
      }),
    );
    const note = await api.db
      .selectFrom("inbox_notification")
      .select("id")
      .where("work_item_id", "=", created.workItemId)
      .executeTakeFirstOrThrow();
    const { token } = await issueDeepLink(api.db, note.id, WORKER);
    const statuses = async () => [
      (await download(newOwner.session)).status,
      (await send("GET", `/api/v1/links/${token}`, { session: newOwner.session })).status,
    ];
    expect(await statuses()).toEqual([200, 200]);
    await mark("benefit", benefitId, true, 2);
    try {
      expect(await statuses()).toEqual([403, 403]);
      const g = await grantTo("benefit", benefitId, newOwner.id);
      expect(await statuses()).toEqual([200, 200]);
      await revoke(g);
      expect(await statuses()).toEqual([403, 403]);
    } finally {
      await mark("benefit", benefitId, false, 3);
    }
  });
});
