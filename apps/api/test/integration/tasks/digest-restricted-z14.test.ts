// T-DG6-BE-Z14 (code-security observation 600; D-226, D-231; ADR-0051 §3; REQ-S10-002 "a sensitive benefit is
// hidden from a workstream member without the grant"; REQ-S12-025 digests): GET /me/notification-digests/{digestId}
// applies the D-226 inbox redaction to every digested notification about a record the reader is not admitted to:
// `inbox.restricted`, params {}, the transformation home as link, and `includesRestrictedRecords: true`. The stored row
// is never changed: after an explicit grant the same read shows the original text again.
// Setup (the code-security round-9 probe zz-cs-r9-digest.test.ts, the before-fix reproduction): tl2, a TL scoped to the
// demo transformation without a grant, gets the real producer's Finance-validation task and notification through the
// API's createWorkItemOnce while tl2's own preferences hold it in quiet hours with a daily digest; the TO marks the
// benefit sensitive; the REAL worker job runDigestWindow digests it. Demo data is SYNTHETIC (illustrative, not Mobily
// actual performance). Marking a record sensitive or granting access is an access decision, never a business approval
// (G1-G6); nothing here touches DG0-DG7.
import { migrate, seedDemo, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { wallClockOf } from "../../../../../packages/shared/src/schemas/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";
import { createWorkItemOnce } from "../../../src/modules/tasks/index.ts";
import { runDigestWindow } from "../../../../worker/src/handlers/digests.ts";
import { randomUUID } from "node:crypto";

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
let toId = "";
const S = {
  hidden: "",
  code: "",
  fv: "",
  noteId: "",
  workItemId: "",
  digestId: "",
  heldBy: "",
  childIds: [] as string[],
};
const log = (...a: unknown[]) => console.log("[BE-Z14-DIGEST]", ...a);
const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session, contract: false });
const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (minutes: number) => {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_be_z14_digest");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const mk = async (role: string, s: { type: "organization" | "transformation"; id: string }) => {
    const u = await createUser(api.db, ORG);
    await grant(api.db, grantor, u.id, role, s, ORG);
    return u;
  };
  const toUser = await mk("TO", { type: "organization", id: ORG });
  toId = toUser.id;
  to = await signIn(api.app, toUser.subject);
  const u2 = await mk("TL", { type: "transformation", id: T });
  tl2Id = u2.id;
  tl2 = await signIn(api.app, u2.subject);
  // tl2's own preferences: quiet hours around now, daily digest after them (as p5-exercises-be-l.ts).
  const now = Math.floor(wallClockOf(new Date(), "Asia/Riyadh").minutes);
  const prefs = await call<Body>(api.app, "PUT", "/api/v1/me/notification-preferences", {
    session: tl2,
    headers: { "if-match": '"0"' },
    body: {
      quietHoursStart: timeOf(now - 120),
      quietHoursEnd: timeOf(now + 120),
      digestMode: "daily",
      digestTime: timeOf(now + 180),
    },
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
  const actor = {
    actorType: "service" as const,
    actorUserId: null,
    requestId: `job:${randomUUID()}`,
    source: "worker" as const,
  };
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
    body: { isSensitive: true, reason: "Synthetic sensitive benefit (BE-Z14)" },
  });
  expect(m.status, JSON.stringify(m.body)).toBe(200);
  // The real digest job, at the release time.
  const run = await runDigestWindow(api.db, `job:${randomUUID()}`, new Date(n.deliver_after!.getTime() + 60_000), {
    userIds: [tl2Id],
  });
  log(`runDigestWindow -> ${JSON.stringify(run.users)}`);
  S.digestId = run.users[0]?.digestId ?? "";
  expect(S.digestId).not.toBe("");
  for (const table of ["benefit_measurement", "finance_validation", "corrective_case", "transition_decision"]) {
    const ids = await sql<{
      id: string;
    }>`SELECT id::text AS id FROM ${sql.table(table)} WHERE benefit_id = ${S.hidden}::uuid`.execute(api.db);
    S.childIds.push(...ids.rows.map((r) => r.id));
  }
}, 900_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

const named = (body: unknown) => {
  const text = JSON.stringify(body);
  return [S.hidden, S.fv, ...S.childIds].filter((x) => text.includes(x));
};
const digestPath = () => `/api/v1/me/notification-digests/${S.digestId}`;

describe("T-DG6-BE-Z14: a digested notification about a restricted record (D-226, D-231)", () => {
  it("control: tl2 cannot read the benefit or its Finance validation", async () => {
    expect((await get(`${t}/benefits/${S.hidden}`, tl2)).status).toBe(404);
    expect([403, 404]).toContain((await get(`${t}/finance-validations/${S.fv}`, tl2)).status);
  });

  it("the digest read applies the inbox redaction: inbox.restricted, params {}, the home link, the marker", async () => {
    const digest = await call<Body>(api.app, "GET", digestPath(), { session: tl2 });
    log(`GET /me/notification-digests/{id} ${digest.status}: ${JSON.stringify(digest.body)}`);
    expect(digest.status).toBe(200);
    const item = (digest.body.items as Body[]).find((x) => x.notificationId === S.noteId);
    expect(item).toBeDefined();
    expect(item).toEqual({
      notificationId: S.noteId,
      messageKey: "inbox.restricted",
      messageParams: {},
      linkPath: `/transformations/${T}`,
      createdAt: item.createdAt,
      includesRestrictedRecords: true,
    });
    expect(named(digest.body)).toEqual([]);
    expect(JSON.stringify(digest.body)).not.toContain(`"${S.code}"`);
    // The same decision as the inbox: the work item is restricted too, and the inbox list names nothing hidden.
    const items = await get(`/api/v1/me/work-items?limit=100`, tl2);
    const wi = (items.body.items as Body[]).find((x) => x.id === S.workItemId);
    expect(wi?.includesRestrictedRecords).toBe(true);
    expect(named(await get(`/api/v1/me/inbox?limit=100`, tl2))).toEqual([]);
    // The stored row is unchanged.
    const row = await api.db
      .selectFrom("inbox_notification")
      .select(["message_key", "link_path"])
      .where("id", "=", S.noteId)
      .executeTakeFirstOrThrow();
    expect(row.message_key).toBe("benefits.task.finance_validation_review");
    expect(row.link_path).toContain(S.fv);
  });

  it("negative: another user's digest is 404 and names nothing", async () => {
    const res = await get(digestPath(), to);
    expect(res.status).toBe(404);
    expect(named(res.body)).toEqual([]);
  });

  it("positive: after an explicit grant the same read shows the original text and link (access restored)", async () => {
    const g = await call<Body>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
      session: to,
      body: {
        transformationId: T,
        recordType: "benefit",
        recordId: S.hidden,
        granteeUserId: tl2Id,
        reason: "Synthetic need to know (BE-Z14 digest)",
      },
      contract: false,
    });
    log(`TO grants tl2 the benefit -> ${g.status} (TO user ${toId})`);
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    const digest = await call<Body>(api.app, "GET", digestPath(), { session: tl2 });
    expect(digest.status).toBe(200);
    const item = (digest.body.items as Body[]).find((x) => x.notificationId === S.noteId);
    expect(item.messageKey).toBe("benefits.task.finance_validation_review");
    expect(item.messageParams.benefitCode).toBe(S.code);
    expect(item.linkPath).toBe(`/transformations/${T}/finance-validations/${S.fv}`);
    expect(item.includesRestrictedRecords).toBeUndefined();
  });
});
