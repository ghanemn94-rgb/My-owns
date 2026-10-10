// My Work = the personal work dashboard (T-DG4-KBE-G2; ADR-0037 §2, §7, §10; D-106 (c): one read model and one
// operation; REQ-S03-008, REQ-S13-001 "personal work"; M0100):
//   GET /me/work[?section=&cursor=&limit=]   any signed-in user; the caller's OWN items only
// Without `section`: the first page of every section with its total count, and `upcomingDeadlines`. With `section`:
// that section paged (cursor). Only the caller's own items appear: work items assigned to the caller, drafts the caller
// authored (`my_work_draft`, 0056), action items the caller owns. Items of transformations the caller can no longer
// read are left out. Every item carries `href` (the work item's stored `link_path`, else the record's API path), its
// due date and `overdue` (due date before the business date in the organization's default calendar timezone,
// Asia/Riyadh unless configured).
//
// The section of a work item is decided by its kind through MY_WORK_SECTION_BY_KIND below (ADR-0037 §7, alternative 4:
// a code map plus a completeness test that reads every `work_item_kind` row of a migrated database, so a later kind
// cannot fall silently into "Other" without a decision). Work items follow their source's due date and owner through
// the tasks services (T-DG4-BE-R1); this read takes the stored rows as they are and re-derives nothing.
//
// A read model: computed in the request's READ ONLY transaction; nothing is stored. Nothing here is a G1-G6 business
// approval, and nothing touches DG0-DG7.
import { sql, type DbOrTx } from "@mth/db";
import { MY_WORK_SECTIONS, type MyWork, type MyWorkItem, type MyWorkSection } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { organizationsWith, principalOf, scopeFilter, type Principal } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  limitSchema,
  paginate,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";
import { loadDefaultWorkingCalendar } from "../portfolio/index.ts";
import { loadOpenWorkItems, type OpenWorkItemFact } from "../tasks/index.ts";
import { dueSoonHorizon } from "./dashboards/areas.ts";
import { readOnly, T_PATH } from "./dashboards/engine.ts";
import { businessClockOf } from "./dashboards/filters.ts";
import { loadDashboardPolicy } from "./dashboards/rag-policy.ts";

export const MY_WORK = "/api/v1/me/work";

/**
 * The section of every work-item kind (ADR-0037 §7; the 30 kinds of migrations 0028-0058). The completeness test
 * (`test/integration/reporting/my-work.test.ts`) fails when a `work_item_kind` row is missing here. A kind that is not
 * in the map is still shown, under "other" (sectionOfKind), so no item is ever hidden.
 */
export const MY_WORK_SECTION_BY_KIND: Readonly<Record<string, Exclude<MyWorkSection, "drafts">>> = Object.freeze({
  // Assigned actions
  meeting_action_due: "assigned_actions",
  raid_action_due: "assigned_actions",
  corrective_case_follow_up: "assigned_actions",
  adoption_intervention_due: "assigned_actions",
  gate_condition_due: "assigned_actions",
  phase_step_enabled: "assigned_actions",
  scale_scope_enabled: "assigned_actions",
  assessment_invitation: "assigned_actions",
  approval_changes_requested: "assigned_actions",
  // Reviews
  kpi_actual_review: "reviews",
  finance_validation_review: "reviews",
  assessment_to_review: "reviews",
  phase_step_review: "reviews",
  benefit_overlap_review: "reviews",
  // Approvals (business approvals inside the product; never DG0-DG7)
  approval_decision: "approvals",
  approval_escalated: "approvals",
  gate_decision_due: "approvals",
  gate_exception_to_decide: "approvals",
  executive_decision_due: "approvals",
  executive_decision_escalated: "approvals",
  bau_handover_to_accept: "approvals",
  minutes_to_approve: "approvals",
  // Missing updates
  kpi_update_due: "missing_updates",
  kpi_actual_rejected: "missing_updates",
  benefit_monitoring_due: "missing_updates",
  performance_review_due: "missing_updates",
  control_check_due: "missing_updates",
  // Other
  approval_outcome: "other",
  approval_overdue: "other",
  gate_exception_expired: "other",
});

/** The section of a kind; an unmapped kind falls into "other" (and fails the completeness test). */
export function sectionOfKind(kind: string): Exclude<MyWorkSection, "drafts"> {
  return new Map(Object.entries(MY_WORK_SECTION_BY_KIND)).get(kind) ?? "other";
}

