// code-security-reviewer DG5 corrected re-gate round 1 (T-DG5-RG2-SEC-R1): P5 AUD / ADM-only role sweep.
// Disposable probe: copied into the disposable clone as tests/qa/integration/zz-sec-rg2-p5-role-sweep.test.ts and run
// there with tests/qa/support/with-pg.sh; never part of the candidate.
//
// World: a scratch database migrated 0001->0097 and seeded with the REAL synthetic demo dataset (seedDemo; International
// Roaming; MTH_ENV=demo). A setup user (TO + TL @ demo org) creates P5 records through the API (snapshot, export,
// owner update, health check, procedure instance, automation rule as ADM_METHOD), so the path parameters of the
// sweep name EXISTING records wherever the dataset or the setup has one.
// Then, for EVERY P5 operation (apps/api/test/support/p5-operations.ts, 194 ids, taken from docs/api/openapi.yaml):
//   - AUD @ org (inherits): every non-GET is called with body {} and If-Match "1"; the status must never be 2xx, and
//     the per-table row counts of every public table (except audit_event and session/rate bookkeeping) must not change.
//   - ADM_ACCESS + ADM_TECH @ org (ADM-only): every non-GET likewise; every GET: a 200 body must not contain the demo
//     transformation's id (nothing transformation-scoped is disclosed); and /me/navigation hides transformation items.
// The statuses of every call are printed, so the log is the evidence.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { P5_OPERATION_IDS } from "../../../apps/api/test/support/p5-operations.ts";
import { operations } from "../../../apps/api/test/support/contract.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../support/api.ts";

type Body = any;
const ORG = DEMO_ANCHORS.organizationId;
const T_ID = DEMO_ANCHORS.transformationId;
const T = `/api/v1/transformations/${T_ID}`;
interface Op {
  method: string;
  path: string;
  operationId: string;
}
// The contract's operations (docs/api/openapi.yaml, parsed by the API test support), restricted to the P5 ids.
const OPS: Op[] = operations
  .filter((o) => P5_OPERATION_IDS.has(o.operationId))
  .map((o) => ({ method: o.method, path: o.path, operationId: o.operationId }));

let api: TestApi;
let scratch: string | null = null;
let setup: Session;
let aud: Session;
let adm: Session;
const params = new Map<string, string>();
const filledFromWorld = new Set<string>();

async function firstId(sqlText: string): Promise<string | null> {
  const r = await api.owner.query(sqlText);
  return r.rows[0]?.id ?? null;
}

