// Fixtures for the slice E execution-tracking tests and contract exercises (backend-workflow-engineer, T-DG4-BE-E;
// ADR-0031 §7-§9). All data is SYNTHETIC. Each seed creates a NEW transformation in org A / BU a1 (so initiative codes
// such as INI-01 are free) with one user per relevant role granted at transformation scope: TL (budget.edit,
// roadmap.edit), WL and TO (roadmap.edit, no budget.edit), FIN (budget.edit), BO (neither), plus seedWorld's org-level
// auditor (AUD, read-only) and technical administrator (ADM_ACCESS + ADM_TECH, no transformation.read) and org B's
// office (outside scope). Initiatives, milestones and decision links are written directly with their audit event (their
// routes belong to other tasks); dependencies go through the T08 API (the canonical record). Nothing here grants a real
// business or Finance approval, and nothing touches the engineering gates DG0-DG7.
import { insertAuditEvent, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  signIn,
  uniq,
  type RequestOptions,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

export type ExecActor = "tl" | "wl" | "to" | "fin" | "bo" | "auditor" | "admin" | "outsider";

export interface ExecWorld {
  readonly transformationId: string;
  readonly organizationId: string;
  readonly users: Readonly<Record<ExecActor, { id: string; subject: string }>>;
  readonly s: Readonly<Record<ExecActor, Session>>;
}

export type Caller = (method: string, url: string, opts?: RequestOptions) => Promise<Res>;

export async function seedExecutionWorld(api: TestApi, w: World): Promise<ExecWorld> {
  const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const scope = { type: "transformation" as const, id: transformationId };
  const mk = async (role: string) => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, role, scope, w.orgA.id);
    return u;
  };
  const users = {
    tl: await mk("TL"),
    wl: await mk("WL"),
    to: await mk("TO"),
    fin: await mk("FIN"),
    bo: await mk("BO"),
    auditor: w.auditor,
    admin: w.admin,
    outsider: w.officeB,
  };
  const s = Object.fromEntries(
    await Promise.all(Object.entries(users).map(async ([k, u]) => [k, await signIn(api.app, u.subject)] as const)),
  ) as Record<ExecActor, Session>;
  return { transformationId, organizationId: w.orgA.id, users, s };
}

