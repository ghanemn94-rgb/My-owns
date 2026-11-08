// T-DG6-BE-Z13B (D-227 (2), (3); D-218, D-226; ADR-0051 §2, §3; ADR-0054 §3; REQ-S10-002): the worker's channel fan-out
// (apps/worker handlers/notifications.ts `recipientCanRead`) applies the same child-source check as the API's inbox, so
// an e-mail about a record the recipient is not admitted to carries the `inbox.restricted` text, no code, no message
// parameter and no deep link to the record (the transformation home instead; no link token is issued). Proven against
// the run's disposable PostgreSQL and the in-process fake SMTP server (never a real mail service), with the e-mail
// channel ENABLED for the organization and a channel catalogue whose templates WOULD render the codes, for:
//   - a Finance validation of a sensitive benefit (child source finance_validation; the worker producer's shape);
//   - a benefit overlap through the real producer (POST /benefit-overlaps; child source benefit_overlap);
//   - an action on the variance case of the sensitive benefit (D-227 (3): the real createCorrectiveCaseAction; the task
//     names the case code as sourceCode and links /action-register/<actionId>);
//   - control: a notification about an open benefit renders its template and deep link; after an explicit grant the
//     Finance recipient's message renders its template again.
// The worker's twin of SENSITIVE_CHILD_SOURCES is pinned deep-equal to the API's map. Enterprise messaging (Teams) is not
// tested by a send: no adapter ships in this release and the database refuses an enabled row
// (notification_channel_no_messaging_adapter); every channel kind goes through the same `sendDelivery` render path.
// Every value is SYNTHETIC. Marking a record sensitive or granting access is an access decision, never a business or
// Finance approval (G1-G6), and nothing here touches DG0-DG7.
import { insertAuditEvent } from "@mth/db";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CHANNEL_CATALOGUE, type ChannelCatalogue } from "../../../../worker/src/channels/render.ts";
import { handleBenefitVariance } from "../../../../worker/src/handlers/raid.ts";
import { configureNotificationChannels, runFanout } from "../../../../worker/src/handlers/notifications.ts";
import { SENSITIVE_CHILD_SOURCES_TWIN } from "../../../../worker/src/sensitive-children.ts";
import { SENSITIVE_CHILD_SOURCES } from "../../../src/modules/access/sensitive-reach.ts";
import { createWorkItemOnce } from "../../../src/modules/tasks/index.ts";
import { decodedBody, FakeSmtp } from "../../support/fake-smtp.ts";
import {
  call,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import {
  benefitAt,
  financialBody,
  insertSubmittedMeasurement,
  seedBenefitWorld,
  type BenefitWorld,
} from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let smtp: FakeSmtp;
let w: World;
let b: BenefitWorld;
let office: Session;
const BASE_URL = "https://hub.example.invalid";
const AR = DEFAULT_CHANNEL_CATALOGUE.texts.ar; // every synthetic user has the default locale `ar` (0001)
const WORKER = { actorType: "service", actorUserId: null, requestId: "job:fanout-z13b", source: "worker" } as const;
const S = {
  benefit: "",
  code: "",
  other: "",
  otherCode: "",
  fv: "",
  overlap: "",
  caseId: "",
  caseCode: "",
  action: "",
};
const N = { fv: "", overlap: "", action: "", open: "" };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (r: { status: number; body: Body }, status = 200) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
};
const home = () => `/transformations/${b.transformationId}`;

/** Templates that WOULD put the codes and parameters into the message (the shipped catalogue has none). */
const LEAKY: ChannelCatalogue = {
  texts: DEFAULT_CHANNEL_CATALOGUE.texts,
  messages: new Map([
    ["benefits.task.finance_validation_review", { en: "Validate {{benefitCode}}", ar: "تحقق من {{benefitCode}}" }],
    [
      "benefits.task.overlap_review",
      { en: "Overlap {{benefitACode}} {{benefitBCode}}", ar: "تداخل {{benefitACode}} {{benefitBCode}}" },
    ],
    ["raid.task.action_due", { en: "Action due for {{sourceCode}}", ar: "إجراء مستحق لـ {{sourceCode}}" }],
    ["tasks.kpi_update_due", { en: "Update {{title}}", ar: "حدّث {{title}}" }],
  ]),
};