async function tableCounts(): Promise<Map<string, number>> {
  const tables = await api.owner.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       AND tablename NOT IN ('audit_event', 'user_session', 'auth_rate_limit', 'rate_limit_bucket', 'request_execution')
     ORDER BY tablename`,
  );
  const out = new Map<string, number>();
  for (const { tablename } of tables.rows) {
    const c = await api.owner.query(`SELECT count(*)::int AS n FROM "${tablename}"`);
    out.set(tablename, c.rows[0].n);
  }
  return out;
}

function fill(path: string): string {
  return path.replace(/\{(\w+)\}/g, (_, name: string) => params.get(name) ?? randomUUID());
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_sec_rg2_sweep");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const by = DEMO_ANCHORS.users.sp;
  const su = await createUser(api.db, ORG);
  for (const role of ["TO", "TL", "ADM_METHOD"])
    await grant(api.db, by, su.id, role, { type: "organization", id: ORG }, ORG);
  setup = await signIn(api.app, su.subject);
  const au = await createUser(api.db, ORG);
  await grant(api.db, by, au.id, "AUD", { type: "organization", id: ORG }, ORG);
  aud = await signIn(api.app, au.subject);
  const ad = await createUser(api.db, ORG);
  for (const role of ["ADM_ACCESS", "ADM_TECH"]) await grant(api.db, by, ad.id, role, { type: "organization", id: ORG }, ORG);
  adm = await signIn(api.app, ad.subject);

  // Records created through the API by the setup user (each attempt's status is logged; a failure leaves the
  // parameter to the world lookup or a random id, which the log names).
  const tried: Record<string, number> = {};
  const snap = await call<Body>(api.app, "POST", `${T}/reports/charter/generate`, { session: setup, body: {} });
  tried["generate charter"] = snap.status;
  const exp =
    snap.status === 201
      ? await call<Body>(api.app, "POST", "/api/v1/exports", {
          session: setup,
          body: { snapshotId: snap.body.id, format: "pdf", language: "en" },
        })
      : null;
  if (exp) tried["create export"] = exp.status;
  const hc = await call<Body>(api.app, "POST", `${T}/health-checks`, {
    session: setup,
    body: { assessmentDate: "2026-09-01" },
  });
  tried["create health check"] = hc.status;
  const published = await api.owner.query(
    `SELECT id FROM methodology_version WHERE status = 'published' AND config_kind = 'methodology' ORDER BY id DESC LIMIT 1`,
  );
  const draft = await call<Body>(api.app, "POST", "/api/v1/admin/methodology-versions", {
    session: setup,
    body: { basedOnVersionId: published.rows[0]?.id, titleEn: "Sweep draft", titleAr: "مسودة" },
  });
  tried["create config draft"] = draft.status;
  const bv = await call<Body>(api.app, "POST", "/api/v1/procedure-instances", {
    session: setup,
    body: { procedureCode: "baseline_validation", transformationId: T_ID },
  });
  tried["launch baseline_validation in T"] = bv.status;
  const intake = await call<Body>(api.app, "POST", "/api/v1/procedure-instances", {
    session: setup,
    body: { procedureCode: "new_transformation_intake", transformationId: null },
  });
  tried["launch new_transformation_intake (organization scope)"] = intake.status;
  const forums = await call<Body>(api.app, "GET", `${T}/forums`, { session: setup });
  const forum = forums.status === 200 ? (forums.body.items as Body[])[0] : undefined;
  if (forum !== undefined) {
    const m = await call<Body>(api.app, "POST", `${T}/meetings`, {
      session: setup,
      body: { forumId: forum.id, scheduledDate: "2041-07-15", startTime: "10:00", durationMinutes: 60, chairUserId: su.id },
    });
    tried["create meeting"] = m.status;
  }
  console.info(`SWEEP setup statuses: ${JSON.stringify(tried)}`);

  params.set("transformationId", T_ID);
  const lookups: Record<string, string> = {
    approvalId: `SELECT id FROM approval WHERE transformation_id = '${T_ID}' ORDER BY id LIMIT 1`,
    assessmentId: `SELECT id FROM health_assessment ORDER BY id LIMIT 1`,
    attachmentId: `SELECT id FROM form_record_attachment ORDER BY id LIMIT 1`,
    businessCaseId: `SELECT id FROM business_case WHERE transformation_id = '${T_ID}' ORDER BY id LIMIT 1`,
    conditionId: `SELECT id FROM gate_decision_condition ORDER BY id LIMIT 1`,
    digestId: `SELECT id FROM notification_digest ORDER BY id LIMIT 1`,
    draftId: `SELECT id FROM form_draft ORDER BY id LIMIT 1`,
    evidenceId: `SELECT id FROM evidence WHERE transformation_id = '${T_ID}' ORDER BY id LIMIT 1`,
    executionId: `SELECT id FROM automation_execution ORDER BY id LIMIT 1`,
    exportId: `SELECT id FROM export_job ORDER BY id LIMIT 1`,
    failureId: `SELECT id FROM operational_failure ORDER BY id LIMIT 1`,
    instanceId: `SELECT id FROM procedure_instance WHERE transformation_id = '${T_ID}' ORDER BY id LIMIT 1`,
    kpiDefinitionId: `SELECT id FROM kpi_definition WHERE transformation_id = '${T_ID}' ORDER BY id LIMIT 1`,
    meetingId: `SELECT id FROM meeting WHERE transformation_id = '${T_ID}' ORDER BY id LIMIT 1`,
    migrationId: `SELECT id FROM methodology_migration ORDER BY id LIMIT 1`,
    restatementId: `SELECT id FROM kpi_restatement ORDER BY id LIMIT 1`,
    reviewId: `SELECT id FROM config_review_request ORDER BY id LIMIT 1`,
    ruleId: `SELECT id FROM automation_rule ORDER BY id LIMIT 1`,
    snapshotId: `SELECT id FROM report_snapshot ORDER BY id LIMIT 1`,
    taskId: `SELECT id FROM launch_task ORDER BY id LIMIT 1`,
    updateId: `SELECT id FROM owner_update ORDER BY id LIMIT 1`,
    versionId: `SELECT id FROM methodology_version ORDER BY (status = 'draft') DESC, id LIMIT 1`,
    schemeVersionId: `SELECT id FROM methodology_version WHERE config_kind = 'health_check_scheme' ORDER BY id LIMIT 1`,
    recordId: `SELECT id FROM benefit WHERE transformation_id = '${T_ID}' ORDER BY id LIMIT 1`,
  };
  for (const [name, q] of Object.entries(lookups)) {
    try {
      const id = await firstId(q);
      if (id !== null) {
        params.set(name, id);
        filledFromWorld.add(name);
      }
    } catch (err) {
      console.info(`SWEEP lookup ${name} failed: ${(err as Error).message}`);
    }
  }
  for (const [k, v] of Object.entries({
    blockRef: "B0001",
    configKind: "methodology",
    definitionCode: "charter",
    elementType: "gate",
    jobCode: "gates.reminders",
    procedureCode: "new_transformation_intake",
    questionCode: "q1",
    recordType: "benefit",
    stableKey: "G1",
    stepKey: "record_baseline",
    stepNo: "1",
    templateCode: "charter",
    versionNo: "1",
  }))
    params.set(k, v);
  const missing = OPS.flatMap((o) => [...o.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)).filter(
    (n) => !params.has(n),
  );
  console.info(
    `SWEEP params from world: ${[...filledFromWorld].sort().join(",")}; random uuid for: ${[...new Set(missing)].sort().join(",") || "(none)"}`,
  );
}, 600_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

async function sweepWrites(who: string, session: Session) {
  const writes = OPS.filter((o) => o.method !== "GET");
  const before = await tableCounts();
  const statuses: Record<string, string> = {};
  const successes: string[] = [];
  for (const o of writes) {
    const url = fill(o.path);
    const r = await call<Body>(api.app, o.method, url, { session, body: {}, headers: { "if-match": '"1"' } });
    statuses[o.operationId] = `${r.status}${r.body?.code ? ` ${r.body.code}` : ""}`;
    if (r.status < 300) successes.push(`${o.operationId} ${r.status}`);
  }
  const after = await tableCounts();
  const changed = [...after].filter(([t, n]) => before.get(t) !== n).map(([t, n]) => `${t}:${before.get(t)}->${n}`);
  const hist: Record<string, number> = {};
  for (const s of Object.values(statuses)) hist[s.split(" ")[0]!] = (hist[s.split(" ")[0]!] ?? 0) + 1;
  console.info(`SWEEP ${who} writes (${writes.length}): histogram ${JSON.stringify(hist)}`);
  console.info(`SWEEP ${who} writes detail: ${JSON.stringify(statuses)}`);
  console.info(`SWEEP ${who} writes 2xx: ${JSON.stringify(successes)}; tables changed: ${JSON.stringify(changed)}`);
  return { successes, changed, statuses };
}

describe("P5 role sweep (AUD, ADM-only) on the demo dataset", () => {
  it("AUD: no P5 write succeeds, and no table changes", async () => {
    const r = await sweepWrites("AUD", aud);
    // putMyNotificationPreferences is the caller's own preference (like P1 updateMyPreferences); reported, not failed.
    expect(r.successes.filter((s) => !s.startsWith("putMyNotificationPreferences"))).toEqual([]);
    expect(r.changed.filter((c) => !c.startsWith("notification_preference"))).toEqual([]);
  }, 600_000);

  it("ADM-only: no P5 write succeeds, and no table changes", async () => {
    const r = await sweepWrites("ADM", adm);
    expect(r.successes.filter((s) => !s.startsWith("putMyNotificationPreferences"))).toEqual([]);
    expect(r.changed.filter((c) => !c.startsWith("notification_preference"))).toEqual([]);
  }, 600_000);

  it("ADM-only: no P5 read discloses the demo transformation", async () => {
    const reads = OPS.filter((o) => o.method === "GET");
    const statuses: Record<string, number> = {};
    const disclosed: string[] = [];
    const operational: string[] = [];
    const OPERATIONAL = new Set([
      "listAutomationExecutions",
      "getAutomationExecution",
      "listAutomationFailures",
      "getAutomationFailure",
      "listJobOperations",
      "getJobOperation",
    ]);
    for (const o of reads) {
      const r = await call<Body>(api.app, "GET", fill(o.path), { session: adm });
      statuses[o.operationId] = r.status;
      const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? "");
      // ADR-0043 §8: ADM_TECH holds automation.read/job.read for the operational execution history and failure queue
      // (documented design); those two lists are reported separately, not counted as a disclosure.
      if (r.status === 200 && text.includes(T_ID))
        (OPERATIONAL.has(o.operationId) ? operational : disclosed).push(o.operationId);
    }
    const hist: Record<string, number> = {};
    for (const s of Object.values(statuses)) hist[s] = (hist[s] ?? 0) + 1;
    console.info(`SWEEP ADM reads (${reads.length}): histogram ${JSON.stringify(hist)}`);
    console.info(`SWEEP ADM reads detail: ${JSON.stringify(statuses)}`);
    console.info(`SWEEP ADM reads disclosing the demo transformation id: ${JSON.stringify(disclosed)}`);
    console.info(`SWEEP ADM operational reads (ADR-0043 §8) naming the demo transformation id: ${JSON.stringify(operational)}`);
    expect(disclosed).toEqual([]);
  }, 600_000);

  it("ADM-only: navigation hides transformation-scoped items; AUD navigation shown for comparison", async () => {
    const a = await call<Body>(api.app, "GET", "/api/v1/me/navigation", { session: adm });
    const u = await call<Body>(api.app, "GET", "/api/v1/me/navigation", { session: aud });
    console.info(`SWEEP navigation ADM ${a.status}: ${JSON.stringify(a.body)}`);
    console.info(`SWEEP navigation AUD ${u.status}: ${JSON.stringify(u.body)}`);
    expect(a.status).toBe(200);
    expect(JSON.stringify(a.body)).not.toContain(T_ID);
  });
});

// Database-level probes on the same migrated + demo-seeded scratch database (owner role; each in a rolled-back
// transaction where it writes).
describe("database probes (0094 triggers re-enabled, migration list, 0096 Rule A refusals)", () => {
  it("every gate_instance trigger is enabled after 0094 (tgenabled = 'O')", async () => {
    const r = await api.owner.query(
      `SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'gate_instance'::regclass AND NOT tgisinternal ORDER BY tgname`,
    );
    console.info(`PROBE gate_instance triggers: ${JSON.stringify(r.rows)}`);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.filter((x: Body) => x.tgenabled !== "O")).toEqual([]);
    const all = await api.owner.query(
      `SELECT c.relname, t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled <> 'O' ORDER BY 1, 2`,
    );
    console.info(`PROBE public triggers NOT enabled: ${JSON.stringify(all.rows)}`);
    expect(all.rows).toEqual([]);
  });

  it("the applied migrations are 0001..0097 minus exactly the eight retired P5 ids, in order", async () => {
    const cols = await api.owner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'schema_migration' ORDER BY ordinal_position`,
    );
    const r = await api.owner.query(`SELECT * FROM schema_migration`);
    const ids = r.rows
      .map((x: Body) => String(x.name ?? x.id).slice(0, 4))
      .sort();
    console.info(`PROBE schema_migration columns ${JSON.stringify(cols.rows.map((c: Body) => c.column_name))}; ids ${ids.join(",")}`);
    const retired = new Set(["0066", "0067", "0073", "0077", "0078", "0079", "0083", "0084"]);
    const expected = Array.from({ length: 97 }, (_, i) => String(i + 1).padStart(4, "0")).filter((x) => !retired.has(x));
    expect(ids).toEqual(expected);
  });

  it("0096 Rule A: changing a step's transformation_id outside the one adoption is refused at the database", async () => {
    const step = await api.owner.query(
      `SELECT id, transformation_id, version FROM procedure_step_instance WHERE transformation_id IS NOT NULL ORDER BY id LIMIT 1`,
    );
    const other = await api.owner.query(`SELECT id FROM transformation WHERE id <> $1 ORDER BY id LIMIT 1`, [T_ID]);
    const nullStep = await api.owner.query(
      `SELECT s.id, s.version FROM procedure_step_instance s WHERE s.transformation_id IS NULL ORDER BY s.id LIMIT 1`,
    );
    const outcomes: Record<string, string> = {};
    const attempt = async (label: string, text: string, values: unknown[]) => {
      const c = await api.owner.connect();
      try {
        await c.query("BEGIN");
        await c.query(text, values);
        outcomes[label] = "ACCEPTED";
      } catch (err) {
        outcomes[label] = `refused: ${(err as { constraint?: string }).constraint ?? (err as Error).message}`;
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    };
    if (step.rows[0]) {
      const s = step.rows[0];
      const target = s.transformation_id === T_ID ? (other.rows[0]?.id ?? null) : T_ID;
      await attempt(
        "T -> another T",
        `UPDATE procedure_step_instance SET transformation_id = $2, version = version + 1 WHERE id = $1`,
        [s.id, target],
      );
      await attempt(
        "T -> NULL",
        `UPDATE procedure_step_instance SET transformation_id = NULL, version = version + 1 WHERE id = $1`,
        [s.id],
      );
    }
    if (nullStep.rows[0])
      await attempt(
        "NULL -> T without a completed capture_intake output link",
        `UPDATE procedure_step_instance SET transformation_id = $2, version = version + 1 WHERE id = $1`,
        [nullStep.rows[0].id, T_ID],
      );
    console.info(
      `PROBE 0096 Rule A: step with T ${step.rows[0]?.id ?? "(none in dataset)"}, step with NULL ${nullStep.rows[0]?.id ?? "(none in dataset)"}: ${JSON.stringify(outcomes)}`,
    );
    expect(Object.values(outcomes).length).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(outcomes)) expect(v, k).toMatch(/refused: procedure_step_instance_identity_immutable/);
  });
});

