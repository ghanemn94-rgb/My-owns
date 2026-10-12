// code-security-reviewer DG4 ROUND-5 probe FS (T-DG4-REV-SEC-R5): after T-DG4-FE-R8 (F-DG4-144) the web builds the
// org-wide request's transformationId list on the client (useOrgQuery: the unit's listTransformations page narrowed by
// phase/status, or the transformation chip intersected with the caller's full readable list). This probe checks that the
// SERVER still enforces scope for every id the client sends, on the Executive Overview, Finance and adoption reads, with
// the business-unit, phase and status filters; and that the client's source list (GET /api/v1/transformations with
// businessUnitId + phase + status) never offers an id the dashboards would refuse, nor one outside the caller's scope.
// World: org A; T1 + T2 in BU a1, T3 in BU a2 (benefitWorldIn, each with its own TL/FIN). T2 is moved to phase design /
// status active by a fixture update (with its audit event), so the phase and status filters distinguish T1 from T2.
// Callers: TL1 (T1 only), TL2 (T2 only), TL3 (T3 only), leadA1 (TL @ BU a1), office (TO @ org A), AUD, ADM-only, OUT (org B).
// NOT product code; disposable clone only. All data synthetic.
import { insertAuditEvent, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import type { BenefitWorld } from "../benefits/fixtures.ts";
import { benefitWorldIn } from "../contract/p4-exercises-kbe-g.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let b1: BenefitWorld;
let b2: BenefitWorld;
let b3: BenefitWorld;
const S: Record<string, Session> = {};
const T: Record<string, string> = {};
const READS = ["/api/v1/overview", "/api/v1/dashboards/finance", "/api/v1/dashboards/adoption"] as const;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b1 = await benefitWorldIn(api, w, w.a1);
  b2 = await benefitWorldIn(api, w, w.a1);
  b3 = await benefitWorldIn(api, w, w.a2);
  T.t1 = b1.transformationId;
  T.t2 = b2.transformationId;
  T.t3 = b3.transformationId;
  await api.db.transaction().execute(async (tx: Tx) => {
    await tx.updateTable("transformation").set({ current_phase: "design", status: "active" }).where("id", "=", T.t2!).execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: b2.users.tl.id, requestId: `fixture-${uuidv7()}`, source: "api" },
      { action: "transformation.update", recordType: "transformation", recordId: T.t2!, organizationId: w.orgA.id, transformationId: T.t2!, newVersion: 1 },
    );
  });
  S.TL1 = b1.s.tl;
  S.TL2 = b2.s.tl;
  S.TL3 = b3.s.tl;
  S.FIN1 = b1.s.fin;
  S.leadA1 = await signIn(api.app, w.leadA1.subject);
  S.office = await signIn(api.app, w.office.subject);
  S.AUD = await signIn(api.app, w.auditor.subject);
  S.ADM = await signIn(api.app, w.admin.subject);
  S.OUT = await signIn(api.app, w.officeB.subject);
}, 600_000);
afterAll(() => api?.close());

const qs = (p: Record<string, string | string[] | undefined>) =>
  Object.entries(p)
    .flatMap(([k, v]) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((x) => `${k}=${encodeURIComponent(x)}`)))
    .join("&");
const rowIds = (b: Body): string[] => ((b?.transformations ?? []) as Body[]).map((r) => r.transformationId ?? r.id).sort();
const name = (id: string) => Object.entries(T).find(([, v]) => v === id)?.[0] ?? (id.length > 30 ? "<other>" : id);
// Every T* id present anywhere in a body except appliedFilters (which echoes the request).
const leaked = (b: Body, allowed: string[]) => {
  const { appliedFilters: _f, ...rest } = b ?? {};
  const s = JSON.stringify(rest);
  return Object.values(T).filter((id) => !allowed.includes(id) && s.includes(id)).map(name);
};
async function unitList(s: Session, bu: string, phase?: string, status?: string): Promise<{ status: number; ids: string[] }> {
  const r = await call<Body>(api.app, "GET", `/api/v1/transformations?${qs({ organizationId: w.orgA.id, businessUnitId: bu, phase, status, sort: "code:asc", limit: "51" })}`, { session: s, contract: false });
  return { status: r.status, ids: r.status === 200 ? (r.body.items as Body[]).map((x) => x.id as string).sort() : [] };
}
async function dash(s: Session, path: string, ids: string[], phase?: string, status?: string) {
  return call<Body>(api.app, "GET", `${path}?${qs({ organizationId: w.orgA.id, transformationId: ids, phase, status })}`, { session: s, contract: false });
}