async function envelopeOf(notificationId: string) {
  const e = await api.db
    .selectFrom("outbox_event")
    .selectAll()
    .where("aggregate_type", "=", "inbox_notification")
    .where("aggregate_id", "=", notificationId)
    .executeTakeFirstOrThrow();
  return {
    outboxEventId: e.id,
    eventType: e.event_type,
    schemaVersion: e.schema_version,
    idempotencyKey: e.idempotency_key,
    organizationId: e.organization_id,
    payload: e.payload as Record<string, unknown>,
  };
}

async function notificationOfItem(workItemId: string): Promise<string> {
  return (
    await api.db
      .selectFrom("inbox_notification")
      .select("id")
      .where("work_item_id", "=", workItemId)
      .executeTakeFirstOrThrow()
  ).id;
}

/** Fans the notification out (the worker's real job) and returns the one message the fake received for it. */
async function sentFor(notificationId: string): Promise<{ text: string; raw: string }> {
  const before = smtp.messages.length;
  const r = await runFanout(api.db, await envelopeOf(notificationId), `z13b-${randomUUID()}`);
  expect(r.sends, JSON.stringify(r)).toEqual(["sent"]);
  expect(smtp.messages.length).toBe(before + 1);
  const m = smtp.messages.at(-1)!;
  return { text: decodedBody(m.data), raw: m.data };
}

const linkToken = async (notificationId: string) =>
  (
    await api.db
      .selectFrom("inbox_notification")
      .select("link_token")
      .where("id", "=", notificationId)
      .executeTakeFirstOrThrow()
  ).link_token;