// Second AUD pass: the operations that answered 400 (body validated before the permission) or 404 (form routes need a
// form record type code and a record of it) in the first pass, now with VALID bodies and a real T02 outcome record, so
// that only the permission decides. Expected: 403 and no table change.
describe("AUD with valid bodies on the 400/404 operations of the first pass", () => {
  it("each answers 403 (or a documented non-write), and no table changes", async () => {
    const outcome = await api.owner.query(`SELECT id FROM outcome WHERE transformation_id = $1 ORDER BY id LIMIT 1`, [T_ID]);
    const evidence = params.get("evidenceId")!;
    const restatement = params.get("restatementId")!;
    const p = new Map(params);
    p.set("recordType", "T02");
    if (outcome.rows[0]) p.set("recordId", outcome.rows[0].id);
    const bodies: Record<string, unknown> = {
      putFormRecordCustomFields: { values: {} },
      createFormRecordComment: { body: "AUD sweep comment" },
      attachFormRecordEvidence: { evidenceId: evidence },
      removeFormRecordAttachment: { reason: "AUD sweep reason" },
      bulkUpdateFormRecords: { items: [{ recordId: p.get("recordId"), version: 1, customFieldValues: {} }] },
      createFormDraft: { recordType: "T02", payload: {} },
      updateProcedureInstanceInputs: { inputValues: { metric: "m" } },
      skipProcedureStep: { reason: "AUD sweep reason" },
      assignProcedureStep: { assigneeUserId: aud.userId },
      linkProcedureStepEvidence: { evidenceId: evidence },
      cancelProcedureInstance: { reason: "AUD sweep reason" },
      decideApprovalRouteStep: { outcome: "approve" },
      closeGateCondition: { note: "AUD sweep note" },
      decideKpiRestatement: { decision: "approve" },
      putHealthCheckAnswer: { response: "yes" },
      previewFormula: { exampleCode: "revenue_uplift" },
    };
    void restatement;
    const fillP = (path: string) => path.replace(/\{(\w+)\}/g, (_, n: string) => p.get(n) ?? randomUUID());
    const before = await tableCounts();
    const out: Record<string, string> = {};
    for (const [opId, body] of Object.entries(bodies)) {
      const o = OPS.find((x) => x.operationId === opId);
      if (o === undefined) {
        out[opId] = "operation not in the P5 list";
        continue;
      }
      const r = await call<Body>(api.app, o.method, fillP(o.path), { session: aud, body, headers: { "if-match": '"1"' } });
      out[opId] = `${r.status}${r.body?.code ? ` ${r.body.code}` : ""}`;
    }
    const after = await tableCounts();
    const changed = [...after].filter(([t, n]) => before.get(t) !== n).map(([t, n]) => `${t}:${before.get(t)}->${n}`);
    console.info(`SWEEP AUD valid-body pass: ${JSON.stringify(out)}; tables changed: ${JSON.stringify(changed)}`);
    expect(changed).toEqual([]);
    const writes2xx = Object.entries(out).filter(([k, v]) => /^2/.test(v) && k !== "previewFormula");
    expect(writes2xx).toEqual([]);
  }, 120_000);
});

