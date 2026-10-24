// code-security-reviewer, DG5 round 2 (T-DG5-RG-SEC-R2): an independent, contract-generated role sweep over EVERY P5
// operation (p5-operations.ts), re-run on candidate 5df44203. Disposable: copied into the review clone as
// apps/api/test/integration/ and removed afterwards; never part of the candidate.
// Round-2 change: the five deviations judged in round 1 are pinned as EXPLICIT expectations (EXPECTED below), so the
// run exits 0 only when every other operation keeps the strict rule AND each pinned one behaves exactly as judged:
//   AUD previewFormula: not a write (formula-preview.ts: writes nothing, session + CSRF only) -> any status, no audit;
//   ADM runJobNow: the ADM_TECH job operation (REQ-S12-022), organization-scoped -> 202 + job_schedule.run_now only;
//   ADM_METHOD listTransformationConfigPins / listConfigPinHistory / listMethodologyMigrations: ADR-0040 §9 grants
//   methodology.read to ADM_METHOD -> 200, read only.
//
// Callers (seedWorld + one ADM_METHOD-only user, all org A):
//   AUD        (auditor @ org A)                 every P5 mutation -> 403 (404 accepted only where the path names a
//                                                record the fixture cannot have; recorded separately), nothing written
//                                                except authorization.denied;
//   ADM        (ADM_ACCESS + ADM_TECH @ org A)    every P5 mutation and every transformation-scoped P5 read -> never 2xx;
//   ADM_METHOD (methodology admin only @ org A)  every transformation-scoped P5 read and write -> never 2xx.
// Path parameters: transformationId = a real transformation of BU a1; every other id a fresh random UUID; the few
// code-valued parameters a plausible code. Every request carries If-Match "1", an Idempotency-Key and the operation's
// declared request media type. The result table is printed (console) for the evidence log.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openapi, operations } from "../support/contract.ts";
import {
  auditOfRequest,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { P5_OPERATION_IDS } from "../support/p5-operations.ts";

type Json = Record<string, unknown>;
const P5 = operations.filter((o) => P5_OPERATION_IDS.has(o.operationId));
const MUTATIONS = P5.filter((o) => o.method !== "GET");
const T_READS = P5.filter((o) => o.method === "GET" && o.path.includes("{transformationId}"));

// Code-valued path parameters, well-formed per the contract (round-1 re-run: elementType, stableKey, jobCode and the two
// questionCode patterns were added after the first run sent UUIDs there and got 400 validation on the path).
const CODE_PARAMS: Record<string, string> = {
  elementType: "phase",
  stableKey: "phase.diagnose",
  jobCode: "automation.tick_daily",
  recordType: "tom_gap",
  stepNo: "1",
  gateCode: "G1",
  configKind: "methodology",
  kind: "methodology",
  code: "new_transformation_intake",
  definitionCode: "executive_pack",
  versionNo: "1",
  stepKey: "capture_intake",
  key: "methodology",
  queue: "automation.evaluate",
  scheduleCode: "automation.tick_daily",
  format: "csv",
  language: "en",
};

// Round-1 run 3: minimal WELL-FORMED bodies for the writes whose empty body run 2 showed is shape-validated before the
// authorization check (400 validation for AUD); with these, AUD must get 403.
const BODIES: Record<string, unknown> = {
  createFormDraft: { recordType: "tom_gap", payload: {} },
  updateProcedureInstanceInputs: { inputValues: { note: "synthetic" } },
  skipProcedureStep: { reason: "Synthetic sweep reason" },
  assignProcedureStep: { assigneeUserId: "0192aaaa-0000-7000-8000-000000000001" },
  linkProcedureStepEvidence: { evidenceId: "0192aaaa-0000-7000-8000-000000000002" },
  cancelProcedureInstance: { reason: "Synthetic sweep reason" },
  decideApprovalRouteStep: { outcome: "approve" },
  closeGateCondition: { note: "Synthetic sweep note" },
  decideKpiRestatement: { decision: "approve" },
};

const PINNED_AUD_NON_WRITES = new Set(["previewFormula"]);
const PINNED_ADM_JOB_OPS = new Set(["runJobNow"]);
const PINNED_METH_READS = new Set(["listTransformationConfigPins", "listConfigPinHistory", "listMethodologyMigrations"]);

let api: TestApi;
let w: World;
let T: string;
let aud: Session;
let adm: Session;
let meth: Session;
const rows: string[] = [];

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  T = await createTransformationRow(api.db, w.orgA.id, w.a1, w.leadA1.id);
  const methUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, methUser.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  aud = await signIn(api.app, w.auditor.subject);
  adm = await signIn(api.app, w.admin.subject);
  meth = await signIn(api.app, methUser.subject);
}, 120_000);
afterAll(async () => {
  console.log(`\n# SWEEP RESULTS (${rows.length} requests)\n` + rows.join("\n"));
  await api.close();
});

function urlOf(path: string): string {
  return path.replace(/\{([A-Za-z]+)\}/g, (_m, name: string) => {
    if (name === "transformationId") return T;
    if (name === "questionCode") return path.includes("/day-90-test/") ? "q1" : "q01";
    return CODE_PARAMS[name] ?? randomUUID();
  });
}

