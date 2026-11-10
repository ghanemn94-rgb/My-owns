// Fixtures of the search query tests (T-DG6-BE-P2; ADR-0057 §3): a scratch database of the run's disposable cluster
// (the index state is global, so the tests that set it to `reindexing` or `failed` never share a database with other
// suites), and one record of EACH of the 12 indexed types in a transformation, written through the record type's own
// create route where the fixture world can reach it, otherwise directly with its audit event (the P2 audit guard's
// pattern, as T-DG6-BE-B and T-DG6-BE-P do). The index is built by the REAL worker job (`runReindex`, T-DG6-BE-P)
// under its own service identity. Every value is SYNTHETIC; nothing here grants a business approval or touches DG0-DG7.
import { insertAuditEvent, migrate, sql, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { expect, inject } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { loadServiceIdentity, principalOfIdentity, type JobRunContext } from "../../../../worker/src/kit.ts";
import { runIndexFeed, runReindex, type SearchRunResult } from "../../../../worker/src/handlers/search.ts";
import type { SearchRecordType } from "../../../src/modules/search/query.ts";
import { insertDeliverable, insertInitiative, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export interface SearchDb {
  readonly api: TestApi;
  /** The scratch database (for a second API instance with other settings). */
  readonly database: string;
  readonly db: Db;
  /** Rebuilds the documents of every type (the weekly job, run on demand). */
  reindex(types?: readonly SearchRecordType[]): Promise<void>;
  /** One run of the incremental feed job. */
  feed(): Promise<void>;
  close(): Promise<void>;
}

/** A migrated scratch database with the API started on it, and the two search jobs under their identities. */
export async function startSearchDb(name: string, env: Record<string, string> = {}): Promise<SearchDb> {
  const { adminUrl } = inject("mthDb");
  const scratch = await createScratchDatabase(adminUrl, name);
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  const api = await startApi({ database: scratch, env });
  const contextOf = async (code: string): Promise<JobRunContext> => {
    const identity = await loadServiceIdentity(api.db, code);
    return { identity, principal: (organizationId) => principalOfIdentity(identity, organizationId) };
  };
  const feedRun = await contextOf("job:search.index_feed");
  const reindexRun = await contextOf("job:search.reindex");
  // A failed type throws (runIndexFeed/runReindex rethrow the first failure); "skipped_reindexing" is not expected here.
  const check = (r: SearchRunResult) =>
    expect(r.types.filter((t) => t.outcome !== "indexed").map((t) => `${t.recordType}:${t.outcome}`)).toEqual([]);
  return {
    api,
    database: scratch,
    db: api.db,
    async reindex(types) {
      check(await runReindex(api.db, reindexRun, types ? { recordTypes: types } : {}));
    },
    async feed() {
      check(await runIndexFeed(api.db, feedRun));
    },
    async close() {
      await api.close();
      await dropScratchDatabase(adminUrl, scratch);
    },
  };
}

export interface FixtureRecord {
  readonly type: SearchRecordType;
  readonly id: string;
  readonly transformationId: string;
  /** The record's own view: its GET (200 = readable), or for a lesson its transformation's lesson list. */
  readonly viewUrl: string;
  /** For a lesson: the view is a list, readable iff it contains the id. */
  readonly viewIsList: boolean;
  /** The words of its title (a query that matches it in the `simple` configuration). */
  readonly title: string;
}

const ok = (res: { status: number; body: Body }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 600)}`).toBe(status);
  return res.body;
};

let seq = 0;

/**
 * A transformation (named with `word`) with one record of each of the other 11 types, each titled with `word`.
 * Returns its benefit world (TL, BO, FIN of the transformation) and the 12 records.
 */
export async function seedTwelve(
  api: TestApi,
  w: World,
  word: string,
  at?: { readonly organizationId: string; readonly businessUnitId: string },
): Promise<{ b: BenefitWorld; records: FixtureRecord[] }> {
  seq += 1;
  const b = at === undefined ? await seedBenefitWorld(api, w) : await benefitWorldAt(api, w, at);
  const T = b.transformationId;
  const base = b.base;
  const tl = b.s.tl;
  const tlId = b.users.tl.id;
  const records: FixtureRecord[] = [];
  const push = (type: SearchRecordType, id: string, viewUrl: string, title: string, viewIsList = false) =>
    records.push({ type, id, transformationId: T, viewUrl, viewIsList, title });
  // transformation: rename the fixture transformation, with its audit event.
  const tName = `Synthetic ${word} transformation ${seq}`;
  await api.db.transaction().execute(async (tx) => {
    const row = await tx
      .updateTable("transformation")
      .set({ name: tName, version: sql<number>`version + 1` })
      .where("id", "=", T)
      .returning(["version", "organization_id"])
      .executeTakeFirstOrThrow();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: tlId, requestId: `search-fixture-${T}`, source: "api" },
      {
        action: "transformation.update",
        recordType: "transformation",
        recordId: T,
        organizationId: row.organization_id,
        transformationId: T,
        priorVersion: row.version - 1,
        newVersion: row.version,
      },
    );
  });
  push("transformation", T, `/api/v1/transformations/${T}`, tName);

  // initiative and deliverable: written directly with their audit events (benefits/fixtures.ts), then titled.
  const initiativeId = await insertInitiative(api.db, b);
  const iName = `Synthetic ${word} initiative ${seq}`;
  await retitle(api.db, "initiative", "name", initiativeId, iName, tlId, b);
  push("initiative", initiativeId, `/api/v1/initiatives/${initiativeId}`, iName);
  const deliverableId = await insertDeliverable(api.db, b, initiativeId);
  const dName = `Synthetic ${word} deliverable ${seq}`;
  await retitle(api.db, "deliverable", "title", deliverableId, dName, tlId, b);
  push("deliverable", deliverableId, `/api/v1/deliverables/${deliverableId}`, dName);

  // kpi_definition (the benefit world's KPI), retitled.
  const kName = `Synthetic ${word} KPI ${seq}`;
  await retitle(api.db, "kpi_definition", "name", b.kpiDefinitionId, kName, tlId, b);
  push("kpi_definition", b.kpiDefinitionId, `${base}/kpi-definitions/${b.kpiDefinitionId}`, kName);

  // benefit, evidence, business case: their create routes (bodies as in T-DG6-BE-B's parity fixture).
  const bTitle = `Synthetic ${word} benefit ${seq}`;
  const benefit = ok(
    await call<Body>(api.app, "POST", `${base}/benefits`, {
      session: b.s.bo,
      body: {
        title: bTitle,
        description: "Synthetic.",
        benefitType: "revenue",
        valueClass: "revenue_uplift",
        ownerUserId: b.users.bo.id,
        currency: "SAR",
        financialStatementLine: "Revenue - prepaid",
      },
    }),
    201,
    "createBenefit",
  );
  push("benefit", benefit.id, `${base}/benefits/${benefit.id}`, bTitle);
  const eTitle = `Synthetic ${word} evidence ${seq}`;
  const evidence = ok(
    await call<Body>(api.app, "POST", `${base}/evidence`, {
      session: tl,
      body: { kind: "note", title: eTitle, noteBody: "Synthetic", ownerUserId: tlId },
    }),
    201,
    "createEvidence",
  );
  push("evidence", evidence.id, `${base}/evidence/${evidence.id}`, eTitle);
  const cTitle = `Synthetic ${word} business case ${seq}`;
  const bc = ok(
    await call<Body>(api.app, "POST", "/api/v1/business-cases", {
      session: tl,
      body: { transformationId: T, level: "transformation", title: cTitle },
    }),
    201,
    "createBusinessCase",
  );
  push("business_case", bc.id, `/api/v1/business-cases/${bc.id}`, cTitle);

  // raid_entry, decision, dependency: their create routes.
  const rText = `Synthetic ${word} risk ${seq}`;
  const raid = ok(
    await call<Body>(api.app, "POST", `${base}/raid`, {
      session: tl,
      body: { type: "risk", description: rText, impact: "medium", probability: "low", ownerUserId: tlId },
    }),
    201,
    "createRaidEntry",
  );
  push("raid_entry", raid.id, `${base}/raid/${raid.id}`, rText);
  const decTitle = `Synthetic ${word} decision ${seq}`;
  const decision = ok(
    await call<Body>(api.app, "POST", "/api/v1/decisions", {
      session: tl,
      body: { transformationId: T, title: decTitle },
    }),
    201,
    "createDecision",
  );
  push("decision", decision.id, `/api/v1/decisions/${decision.id}`, decTitle);
  const depText = `Synthetic ${word} vendor dependency ${seq}`;
  const dependency = ok(
    await call<Body>(api.app, "POST", "/api/v1/dependencies", {
      session: tl,
      body: {
        transformationId: T,
        description: depText,
        from: { kind: "external", label: "Synthetic vendor" },
        toInitiativeId: initiativeId,
        dependencyType: "vendor",
      },
    }),
    201,
    "createDependency",
  );
  push("dependency", dependency.id, `/api/v1/dependencies/${dependency.id}`, depText);

  // lesson and change request: written directly with their audit events (the T-DG6-BE-P pattern).
  const lTitle = `Synthetic ${word} lesson ${seq}`;
  const lessonId = await insertWithAudit(api.db, "lesson", b, tlId, {
    code: `LL-${String(8000 + seq)}`,
    title: lTitle,
    context: "Synthetic context",
    lesson_text: "Synthetic lesson text (illustrative, not Mobily data).",
  });
  push("lesson", lessonId, `${base}/lessons?limit=100`, lTitle, true);
  const crText = `Synthetic ${word} change request ${seq}`;
  const subject = await api.db
    .selectFrom("initiative")
    .select(["id", "version"])
    .where("id", "=", initiativeId)
    .executeTakeFirstOrThrow();
  const crId = await insertWithAudit(api.db, "change_request", b, tlId, {
    code: `CR-${String(8000 + seq)}`,
    change_kind: "business_scope",
    subject_type: "initiative",
    subject_id: subject.id,
    subject_version: subject.version,
    proposed_change: JSON.stringify({ scope: "Synthetic scope change" }),
    reason: crText,
    raised_by: tlId,
  });
  push("change_request", crId, `${base}/change-requests/${crId}`, crText);
  expect(new Set(records.map((r) => r.type)).size).toBe(12);
  return { b, records };
}

/**
 * The benefit world of benefits/fixtures.ts (TL, BO, a second BO and FIN at the transformation, an agreed KPI) for a
 * transformation in a chosen organization and business unit (seedBenefitWorld always uses organization A, unit a1).
 */
async function benefitWorldAt(
  api: TestApi,
  w: World,
  at: { readonly organizationId: string; readonly businessUnitId: string },
): Promise<BenefitWorld> {
  const { organizationId, businessUnitId } = at;
  const transformationId = await createTransformationRow(api.db, organizationId, businessUnitId, w.grantor.id);
  const scope = { type: "transformation" as const, id: transformationId };
  const mk = async (role: string) => {
    const u = await createUser(api.db, organizationId);
    await grant(api.db, w.grantor.id, u.id, role, scope, organizationId);
    return u;
  };
  const users = {
    tl: await mk("TL"),
    bo: await mk("BO"),
    bo2: await mk("BO"),
    fin: await mk("FIN"),
    auditor: w.auditor,
    admin: w.admin,
    outsider: organizationId === w.orgB.id ? w.office : w.officeB,
  };
  const sessions = Object.fromEntries(
    await Promise.all(Object.entries(users).map(async ([k, u]) => [k, await signIn(api.app, u.subject)] as const)),
  ) as Record<keyof typeof users, Session>;
  const base = `/api/v1/transformations/${transformationId}`;
  const kpi = ok(
    await call<Body>(api.app, "POST", `${base}/kpi-definitions`, {
      session: sessions.tl,
      body: { name: "Synthetic NPS (CX)", unitKind: "score", polarity: "higher_is_better" },
    }),
    201,
    "createKpiDefinition",
  );
  return {
    transformationId,
    organizationId,
    base,
    users,
    s: sessions,
    kpiDefinitionId: kpi.id,
    benefitFormulaId: "",
  };
}

/** Sets one text column of a record (version + 1) with its audit event. */
async function retitle(
  db: Db,
  table: "initiative" | "deliverable" | "kpi_definition",
  column: "name" | "title",
  id: string,
  value: string,
  actorUserId: string,
  b: BenefitWorld,
): Promise<void> {
  await updateWithAudit(db, table, id, { [column]: value }, actorUserId, b);
}

/** Updates columns of a record of `b`'s transformation (version + 1) with its audit event, as a write path does. */
export async function updateWithAudit(
  db: Db,
  table: SearchRecordType,
  id: string,
  set: Record<string, string | null>,
  actorUserId: string,
  b: Pick<BenefitWorld, "organizationId" | "transformationId">,
): Promise<number> {
  return db.transaction().execute(async (tx) => {
    const assignments = Object.entries(set).map(([c, v]) => sql`${sql.ref(c)} = ${v}`);
    const row = await sql<{ version: number }>`
      UPDATE ${sql.table(table)} SET ${sql.join(assignments)}, version = version + 1
      WHERE id = ${id} RETURNING version`.execute(tx);
    const version = row.rows[0]!.version;
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId, requestId: `search-fixture-${id}-${version}`, source: "api" },
      {
        action: `${table}.update`,
        recordType: table,
        recordId: id,
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        priorVersion: version - 1,
        newVersion: version,
      },
    );
    return version;
  });
}

/** Inserts a lesson or change request with its create audit event (version 1). */
async function insertWithAudit(
  db: Db,
  table: "lesson" | "change_request",
  b: BenefitWorld,
  actorUserId: string,
  values: Record<string, unknown>,
): Promise<string> {
  const id = uuidv7();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto(table)
      .values({
        id,
        organization_id: b.organizationId,
        transformation_id: b.transformationId,
        created_by: actorUserId,
        updated_by: actorUserId,
        ...values,
      } as never)
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId, requestId: `search-fixture-${id}`, source: "api" },
      {
        action: `${table}.create`,
        recordType: table,
        recordId: id,
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

/** A search request URL. */
export function searchUrl(q: string, params: Record<string, string | readonly string[] | undefined> = {}): string {
  const parts = [`q=${encodeURIComponent(q)}`];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    for (const one of typeof v === "string" ? [v] : v) parts.push(`${k}=${encodeURIComponent(one)}`);
  }
  return `/api/v1/search?${parts.join("&")}`;
}

/** Every page of a search (limit 100). */
export async function searchAll(
  api: TestApi,
  session: Session,
  q: string,
  params: Record<string, string | readonly string[] | undefined> = {},
): Promise<Body[]> {
  const out: Body[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const res = await call<Body>(api.app, "GET", searchUrl(q, { ...params, limit: "100", cursor }), { session });
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    out.push(...res.body.items);
    if (res.body.nextCursor === null) return out;
    cursor = res.body.nextCursor;
  }
  throw new Error("searchAll: more than 50 pages");
}
