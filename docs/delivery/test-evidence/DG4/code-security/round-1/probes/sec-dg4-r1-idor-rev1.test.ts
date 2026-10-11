// code-security-reviewer DG4 round-1 probe I (T-DG4-REV-SEC-R1). NOT product code; runs only in a disposable clone,
// copied to apps/api/test/integration/zz-sec-dg4/. All data is synthetic.
// Cross-transformation IDOR sweep over EVERY P4 mutating operation (generated from docs/api/openapi.yaml):
//   1. populate org A by running the P3 and P4 contract exercise seams (as probe S);
//   2. T1 = the transformation of the newest benefit; user W holds EVERY business role (SP TL BO WL FIN TO KDS TD CM SEC)
//      at TRANSFORMATION scope T1 only (so W may write in T1 and nowhere else);
//   3. for every P4 mutation whose path names a record id besides {transformationId}/{organizationId}, fill each such
//      id from rows of OTHER transformations of org A (never T1), and put T1 in {transformationId} where the path has it.
//      W calls it with If-Match "1".."3" (the probable versions) and two bodies ({} and a plausible one);
//   4. expected: never a 2xx; and the checksum of every row of every table that belongs to a transformation other
//      than T1 is identical before and after the whole sweep (no foreign record was changed through T1's path).
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operations } from "../../support/contract.ts";
import { call, createUser, grant, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
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

const MUTATIONS = operations.filter((o) => P4_OPERATION_IDS.has(o.operationId) && o.method !== "GET");
const TABLE_OF: Record<string, string> = {
  groupId: "access_group", memberId: "access_group_member", calendarId: "business_calendar",
  holidayId: "business_calendar_holiday", mappingId: "role_mapping", notificationId: "inbox_notification",
  decisionRightId: "transformation_decision_right", meetingAttendanceId: "meeting_attendance", linkId: "meeting_action_link",
};
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const tableOf = (param: string) => TABLE_OF[param] ?? snake(param.replace(/Id$/, ""));
const LITERAL: Record<string, string> = {
  gateCode: "G4", matrixKind: "decision_rights", ruleKind: "kpi_deviation", sourceKind: "kpi", recordType: "initiative",
  jobCode: "approval.escalation_scan", versionNo: "1", submissionNo: "1", allocationTargetType: "initiative",
  stepKey: "diagnose.current_state", criterionKey: "c1",
};

let api: TestApi;
let w: World;
let user: Session;
let t1 = "";
const columnsOf = new Map<string, Set<string>>();
const skipped: string[] = [];

async function foreignChecksum(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [t, c] of columnsOf) {
    if (!c.has("transformation_id") || ["audit_event"].includes(t)) continue;
    const r = await sql<{ h: string | null; n: string }>`SELECT md5(string_agg(x::text, '|' ORDER BY x::text)) AS h, count(*)::text AS n FROM ${sql.table(t)} x WHERE x.transformation_id IS DISTINCT FROM ${t1}::uuid`.execute(api.db);
    out[t] = `${r.rows[0]!.n}:${r.rows[0]!.h}`;
  }
  return out;
}

async function foreignRow(table: string): Promise<Record<string, unknown> | undefined> {
  const c = columnsOf.get(table);
  if (!c || !c.has("transformation_id")) return undefined;
  const order = c.has("created_at") ? sql`created_at DESC` : sql`1`;
  const r = await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(table)} WHERE transformation_id <> ${t1}::uuid AND organization_id = ${w.orgA.id}::uuid ORDER BY ${order} LIMIT 1`.execute(api.db);
  return r.rows[0];
}

/** T1 in {transformationId}; every other id parameter from a foreign row (outer ids from the anchor's foreign keys). */
async function idorUrl(path: string): Promise<string | null> {
  const names = [...path.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]!);
  const ids = names.filter((n) => n.endsWith("Id") && n !== "transformationId" && n !== "organizationId");
  if (ids.length === 0) return null;
  const values = new Map<string, string>([["transformationId", t1], ["organizationId", w.orgA.id]]);
  let anchor: Record<string, unknown> | undefined;
  for (const n of [...ids].reverse()) {
    const col = `${snake(n.replace(/Id$/, ""))}_id`;
    if (anchor && anchor[col] != null) {
      values.set(n, String(anchor[col]));
      continue;
    }
    const row = await foreignRow(tableOf(n));
    if (!row) return null;
    values.set(n, String(row["id"]));
    anchor ??= row;
  }
  return path.replace(/\{([A-Za-z]+)\}/g, (_m, n: string) => values.get(n) ?? LITERAL[n] ?? "x");
}

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
  const b = await sql<{ transformation_id: string }>`SELECT transformation_id FROM benefit ORDER BY created_at DESC LIMIT 1`.execute(api.db);
  t1 = b.rows[0]!.transformation_id;
  const u = await createUser(api.db, w.orgA.id);
  for (const role of ["SP", "TL", "BO", "WL", "FIN", "TO", "KDS", "TD", "CM", "SEC"])
    await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: t1 }, w.orgA.id);
  user = await signIn(api.app, u.subject);
  before = await foreignChecksum();
}, 900_000);
afterAll(() => api.close());

describe("SEC-DG4-R1 probe I: cross-transformation IDOR through T1's path", () => {
  it.each(MUTATIONS.map((o) => [o.operationId, o.method, o.path] as const))(
    "%s (%s %s): a foreign record id through T1 is never a 2xx",
    async (id, method, path) => {
      const url = await idorUrl(path);
      if (url === null) {
        skipped.push(id);
        return;
      }
      const t1Url = /transformations\/([0-9a-f-]{36})/.exec(url)?.[1];
      for (const v of ["1", "2", "3"]) {
        for (const body of [{}, { transformationId: t1Url ?? t1, rationale: "IDOR probe", reason: "IDOR probe", note: "IDOR probe" }]) {
          const res = await call(api.app, method, url, { session: user, headers: { "if-match": `"${v}"` }, body, contract: false });
          console.log(`[probe-I] ${id} ${method} ${url} v=${v} body=${Object.keys(body).length ? "plausible" : "{}"} -> ${res.status} ${(res.body as { code?: string })?.code ?? ""}`);
          expect(res.status, `${id}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeGreaterThanOrEqual(400);
        }
      }
    },
  );

  it("no row of another transformation changed", async () => {
    const after = await foreignChecksum();
    const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
    console.log(`[probe-I] T1 ${t1}; operations without a foreign id parameter (not applicable): ${skipped.length} ${JSON.stringify(skipped)}`);
    for (const t of changed) console.log(`[probe-I] CHANGED ${t} ${before[t]} -> ${after[t]}`);
    expect(changed).toEqual([]);
  });
});
