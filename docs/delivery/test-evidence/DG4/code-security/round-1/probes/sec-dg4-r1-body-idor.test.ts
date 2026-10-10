// code-security-reviewer DG4 round-1 probe B (T-DG4-REV-SEC-R1). NOT product code; runs only in a disposable clone,
// copied to apps/api/test/integration/zz-sec-dg4/. All data is synthetic.
// Cross-transformation references in REQUEST BODIES (complements probe I, which covers path ids):
//   1. run the P3 and P4 contract exercise seams through a capturing client: every SUCCESSFUL (2xx) P4 POST/PUT/PATCH
//      whose path is /api/v1/transformations/{T}/<collection...> with NO other id in the path is recorded with its body;
//   2. T0 = a new, empty transformation of org A; user W holds every business role at T0 only;
//   3. each recorded request is replayed by W with {T} replaced by T0 and the body UNCHANGED, but only when the body
//      contains at least one id of a row that belongs to another transformation (so a success would link T0 to a
//      foreign record). Expected: never a 2xx. Each replay is printed; a 2xx is printed with the foreign ids it named;
//   4. the checksum of every row of every other transformation is unchanged.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findOperation } from "../../support/contract.ts";
import { call, createTransformationRow, createUser, grant, seedWorld, signIn, startApi, type RequestOptions, type Session, type TestApi, type World } from "../../support/harness.ts";
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

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
interface Captured { readonly operationId: string; readonly method: string; readonly url: string; readonly body: unknown; readonly t: string }
const captured: Captured[] = [];
let api: TestApi;
let w: World;
let user: Session;
let t0 = "";
const columnsOf = new Map<string, Set<string>>();
/** id -> transformation it belongs to (rows of tables with transformation_id). */
const owner = new Map<string, string>();

async function foreignChecksum(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [t, c] of columnsOf) {
    if (!c.has("transformation_id") || t === "audit_event") continue;
    const r = await sql<{ h: string | null; n: string }>`SELECT md5(string_agg(x::text, '|' ORDER BY x::text)) AS h, count(*)::text AS n FROM ${sql.table(t)} x WHERE x.transformation_id IS DISTINCT FROM ${t0}::uuid`.execute(api.db);
    out[t] = `${r.rows[0]!.n}:${r.rows[0]!.h}`;
  }
  return out;
}

let before: Record<string, string>;
let replays: Captured[] = [];
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const capture = async (m: string, u: string, o: RequestOptions = {}) => {
    const res = await call(api.app, m, u, o);
    const path = u.split("?")[0]!;
    const tm = /^\/api\/v1\/transformations\/([0-9a-f-]{36})(\/[a-z-]+)+$/.exec(path);
    const op = findOperation(m, path);
    if (m !== "GET" && res.status >= 200 && res.status < 300 && tm && op && P4_OPERATION_IDS.has(op.operationId) && o.body !== undefined)
      captured.push({ operationId: op.operationId, method: m, url: path, body: o.body, t: tm[1]! });
    return res;
  };
  const ctx = { api, world: w, mirrored: capture };
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
  for (const [t, c] of columnsOf) {
    if (!c.has("transformation_id") || !c.has("id")) continue;
    const r = await sql<{ id: string; tid: string }>`SELECT id::text AS id, transformation_id::text AS tid FROM ${sql.table(t)} WHERE transformation_id IS NOT NULL`.execute(api.db);
    for (const x of r.rows) owner.set(x.id, x.tid);
  }
  t0 = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  const u = await createUser(api.db, w.orgA.id);
  for (const role of ["SP", "TL", "BO", "WL", "FIN", "TO", "KDS", "TD", "CM", "SEC"])
    await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: t0 }, w.orgA.id);
  user = await signIn(api.app, u.subject);
  replays = captured.filter((c) => (JSON.stringify(c.body).match(UUID) ?? []).some((id) => owner.has(id) && owner.get(id) !== t0));
  before = await foreignChecksum();
}, 900_000);
afterAll(() => api.close());

describe("SEC-DG4-R1 probe B: foreign record ids in request bodies through T0's path", () => {
  it("replays every captured create/update whose body names a foreign record; none succeeds", async () => {
    const ops = new Set(captured.map((c) => c.operationId));
    const rops = new Set(replays.map((c) => c.operationId));
    console.log(`[probe-B] captured ${captured.length} successful P4 writes on /transformations/{T}/<collection> (${ops.size} operations); with a foreign id in the body: ${replays.length} (${rops.size} operations: ${JSON.stringify([...rops].sort())})`);
    expect(replays.length).toBeGreaterThan(20);
    const successes: string[] = [];
    for (const c of replays) {
      const url = c.url.replace(c.t, t0);
      const foreign = (JSON.stringify(c.body).match(UUID) ?? []).filter((id) => owner.has(id) && owner.get(id) !== t0);
      const res = await call(api.app, c.method, url, { session: user, body: c.body, headers: { "if-match": '"0"' }, contract: false });
      console.log(`[probe-B] ${c.operationId} ${c.method} ${url} foreign=${foreign.length} -> ${res.status} ${(res.body as { code?: string })?.code ?? ""}${res.status < 300 ? " BODY=" + JSON.stringify(c.body).slice(0, 600) : ""}`);
      if (res.status < 300) successes.push(`${c.operationId} foreign=${JSON.stringify(foreign)}`);
    }
    console.log(`[probe-B] 2xx replays: ${successes.length} ${JSON.stringify(successes)}`);
    expect(successes).toEqual([]);
  });

  it("no row of another transformation changed", async () => {
    const after = await foreignChecksum();
    const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
    for (const t of changed) console.log(`[probe-B] CHANGED ${t} ${before[t]} -> ${after[t]}`);
    expect(changed).toEqual([]);
  });
});