/** Inserts one transformation-scoped row with its audit event (the P2 audit guard demands one), as TL. */
export async function insertAudited(
  db: Db,
  x: ExecWorld,
  table:
    | "initiative"
    | "milestone"
    | "initiative_decision_link"
    | "deliverable"
    | "resource_role"
    | "capacity"
    | "resource_demand",
  values: Record<string, unknown>,
): Promise<string> {
  const id = uuidv7();
  const by = x.users.tl.id;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto(table)
      .values({
        id,
        organization_id: x.organizationId,
        transformation_id: x.transformationId,
        created_by: by,
        updated_by: by,
        ...values,
      } as never)
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: by, requestId: `fixture-${id}`, source: "api" },
      {
        action: `${table}.create`,
        recordType: table,
        recordId: id,
        organizationId: x.organizationId,
        transformationId: x.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

/** An initiative with the given code (synthetic name); `cancelled` sets the cancel stamps the CHECK needs. */
export function insertInitiative(
  db: Db,
  x: ExecWorld,
  code: string,
  opts: { status?: "draft" | "cancelled" } = {},
): Promise<string> {
  return insertAudited(db, x, "initiative", {
    code,
    name: `Synthetic initiative ${code}`,
    ...(opts.status === "cancelled"
      ? { status: "cancelled", cancelled_at: new Date(), cancelled_by: x.users.tl.id, cancel_reason: "Synthetic" }
      : {}),
  });
}

/** A milestone with an approved and a forecast date (either may be null). The approval stamps are synthetic. */
export function insertMilestone(
  db: Db,
  x: ExecWorld,
  initiativeId: string,
  approved: string | null,
  forecast: string | null,
  title = "Synthetic milestone",
): Promise<string> {
  return insertAudited(db, x, "milestone", {
    initiative_id: initiativeId,
    title,
    approved_date: approved,
    approved_by: approved === null ? null : x.users.tl.id,
    approved_at: approved === null ? null : new Date(),
    approval_reason: approved === null ? null : "Synthetic baseline",
    forecast_date: forecast,
  });
}

/** A resourcing role, its capacity in a month (optional) and an initiative's demand on it in that month. */
export async function insertDemand(
  db: Db,
  x: ExecWorld,
  initiativeId: string,
  month: string,
  demandFte: string,
  availableFte: string | null,
): Promise<{ roleId: string; demandId: string }> {
  const roleId = await insertAudited(db, x, "resource_role", {
    code: `role_${uniq("r").toLowerCase()}`,
    label_en: "Synthetic analyst",
    label_ar: "محلل اصطناعي",
  });
  if (availableFte !== null)
    await insertAudited(db, x, "capacity", {
      resource_role_id: roleId,
      period_month: month,
      available_fte: availableFte,
    });
  const demandId = await insertAudited(db, x, "resource_demand", {
    initiative_id: initiativeId,
    resource_role_id: roleId,
    period_month: month,
    demand_fte: demandFte,
  });
  return { roleId, demandId };
}

/** Links a decision to an initiative (direct write; the link routes belong to DG3 BE-B). */
export function linkDecision(db: Db, x: ExecWorld, initiativeId: string, decisionId: string): Promise<string> {
  return insertAudited(db, x, "initiative_decision_link", { initiative_id: initiativeId, decision_id: decisionId });
}

/** A design decision through the API (TL). */
export async function newDecision(send: Caller, x: ExecWorld, title = "Synthetic design decision"): Promise<string> {
  const res = await send("POST", "/api/v1/decisions", {
    session: x.s.tl,
    body: { transformationId: x.transformationId, title },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { id: string }).id;
}

/** A finish-to-start dependency From -> To through the T08 API (the canonical record), as TL. */
export async function newDependency(
  send: Caller,
  x: ExecWorld,
  from: string,
  to: string,
): Promise<{ id: string; code: string }> {
  const res = await send("POST", "/api/v1/dependencies", {
    session: x.s.tl,
    body: {
      transformationId: x.transformationId,
      description: "Synthetic delivery dependency",
      from: { kind: "initiative", initiativeId: from },
      toInitiativeId: to,
      dependencyType: "tech",
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; code: string };
}

/** Records an initiative's planned duration through the API (TL). */
export async function setDuration(
  send: Caller,
  x: ExecWorld,
  initiativeId: string,
  days: number | null,
): Promise<void> {
  const res = await send("POST", `/api/v1/initiatives/${initiativeId}/schedule`, {
    session: x.s.tl,
    body: { durationWorkingDays: days },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

/** Org A's active default calendar id, created through the API (ADM_TECH) when absent. Default: Sunday-Thursday. */
export async function ensureDefaultCalendar(api: TestApi, w: World, send?: Caller): Promise<string> {
  const req: Caller = send ?? ((m, u, o) => call(api.app, m, u, o));
  const existing = await api.db
    .selectFrom("business_calendar")
    .select("id")
    .where("organization_id", "=", w.orgA.id)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (existing) return existing.id;
  const admin = await signIn(api.app, w.admin.subject);
  const res = await req("POST", `/api/v1/organizations/${w.orgA.id}/calendars`, {
    session: admin,
    body: { code: uniq("CAL"), nameEn: "Synthetic calendar", nameAr: "تقويم اصطناعي", isDefault: true },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { id: string }).id;
}

/** Adds a one-day holiday to a calendar through the API (ADM_TECH). Synthetic, not a real holiday. */
export async function addHoliday(api: TestApi, w: World, calendarId: string, date: string): Promise<void> {
  const admin = await signIn(api.app, w.admin.subject);
  const res = await call(api.app, "POST", `/api/v1/calendars/${calendarId}/holidays`, {
    session: admin,
    body: { dateFrom: date, dateTo: date, nameEn: "Synthetic holiday", nameAr: "عطلة اصطناعية" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}
