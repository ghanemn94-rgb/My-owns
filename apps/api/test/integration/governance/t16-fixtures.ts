// Fixtures for the slice D T16, escalation and blocker-status tests and contract exercises (backend-workflow-engineer,
// T-DG4-BE-G; ADR-0032 §6-§8). All data is SYNTHETIC. They build on BE-F's meeting world (TL lead, TO office, WL
// contributor, AUD auditor, SP sponsor mapped to SP, BO mapped to BO, FIN, ADM-only admin, the organization's default
// business calendar). Test clocks (an ask's dates moved into the past, the workweek changed) are written like an API
// change: version + 1 with an audit event in the same transaction (the record guards). Nothing here grants a real
// business approval or touches the engineering gates DG0-DG7.
import { insertAuditEvent, sql, type Db } from "@mth/db";
import { expect } from "vitest";
import type { RequestOptions, Res, Session, TestApi } from "../../support/harness.ts";
import type { MeetingWorld } from "./meeting-fixtures.ts";

// Test responses are asserted structurally; the body type is deliberately loose (as in `call`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Send = (method: string, url: string, opts?: RequestOptions) => Promise<Res<any>>;

const testActor = { actorType: "system", actorUserId: null, requestId: "test:t16-clock", source: "api" } as const;

/** A complete executive ask body (the seven elements; options A and B; recommendation A). */
export const askBody = (ownerUserId: string, requiredDate: string, extra: Record<string, unknown> = {}) => ({
  title: "Synthetic: approve the vendor switch",
  whyNow: "Synthetic: the contract renewal window closes this month",
  options: [{ title: "Switch vendor" }, { title: "Renew the current contract", description: "Synthetic" }],
  recommendation: "A",
  impactOfDelay: "Synthetic: a further quarter on the current terms",
  ownerUserId,
  requiredDate,
  ...extra,
});

/** Raises an ask through the API as `session` (TL by default) and returns its body. */
export async function raiseAsk(
  send: Send,
  x: MeetingWorld,
  ownerUserId: string,
  requiredDate: string,
  extra: Record<string, unknown> = {},
  session: Session = x.lead.session,
) {
  const res = await send("POST", `/api/v1/transformations/${x.transformationId}/executive-decisions`, {
    session,
    body: askBody(ownerUserId, requiredDate, extra),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; code: string; version: number };
}

/** Moves an ask's decision date and SLA date (test clock), version + 1 with an audit event. */
export async function moveAskDates(db: Db, decisionId: string, dueDate: string, slaDueDate: string): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const d = await tx
      .selectFrom("decision")
      .select(["version", "organization_id", "transformation_id"])
      .where("id", "=", decisionId)
      .executeTakeFirstOrThrow();
    await tx
      .updateTable("decision")
      .set({ due_date: dueDate, sla_due_date: slaDueDate, sla_unknown_reason: null, version: sql<number>`version + 1` })
      .where("id", "=", decisionId)
      .execute();
    await insertAuditEvent(tx, testActor, {
      action: "decision.test_clock",
      recordType: "decision",
      recordId: decisionId,
      organizationId: d.organization_id,
      transformationId: d.transformation_id,
      priorVersion: d.version,
      newVersion: d.version + 1,
    });
  });
}

/** Sets the workweek of the organization's default calendar (ISO 1 = Monday ... 7 = Sunday). */
export async function setWorkweek(db: Db, organizationId: string, days: readonly number[]): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const c = await tx
      .selectFrom("business_calendar")
      .select(["id", "version"])
      .where("organization_id", "=", organizationId)
      .where("is_default", "=", true)
      .where("status", "=", "active")
      .executeTakeFirstOrThrow();
    await tx
      .updateTable("business_calendar")
      .set({ workweek: sql<number[]>`${`{${days.join(",")}}`}::smallint[]`, version: sql<number>`version + 1` })
      .where("id", "=", c.id)
      .execute();
    await insertAuditEvent(tx, testActor, {
      action: "business_calendar.test_clock",
      recordType: "business_calendar",
      recordId: c.id,
      organizationId,
      priorVersion: c.version,
      newVersion: c.version + 1,
    });
  });
}

/** The workweek of the organization's default calendar (to restore it after a test clock). */
export async function workweekOf(db: Db, organizationId: string): Promise<number[]> {
  const c = await db
    .selectFrom("business_calendar")
    .select("workweek")
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirstOrThrow();
  return c.workweek.map(Number);
}

/** The organization of the meeting world's transformation. */
export async function organizationOf(api: TestApi, transformationId: string): Promise<string> {
  const t = await api.db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  return t.organization_id;
}

/** A RAID risk of the transformation (the blocker record), created through the API by the TL. */
export async function createBlockerRisk(send: Send, x: MeetingWorld, description = "Synthetic blocker: data feed") {
  const res = await send("POST", `/api/v1/transformations/${x.transformationId}/raid`, {
    session: x.lead.session,
    body: {
      type: "risk",
      description,
      impact: "high",
      probability: "medium",
      ownerUserId: x.lead.id,
      dueDate: "2026-12-31",
      mitigation: "Synthetic mitigation",
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** A new forum of the transformation (TO), so cycle counts are not shared with other tests. */
export async function createForum(send: Send, x: MeetingWorld, name = "Synthetic review forum"): Promise<string> {
  const res = await send("POST", `/api/v1/transformations/${x.transformationId}/forums`, {
    session: x.office.session,
    body: {
      nameEn: name,
      nameAr: "منتدى اصطناعي",
      cadenceLabel: "Weekly",
      purpose: "Synthetic",
      participantsLabel: "Synthetic",
      outputsLabel: "RAID",
      outputKinds: ["raid"],
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** An ad-hoc meeting of `forumId` on `date`, started (in_session) by the TL. Returns its id. */
export async function meetingInSession(send: Send, x: MeetingWorld, forumId: string, date: string): Promise<string> {
  const T = `/api/v1/transformations/${x.transformationId}/meetings`;
  const created = await send("POST", T, {
    session: x.lead.session,
    body: { forumId, scheduledDate: date, startTime: "09:00", durationMinutes: 60 },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const started = await send("POST", `${T}/${created.body.id}/start`, {
    session: x.lead.session,
    headers: { "if-match": '"1"' },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  return created.body.id as string;
}

/** The relay's message for the outbox row of an aggregate (what the queue delivers to the consumer). */
export async function envelopeOf(db: Db, aggregateId: string) {
  const e = await db
    .selectFrom("outbox_event")
    .selectAll()
    .where("aggregate_id", "=", aggregateId)
    .executeTakeFirstOrThrow();
  return {
    outboxEventId: e.id,
    eventType: e.event_type,
    schemaVersion: e.schema_version,
    idempotencyKey: e.idempotency_key,
    organizationId: e.organization_id,
    payload: typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload,
  };
}