describe("SEC-DG4-R5 probe FS: client-built transformation ids on the org-wide reads stay server-scoped", () => {
  it("control: AUD's unit list narrows by phase and status (the probe can tell T1 from T2), and the reads filter rows", async () => {
    const all = await unitList(S.AUD!, w.a1);
    const des = await unitList(S.AUD!, w.a1, "design");
    const act = await unitList(S.AUD!, w.a1, undefined, "active");
    const dia = await unitList(S.AUD!, w.a1, "diagnose", "draft");
    console.log(`[probe-FS control] a1 all=${all.ids.map(name)} design=${des.ids.map(name)} active=${act.ids.map(name)} diagnose+draft=${dia.ids.map(name)}`);
    expect(all.ids).toEqual([T.t1!, T.t2!].sort());
    expect(des.ids).toEqual([T.t2!]);
    expect(act.ids).toEqual([T.t2!]);
    expect(dia.ids).toEqual([T.t1!]);
    for (const p of READS) {
      const r = await dash(S.AUD!, p, [T.t1!, T.t2!], "design");
      console.log(`[probe-FS control] AUD ${p} ids=T1,T2 phase=design -> ${r.status} rows=${rowIds(r.body).map(name)}`);
      expect(r.status).toBe(200);
      expect(rowIds(r.body)).toEqual([T.t2!]);
    }
  });

  it("every caller: each id its unit list offers is accepted by all three reads, and the rows stay within the list", async () => {
    const bad: string[] = [];
    for (const [who, s] of Object.entries(S)) {
      for (const bu of [w.a1, w.a2]) {
        for (const [phase, status] of [[undefined, undefined], ["design", undefined], [undefined, "active"], ["diagnose", "draft"], ["design", "draft"]] as const) {
          const l = await unitList(s, bu, phase, status);
          if (l.status >= 500) bad.push(`${who} list ${l.status}`);
          if (l.ids.length === 0) continue; // the client sends no request (blocked none / none_matching)
          for (const p of READS) {
            const r = await dash(s, p, l.ids, phase, status);
            const rows = rowIds(r.body);
            const line = `${who} bu=${bu === w.a1 ? "a1" : "a2"} phase=${phase ?? "-"} status=${status ?? "-"} list=${l.ids.map(name)} ${p} -> ${r.status} rows=${rows.map(name)}`;
            console.log(`[probe-FS lists] ${line}`);
            if (r.status !== 200) bad.push(`refused: ${line}`);
            if (rows.some((x) => !l.ids.includes(x))) bad.push(`row outside list: ${line}`);
            const lk = leaked(r.body, l.ids);
            if (lk.length) bad.push(`leak ${lk}: ${line}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("forged id lists: any unreadable, foreign-org or unknown id is 404 on every read, whatever the phase/status", async () => {
    const unknown = uuidv7();
    const cases: [string, string[], string[]][] = [
      // caller, ids sent, ids the caller may read among them
      ["TL1", [T.t2!], []],
      ["TL1", [T.t1!, T.t2!], [T.t1!]],
      ["TL1", [T.t1!, T.t3!], [T.t1!]],
      ["TL1", [T.t1!, unknown], [T.t1!]],
      ["TL2", [T.t1!, T.t2!], [T.t2!]],
      ["TL3", [T.t3!, T.t1!], [T.t3!]],
      ["FIN1", [T.t1!, T.t2!], [T.t1!]],
      ["leadA1", [T.t3!], []],
      ["OUT", [T.t1!], []],
      ["ADM", [T.t1!], []],
    ];
    const bad: string[] = [];
    for (const [who, ids] of cases) {
      for (const [phase, status] of [[undefined, undefined], ["design", "active"], ["diagnose", "draft"], ["realize", "closed"]] as const) {
        for (const p of READS) {
          const r = await dash(S[who]!, p, ids, phase, status);
          const lk = leaked(r.body, []);
          const line = `${who} ids=${ids.map(name)} phase=${phase ?? "-"} status=${status ?? "-"} ${p} -> ${r.status} ${r.body?.code ?? ""} leaked=${lk}`;
          console.log(`[probe-FS forged] ${line}`);
          if (r.status !== 404) bad.push(`not 404: ${line}`);
          if (lk.length) bad.push(`leak: ${line}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("the 404 for an unreadable id cannot be told apart from an unknown id (no existence oracle via phase/status)", async () => {
    const unknown = uuidv7();
    const bad: string[] = [];
    for (const p of READS) {
      for (const [phase, status] of [["design", "active"], ["diagnose", "draft"]] as const) {
        const a = await dash(S.TL1!, p, [T.t2!], phase, status);
        const b = await dash(S.TL1!, p, [unknown], phase, status);
        const strip = (x: Body) => JSON.stringify({ ...x, requestId: undefined, instance: undefined, traceId: undefined });
        console.log(`[probe-FS oracle] ${p} phase=${phase} status=${status} T2 -> ${a.status} ${strip(a.body)} | unknown -> ${b.status} ${strip(b.body)}`);
        if (a.status !== b.status || strip(a.body) !== strip(b.body)) bad.push(`${p} ${phase}/${status} differs`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("no filter / phase-status only: org-wide rows equal the caller's readable set narrowed by phase and status", async () => {
    const bad: string[] = [];
    const expectRows: Record<string, string[]> = { TL1: [T.t1!], TL2: [T.t2!], TL3: [T.t3!], FIN1: [T.t1!], AUD: [T.t1!, T.t2!, T.t3!] };
    for (const [who, readable] of Object.entries(expectRows)) {
      for (const [phase, status] of [[undefined, undefined], ["design", undefined], [undefined, "draft"]] as const) {
        const want = readable.filter((id) => (phase === "design" ? id === T.t2 : status === "draft" ? id !== T.t2 : true)).sort();
        for (const p of READS) {
          const r = await dash(S[who]!, p, [], phase, status);
          const rows = rowIds(r.body);
          const lk = leaked(r.body, readable);
          console.log(`[probe-FS org] ${who} phase=${phase ?? "-"} status=${status ?? "-"} ${p} -> ${r.status} rows=${rows.map(name)} want=${want.map(name)} leaked=${lk}`);
          if (r.status !== 200 || JSON.stringify(rows) !== JSON.stringify(want) || lk.length) bad.push(`${who} ${phase}/${status} ${p} ${r.status} ${rows.map(name)} vs ${want.map(name)} ${lk}`);
        }
      }
    }
    for (const who of ["ADM", "OUT"]) {
      for (const p of READS) {
        const r = await dash(S[who]!, p, []);
        console.log(`[probe-FS org] ${who} ${p} -> ${r.status} ${r.body?.code ?? ""} leaked=${leaked(r.body, [])}`);
        if (r.status !== 404 || leaked(r.body, []).length) bad.push(`${who} ${p} ${r.status}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
