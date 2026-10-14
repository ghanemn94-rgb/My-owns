// My procedures (OpenAPI `listMyProcedureSteps`, GET /me/procedure-steps; ADR-0042 §3, §9; REQ-S06-002 "Playbook and
// Procedures > My procedures"; p5-work-split §C.2; T-DG5-BE-F2): the ACTIVE steps of active instances assigned to the
// caller, or unassigned steps of a role the caller holds in the instance's scope, ordered by due date with Unknown
// (no business calendar) last, then by activation. Read-only (procedure.read); nothing here completes or approves.
import { sql } from "@mth/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { principalOf } from "../access/index.ts";
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
import { businessToday, holdsRoleIn, inputsOf, instanceTarget, loadBundle, presentStep } from "./steps.ts";

const query = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
const PATH = "/api/v1/me/procedure-steps";

/** The sort key of a step: its due date ('9999-12-31' stands for Unknown, so Unknown sorts last), then its id. */
const sortKey = (due: string | null, id: string): [string, string] => [due ?? "9999-12-31", id];

async function listMine(db: ModuleDeps["db"], request: FastifyRequest) {
  const q = parseQuery(query, request.query);
  const principal = principalOf(request);
  principal.tracker.decisions += 1;
  if (principal.userId === null || !principal.grants.some((g) => g.permissions.has("procedure.read")))
    throw problems.forbidden();
  const me = principal.userId;
  const roles = [...new Set(principal.grants.map((g) => g.roleCode))];
  const hash = filterHash({ me });
  const after = decodeCursor(q.cursor, hash, 2);
  const candidates = await db
    .selectFrom("procedure_step_instance as s")
    .innerJoin("procedure_instance as pi", "pi.id", "s.procedure_instance_id")
    .selectAll("s")
    .where("s.status", "=", "active")
    .where("pi.status", "=", "active")
    .where((eb) =>
      eb.or([
        eb("s.assignee_user_id", "=", me),
        roles.length === 0
          ? sql<boolean>`false`
          : eb.and([eb("s.assignee_user_id", "is", null), eb("s.assignee_role_code", "in", roles)]),
      ]),
    )
    .execute();
  // Role-holder rows are kept only where the role applies in the instance's scope (the policy, not the role name).
  const mine = [];
  for (const s of candidates) {
    if (s.assignee_user_id === me) {
      mine.push(s);
      continue;
    }
    const target = await instanceTarget(db, s);
    if (holdsRoleIn(principal.grants, s.assignee_role_code, "procedure.act", target)) mine.push(s);
  }
  const ordered = mine
    .map((s) => ({ s, key: sortKey(s.due_date, s.id) }))
    .sort((a, b) => (a.key.join("|") < b.key.join("|") ? -1 : a.key.join("|") > b.key.join("|") ? 1 : 0))
    .filter(({ key }) => after === null || key.join("|") > `${String(after.at(0))}|${String(after.at(1))}`);
  const page = paginate(ordered.slice(0, q.limit + 1), q.limit, ({ key }) => key, hash);
  const items = [];
  for (const { s } of page.items) {
    const i = await db
      .selectFrom("procedure_instance")
      .selectAll()
      .where("id", "=", s.procedure_instance_id)
      .executeTakeFirstOrThrow();
    const b = await loadBundle(db, i);
    const today = await businessToday(db, i.organization_id);
    items.push({
      instanceId: i.id,
      transformationId: i.transformation_id,
      procedureCode: i.procedure_code,
      procedureNameEn: b.definition.name_en,
      procedureNameAr: b.definition.name_ar,
      step: presentStep(b, b.steps.find((x) => x.id === s.id) ?? s, today, inputsOf(i)),
    });
  }
  return { items, nextCursor: page.nextCursor };
}

export function registerMyProcedureStepRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(PATH, { config: { access: { permission: "procedure.read" } } }, async (request) => listMine(db, request));
  return [`GET ${PATH}`];
}
