// code-security-reviewer, DG6 round 9 (T-DG6-REV-CS-R9). NOT part of the candidate: copied into a disposable clone's
// tests/qa/integration by checks.sh repro and removed afterwards. Demo data is SYNTHETIC (illustrative, not Mobily
// actual performance). Marking a record sensitive is an access decision, never a business approval (G1-G6); nothing
// here touches DG0-DG7.
//
// Question (D-226 "D-218 and D-222 (1) apply to every response that serializes a notification"): the inbox list and
// mark-read are redacted (T-DG6-BE-Z13). A notification held in quiet hours is released into a DIGEST by the worker's
// notification.digest job and is then NOT in the inbox list (only `delivered` rows are); it is read through
// GET /me/notification-digests/{digestId} (apps/api/src/modules/tasks/digests.ts), which serializes messageKey,
// messageParams and linkPath. Is that response redacted?
// Setup = the F-DG6-540 P1 setup (round-8 probe zz-cs-r8-inbox-text.test.ts): tl2 (a TL scoped to the demo
// transformation, no grant, never a named party) gets the real producer's Finance-validation task and notification
// (apps/worker/src/handlers/benefits.ts shape) through the API's createWorkItemOnce, while tl2's own preferences put
// it in quiet hours with a daily digest (PUT /me/notification-preferences, as p5-exercises-be-l.ts does); the TO marks
// the benefit sensitive; the REAL worker job runDigestWindow (apps/worker/src/handlers/digests.ts) digests it.
// Then tl2 reads GET /me/work-items (control: redacted), GET /me/inbox (the digest notification itself) and
// GET /me/notification-digests/{id}. Asserted: no response names a hidden id or the benefit's code. EXPECTED TO FAIL
// on a leak (the log names each one).
import { DEV_ISSUER, migrate, seedDemo, sql } from "../../../packages/db/src/index.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { wallClockOf } from "../../../packages/shared/src/schemas/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../../../apps/api/test/support/harness.ts";
import { createWorkItemOnce } from "../../../apps/api/src/modules/tasks/index.ts";
import { runDigestWindow } from "../../../apps/worker/src/handlers/digests.ts";
import { randomUUID } from "node:crypto";

