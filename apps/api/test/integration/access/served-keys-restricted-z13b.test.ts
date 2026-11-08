// T-DG6-BE-Z13B (D-227 (1); D-218; ADR-0051 §2; REQ-S10-002 "a sensitive benefit is hidden from a workstream member
// without the grant"): a served text built from record ids (an idempotency, trigger, event or scope key; an error text)
// never names a sensitive record, or a child that carries one's values, to a reader who is not admitted to it. The hidden
// id is replaced by the restricted marker "[restricted]" and the item carries `includesRestrictedRecords: true`; the
// stored row is unchanged. Each column comes from its real producer:
//   - OperationalFailure.idempotencyKey / errorMessage: the worker's captureJobFailure of a failed job whose envelope
//     key is `benefit.variance_evaluated:<measurementId>` (the measurement is a child of the benefit) and whose error
//     text names the benefit (the shape of handleBenefitVariance's own error);
//   - AutomationExecution.triggerKey / actionResults[].idempotencyKey: the worker's raid.corrective_benefit handler as
//     DOMAIN_HANDLERS registers it (wrapped as the starter rule starter.kpi_deviation), delivered the variance event;
//   - IntegrationRun.idempotencyKey: runConnector with an Idempotency-Key naming the benefit (`manual:<user>:<key>`),
//     read through listIntegrationRuns, getIntegrationRun and the connector's lastRun;
//   - OutboundWrite.idempotencyKey: executeOutboundWrite with a key naming the benefit, read by another reader;
//   - CorrectiveCase.sourceScopeKey: a Value Review case whose finding reference names the benefit.
// Positive: after an explicit sensitive-record grant the same reader sees the real ids and no marker; an unrelated key
// is never touched. Authorization: another organization's reader gets 404, a reader without the right 403.
// Every value is SYNTHETIC. Marking a record sensitive or granting access is an access decision, never a business or
// Finance approval (G1-G6), and nothing here touches DG0-DG7.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOMAIN_HANDLERS } from "../../../../worker/src/handlers/index.ts";
import { captureJobFailure } from "../../../../worker/src/kit.ts";
import { installDefaultConnectorAdapters } from "../../../src/modules/integrations/runs.ts";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import {
  benefitAt,
  insertDeliverable,
  insertInitiative,
  insertSubmittedMeasurement,
  seedBenefitWorld,
  type BenefitWorld,
} from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let b: BenefitWorld;
let office: Session; // TO @ A: marks records and grants (sensitive_record.grant)
let tech: Session; // ADM_TECH only @ A: job.read, connector.read/configure/run; not admitted to the benefit
let techUserId: string;
let auditor: Session; // AUD @ A: automation.read, connector.read, outbound_write.read; not admitted
let outsider: Session; // TO @ B
let td: Session; // TD @ the transformation: outbound_write.execute
const MARKER = "[restricted]";
const S = { benefit: "", code: "", measurement: "", ruleExecution: "", failure: "", connector: "", run: "" };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (r: { status: number; body: Body }, status = 200) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
};
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const varianceHandler = DOMAIN_HANDLERS.find((h) => h.queue === "raid.corrective_benefit")!;

const varianceEnvelope = () => ({
  outboxEventId: randomUUID(),
  eventType: "benefit.variance_evaluated",
  schemaVersion: 1,
  // The real producer's key (apps/worker/src/handlers/benefits.ts): the measurement id, a child of the benefit.
  idempotencyKey: `benefit.variance_evaluated:${S.measurement}`,
  organizationId: b.organizationId,
  payload: {
    benefitId: S.benefit,
    measurementId: S.measurement,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    plannedAmount: "100000.0000",
    measuredAmount: "80000.0000",
    variance: "-20000.0000",
    offTrack: true,
  },
});

async function grantTo(userId: string) {
  ok(
    await send("POST", "/api/v1/admin/sensitive-grants", {
      session: office,
      body: {
        transformationId: b.transformationId,
        recordType: "benefit",
        recordId: S.benefit,
        granteeUserId: userId,
        reason: "Synthetic need to know (BE-Z13B served keys)",
      },
    }),
    201,
  );
}

