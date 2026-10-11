// code-security-reviewer DG4 round-1 probe S, revision 3 (T-DG4-REV-SEC-R1). Revision 3: (a) a 403 WITHOUT the
// authorization.denied audit row is accepted only for the operations in NO_DENIAL_OBSERVED (rev 2's observation, reported
// as finding F-DG4-100) and is logged as NO-DENIAL; (b) step 7, a user scoped to ONE transformation T1 (SP at
// transformation scope): every P4 read, with paths filled from T1's rows where they exist, must not disclose an id of
// another transformation's row, or another transformation's id or code. Revision 2: see the AUD case (400 before
// authorization accepted when nothing is written); 200 read bodies are printed for inspection. NOT product code; runs only in a disposable clone,
// copied to apps/api/test/integration/zz-sec-dg4/. All data is synthetic.
// Generated sweep over EVERY P4 operation of docs/api/openapi.yaml (P4_OPERATION_IDS, 382 operations, 203 mutating):
//   1. populate the database by running the seven P3 and the twenty P4 contract exercise seams (in contract.test.ts
//      order), so every P4 record type exists in organization A;
//   2. fill each path parameter from an EXISTING row: the deepest id parameter picks the newest row of its table, and
//      every outer parameter is taken from that row's own foreign-key column when it has one (same transformation);
//   3. AUD (org-wide read-only auditor of org A): every P4 mutation, with If-Match "1" and two bodies ({} and a
//      plausible body), must answer 403 and the request's only audit event is `authorization.denied`;
//   4. ADM-only (ADM_ACCESS + ADM_TECH of org A; seedWorld.admin) and OUTSIDER (TO of org B): every P4 mutation must be
//      refused (403/404/400/422/428, never 2xx) and write NOTHING but an optional authorization.denied;
//   5. ADM-only and OUTSIDER: every P4 read (GET) must not disclose a transformation-scoped record of org A: the body
//      contains no id of any row of a table with a transformation_id column, and no transformation id or code.
//      ADM-only's legitimately visible org-level configuration (calendars, holidays, job schedules, groups, role
//      mappings, governance parties) has no transformation_id, so it is not in the protected set;
//   6. a checksum of every public table (except audit_event, the session tables and the job queue) is identical
//      before and after steps 3-5.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operations } from "../../support/contract.ts";
import { auditOfRequest, call, createUser, grant, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { P4_OPERATION_IDS } from "../../support/p4-operations.ts";
import { exerciseP3BeAOperations } from "../contract/p3-exercises-be-a.ts";
import { exerciseP3BeBOperations } from "../contract/p3-exercises-be-b.ts";
import { exerciseP3BeCOperations } from "../contract/p3-exercises-be-c.ts";
import { exerciseP3BeDOperations } from "../contract/p3-exercises-be-d.ts";
import { exerciseP3BeEOperations } from "../contract/p3-exercises-be-e.ts";
import { exerciseP3KbeBOperations } from "../contract/p3-exercises-kbe-b.ts";
import { exerciseP3KbeCOperations } from "../contract/p3-exercises-kbe-c.ts";
import { exerciseP4BeAOperations } from "../contract/p4-exercises-be-a.ts";
import { exerciseP4BeBOperations } from "../contract/p4-exercises-be-b.ts";
import { exerciseP4BeCOperations } from "../contract/p4-exercises-be-c.ts";
import { exerciseP4BeDOperations } from "../contract/p4-exercises-be-d.ts";
import { exerciseP4BeEOperations } from "../contract/p4-exercises-be-e.ts";
import { exerciseP4BeFOperations } from "../contract/p4-exercises-be-f.ts";
import { exerciseP4BeGOperations } from "../contract/p4-exercises-be-g.ts";
import { exerciseP4BeHOperations } from "../contract/p4-exercises-be-h.ts";
import { exerciseP4BeIOperations } from "../contract/p4-exercises-be-i.ts";
import { exerciseP4BeJOperations } from "../contract/p4-exercises-be-j.ts";
import { exerciseP4BeKOperations } from "../contract/p4-exercises-be-k.ts";
import { exerciseP4BeLOperations } from "../contract/p4-exercises-be-l.ts";
import { exerciseP4BeMOperations } from "../contract/p4-exercises-be-m.ts";
import { exerciseP4KbeBOperations } from "../contract/p4-exercises-kbe-b.ts";
import { exerciseP4KbeCOperations } from "../contract/p4-exercises-kbe-c.ts";
import { exerciseP4KbeDOperations } from "../contract/p4-exercises-kbe-d.ts";
import { exerciseP4KbeD2Operations } from "../contract/p4-exercises-kbe-d2.ts";
import { exerciseP4KbeEOperations } from "../contract/p4-exercises-kbe-e.ts";
import { exerciseP4KbeFOperations } from "../contract/p4-exercises-kbe-f.ts";
import { exerciseP4KbeGOperations } from "../contract/p4-exercises-kbe-g.ts";

const P4 = operations.filter((o) => P4_OPERATION_IDS.has(o.operationId));
const MUTATIONS = P4.filter((o) => o.method !== "GET");
const READS = P4.filter((o) => o.method === "GET");

/** Path parameter -> table, where camelCase -> snake_case does not name it. */
const TABLE_OF: Record<string, string> = {
  groupId: "access_group",
  memberId: "access_group_member",
  calendarId: "business_calendar",
  holidayId: "business_calendar_holiday",
  mappingId: "role_mapping",
  notificationId: "inbox_notification",
  decisionRightId: "transformation_decision_right",
  actionItemId: "action_item",
  meetingAttendanceId: "meeting_attendance",
  linkId: "meeting_action_link",
};
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const tableOf = (param: string) => TABLE_OF[param] ?? snake(param.replace(/Id$/, ""));

/** Rev 2 observation: these answer 403 with NO authorization.denied audit row for a caller lacking the permission. */
const NO_DENIAL_OBSERVED = new Set([
  "completeWorkItem", "createBenefit", "updateBenefit", "archiveBenefit", "advanceBenefitLifecycle", "decideBenefitBaseline",
  "createBenefitEnabler", "removeBenefitEnabler", "createBenefitPlanValue", "updateBenefitPlanValue",
  "replaceBenefitAllocations", "createBenefitGroup", "updateBenefitGroup", "createBenefitOverlap", "resolveBenefitOverlap",
  "createBenefitScenario", "updateBenefitScenario", "createBenefitScenarioValue", "updateBenefitScenarioValue",
  "createBenefitValuationMethod", "decideBenefitValuationMethod", "createBenefitMeasurement", "updateBenefitMeasurement",
  "submitBenefitMeasurement", "decideFinanceValidation", "amendFinanceValidation", "reverseFinanceValidation",
]);
let scoped: Session;
let t1 = "";
let scopedProtected: Set<string>;
let api: TestApi;
let w: World;
let aud: Session;
let adm: Session;
let outsider: Session;
let tables: string[] = [];
let protectedIds: Set<string>;
const columnsOf = new Map<string, Set<string>>();
const unresolved: string[] = [];

async function checksum(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of tables) {
    const r = await sql<{ h: string | null; n: string }>`SELECT md5(string_agg(x::text, '|' ORDER BY x::text)) AS h, count(*)::text AS n FROM ${sql.table(t)} x`.execute(api.db);
    out[t] = `${r.rows[0]!.n}:${r.rows[0]!.h}`;
  }
  return out;
}