/** The API path of a draft record of `my_work_draft` (the 18 types of 0056). */
export function draftHref(d: {
  recordType: string;
  recordId: string;
  transformationId: string | null;
  parentId: string | null;
}): string {
  const t = d.transformationId === null ? null : T_PATH(d.transformationId);
  switch (d.recordType) {
    case "business_case":
      return `/api/v1/business-cases/${d.recordId}`;
    case "initiative":
      return `/api/v1/initiatives/${d.recordId}`;
    default:
      break;
  }
  if (t === null) return `/api/v1/me/work?section=drafts`;
  switch (d.recordType) {
    case "agenda_item":
      return `${t}/meetings/${d.parentId ?? ""}/agenda-items/${d.recordId}`;
    case "meeting_minutes":
      return `${t}/meetings/${d.parentId ?? ""}/minutes`;
    case "assessment_form":
      return `${t}/assessment-forms/${d.recordId}`;
    case "bau_handover":
      return `${t}/bau-handovers/${d.recordId}`;
    case "benefit_measurement":
      return `${t}/benefit-measurements/${d.recordId}`;
    case "change_request":
      return `${t}/change-requests/${d.recordId}`;
    case "diagnostic_finding":
      return `${t}/diagnostic-findings/${d.recordId}`;
    case "journey":
      return `${t}/journeys/${d.recordId}`;
    case "kpi_actual":
      return `${t}/kpi-actuals/${d.recordId}`;
    case "kpi_definition":
      return `${t}/kpi-definitions/${d.recordId}`;
    case "kpi_version":
      return `${t}/kpi-versions/${d.recordId}`;
    case "lesson":
      return `${t}/lessons/${d.recordId}`;
    case "outcome":
      return `${t}/outcomes/${d.recordId}`;
    case "target_trajectory":
      return `${t}/target-trajectories/${d.recordId}`;
    case "tom_canvas_cell":
      return `${t}/tom-canvas`;
    case "transition_decision":
      return `${t}/transition-decisions/${d.recordId}`;
    default:
      return t;
  }
}

/** The transformations the principal may read, across its organizations (the access module's scoped policy). */
export async function readableTransformationIds(db: DbOrTx, principal: Principal): Promise<Set<string>> {
  if (organizationsWith(principal, "transformation.read").length === 0) return new Set();
  const rows = await db
    .selectFrom("transformation as t")
    .select("t.id")
    .where(
      scopeFilter(principal, "transformation.read", {
        level: "transformation",
        organizationId: sql.ref("t.organization_id"),
        businessUnitId: sql.ref("t.business_unit_id"),
        transformationId: sql.ref("t.id"),
      }),
    )
    .execute();
  return new Set(rows.map((r) => r.id));
}

/** A work item as a My Work item (href = its stored link_path). */
export function workItemOf(w: OpenWorkItemFact, businessDate: string): MyWorkItem {
  return {
    section: sectionOfKind(w.kind),
    source: "work_item",
    recordType: w.subjectType,
    recordId: w.subjectId,
    kind: w.kind,
    code: w.periodLabel,
    label: null,
    messageKey: w.messageKey,
    messageParams: w.messageParams,
    transformationId: w.transformationId,
    href: w.linkPath,
    dueDate: w.dueDate,
    overdue: w.dueDate !== null && w.dueDate < businessDate,
  };
}

/** Whether the caller may still see an item of `transformationId` (null: an organization-level item of its own org). */
function visible(
  transformationId: string | null,
  organizationId: string,
  readable: ReadonlySet<string>,
  orgs: ReadonlySet<string>,
) {
  return transformationId === null ? orgs.has(organizationId) : readable.has(transformationId);
}