describe("export download authorization (requester only; ADR-0046 §5)", () => {
  it("a reader of the transformation who did not request the export gets 404 on read and download, and does not list it", async () => {
    const exportId = params.get("exportId");
    expect(exportId, "the setup created an export").toBeDefined();
    const own = await call<Body>(api.app, "GET", `/api/v1/exports/${exportId}`, { session: setup });
    const t = await call<Body>(api.app, "GET", T, { session: aud });
    const one = await call<Body>(api.app, "GET", `/api/v1/exports/${exportId}`, { session: aud });
    const dl = await call<Body>(api.app, "GET", `/api/v1/exports/${exportId}/download`, { session: aud });
    const list = await call<Body>(api.app, "GET", "/api/v1/exports", { session: aud });
    const admOne = await call<Body>(api.app, "GET", `/api/v1/exports/${exportId}`, { session: adm });
    console.info(
      `PROBE export ${exportId}: requester GET ${own.status}; AUD GET transformation ${t.status}, GET export ${one.status}, download ${dl.status}, list ${list.status} items ${JSON.stringify(list.body?.items?.map((x: Body) => x.id))}; ADM GET export ${admOne.status}`,
    );
    expect(own.status).toBe(200);
    expect(t.status).toBe(200);
    expect(one.status).toBe(404);
    expect(dl.status).toBe(404);
    expect(list.body.items.some((x: Body) => x.id === exportId)).toBe(false);
    expect(admOne.status).toBe(404);
  });
});