void DEV_ISSUER;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const grantor = DEMO_ANCHORS.users.sp;
const t = `/api/v1/transformations/${T}`;
let api: TestApi;
let scratch: string | null = null;
let to: Session;
let tl2: Session;
let tl2Id = "";
const S = { hidden: "", code: "", fv: "", noteId: "", workItemId: "", digestId: "", heldBy: "", childIds: [] as string[] };
const log = (...a: unknown[]) => console.log("[CS-R9-DIGEST]", ...a);
const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session, contract: false });
const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (minutes: number) => {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r9_digest");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const mk = async (role: string, s: { type: "organization" | "transformation"; id: string }) => {
    const u = await createUser(api.db, ORG);
    await grant(api.db, grantor, u.id, role, s, ORG);
    return u;
  };
  to = await signIn(api.app, (await mk("TO", { type: "organization", id: ORG })).subject);
  const u2 = await mk("TL", { type: "transformation", id: T });
  tl2Id = u2.id;
  tl2 = await signIn(api.app, u2.subject);
  // tl2's own preferences: quiet hours around now, daily digest after them (as p5-exercises-be-l.ts).
  const now = Math.floor(wallClockOf(new Date(), "Asia/Riyadh").minutes);
  const prefs = await call<Body>(api.app, "PUT", "/api/v1/me/notification-preferences", {
    session: tl2,
    headers: { "if-match": '"0"' },
    body: { quietHoursStart: timeOf(now - 120), quietHoursEnd: timeOf(now + 120), digestMode: "daily", digestTime: timeOf(now + 180) },
    contract: false,
  });
  log(`tl2 PUT /me/notification-preferences (quiet hours now, daily digest) -> ${prefs.status}`);
  expect(prefs.status).toBe(200);
  const fv = await sql<{ fv: string; benefit: string; code: string; ps: string | null; pe: string | null }>`
    SELECT f.id::text AS fv, b.id::text AS benefit, b.code, m.period_start::text AS ps, m.period_end::text AS pe
      FROM finance_validation f JOIN benefit b ON b.id = f.benefit_id
      LEFT JOIN benefit_measurement m ON m.id = f.benefit_measurement_id
     WHERE b.transformation_id = ${T}::uuid ORDER BY f.id LIMIT 1`.execute(api.db);
  const row = fv.rows[0];
  expect(row, "the demo has a Finance validation").toBeDefined();
  S.hidden = row!.benefit;
  S.code = row!.code;
  S.fv = row!.fv;
  log(`hidden benefit ${S.code} ${S.hidden}; finance validation ${S.fv}`);
  const actor = { actorType: "service" as const, actorUserId: null, requestId: `job:${randomUUID()}`, source: "worker" as const };
  const out = await api.db.transaction().execute((tx) =>
    createWorkItemOnce(tx, actor, {
      organizationId: ORG,
      transformationId: T,
      kind: "finance_validation_review",
      assigneeUserId: tl2Id,
      subjectType: "finance_validation",
      subjectId: S.fv,
      linkPath: `/transformations/${T}/finance-validations/${S.fv}`,
      messageKey: "benefits.task.finance_validation_review",
      messageParams: { benefitCode: S.code, periodStart: row!.ps ?? "2026-01-01", periodEnd: row!.pe ?? "2026-03-31" },
      dedupeKey: `finance_validation:${S.fv}:${tl2Id}`,
    } as Body),
  );
  S.workItemId = out.workItemId;
  const n = await api.db
    .selectFrom("inbox_notification")
    .select(["id", "delivery_state", "deliver_after"])
    .where("work_item_id", "=", out.workItemId)
    .executeTakeFirstOrThrow();
  S.noteId = n.id;
  S.heldBy = `delivery decision (state ${n.delivery_state}, deliver_after ${n.deliver_after?.toISOString() ?? null})`;
  log(`notification ${n.id}: ${S.heldBy}`);
  expect(n.delivery_state, "the delivery decision holds it in tl2's quiet hours").toBe("held");
  // The TO marks the benefit sensitive (after the notification was issued, as in production).
  const m = await call<Body>(api.app, "PUT", `${t}/records/benefit/${S.hidden}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic sensitive benefit (CS-R9-DIGEST)" },
  });
  expect(m.status, JSON.stringify(m.body)).toBe(200);
  // The real digest job, at the release time.
  const run = await runDigestWindow(api.db, `job:${randomUUID()}`, new Date(n.deliver_after!.getTime() + 60_000), { userIds: [tl2Id] });
  log(`runDigestWindow -> ${JSON.stringify(run.users)}`);
  S.digestId = run.users[0]?.digestId ?? "";
  expect(S.digestId).not.toBe("");
  for (const table of ["benefit_measurement", "finance_validation", "corrective_case", "transition_decision"]) {
    const ids = await sql<{ id: string }>`SELECT id::text AS id FROM ${sql.table(table)} WHERE benefit_id = ${S.hidden}::uuid`.execute(api.db);
    S.childIds.push(...ids.rows.map((r) => r.id));
  }
}, 900_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

const named = (body: unknown) => {
  const text = JSON.stringify(body);
  return [S.hidden, ...S.childIds].filter((x) => text.includes(x));
};

describe("CS-R9-DIGEST: a digested notification about a restricted record", () => {
  it("tl2 gets 404 on the benefit and its Finance validation (control)", async () => {
    const b = await get(`${t}/benefits/${S.hidden}`, tl2);
    const f = await get(`${t}/finance-validations/${S.fv}`, tl2);
    log(`tl2 GET benefit ${b.status}; tl2 GET finance validation ${f.status}`);
    expect(b.status).toBe(404);
    expect([403, 404]).toContain(f.status);
  });

  it("work item, inbox and the digest read never name a hidden id or the restricted benefit's code", async () => {
    const leaks: string[] = [];
    const items = await get(`/api/v1/me/work-items?limit=100`, tl2);
    const wi = (items.body.items ?? []).find((x: Body) => x.id === S.workItemId);
    log(`GET /me/work-items ${items.status}: subjectId=${wi?.subjectId} linkPath=${wi?.linkPath} key=${wi?.messageKey} params=${JSON.stringify(wi?.messageParams)} marker=${wi?.includesRestrictedRecords}`);
    if (named(items.body).length > 0) leaks.push(`listMyWorkItems names ${named(items.body).join(",")}`);
    const inbox = await get(`/api/v1/me/inbox?limit=100`, tl2);
    const listed = (inbox.body.items ?? []).map((x: Body) => ({ id: x.id, key: x.messageKey, params: x.messageParams, link: x.linkPath }));
    log(`GET /me/inbox ${inbox.status}: ${JSON.stringify(listed)} (the digested notification ${S.noteId} listed: ${listed.some((x: Body) => x.id === S.noteId)})`);
    if (named(inbox.body).length > 0) leaks.push(`listMyInbox names ${named(inbox.body).join(",")}`);
    const digest = await get(`/api/v1/me/notification-digests/${S.digestId}`, tl2);
    log(`GET /me/notification-digests/{id} ${digest.status}: ${JSON.stringify(digest.body)}`);
    if (named(digest.body).length > 0) leaks.push(`getMyNotificationDigest names ${named(digest.body).join(",")}`);
    if (JSON.stringify(digest.body?.items ?? []).includes(`"${S.code}"`)) leaks.push(`getMyNotificationDigest returns the restricted benefit's code ${S.code}`);
    log(`leaks (${leaks.length}):\n${leaks.join("\n")}`);
    expect(wi?.subjectId ?? null).toBeNull();
    expect(leaks).toEqual([]);
  });
});
