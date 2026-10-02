// Fixtures for the kpi integration tests and the kpi contract exercises (kpi-benefits-engineer). All data is
// SYNTHETIC. A transformation in org A / BU a1 with one user per P2 role granted at TRANSFORMATION scope, plus the
// outcome rows that T02 references (outcomes are routed by backend-workflow-engineer; the fixture writes them directly
// with their audit event, as the p2_audit_required guard demands).
import { insertAuditEvent, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import {
  createTransformationRow,
  createUser,
  grant,
  signIn,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

export interface KpiWorld {
  readonly transformationId: string;
  readonly outcomeId: string;
  readonly archivedOutcomeId: string;
  readonly users: Readonly<Record<KpiActor, { id: string; subject: string }>>;
  readonly s: Readonly<Record<KpiActor, Session>>;
  readonly base: string;
}

/** tl: TL; kds: KDS; fin: FIN; finKds: FIN + KDS and finTl: FIN + TL (separation-of-duties probes); sp: SP; bo: BO;
 *  to: TO (org, from
 *  seedWorld); auditor: AUD (org, from seedWorld); outsider: TO of org B; nobody: no grant. */
export type KpiActor =
  | "tl"
  | "kds"
  | "fin"
  | "finKds"
  | "finTl"
  | "sp"
  | "bo"
  | "to"
  | "auditor"
  | "outsider"
  | "nobody";

export async function createOutcomeRow(
  db: Db,
  transformationId: string,
  organizationId: string,
  createdBy: string,
  opts: { archived?: boolean } = {},
): Promise<string> {
  const id = uuidv7();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("outcome")
      .values({
        id,
        organization_id: organizationId,
        transformation_id: transformationId,
        statement: `Synthetic outcome ${id.slice(-6)}`,
        created_by: createdBy,
        updated_by: createdBy,
        ...(opts.archived
          ? { status: "archived", archived_at: new Date(), archived_by: createdBy, archive_reason: "fixture" }
          : {}),
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: createdBy, requestId: `fixture-${id}`, source: "api" },
      {
        action: "outcome.create",
        recordType: "outcome",
        recordId: id,
        organizationId,
        transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

export async function seedKpiWorld(api: TestApi, w: World): Promise<KpiWorld> {
  const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const scope = { type: "transformation" as const, id: transformationId };
  const mk = async (...roles: string[]) => {
    const u = await createUser(api.db, w.orgA.id);
    for (const role of roles) await grant(api.db, w.grantor.id, u.id, role, scope, w.orgA.id);
    return u;
  };
  const users = {
    tl: await mk("TL"),
    kds: await mk("KDS"),
    fin: await mk("FIN"),
    finKds: await mk("FIN", "KDS"),
    finTl: await mk("FIN", "TL"),
    sp: await mk("SP"),
    bo: await mk("BO"),
    to: w.office,
    auditor: w.auditor,
    outsider: w.officeB,
    nobody: w.nobody,
  };
  const s = Object.fromEntries(
    await Promise.all(Object.entries(users).map(async ([k, u]) => [k, await signIn(api.app, u.subject)] as const)),
  ) as Record<KpiActor, Session>;
  const outcomeId = await createOutcomeRow(api.db, transformationId, w.orgA.id, users.tl.id);
  const archivedOutcomeId = await createOutcomeRow(api.db, transformationId, w.orgA.id, users.tl.id, {
    archived: true,
  });
  return {
    transformationId,
    outcomeId,
    archivedOutcomeId,
    users,
    s,
    base: `/api/v1/transformations/${transformationId}`,
  };
}

export const ifMatch = (version: number) => ({ "if-match": `"${version}"` });
