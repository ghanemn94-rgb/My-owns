// Notification deep links with re-authorization and the inbox title redaction (ADR-0051 §3; REQ-S12-024;
// p6-work-split §E/F.4; T-DG6-BE-C) against a real PostgreSQL. The literal tests of §E/F.4:
//  - a forwarded link opened by an unauthorized user returns 403 `deep_link.forbidden`, and the body (minus requestId)
//    is byte-identical for a sensitive target, a target in another transformation and a target that no longer exists;
//    it never contains the record's title, type, id, transformation or the notification's messageParams;
//  - an authorized colleague resolves it (being the recipient is neither required nor sufficient);
//  - the recipient who lost access sees `inbox.restricted` with empty params, and sees the title again when access is
//    restored; the stored row is never modified by the redaction;
//  - concurrent lazy issue x5 yields one token, one version step and one audit event.
// Also: 404 for an unknown token, 400 for a malformed one, 401 without a session; the resolver and the inbox write
// nothing; deepLinkTarget recognizes exactly the three record routes. All data is SYNTHETIC; nothing here approves
// anything or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadGrants } from "../../../src/modules/access/index.ts";
import {
  createWorkItemOnce,
  deepLinkTarget,
  issueDeepLink,
  readableTargets,
} from "../../../src/modules/tasks/index.ts";
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
import { financialBody, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let office: Session; // TO @ org A: marks records and grants (sensitive_record.grant)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const WORKER = { actorType: "service", actorUserId: null, requestId: "job:deep-links", source: "worker" } as const;
const SECRET_TITLE = "Synthetic confidential tariff renegotiation";

let benefitId: string; // not sensitive
let sensitiveId: string; // marked sensitive; owner BO (named party), bo2 not admitted
let otherTransformationId: string; // bo2 holds nothing here
let otherBenefitId: string;
const notes: string[] = []; // every notification this file creates

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  const mkBenefit = async (base: string, session: Session, body: Record<string, unknown>) => {
    const r = await send("POST", `${base}/benefits`, { session, body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  benefitId = await mkBenefit(b.base, b.s.bo, financialBody(b, { title: "Synthetic open churn benefit" }));
  sensitiveId = await mkBenefit(b.base, b.s.bo, financialBody(b, { title: SECRET_TITLE }));
  const marked = await send("PUT", `${b.base}/records/benefit/${sensitiveId}/sensitivity`, {
    session: office,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic commercial terms" },
  });
  expect(marked.status, JSON.stringify(marked.body)).toBe(200);
  // A second transformation in which only its own BO holds an assignment.
  otherTransformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const otherBo = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, otherBo.id, "BO", { type: "transformation", id: otherTransformationId }, w.orgA.id);
  const otherBoS = await signIn(api.app, otherBo.subject);
  otherBenefitId = await mkBenefit(
    `/api/v1/transformations/${otherTransformationId}`,
    otherBoS,
    financialBody(b, { title: "Synthetic other-transformation benefit", ownerUserId: otherBo.id }),
  );
}, 120_000);
afterAll(() => api.close());

/** A reminder for `recipient` pointing at `linkPath` (the P4 writer, unchanged), and its notification id. */
async function notify(
  recipient: string,
  linkPath: string,
  transformationId: string | null,
  params: Record<string, string> = { title: SECRET_TITLE },
): Promise<string> {
  const created = await api.db.transaction().execute((tx) =>
    createWorkItemOnce(tx, WORKER, {
      organizationId: w.orgA.id,
      transformationId,
      kind: "kpi_update_due",
      assigneeUserId: recipient,
      subjectType: "benefit",
      subjectId: crypto.randomUUID(),
      linkPath,
      messageKey: "tasks.kpi_update_due",
      messageParams: params,
      dedupeKey: uniq("deep-link.test:"),
    }),
  );
  const row = await api.db
    .selectFrom("inbox_notification")
    .select("id")
    .where("work_item_id", "=", created.workItemId)
    .executeTakeFirstOrThrow();
  notes.push(row.id);
  return row.id;
}

const benefitPath = (t: string, id: string) => `/transformations/${t}/benefits/${id}`;
const tokenOf = async (notificationId: string) => (await issueDeepLink(api.db, notificationId, WORKER)).token;
const resolve = (token: string, session: Session | null = null) => send("GET", `/api/v1/links/${token}`, { session });
const withoutRequestId = (raw: string) => raw.replace(/"requestId":"[^"]*"/, '"requestId":""');
/** Audit events of this file's two transformations and organization-level rows of its notifications (the run's
 * database is shared by concurrent files, so a global count would not be deterministic). */
const auditCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("audit_event")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where((eb) =>
          eb.or([
            eb("transformation_id", "in", [b.transformationId, otherTransformationId]),
            eb("record_id", "in", notes.length > 0 ? notes : ["01900000-0000-7000-8000-000000000000"]),
          ]),
        )
        .executeTakeFirstOrThrow()
    ).n,
  );

