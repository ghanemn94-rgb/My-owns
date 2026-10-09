// Test fixture of slice C (T-DG4-BE-B; ADR-0026 §2-§4): a P2 world (setupP2World: TL lead, SP sponsor at the
// transformation, TO office, WL contributor, AUD auditor) plus two Business Owners and a Finance user at the
// transformation, the P4 starter structure (the four T11 rows; idempotent, so it also holds once BE-C switches
// POST /transformations to p4_instantiate_transformation), a default business calendar for the organization, the BO and
// SP parties mapped to named people, and a design decision as the subject of `decision_request` approvals.
// All data is SYNTHETIC. The approvals decided in tests are demo BUSINESS approvals on synthetic records; they approve
// nothing real and have nothing to do with the engineering gates DG0-DG7.
import { insertAuditEvent, sql } from "@mth/db";
import { expect } from "vitest";
import {
  call,
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
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";

export type Caller = (method: string, url: string, opts?: RequestOptions) => Promise<Res>;

export interface Person {
  readonly id: string;
  readonly session: Session;
}

export interface ApprovalWorld extends P2World {
  readonly bo: Person;
  readonly bo2: Person;
  readonly fin: Person;
  /** transformation_decision_right ids by template key (business_scope_change, target_state_design, ...). */
  readonly rights: Readonly<Record<string, string>>;
  /** A design decision (subject of decision_request approvals), at version 1. */
  readonly decisionId: string;
}

/** A new BUSINESS role holder at the transformation, signed in. */
export async function person(api: TestApi, w: World, transformationId: string, role: string): Promise<Person> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: transformationId }, w.orgA.id);
  return { id: u.id, session: await signIn(api.app, u.subject) };
}

/** Makes sure orgA has an active default calendar (ADM_TECH through the API; at most one per organization). */
export async function ensureDefaultCalendar(api: TestApi, w: World, send: Caller): Promise<void> {
  const existing = await api.db
    .selectFrom("business_calendar")
    .select("id")
    .where("organization_id", "=", w.orgA.id)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (existing) return;
  const admin = await signIn(api.app, w.admin.subject);
  const res = await send("POST", `/api/v1/organizations/${w.orgA.id}/calendars`, {
    session: admin,
    body: { code: uniq("CAL"), nameEn: "Synthetic calendar", nameAr: "تقويم اصطناعي", isDefault: true },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

/** Creates a design decision through the API (TL), version 1. */
export async function newDecision(send: Caller, p: P2World, title = "Synthetic decision to approve"): Promise<string> {
  const res = await send("POST", "/api/v1/decisions", {
    session: p.lead.session,
    body: { transformationId: p.transformationId, title },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { id: string }).id;
}

/** Bumps a decision's version through the API (TL edits its title). Returns the new version. */
export async function editDecision(send: Caller, p: P2World, decisionId: string, version: number): Promise<number> {
  const res = await send("PATCH", `/api/v1/decisions/${decisionId}`, {
    session: p.lead.session,
    headers: ifm(version),
    body: { title: `Synthetic decision, edited ${uniq("E")}` },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { version: number }).version;
}

/** Maps a party to a person through the API (TL holds role_mapping.assign at its transformation). */
export async function mapParty(send: Caller, p: P2World, partyCode: string, userId: string): Promise<string> {
  const res = await send("POST", `/api/v1/transformations/${p.transformationId}/role-mappings`, {
    session: p.lead.session,
    body: { partyCode, targetKind: "user", userId },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { id: string }).id;
}

export async function setupApprovalWorld(api: TestApi, w: World, sender?: Caller): Promise<ApprovalWorld> {
  const send: Caller = sender ?? ((m, u, o) => call(api.app, m, u, o));
  const p = await setupP2World(api, w, send);
  await sql`SELECT p4_instantiate_transformation(${p.transformationId}::uuid, ${p.lead.id}::uuid, 'test:approval-world', 'api')`.execute(
    api.db,
  );
  await ensureDefaultCalendar(api, w, send);
  const bo = await person(api, w, p.transformationId, "BO");
  const bo2 = await person(api, w, p.transformationId, "BO");
  const fin = await person(api, w, p.transformationId, "FIN");
  const rows = await api.db
    .selectFrom("transformation_decision_right")
    .select(["id", "template_key"])
    .where("transformation_id", "=", p.transformationId)
    .execute();
  const rights = Object.fromEntries(rows.filter((r) => r.template_key !== null).map((r) => [r.template_key!, r.id]));
  expect(Object.keys(rights).sort()).toEqual([
    "business_scope_change",
    "funding_reallocation",
    "go_live_scale",
    "target_state_design",
  ]);
  await mapParty(send, p, "BO", bo.id);
  await mapParty(send, p, "SP", p.sponsor.id);
  const decisionId = await newDecision(send, p);
  return { ...p, bo, bo2, fin, rights, decisionId };
}

/** The approval request body of a decision_request on a decision. */
export const requestBody = (decisionId: string, decisionRightId: string, subjectVersion = 1, extra = {}) => ({
  approvalType: "decision_request",
  subjectId: decisionId,
  subjectVersion,
  decisionRightId,
  title: "Synthetic decision for a business approval",
  ...extra,
});

/**
 * Moves an approval's due date into the past, as if the calendar had moved on (test-only; synthetic). Written like an
 * API change: version + 1 with its audit event in the same transaction (the 0031 audit-required guard).
 */
export async function makeOverdue(api: TestApi, approvalId: string, dueDate = "2026-01-04"): Promise<void> {
  await api.db.transaction().execute(async (tx) => {
    const a = await tx
      .selectFrom("approval")
      .select(["version", "organization_id", "transformation_id", "due_date"])
      .where("id", "=", approvalId)
      .executeTakeFirstOrThrow();
    await tx
      .updateTable("approval")
      .set({ due_date: dueDate, due_unknown_reason: null, version: sql<number>`version + 1` })
      .where("id", "=", approvalId)
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "system", actorUserId: null, requestId: "test:make-overdue", source: "api" },
      {
        action: "approval.test_clock",
        recordType: "approval",
        recordId: approvalId,
        organizationId: a.organization_id,
        transformationId: a.transformation_id,
        priorVersion: a.version,
        newVersion: a.version + 1,
        reason: "Synthetic test: the due date is moved into the past",
        changes: { due_date: { from: a.due_date, to: dueDate } },
      },
    );
  });
}