function mediaOf(path: string, method: string): string | null {
  const op = ((openapi["paths"] as Json)[path] as Json)[method.toLowerCase()] as Json;
  const rb = op["requestBody"] as Json | undefined;
  if (rb === undefined) return null;
  const content = (rb["content"] ?? {}) as Json;
  return Object.keys(content)[0] ?? null;
}

async function send(session: Session, method: string, path: string, operationId = "") {
  const media = method === "GET" ? null : mediaOf(path, method);
  const headers: Record<string, string> = method === "GET" ? {} : { "if-match": '"1"', "idempotency-key": `sweep-${randomUUID()}` };
  let body: unknown = undefined;
  if (media !== null) {
    headers["content-type"] = media;
    body = media === "application/json" ? (BODIES[operationId] ?? {}) : Buffer.from("synthetic");
    if (media !== "application/json") headers["x-file-name"] = "sweep.txt";
  }
  const res = await call(api.app, method, urlOf(path), { session, headers, body, contract: false });
  const written = (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);
  const b = (typeof res.body === "object" && res.body !== null ? res.body : {}) as Json;
  const errs = Array.isArray(b["errors"]) ? (b["errors"] as Json[]).map((e) => `${String(e["pointer"])}:${String(e["code"])}`) : [];
  return { status: res.status, written, code: b["code"] ?? null, errors: errs.join(";") };
}

describe("P5 contract-generated role sweep (code-security-reviewer DG5 r2)", () => {
  it("covers the P5 operations", () => {
    console.log(`P5 operations: ${P5.length}; mutations: ${MUTATIONS.length}; transformation-scoped reads: ${T_READS.length}`);
    expect(P5.length).toBeGreaterThan(150);
  });

  it.each(MUTATIONS.map((o) => [o.operationId, o.method, o.path] as const))(
    "AUD %s (%s %s): 403 (or 404 for an unknown record), only the denial written",
    async (id, method, path) => {
      const r = await send(aud, method, path, id);
      rows.push(`AUD\t${r.status}\t${id}\t${method} ${path}\t${String(r.code)}\t${r.written.join("|")}\t${r.errors}`);
      if (PINNED_AUD_NON_WRITES.has(id)) {
        expect(r.written, JSON.stringify(r)).toEqual([]);
        return;
      }
      expect([403, 404], JSON.stringify(r)).toContain(r.status);
      expect(r.written.filter((a) => a !== "authorization.denied"), JSON.stringify(r)).toEqual([]);
    },
  );

  it.each(MUTATIONS.map((o) => [o.operationId, o.method, o.path] as const))(
    "ADM(tech+access) %s (%s %s): never 2xx, nothing but a denial written",
    async (id, method, path) => {
      const r = await send(adm, method, path);
      rows.push(`ADM\t${r.status}\t${id}\t${method} ${path}\t${String(r.code)}\t${r.written.join("|")}`);
      if (PINNED_ADM_JOB_OPS.has(id)) {
        expect([r.status, r.written], JSON.stringify(r)).toEqual([202, ["job_schedule.run_now"]]);
        expect(path.includes("{transformationId}")).toBe(false);
        return;
      }
      expect(r.status, JSON.stringify(r)).toBeGreaterThanOrEqual(400);
      expect(r.written.filter((a) => a !== "authorization.denied"), JSON.stringify(r)).toEqual([]);
    },
  );

  it.each(T_READS.map((o) => [o.operationId, o.path] as const))(
    "ADM(tech+access) GET %s (%s): transformation-scoped read is not 2xx",
    async (id, path) => {
      const r = await send(adm, "GET", path);
      rows.push(`ADM-READ\t${r.status}\t${id}\tGET ${path}\t${String(r.code)}`);
      expect([403, 404], JSON.stringify(r)).toContain(r.status);
    },
  );

  it.each(T_READS.map((o) => [o.operationId, o.path] as const))(
    "ADM_METHOD GET %s (%s): transformation-scoped read is not 2xx",
    async (id, path) => {
      const r = await send(meth, "GET", path);
      rows.push(`METH-READ\t${r.status}\t${id}\tGET ${path}\t${String(r.code)}`);
      if (PINNED_METH_READS.has(id)) {
        expect(r.status, JSON.stringify(r)).toBe(200);
        return;
      }
      expect([403, 404], JSON.stringify(r)).toContain(r.status);
    },
  );

  it.each(MUTATIONS.filter((o) => o.path.includes("{transformationId}")).map((o) => [o.operationId, o.method, o.path] as const))(
    "ADM_METHOD %s (%s %s): transformation-scoped write is not 2xx",
    async (id, method, path) => {
      const r = await send(meth, method, path);
      rows.push(`METH\t${r.status}\t${id}\t${method} ${path}\t${String(r.code)}\t${r.written.join("|")}`);
      expect(r.status, JSON.stringify(r)).toBeGreaterThanOrEqual(400);
      expect(r.written.filter((a) => a !== "authorization.denied"), JSON.stringify(r)).toEqual([]);
    },
  );
});