describe("deepLinkTarget (ADR-0051 §3: a pure function over the record routes)", () => {
  const t = "01900000-0000-7000-8000-0000000000aa";
  const r = "01900000-0000-7000-8000-0000000000bb";
  it("recognizes the benefit, business-case and evidence routes, with a sub-path, query or fragment", () => {
    expect(deepLinkTarget(`/transformations/${t}/benefits/${r}`)).toEqual({
      recordType: "benefit",
      recordId: r,
      transformationId: t,
    });
    expect(deepLinkTarget(`/transformations/${t}/business-cases/${r}?tab=finance`)?.recordType).toBe("business_case");
    expect(deepLinkTarget(`/transformations/${t}/evidence/${r}/versions`)?.recordType).toBe("evidence");
    expect(deepLinkTarget(`/transformations/${t}/benefits/${r.toUpperCase()}#x`)?.recordId).toBe(r);
  });
  it("recognizes nothing else", () => {
    for (const p of [
      `/transformations/${t}/benefits`,
      `/transformations/${t}/benefit-measurements/${r}`,
      `/transformations/${t}/benefits/${r}x`,
      `/transformations/${t}/kpis/${r}`,
      `/my-work/approvals/${r}`,
      `/x/transformations/${t}/benefits/${r}`,
    ])
      expect(deepLinkTarget(p), p).toBeNull();
  });
});