beforeAll(async () => {
  api = await startApi();
  installDefaultConnectorAdapters();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  // w.admin also holds ADM_ACCESS (sensitive_record.grant at the organization), which admits it: a technical
  // administrator with ADM_TECH alone is the reader who is not admitted.
  const techUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, techUser.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
  techUserId = techUser.id;
  [office, tech, auditor, outsider] = await Promise.all([
    signIn(api.app, w.office.subject),
    signIn(api.app, techUser.subject),
    signIn(api.app, w.auditor.subject),
    signIn(api.app, w.officeB.subject),
  ]);
  const tdUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, tdUser.id, "TD", { type: "transformation", id: b.transformationId }, w.orgA.id);
  td = await signIn(api.app, tdUser.subject);
  const hidden = await benefitAt(api, b, "measure");
  S.benefit = hidden.id;
  S.code = hidden.code;
  S.measurement = await insertSubmittedMeasurement(api.db, b, S.benefit, "80000.00");
  ok(
    await send("PUT", `${b.base}/records/benefit/${S.benefit}/sensitivity`, {
      session: office,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit (BE-Z13B served keys)" },
    }),
  );
}, 180_000);
afterAll(async () => {
  await api?.close();
});

describe("D-227 (1): served keys that embed a hidden record id show the restricted marker", () => {
  it("failure queue: the job's idempotency key and error message (captureJobFailure) are redacted for ADM_TECH", async () => {
    const envelope = varianceEnvelope();
    const failure = await captureJobFailure(api.db, {
      queue: "raid.corrective_benefit",
      jobId: randomUUID(),
      data: envelope,
      attempts: 6,
      error: new Error(`benefit ${S.benefit} is not in organization ${w.orgB.id}`),
    });
    S.failure = failure.failureId;
    const unrelated = await captureJobFailure(api.db, {
      queue: "gates.decided",
      jobId: randomUUID(),
      data: { ...envelope, eventType: "gate.decided", idempotencyKey: `gate.decided:${randomUUID()}` },
      attempts: 6,
      error: new Error("synthetic unrelated fault"),
    });
    const one = ok(await send("GET", `/api/v1/admin/automation-failures/${S.failure}`, { session: tech }));
    expect(one.idempotencyKey).toBe(`benefit.variance_evaluated:${MARKER}`);
    expect(one.errorMessage).toBe(`benefit ${MARKER} is not in organization ${w.orgB.id}`);
    expect(one.includesRestrictedRecords).toBe(true);
    const list = ok(await send("GET", "/api/v1/admin/automation-failures?source=job&limit=100", { session: tech }));
    const listed = list.items.find((f: Body) => f.id === S.failure);
    expect(listed).toMatchObject({
      idempotencyKey: `benefit.variance_evaluated:${MARKER}`,
      includesRestrictedRecords: true,
    });
    const other = list.items.find((f: Body) => f.id === unrelated.failureId);
    expect(other.idempotencyKey).toMatch(/^gate\.decided:[0-9a-f-]{36}$/);
    expect(other).not.toHaveProperty("includesRestrictedRecords");
    for (const body of [one, list]) {
      expect(JSON.stringify(body)).not.toContain(S.measurement);
      expect(JSON.stringify(body)).not.toContain(S.benefit);
    }
    // The stored row keeps the real key (the redaction is a view).
    const row = await api.db
      .selectFrom("operational_failure")
      .select(["idempotency_key", "error_message"])
      .where("id", "=", S.failure)
      .executeTakeFirstOrThrow();
    expect(row.idempotency_key).toBe(`benefit.variance_evaluated:${S.measurement}`);
    expect(row.error_message).toContain(S.benefit);
    // The repair response (dismiss: If-Match, audited) is redacted the same way.
    const dismissed = ok(
      await send("POST", `/api/v1/admin/automation-failures/${S.failure}/dismiss`, {
        session: tech,
        headers: ifm(one.version),
        body: { reason: "Synthetic: dismissed by the BE-Z13B test" },
      }),
    );
    expect(dismissed).toMatchObject({
      status: "dismissed",
      idempotencyKey: `benefit.variance_evaluated:${MARKER}`,
      includesRestrictedRecords: true,
    });
    // Authorization: another organization's reader 404 (existence not disclosed); AUD holds no job.read here.
    expect((await send("GET", `/api/v1/admin/automation-failures/${S.failure}`, { session: outsider })).status).toBe(
      404,
    );
    expect((await send("GET", `/api/v1/admin/automation-failures/${S.failure}`, { session: auditor })).status).toBe(
      404,
    );
  });

  it("execution history: the trigger key and every action result's key (real starter execution) are redacted for AUD", async () => {
    await varianceHandler.handle(api.db, varianceEnvelope(), `be-z13b-${randomUUID()}`);
    const exec = await api.db
      .selectFrom("automation_execution")
      .select(["id", "trigger_key", "automation_rule_id"])
      .where("trigger_key", "=", `benefit.variance_evaluated:${S.measurement}`)
      .executeTakeFirstOrThrow();
    S.ruleExecution = exec.id;
    const stored = await api.db
      .selectFrom("automation_action_result")
      .select("idempotency_key")
      .where("automation_execution_id", "=", exec.id)
      .execute();
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((r) => r.idempotency_key.includes(S.measurement))).toBe(true);

    const one = ok(await send("GET", `/api/v1/admin/automation-executions/${exec.id}`, { session: auditor }));
    expect(one.triggerKey).toBe(`benefit.variance_evaluated:${MARKER}`);
    expect(one.actionResults.length).toBe(stored.length);
    for (const r of one.actionResults) expect(r.idempotencyKey).toContain(MARKER);
    expect(one.includesRestrictedRecords).toBe(true);
    const list = ok(
      await send("GET", `/api/v1/admin/automation-executions?ruleId=${exec.automation_rule_id}&limit=100`, {
        session: auditor,
      }),
    );
    expect(list.items.find((e: Body) => e.id === exec.id)).toMatchObject({
      triggerKey: `benefit.variance_evaluated:${MARKER}`,
      includesRestrictedRecords: true,
    });
    for (const body of [one, list]) expect(JSON.stringify(body)).not.toContain(S.measurement);
    // Authorization: another organization's reader 404.
    expect((await send("GET", `/api/v1/admin/automation-executions/${exec.id}`, { session: outsider })).status).toBe(
      404,
    );
  });

  it("integration runs: a caller's Idempotency-Key naming the benefit is redacted in the run, its detail and lastRun", async () => {
    const created = ok(
      await send("POST", "/api/v1/admin/connectors", {
        session: tech,
        body: {
          organizationId: w.orgA.id,
          code: uniq("z13b-").toLowerCase(),
          nameEn: "Synthetic downstream (BE-Z13B)",
          nameAr: "نظام لاحق اصطناعي",
          adapterKind: "test_adapter",
          targetKind: "none",
          config: {
            sourceSystemId: "synthetic.downstream:z13b",
            endpointUrl: null,
            credentialRefs: {},
            fieldMappings: [],
            targetTransformationId: null,
            cadence: "manual",
            retryMaxAttempts: 0,
            retryBackoffSeconds: 60,
            commitMode: "manual",
            commitOnBehalfOf: null,
            outboundActions: ["deliverable_status_push"],
            reconciliationRule: "none",
            adapterSettings: { mode: "healthy" },
            reason: "Synthetic downstream for the BE-Z13B served-keys suite.",
          },
        },
      }),
      201,
    );
    S.connector = created.id;
    ok(
      await send("POST", `/api/v1/admin/connectors/${S.connector}/enable`, {
        session: tech,
        headers: ifm(1),
        body: { reason: null },
      }),
    );
    const queued = await send("POST", `/api/v1/admin/connectors/${S.connector}/runs`, {
      session: tech,
      body: {},
      headers: { "idempotency-key": `vr-${S.benefit}` },
    });
    expect([200, 202], JSON.stringify(queued.body)).toContain(queued.status);
    S.run = queued.body.id;
    const stored = await api.db
      .selectFrom("integration_run")
      .select("idempotency_key")
      .where("id", "=", S.run)
      .executeTakeFirstOrThrow();
    expect(stored.idempotency_key).toContain(S.benefit);
    const expected = { idempotencyKey: expect.stringContaining(`vr-${MARKER}`), includesRestrictedRecords: true };
    expect(queued.body).toMatchObject(expected);
    const list = ok(await send("GET", `/api/v1/admin/connectors/${S.connector}/runs`, { session: auditor }));
    expect(list.items.find((r: Body) => r.id === S.run)).toMatchObject(expected);
    const detail = ok(await send("GET", `/api/v1/admin/connectors/${S.connector}/runs/${S.run}`, { session: auditor }));
    expect(detail.run).toMatchObject(expected);
    const connector = ok(await send("GET", `/api/v1/admin/connectors/${S.connector}`, { session: auditor }));
    expect(connector.lastRun).toMatchObject(expected);
    for (const body of [queued.body, list, detail, connector]) expect(JSON.stringify(body)).not.toContain(S.benefit);
    expect((await send("GET", `/api/v1/admin/connectors/${S.connector}/runs`, { session: outsider })).status).toBe(404);
  });

  it("outbound writes: a key naming the benefit is redacted for another reader (list and detail)", async () => {
    const fixture = { organizationId: w.orgA.id, transformationId: b.transformationId, users: b.users } as BenefitWorld;
    const deliverableId = await insertDeliverable(api.db, fixture, await insertInitiative(api.db, fixture));
    const base = `/api/v1/transformations/${b.transformationId}/outbound-writes`;
    const res = await send("POST", base, {
      session: td,
      body: {
        connectorId: S.connector,
        actionCode: "deliverable_status_push",
        deliverableId,
        idempotencyKey: `ow-${S.benefit}`,
        payload: { status: "accepted", note: "Synthetic status push (BE-Z13B)" },
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const writeId = res.body.id as string;
    const expected = { idempotencyKey: `ow-${MARKER}`, includesRestrictedRecords: true };
    const list = ok(await send("GET", base, { session: auditor }));
    expect(list.items.find((x: Body) => x.id === writeId)).toMatchObject(expected);
    const detail = ok(await send("GET", `${base}/${writeId}`, { session: auditor }));
    expect(detail.write).toMatchObject(expected);
    for (const body of [list, detail]) expect(JSON.stringify(body)).not.toContain(S.benefit);
    expect((await send("GET", `${base}/${writeId}`, { session: outsider })).status).toBe(404);
  });

  it("corrective case: a Value Review finding reference naming the benefit is redacted in sourceScopeKey for FIN", async () => {
    const created = ok(
      await send("POST", `${b.base}/corrective-actions`, {
        session: b.s.tl,
        body: {
          findingRef: `VR ${S.benefit}`,
          title: "Synthetic Value Review finding (BE-Z13B)",
          ownerUserId: b.users.tl.id,
          followUpDate: "2027-01-31",
        },
      }),
      201,
    );
    const stored = await api.db
      .selectFrom("corrective_case")
      .select("source_scope_key")
      .where("id", "=", created.id)
      .executeTakeFirstOrThrow();
    expect(stored.source_scope_key).toBe(`value_review:vr ${S.benefit}`);
    const one = ok(await send("GET", `${b.base}/corrective-actions/${created.id}`, { session: b.s.fin }));
    expect(one).toMatchObject({ sourceScopeKey: `value_review:vr ${MARKER}`, includesRestrictedRecords: true });
    const list = ok(await send("GET", `${b.base}/corrective-actions?limit=100`, { session: b.s.fin }));
    expect(list.items.find((c: Body) => c.id === created.id)).toMatchObject({
      sourceScopeKey: `value_review:vr ${MARKER}`,
      includesRestrictedRecords: true,
    });
    for (const body of [one, list]) expect(JSON.stringify(body)).not.toContain(S.benefit);
    expect((await send("GET", `${b.base}/corrective-actions/${created.id}`, { session: outsider })).status).toBe(404);
  });

  it("after an explicit grant, the same readers see the real keys and no marker", async () => {
    await grantTo(techUserId);
    await grantTo(w.auditor.id);
    await grantTo(b.users.fin.id);
    const failure = ok(await send("GET", `/api/v1/admin/automation-failures/${S.failure}`, { session: tech }));
    expect(failure.idempotencyKey).toBe(`benefit.variance_evaluated:${S.measurement}`);
    expect(failure).not.toHaveProperty("includesRestrictedRecords");
    const exec = ok(await send("GET", `/api/v1/admin/automation-executions/${S.ruleExecution}`, { session: auditor }));
    expect(exec.triggerKey).toBe(`benefit.variance_evaluated:${S.measurement}`);
    expect(exec).not.toHaveProperty("includesRestrictedRecords");
    const run = ok(await send("GET", `/api/v1/admin/connectors/${S.connector}/runs/${S.run}`, { session: auditor }));
    expect(run.run.idempotencyKey).toContain(S.benefit);
    expect(run.run).not.toHaveProperty("includesRestrictedRecords");
    const cases = ok(await send("GET", `${b.base}/corrective-actions?limit=100`, { session: b.s.fin }));
    expect(cases.items.some((c: Body) => c.sourceScopeKey === `value_review:vr ${S.benefit}`)).toBe(true);
  });
});