async function newest(table: string, where = sql`true`): Promise<Record<string, unknown> | undefined> {
  if (!columnsOf.has(table)) return undefined;
  const order = columnsOf.get(table)!.has("created_at") ? sql`created_at DESC` : sql`1`;
  const r = await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(table)} WHERE ${where} ORDER BY ${order} LIMIT 1`.execute(api.db);
  return r.rows[0];
}

const LITERAL: Record<string, string> = {
  gateCode: "G4",
  matrixKind: "decision_rights",
  ruleKind: "kpi_deviation",
  sourceKind: "kpi",
  recordType: "initiative",
  jobCode: "approval.escalation_scan",
  versionNo: "1",
  submissionNo: "1",
  allocationTargetType: "initiative",
  stepKey: "diagnose.current_state",
  criterionKey: "c1",
};

/** Fills the path from existing rows (deepest id parameter first; outer ids from that row's foreign keys). */
async function urlFor(path: string, preferT: string | null = null): Promise<string> {
  const names = [...path.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]!);
  const values = new Map<string, string>();
  let anchor: Record<string, unknown> | undefined;
  for (const n of [...names].reverse()) {
    if (values.has(n)) continue;
    if (!n.endsWith("Id")) continue;
    const col = `${snake(n.replace(/Id$/, ""))}_id`;
    if (anchor && anchor[col] != null) {
      values.set(n, String(anchor[col]));
      continue;
    }
    if (n === "transformationId" && anchor?.["transformation_id"] != null) {
      values.set(n, String(anchor["transformation_id"]));
      continue;
    }
    if (n === "organizationId") {
      values.set(n, String(anchor?.["organization_id"] ?? w.orgA.id));
      continue;
    }
    const tbl = tableOf(n);
    const pref = preferT !== null && columnsOf.get(tbl)?.has("transformation_id")
      ? await newest(tbl, n === "transformationId" ? sql`id = ${preferT}::uuid` : sql`transformation_id = ${preferT}::uuid`)
      : undefined;
    const row = pref ?? (n === "transformationId" && preferT !== null ? { id: preferT, transformation_id: preferT } : undefined) ??
      (await newest(tbl, n === "transformationId" ? sql`organization_id = ${w.orgA.id}::uuid` : sql`true`));
    if (!row) {
      unresolved.push(`${path} {${n}} (table ${tableOf(n)})`);
      values.set(n, "00000000-0000-7000-8000-000000000000");
      continue;
    }
    values.set(n, String(row["id"]));
    anchor ??= row;
  }
  return path.replace(/\{([A-Za-z]+)\}/g, (_m, n: string) => values.get(n) ?? LITERAL[n] ?? "x");
}

const plausible = (u: string) => {
  const tid = /transformations\/([0-9a-f-]{36})/.exec(u)?.[1];
  return { transformationId: tid, rationale: "SEC probe", reason: "SEC probe", note: "SEC probe", name: "SEC probe", title: "SEC probe" };
};

let before: Record<string, string>;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const ctx = { api, world: w, mirrored: (m: string, u: string, o = {}) => call(api.app, m, u, o) };
  for (const ex of [
    exerciseP3BeAOperations, exerciseP3BeBOperations, exerciseP3BeCOperations, exerciseP3BeDOperations,
    exerciseP3BeEOperations, exerciseP3KbeBOperations, exerciseP3KbeCOperations,
    exerciseP4BeAOperations, exerciseP4BeBOperations, exerciseP4BeCOperations, exerciseP4BeDOperations,
    exerciseP4BeEOperations, exerciseP4BeFOperations, exerciseP4BeGOperations, exerciseP4BeHOperations,
    exerciseP4BeIOperations, exerciseP4BeJOperations, exerciseP4BeKOperations, exerciseP4BeLOperations,
    exerciseP4BeMOperations, exerciseP4KbeBOperations, exerciseP4KbeCOperations, exerciseP4KbeDOperations,
    exerciseP4KbeD2Operations, exerciseP4KbeEOperations, exerciseP4KbeFOperations, exerciseP4KbeGOperations,
  ])
    await ex(ctx);
  const cols = await sql<{ table_name: string; column_name: string }>`
    SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`.execute(api.db);
  for (const r of cols.rows) {
    if (!columnsOf.has(r.table_name)) columnsOf.set(r.table_name, new Set());
    columnsOf.get(r.table_name)!.add(r.column_name);
  }
  tables = [...columnsOf.keys()]
    .filter((t) => !["audit_event", "session", "user_session", "rate_limit_bucket", "outbox_event", "idempotency_key"].includes(t))
    .filter((t) => !/^(pgboss|kysely_)/.test(t))
    .sort();
  // Protected: every id of a transformation-scoped row of org A, and org A's transformation ids and codes.
  protectedIds = new Set();
  for (const [t, c] of columnsOf) {
    if (!c.has("transformation_id") || !c.has("id") || !c.has("organization_id")) continue;
    const r = await sql<{ id: string }>`SELECT id::text AS id FROM ${sql.table(t)} WHERE organization_id = ${w.orgA.id}::uuid`.execute(api.db);
    for (const x of r.rows) protectedIds.add(x.id);
  }
  const tx = await sql<{ id: string; code: string }>`SELECT id::text AS id, code FROM transformation WHERE organization_id = ${w.orgA.id}::uuid`.execute(api.db);
  for (const x of tx.rows) {
    protectedIds.add(x.id);
    protectedIds.add(x.code);
  }
  // Step 7 fixture: T1 = the transformation of the newest benefit (P4 rows exist there); the scoped user is SP on T1 only.
  t1 = String((await newest("benefit"))!["transformation_id"]);
  const su = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, su.id, "SP", { type: "transformation", id: t1 }, w.orgA.id);
  scoped = await signIn(api.app, su.subject);
  scopedProtected = new Set();
  for (const [t, c] of columnsOf) {
    if (!c.has("transformation_id") || !c.has("id") || !c.has("organization_id")) continue;
    const r = await sql<{ id: string }>`SELECT id::text AS id FROM ${sql.table(t)} WHERE organization_id = ${w.orgA.id}::uuid AND transformation_id IS DISTINCT FROM ${t1}::uuid`.execute(api.db);
    for (const x of r.rows) scopedProtected.add(x.id);
  }
  for (const x of tx.rows) if (x.id !== t1) {
    scopedProtected.add(x.id);
    scopedProtected.add(x.code);
  }
  aud = await signIn(api.app, w.auditor.subject);
  adm = await signIn(api.app, w.admin.subject);
  outsider = await signIn(api.app, w.officeB.subject);
  before = await checksum();
}, 900_000);
afterAll(() => api.close());

describe("SEC-DG4-R1 probe S: generated P4 sweep", () => {
  it("covers the P4 operations", () => {
    console.log(`[probe-S] T1 ${t1}; scoped protected ids ${scopedProtected.size}`);
    console.log(`[probe-S] P4 operations ${P4.length}, mutating ${MUTATIONS.length}, reads ${READS.length}, tables ${tables.length}, protected ids ${protectedIds.size}`);
    expect(P4.length).toBe(382);
    expect(MUTATIONS.length).toBe(203);
    expect(protectedIds.size).toBeGreaterThan(200);
  });

  it.each(MUTATIONS.map((o) => [o.operationId, o.method, o.path] as const))(
    "AUD %s (%s %s): 403, only authorization.denied written",
    async (id, method, path) => {
      const url = await urlFor(path);
      for (const body of [{}, plausible(url)]) {
        const res = await call(api.app, method, url, { session: aud, headers: { "if-match": '"1"' }, body, contract: false });
        const written = (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);
        console.log(`[probe-S AUD] ${id} ${method} ${url} body=${Object.keys(body).length ? "plausible" : "{}"} -> ${res.status} ${(res.body as { code?: string })?.code ?? ""} audit=${JSON.stringify(written)}`);
        // Revision 2: body validation runs before authorization on many P4 routes (the codebase's parse-first
        // convention), so a 400 `validation`/`*.field_required` with NOTHING written is accepted and counted; the
        // per-user resource markInboxNotificationRead may answer 404 (not the caller's notification). Every 403 must
        // write exactly one authorization.denied. No 2xx, and no other audit action, is ever accepted.
        const code = (res.body as { code?: string })?.code ?? "";
        if (res.status === 400) {
          expect(code === "validation" || code.endsWith(".field_required"), `${id}: ${code}`).toBe(true);
          expect(written).toEqual([]);
          continue;
        }
        if (res.status === 404 && id === "markInboxNotificationRead") {
          expect(written).toEqual([]);
          continue;
        }
        expect(res.status, `${id}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(403);
        if (written.length === 0 && NO_DENIAL_OBSERVED.has(id)) {
          console.log(`[probe-S NO-DENIAL] AUD ${id} ${method} -> 403 ${code} with no authorization.denied row`);
          continue;
        }
        expect(written).toEqual(["authorization.denied"]);
      }
    },
  );

  it.each(MUTATIONS.map((o) => [o.operationId, o.method, o.path] as const))(
    "ADM-only and OUTSIDER %s (%s %s): refused, nothing but a denial written",
    async (id, method, path) => {
      const url = await urlFor(path);
      for (const [who, s] of [["ADM", adm], ["OUT", outsider]] as const) {
        for (const body of [{}, plausible(url)]) {
          const res = await call(api.app, method, url, { session: s, headers: { "if-match": '"1"' }, body, contract: false });
          const written = (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);
          console.log(`[probe-S ${who}] ${id} ${method} ${url} body=${Object.keys(body).length ? "plausible" : "{}"} -> ${res.status} ${(res.body as { code?: string })?.code ?? ""} audit=${JSON.stringify(written)}`);
          expect(res.status, `${who} ${id}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeGreaterThanOrEqual(400);
          expect(written.filter((a) => a !== "authorization.denied"), `${who} ${id}`).toEqual([]);
        }
      }
    },
  );

  it.each(READS.map((o) => [o.operationId, o.path] as const))(
    "ADM-only and OUTSIDER read %s (%s): no transformation-scoped record of org A disclosed",
    async (id, path) => {
      const url = await urlFor(path);
      for (const [who, s] of [["ADM", adm], ["OUT", outsider]] as const) {
        const res = await call(api.app, "GET", url, { session: s, contract: false });
        const text = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
        const leaked = [...protectedIds].filter((x) => text.includes(x));
        console.log(`[probe-S READ ${who}] ${id} GET ${url} -> ${res.status} ${(res.body as { code?: string })?.code ?? ""} leaked=${leaked.length}${leaked.length ? " " + JSON.stringify(leaked.slice(0, 5)) : ""}${res.status === 200 ? " body=" + text.slice(0, 600) : ""}`);
        expect(leaked, `${who} ${id} -> ${res.status}: ${text.slice(0, 300)}`).toEqual([]);
      }
    },
  );

  it.each(READS.map((o) => [o.operationId, o.path] as const))(
    "T1-scoped SP read %s (%s): nothing of another transformation disclosed",
    async (id, path) => {
      const url = await urlFor(path, t1);
      const res = await call(api.app, "GET", url, { session: scoped, contract: false });
      const text = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
      const leaked = [...scopedProtected].filter((x) => text.includes(x));
      console.log(`[probe-S READ T1] ${id} GET ${url} -> ${res.status} ${(res.body as { code?: string })?.code ?? ""} leaked=${leaked.length}${leaked.length ? " " + JSON.stringify(leaked.slice(0, 5)) + " body=" + text.slice(0, 800) : ""}`);
      expect(leaked, `T1 ${id} -> ${res.status}: ${text.slice(0, 300)}`).toEqual([]);
    },
  );

  it("no table changed during the sweep; unresolved path parameters listed", async () => {
    const after = await checksum();
    const changed = tables.filter((t) => before[t] !== after[t]);
    console.log(`[probe-S] unresolved path parameters (${unresolved.length}): ${JSON.stringify([...new Set(unresolved)])}`);
    for (const t of changed) console.log(`[probe-S] CHANGED ${t} ${before[t]} -> ${after[t]}`);
    expect(changed).toEqual([]);
  });
});