beforeAll(async () => {
  api = await startApi();
  smtp = new FakeSmtp();
  await smtp.start();
  configureNotificationChannels({ refuseInsecure: false, appBaseUrl: new URL(BASE_URL), catalogue: LEAKY });
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  const hidden = await benefitAt(api, b, "measure");
  S.benefit = hidden.id;
  S.code = hidden.code;
  const other = ok(
    await send("POST", `${b.base}/benefits`, {
      session: b.s.bo,
      body: financialBody(b, { title: "Synthetic open benefit (BE-Z13B)" }),
    }),
    201,
  );
  S.other = other.id;
  S.otherCode = other.code;
  // A Finance validation of the benefit, inserted as the worker's finance-validation job does (synthetic setup).
  const measurementId = await insertSubmittedMeasurement(api.db, b, S.benefit, "1000.00");
  S.fv = uuidv7();
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("finance_validation")
      .values({
        id: S.fv,
        organization_id: b.organizationId,
        transformation_id: b.transformationId,
        benefit_id: S.benefit,
        benefit_measurement_id: measurementId,
        kind: "validation",
        idempotency_key: uniq("z13b-fv:"),
        assignee_user_id: null,
        status: "queued",
        content: JSON.stringify(
          Object.fromEntries(
            ["baseline", "attribution", "calculation", "evidence", "measurementPeriod", "assumptions"].map((k) => [
              k,
              {},
            ]),
          ),
        ),
        measurement_period_start: "2026-09-01",
        measurement_period_end: "2026-09-30",
        created_by: b.users.bo.id,
        updated_by: b.users.bo.id,
      })
      .execute();
    await insertAuditEvent(tx, WORKER, {
      action: "finance_validation.queued",
      recordType: "finance_validation",
      recordId: S.fv,
      organizationId: b.organizationId,
      transformationId: b.transformationId,
      newVersion: 1,
      changes: { status: { from: null, to: "queued" } },
    });
  });
  const fvItem = await api.db.transaction().execute((tx) =>
    createWorkItemOnce(tx, WORKER, {
      organizationId: b.organizationId,
      transformationId: b.transformationId,
      kind: "finance_validation_review",
      assigneeUserId: b.users.fin.id,
      subjectType: "finance_validation",
      subjectId: S.fv,
      linkPath: `${home()}/finance-validations/${S.fv}`,
      messageKey: "benefits.task.finance_validation_review",
      messageParams: { benefitCode: S.code, periodStart: "2026-09-01", periodEnd: "2026-09-30" },
      dedupeKey: `finance_validation:${S.fv}:${b.users.fin.id}`,
    }),
  );
  N.fv = await notificationOfItem(fvItem.workItemId);
  // The overlap through the real producer: FIN (the Finance recipient) gets the task and the notification.
  S.overlap = ok(
    await send("POST", `${b.base}/benefit-overlaps`, {
      session: b.s.tl,
      body: { benefitAId: S.benefit, benefitBId: S.other, dimensions: ["driver"] },
    }),
    201,
  ).id;
  const ovItem = await api.db
    .selectFrom("work_item")
    .select("id")
    .where("subject_type", "=", "benefit_overlap")
    .where("subject_id", "=", S.overlap)
    .where("assignee_user_id", "=", b.users.fin.id)
    .executeTakeFirstOrThrow();
  N.overlap = await notificationOfItem(ovItem.id);
  // The variance case (worker consumer) and an action on it owned by bo2 (no party of the benefit, no grant).
  await handleBenefitVariance(
    api.db,
    {
      outboxEventId: randomUUID(),
      eventType: "benefit.variance_evaluated",
      schemaVersion: 1,
      idempotencyKey: `benefit.variance_evaluated:z13b-${randomUUID()}`,
      organizationId: b.organizationId,
      payload: {
        benefitId: S.benefit,
        measurementId: randomUUID(),
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        plannedAmount: "100000.0000",
        measuredAmount: "80000.0000",
        variance: "-20000.0000",
        offTrack: true,
      },
    },
    "z13b-fanout-variance",
  );
  const c = await api.db
    .selectFrom("corrective_case")
    .select(["id", "code"])
    .where("benefit_id", "=", S.benefit)
    .executeTakeFirstOrThrow();
  S.caseId = c.id;
  S.caseCode = c.code;
  S.action = ok(
    await send("POST", `${b.base}/corrective-actions/${S.caseId}/actions`, {
      session: b.s.tl,
      body: { title: "Synthetic recovery step (BE-Z13B fan-out)", ownerUserId: b.users.bo2.id, dueDate: "2027-01-15" },
    }),
    201,
  ).id;
  const actionItem = await api.db
    .selectFrom("work_item")
    .select("id")
    .where("subject_type", "=", "action_item")
    .where("subject_id", "=", S.action)
    .executeTakeFirstOrThrow();
  N.action = await notificationOfItem(actionItem.id);
  // Control: a notification about the open benefit, for FIN.
  const openItem = await api.db.transaction().execute((tx) =>
    createWorkItemOnce(tx, WORKER, {
      organizationId: b.organizationId,
      transformationId: b.transformationId,
      kind: "kpi_update_due",
      assigneeUserId: b.users.fin.id,
      subjectType: "benefit",
      subjectId: S.other,
      linkPath: `${home()}/benefits/${S.other}`,
      messageKey: "tasks.kpi_update_due",
      messageParams: { title: S.otherCode },
      dedupeKey: uniq("z13b-open:"),
    }),
  );
  N.open = await notificationOfItem(openItem.workItemId);
  // Mark the benefit sensitive, then enable the organization's e-mail channel (pointing at the fake).
  ok(
    await send("PUT", `${b.base}/records/benefit/${S.benefit}/sensitivity`, {
      session: office,
      headers: { "if-match": '"0"' },
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit (BE-Z13B fan-out)" },
    }),
  );
  const admin = await signIn(api.app, w.admin.subject);
  ok(
    await send("PUT", `/api/v1/admin/notification-channels/email?organizationId=${w.orgA.id}`, {
      session: admin,
      headers: { "if-match": '"0"' },
      body: {
        enabled: true,
        smtp: {
          host: "127.0.0.1",
          port: smtp.port,
          security: "none",
          usernameRef: null,
          passwordRef: null,
          fromAddress: "hub-noreply@example.invalid",
        },
        reason: "Synthetic BE-Z13B test: enable email",
      },
    }),
  );
}, 240_000);