describe("resolveDeepLink (ADR-0051 §3; REQ-S12-024)", () => {
  it("the recipient and an authorized colleague resolve a forwarded link; 200 names the target", async () => {
    const token = await tokenOf(
      await notify(b.users.bo2.id, benefitPath(b.transformationId, benefitId), b.transformationId),
    );
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expected = {
      linkPath: benefitPath(b.transformationId, benefitId),
      recordType: "benefit",
      recordId: benefitId,
    };
    for (const s of [b.s.bo2, b.s.tl, b.s.auditor]) {
      const res = await resolve(token, s);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual(expected);
    }
  });

  it("A12: a forwarded link opened by an unauthorized user is 403 deep_link.forbidden, without the title", async () => {
    const token = await tokenOf(
      await notify(b.users.bo2.id, benefitPath(b.transformationId, benefitId), b.transformationId),
    );
    const res = await resolve(token, b.s.outsider);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "deep_link.forbidden", detail: "You do not have access to this item." });
    expect(res.raw.body).not.toContain(SECRET_TITLE);
    expect(res.raw.body).not.toContain(benefitId);
  });

  it("the 403 body (minus requestId) is byte-identical for a sensitive, another transformation's and a missing target", async () => {
    // bo2 reads the transformation but is not admitted to the sensitive benefit; holds nothing in the other
    // transformation; and the third link names a benefit id with no row (the application role cannot delete a benefit,
    // so "deleted" is a link whose record no longer exists).
    const missing = "01900000-0000-7000-8000-00000000dead";
    const tokens = [
      await tokenOf(await notify(b.users.bo2.id, benefitPath(b.transformationId, sensitiveId), b.transformationId)),
      await tokenOf(
        await notify(b.users.bo2.id, benefitPath(otherTransformationId, otherBenefitId), otherTransformationId),
      ),
      await tokenOf(await notify(b.users.bo2.id, benefitPath(b.transformationId, missing), b.transformationId)),
    ];
    const bodies: string[] = [];
    for (const token of tokens) {
      const res = await resolve(token, b.s.bo2);
      expect(res.status, res.raw.body).toBe(403);
      for (const leak of [
        SECRET_TITLE,
        sensitiveId,
        otherBenefitId,
        missing,
        b.transformationId,
        otherTransformationId,
      ])
        expect(res.raw.body).not.toContain(leak);
      expect(res.raw.body).not.toContain("benefit");
      bodies.push(withoutRequestId(res.raw.body));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]!)).toEqual({
      type: "urn:mth:problem:forbidden",
      title: "Forbidden",
      status: 403,
      detail: "You do not have access to this item.",
      code: "deep_link.forbidden",
      requestId: "",
    });
    // The owner (a named party of the sensitive benefit) resolves its link.
    expect((await resolve(tokens[0]!, b.s.bo)).status).toBe(200);
  });

  it("the recipient who lost access is refused; a grant restores it; a revocation removes it again", async () => {
    const token = await tokenOf(
      await notify(b.users.bo2.id, benefitPath(b.transformationId, sensitiveId), b.transformationId),
    );
    expect((await resolve(token, b.s.bo2)).status).toBe(403);
    const g = await send("POST", "/api/v1/admin/sensitive-grants", {
      session: office,
      body: {
        transformationId: b.transformationId,
        recordType: "benefit",
        recordId: sensitiveId,
        granteeUserId: b.users.bo2.id,
        reason: "Synthetic need to know",
      },
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect((await resolve(token, b.s.bo2)).status).toBe(200);
    const revoked = await send("POST", `/api/v1/admin/sensitive-grants/${g.body.id}/revoke`, {
      session: office,
      headers: { "if-match": '"1"' },
      body: { reason: "Synthetic need ended" },
    });
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    expect((await resolve(token, b.s.bo2)).status).toBe(403);
  });

  it("a link without a record target re-checks the transformation read; an organization-level link resolves", async () => {
    const tLink = await tokenOf(
      await notify(b.users.bo2.id, `/transformations/${b.transformationId}/team`, b.transformationId),
    );
    expect((await resolve(tLink, b.s.bo2)).body).toEqual({
      linkPath: `/transformations/${b.transformationId}/team`,
      recordType: null,
      recordId: null,
    });
    expect((await resolve(tLink, b.s.outsider)).status).toBe(403);
    const orgLink = await tokenOf(await notify(b.users.bo2.id, "/my-work", null, {}));
    expect((await resolve(orgLink, b.s.bo2)).status).toBe(200);
  });

  it("404 for an unknown token, 400 for a malformed one, 401 without a session; resolving writes nothing", async () => {
    const id = await notify(b.users.bo2.id, benefitPath(b.transformationId, benefitId), b.transformationId);
    const token = await tokenOf(id);
    const before = await auditCount();
    const row = await api.db
      .selectFrom("inbox_notification")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect((await resolve("A".repeat(43), b.s.bo2)).status).toBe(404);
    const malformed = await resolve("short", b.s.bo2);
    expect([malformed.status, malformed.body.code]).toEqual([400, "validation"]);
    expect((await resolve(token)).status).toBe(401);
    expect((await resolve(token, b.s.bo2)).status).toBe(200);
    expect((await resolve(token, b.s.outsider)).status).toBe(403);
    expect(await auditCount()).toBe(before);
    expect(
      await api.db.selectFrom("inbox_notification").selectAll().where("id", "=", id).executeTakeFirstOrThrow(),
    ).toEqual(row);
  });
});