const DUE_KEY = (i: MyWorkItem) => i.dueDate ?? "9999-12-31";
/** Order inside a section: by due date (none last), then source, record id (deterministic; the cursor key). */
const keyOf = (i: MyWorkItem): [string, string, string] => [DUE_KEY(i), i.source, i.recordId];
const compareKeys = (a: readonly string[], b: readonly string[]) => {
  const bs = b.values();
  for (const x of a) {
    const y = bs.next().value ?? "";
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

export interface MyWorkFacts {
  readonly businessDate: string;
  readonly horizonWorkingDays: number;
  readonly horizonDate: string | null;
  readonly items: readonly MyWorkItem[];
}

/** Loads every own item of the caller (all six sections), each visible and in its section. */
export async function loadMyWork(db: DbOrTx, principal: Principal): Promise<MyWorkFacts> {
  const userId = principal.userId;
  const organizationId = principal.organizationId;
  if (userId === null || organizationId === null) throw problems.unauthenticated();
  const clock = await businessClockOf(db, organizationId);
  const policy = await loadDashboardPolicy(db, organizationId);
  const calendar = await loadDefaultWorkingCalendar(db, organizationId);
  const horizonWorkingDays = policy.values.deadlineHorizonWorkingDays;
  const readable = await readableTransformationIds(db, principal);
  const orgs = new Set(organizationsWith(principal, "organization.read"));

  const workItems = (await loadOpenWorkItems(db, userId)).filter((w) =>
    visible(w.transformationId, w.organizationId, readable, orgs),
  );
  const items: MyWorkItem[] = workItems.map((w) => workItemOf(w, clock.date));

  // Action items the caller owns that no open work item of the caller names as its subject (listed once).
  const named = new Set(workItems.filter((w) => w.subjectType === "action_item").map((w) => w.subjectId));
  const actions = await db
    .selectFrom("action_item")
    .select(["id", "organization_id", "transformation_id", "title", "due_date"])
    .where("owner_user_id", "=", userId)
    .where("status", "in", ["open", "in_progress"])
    .execute();
  for (const a of actions) {
    if (named.has(a.id) || !visible(a.transformation_id, a.organization_id, readable, orgs)) continue;
    items.push({
      section: "assigned_actions",
      source: "action_item",
      recordType: "action_item",
      recordId: a.id,
      kind: null,
      code: null,
      label: a.title,
      messageKey: null,
      messageParams: null,
      transformationId: a.transformation_id,
      href: `${T_PATH(a.transformation_id)}/actions/${a.id}`,
      dueDate: a.due_date,
      overdue: a.due_date !== null && a.due_date < clock.date,
    });
  }

  // Drafts the caller authored (my_work_draft, 0056: the 18 draft types).
  const drafts = await db
    .selectFrom("my_work_draft")
    .select(["organization_id", "transformation_id", "record_type", "record_id", "code", "label", "parent_id"])
    .where("created_by", "=", userId)
    .execute();
  for (const d of drafts) {
    if (d.record_id === null || d.record_type === null || d.organization_id === null) continue;
    if (!visible(d.transformation_id, d.organization_id, readable, orgs)) continue;
    items.push({
      section: "drafts",
      source: "draft",
      recordType: d.record_type,
      recordId: d.record_id,
      kind: null,
      code: d.code,
      label: d.label,
      messageKey: null,
      messageParams: null,
      transformationId: d.transformation_id,
      href: draftHref({
        recordType: d.record_type,
        recordId: d.record_id,
        transformationId: d.transformation_id,
        parentId: d.parent_id,
      }),
      dueDate: null,
      overdue: false,
    });
  }
  items.sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
  return {
    businessDate: clock.date,
    horizonWorkingDays,
    horizonDate: dueSoonHorizon(clock.date, horizonWorkingDays, calendar),
    items,
  };
}

/**
 * Upcoming deadlines (ADR-0037 §7): every open item of the five non-draft sections due on or before the business date
 * plus the horizon in working days (overdue ones included and flagged), by due date. Without a configured business
 * calendar the horizon is Unknown, and only the items due on or before the business date are listed.
 */
export function upcomingDeadlines(f: MyWorkFacts): MyWorkItem[] {
  const until = f.horizonDate ?? f.businessDate;
  return f.items.filter((i) => i.section !== "drafts" && i.dueDate !== null && i.dueDate <= until);
}

const myWorkQuery = z.strictObject({
  section: z.enum(MY_WORK_SECTIONS).optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerMyWorkRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(MY_WORK, { config: { access: { permission: "authenticated" } } }, async (request): Promise<MyWork> => {
    const principal = principalOf(request);
    if (principal.userId === null) throw problems.unauthenticated();
    const query = parseQuery(myWorkQuery, request.query);
    // A cursor pages ONE section: each section's nextCursor is bound to that section (and the caller), so it is
    // used with `section` (a cursor without `section`, or of another section or user, is 400 validation.cursor).
    const hashOf = (section: MyWorkSection) => filterHash({ section, userId: principal.userId });
    if (query.cursor !== undefined && query.section === undefined)
      throw problems.badRequest(
        "validation.cursor",
        "The cursor is invalid or belongs to other filters.",
        "/query/cursor",
      );
    const after = query.section === undefined ? null : decodeCursor(query.cursor, hashOf(query.section), 3);
    return readOnly(db, async (tx) => {
      const f = await loadMyWork(tx, principal);
      const sections = (query.section === undefined ? MY_WORK_SECTIONS : [query.section]).map((section) => {
        const all = f.items.filter((i) => i.section === section);
        const rest = after === null ? all : all.filter((i) => compareKeys(keyOf(i), after.map(String)) > 0);
        const page = paginate(rest, query.limit, keyOf, hashOf(section));
        return { section, total: all.length, items: page.items, nextCursor: page.nextCursor };
      });
      const now = await sql<{ now: Date }>`SELECT now() AS now`.execute(tx);
      return {
        userId: principal.userId!,
        generatedAt: now.rows[0]!.now.toISOString(),
        businessDate: f.businessDate,
        horizonWorkingDays: f.horizonWorkingDays,
        sections,
        upcomingDeadlines: upcomingDeadlines(f),
      };
    });
  });
  return [`GET ${MY_WORK}`];
}