afterAll(async () => {
  configureNotificationChannels({});
  await smtp?.stop();
  await api?.close();
});

describe("D-227 (2): the channel fan-out redacts a message about a restricted record like the inbox", () => {
  it("the worker's child-source twin equals the API's SENSITIVE_CHILD_SOURCES", () => {
    expect(SENSITIVE_CHILD_SOURCES_TWIN).toEqual(SENSITIVE_CHILD_SOURCES);
  });

  it("control: FIN gets 404 on the Finance validation and the overlap; bo2 on the case", async () => {
    expect((await send("GET", `${b.base}/finance-validations/${S.fv}`, { session: b.s.fin })).status).toBe(404);
    expect((await send("GET", `${b.base}/benefit-overlaps/${S.overlap}`, { session: b.s.fin })).status).toBe(404);
    expect((await send("GET", `${b.base}/corrective-actions/${S.caseId}`, { session: b.s.bo2 })).status).toBe(404);
  });

  for (const [label, key] of [
    ["a Finance validation of the sensitive benefit (child source finance_validation)", "fv"],
    ["a benefit overlap through the real producer (child source benefit_overlap)", "overlap"],
    ["an action on the restricted corrective case (D-227 (3): sourceCode, /action-register/ link)", "action"],
  ] as const) {
    it(`e-mail for ${label}: the restricted text, no code, no parameter, the home link, no token`, async () => {
      const { text, raw } = await sentFor(N[key]);
      expect(text).toContain(AR.restricted);
      expect(text).toContain(`${BASE_URL}${home()}`);
      for (const hidden of [S.code, S.caseCode, S.fv, S.overlap, S.action, S.benefit, "/links/", "/action-register/"])
        expect(`${text}\n${raw}`).not.toContain(hidden);
      expect(await linkToken(N[key])).toBeNull();
    });
  }

  it("control: the open benefit's message renders its template and a deep link", async () => {
    const { text } = await sentFor(N.open);
    expect(text).toContain(`حدّث ${S.otherCode}`);
    expect(text).not.toContain(AR.restricted);
    const token = await linkToken(N.open);
    expect(token).not.toBeNull();
    expect(text).toContain(`${BASE_URL}/links/${token}`);
  });

  it("after an explicit grant, a new Finance validation message for FIN renders its template again", async () => {
    ok(
      await send("POST", "/api/v1/admin/sensitive-grants", {
        session: office,
        body: {
          transformationId: b.transformationId,
          recordType: "benefit",
          recordId: S.benefit,
          granteeUserId: b.users.fin.id,
          reason: "Synthetic need to know (BE-Z13B fan-out)",
        },
      }),
      201,
    );
    const item = await api.db.transaction().execute((tx) =>
      createWorkItemOnce(tx, WORKER, {
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        kind: "finance_validation_review",
        assigneeUserId: b.users.fin.id,
        subjectType: "finance_validation",
        subjectId: S.fv,
        linkPath: `${home()}/finance-validations/${S.fv}`,
        messageKey: "benefits.task.finance_validation_review",
        messageParams: { benefitCode: S.code, periodStart: "2026-09-01", periodEnd: "2026-09-30" },
        dedupeKey: uniq("z13b-fv-again:"),
      }),
    );
    const { text } = await sentFor(await notificationOfItem(item.workItemId));
    expect(text).toContain(`تحقق من ${S.code}`);
    expect(text).toContain(`${BASE_URL}/links/`);
  });
});