describe("issueDeepLink: lazy, once, under lock 730301 (ADR-0051 §3, §6)", () => {
  it("concurrent lazy issue x5 yields one token, one version step and one audit event", async () => {
    const id = await notify(b.users.bo2.id, benefitPath(b.transformationId, benefitId), b.transformationId);
    const before = await api.db
      .selectFrom("inbox_notification")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect([before.link_token, before.target_record_type, before.target_record_id]).toEqual([null, null, null]);
    const results = await Promise.all(Array.from({ length: 5 }, () => issueDeepLink(api.db, id, WORKER)));
    expect(new Set(results.map((r) => r.token)).size).toBe(1);
    expect(results.filter((r) => r.issued)).toHaveLength(1);
    const after = await api.db
      .selectFrom("inbox_notification")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(after).toMatchObject({
      link_token: results[0]!.token,
      target_record_type: "benefit",
      target_record_id: benefitId,
      version: before.version + 1,
      message_key: before.message_key,
      message_params: before.message_params,
    });
    const events = await api.db
      .selectFrom("audit_event")
      .select(["action", "prior_version", "new_version", "changes"])
      .where("record_id", "=", id)
      .where("action", "=", "inbox_notification.link_issued")
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ prior_version: before.version, new_version: before.version + 1 });
    expect(JSON.stringify(events[0]!.changes)).not.toContain(results[0]!.token);
    // A later issue reads the token already set and writes nothing (no unmapped set-once violation).
    expect(await issueDeepLink(api.db, id, WORKER)).toEqual({ token: results[0]!.token, issued: false });
  });

  it("a link the routes do not recognize gets a token and no target; an unknown notification is 404", async () => {
    const id = await notify(b.users.bo2.id, `/transformations/${b.transformationId}/team`, b.transformationId);
    await tokenOf(id);
    const row = await api.db
      .selectFrom("inbox_notification")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect([row.target_record_type, row.target_record_id]).toEqual([null, null]);
    await expect(issueDeepLink(api.db, "01900000-0000-7000-8000-00000000beef", WORKER)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("listMyInbox redaction (ADR-0051 §3; D-195 reopen row 6)", () => {
  const inboxItem = async (session: Session, id: string) => {
    const res = await send("GET", "/api/v1/me/inbox?limit=100", { session });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.items.find((i: Body) => i.id === id);
  };

  it("the recipient who lost access sees inbox.restricted with empty params; the title returns with access", async () => {
    const id = await notify(b.users.bo2.id, benefitPath(b.transformationId, sensitiveId), b.transformationId);
    const stored = await api.db
      .selectFrom("inbox_notification")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    const redacted = await inboxItem(b.s.bo2, id);
    expect(redacted).toEqual({
      id,
      transformationId: b.transformationId,
      workItemId: stored.work_item_id,
      linkPath: benefitPath(b.transformationId, sensitiveId),
      messageKey: "inbox.restricted",
      messageParams: {},
      readAt: null,
      createdAt: stored.created_at.toISOString(),
      version: stored.version,
    });
    const g = await send("POST", "/api/v1/admin/sensitive-grants", {
      session: office,
      body: {
        transformationId: b.transformationId,
        recordType: "benefit",
        recordId: sensitiveId,
        granteeUserId: b.users.bo2.id,
        reason: "Synthetic restored access",
      },
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect(await inboxItem(b.s.bo2, id)).toEqual({
      ...redacted,
      messageKey: "tasks.kpi_update_due",
      messageParams: { title: SECRET_TITLE },
    });
    const revoked = await send("POST", `/api/v1/admin/sensitive-grants/${g.body.id}/revoke`, {
      session: office,
      headers: { "if-match": '"1"' },
      body: { reason: "Synthetic access ended" },
    });
    expect(revoked.status).toBe(200);
    expect(await inboxItem(b.s.bo2, id)).toEqual(redacted);
    // The stored row was never modified by the redaction.
    expect(
      await api.db.selectFrom("inbox_notification").selectAll().where("id", "=", id).executeTakeFirstOrThrow(),
    ).toEqual(stored);
  });

  it("a stored target, a recognized path, the transformation, or nothing (organization-level, never redacted)", async () => {
    const open = await notify(b.users.bo2.id, benefitPath(b.transformationId, benefitId), b.transformationId);
    const elsewhere = await notify(
      b.users.bo2.id,
      `/transformations/${otherTransformationId}/team`,
      otherTransformationId,
    );
    const orgLevel = await notify(b.users.bo2.id, "/my-work", null);
    // A stored target (set by the token issue from the path) is checked like the recognized path.
    const stored = await notify(b.users.bo2.id, benefitPath(b.transformationId, sensitiveId), b.transformationId);
    await tokenOf(stored);
    expect((await inboxItem(b.s.bo2, open)).messageKey).toBe("tasks.kpi_update_due");
    expect((await inboxItem(b.s.bo2, elsewhere)).messageKey).toBe("inbox.restricted");
    expect((await inboxItem(b.s.bo2, orgLevel)).messageParams).toEqual({ title: SECRET_TITLE });
    expect((await inboxItem(b.s.bo2, stored)).messageKey).toBe("inbox.restricted");
    // The batch rule agrees row by row with the resolver.
    const rows = await api.db
      .selectFrom("inbox_notification")
      .selectAll()
      .where("id", "in", [open, elsewhere, orgLevel, stored])
      .orderBy("id")
      .execute();
    const principal = {
      kind: "user" as const,
      userId: b.users.bo2.id,
      organizationId: w.orgA.id,
      grants: await loadGrants(api.db, b.users.bo2.id),
      tracker: { decisions: 0 },
    };
    const readable = await readableTargets(api.db, principal, rows);
    expect(Object.fromEntries(rows.map((r, i) => [r.id, readable[i]]))).toEqual({
      [open]: true,
      [elsewhere]: false,
      [orgLevel]: true,
      [stored]: false,
    });
  });

  it("the inbox read writes nothing", async () => {
    await notify(b.users.bo2.id, benefitPath(b.transformationId, sensitiveId), b.transformationId);
    const before = await auditCount();
    expect((await send("GET", "/api/v1/me/inbox", { session: b.s.bo2 })).status).toBe(200);
    expect(await auditCount()).toBe(before);
  });
});
