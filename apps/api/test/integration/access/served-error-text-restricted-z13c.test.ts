// T-DG6-BE-Z13C (D-228 (2), extending D-227 (1); D-218; ADR-0051 §2; REQ-S10-002 "a sensitive benefit is hidden from a
// workstream member without the grant"): every served error text column (`(^|_)error_(message|detail)$`) never names
// a sensitive record, or a child that carries one's values, to a reader who is not admitted to it. The hidden id is
// replaced by the restricted marker "[restricted]" and the item carries `includesRestrictedRecords: true`; the stored
// row is unchanged. The two columns this task adds, each from its real producer:
//   - OperationalException.lastErrorMessage: the worker's captureJobFailure of a failed job whose error text names the
//     benefit (the shape of handleBenefitVariance's own error) opens the queue's `job_failed` exception in the same
//     transaction; read through listOperationalExceptions, getOperationalException, acknowledge and resolve;
//   - IntegrationRun.errorMessage (and the actionableError params parsed from it): testConnector of a connector whose
//     credential reference (a file name) embeds the benefit id fails with connector.secret_unresolvable naming the secret;
//     read through the testConnector response, listIntegrationRuns, getIntegrationRun and getConnector.
//   - AutomationExecution.errorDetail (masked since T-DG6-BE-Z13B, first exercised here): the worker's starter wrapper
//     runAsStarter (starter.kpi_deviation on raid.corrective_benefit) around a handler that throws handleBenefitVariance's
//     error text on its last attempt records the failed execution with that text. The handler is a stand-in because the
//     real throw needs an envelope of another organization (D-228 (4): cross-organization ids are out of scope).
// (OperationalFailure.errorMessage is masked since T-DG6-BE-Z13B and exercised by served-keys-restricted-z13b.test.ts.) Positive: after an explicit sensitive-record grant the same readers see the
// real text and no marker; an unrelated error text is never touched. Authorization: another organization's reader gets
// 404, AUD (operations.read only) gets 403 on acknowledge.
// Every value is SYNTHETIC. Marking a record sensitive or granting access is an access decision, never a business or
// Finance approval (G1-G6); acknowledging an operational exception approves nothing; nothing here touches DG0-DG7.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAsStarter, STARTER_RULE_BY_QUEUE } from "../../../../worker/src/automation/starters.ts";
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
import { bindSecrets } from "../../support/secret-bindings.ts";
import { benefitAt, insertSubmittedMeasurement, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let b: BenefitWorld;
let office: Session; // TO @ A: marks records and grants (sensitive_record.grant)
let tech: Session; // ADM_TECH only @ A: operations.read/acknowledge, connector.read/configure/run; not admitted
let techUserId: string;
let auditor: Session; // AUD @ A: operations.read, connector.read; not admitted
let outsider: Session; // TO @ B
const MARKER = "[restricted]";
const S = { benefit: "", measurement: "", exception: "", otherException: "", connector: "", run: "", execution: "" };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (r: { status: number; body: Body }, status = 200) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
};
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const EXC = "/api/v1/admin/operations/exceptions";
let unbindSecrets: () => void = () => undefined;

async function grantTo(userId: string) {
  ok(
    await send("POST", "/api/v1/admin/sensitive-grants", {
      session: office,
      body: {
        transformationId: b.transformationId,
        recordType: "benefit",
        recordId: S.benefit,
        granteeUserId: userId,
        reason: "Synthetic need to know (BE-Z13C served error texts)",
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
  S.benefit = (await benefitAt(api, b, "measure")).id;
  S.measurement = await insertSubmittedMeasurement(api.db, b, S.benefit, "80000.00");
  // IT binds the connector's credential reference the way the manifest does (a name, never a value); no file exists,
  // so the test run fails with connector.secret_unresolvable naming it.
  unbindSecrets = bindSecrets([
    {
      provider: "file",
      name: `z13c-${S.benefit}`,
      consumer: "connector",
      organization: w.orgA.code,
      hosts: ["source.example.invalid"],
    },
  ]);
  ok(
    await send("PUT", `${b.base}/records/benefit/${S.benefit}/sensitivity`, {
      session: office,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit (BE-Z13C served error texts)" },
    }),
  );
}, 180_000);
afterAll(async () => {
  unbindSecrets();
  await api?.close();
});

describe("D-228 (2): served error texts that embed a hidden record id show the restricted marker", () => {
  it("operational exception: lastErrorMessage (job failure) is redacted in list, get, acknowledge and resolve", async () => {
    const envelope = {
      outboxEventId: randomUUID(),
      eventType: "benefit.variance_evaluated",
      schemaVersion: 1,
      idempotencyKey: `benefit.variance_evaluated:${randomUUID()}`,
      organizationId: b.organizationId,
      payload: { benefitId: S.benefit },
    };
    const failure = await captureJobFailure(api.db, {
      queue: "raid.corrective_benefit",
      jobId: randomUUID(),
      data: envelope,
      attempts: 6,
      error: new Error(`benefit ${S.benefit} is not in organization ${w.orgB.id}`),
    });
    const other = await captureJobFailure(api.db, {
      queue: "gates.decided",
      jobId: randomUUID(),
      data: { ...envelope, eventType: "gate.decided", idempotencyKey: `gate.decided:${randomUUID()}` },
      attempts: 6,
      error: new Error("synthetic unrelated fault"),
    });
    const rows = await api.db
      .selectFrom("operational_exception")
      .select(["id", "last_error_message", "source_code"])
      .where("organization_id", "=", w.orgA.id)
      .where("source_code", "in", ["raid.corrective_benefit", "gates.decided"])
      .execute();
    const hiddenRow = rows.find((r) => r.source_code === "raid.corrective_benefit")!;
    // The stored row keeps the real text (the redaction is a view).
    expect(hiddenRow.last_error_message).toContain(S.benefit);
    S.exception = hiddenRow.id;
    S.otherException = rows.find((r) => r.source_code === "gates.decided")!.id;
    expect(failure.failureId).toBeTruthy();
    expect(other.failureId).toBeTruthy();

    const expected = {
      lastErrorMessage: `benefit ${MARKER} is not in organization ${w.orgB.id}`,
      includesRestrictedRecords: true,
    };
    const list = ok(await send("GET", `${EXC}?organizationId=${w.orgA.id}&limit=100`, { session: tech }));
    expect(list.items.find((e: Body) => e.id === S.exception)).toMatchObject(expected);
    const unrelated = list.items.find((e: Body) => e.id === S.otherException);
    expect(unrelated.lastErrorMessage).toBe("synthetic unrelated fault");
    expect(unrelated).not.toHaveProperty("includesRestrictedRecords");
    const one = ok(await send("GET", `${EXC}/${S.exception}`, { session: tech }));
    expect(one).toMatchObject(expected);
    const audited = ok(await send("GET", `${EXC}/${S.exception}`, { session: auditor }));
    expect(audited).toMatchObject(expected);
    // Authorization: AUD reads but may not acknowledge (403); another organization's reader gets 404.
    const refused = await send("POST", `${EXC}/${S.exception}/acknowledge`, {
      session: auditor,
      headers: ifm(one.version),
      body: { note: "Synthetic acknowledgement (refused)" },
    });
    expect(refused.status).toBe(403);
    expect((await send("GET", `${EXC}/${S.exception}`, { session: outsider })).status).toBe(404);
    // The state changes (If-Match, audited) answer with the redacted text too.
    const acknowledged = ok(
      await send("POST", `${EXC}/${S.exception}/acknowledge`, {
        session: tech,
        headers: ifm(one.version),
        body: { note: "Synthetic acknowledgement (BE-Z13C)" },
      }),
    );
    expect(acknowledged).toMatchObject({ status: "acknowledged", ...expected });
    const resolved = ok(
      await send("POST", `${EXC}/${S.exception}/resolve`, {
        session: tech,
        headers: ifm(acknowledged.version),
        body: { note: "Synthetic resolution (BE-Z13C)" },
      }),
    );
    expect(resolved).toMatchObject({ status: "resolved", ...expected });
    for (const body of [list, one, audited, acknowledged, resolved])
      expect(JSON.stringify(body)).not.toContain(S.benefit);
    const after = await api.db
      .selectFrom("operational_exception")
      .select("last_error_message")
      .where("id", "=", S.exception)
      .executeTakeFirstOrThrow();
    expect(after.last_error_message).toBe(hiddenRow.last_error_message);
  });

  it("integration run: errorMessage and the actionable error's params are redacted in the test run, list, detail and connector", async () => {
    // A file-provider reference: its plain file name may hold a uuid (an env name is upper-case only).
    const secretName = `z13c-${S.benefit}`;
    const created = ok(
      await send("POST", "/api/v1/admin/connectors", {
        session: tech,
        body: {
          organizationId: w.orgA.id,
          code: uniq("z13c-").toLowerCase(),
          nameEn: "Synthetic downstream (BE-Z13C)",
          nameAr: "نظام لاحق اصطناعي",
          adapterKind: "test_adapter",
          targetKind: "none",
          config: {
            sourceSystemId: "synthetic.downstream:z13c",
            endpointUrl: null,
            credentialRefs: { api: { provider: "file", name: secretName } },
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
            reason: "Synthetic downstream for the BE-Z13C served error texts suite.",
          },
        },
      }),
      201,
    );
    S.connector = created.id;
    const tested = ok(await send("POST", `/api/v1/admin/connectors/${S.connector}/test`, { session: tech, body: {} }));
    expect(tested).toMatchObject({ status: "failed", errorCode: "connector.secret_unresolvable" });
    S.run = tested.id;
    const stored = await api.db
      .selectFrom("integration_run")
      .select("error_message")
      .where("id", "=", S.run)
      .executeTakeFirstOrThrow();
    expect(stored.error_message).toContain(S.benefit);
    const masked = expect.stringContaining(`z13c-${MARKER}`);
    const expected = { errorMessage: masked, includesRestrictedRecords: true };
    expect(tested).toMatchObject(expected);
    const list = ok(await send("GET", `/api/v1/admin/connectors/${S.connector}/runs`, { session: auditor }));
    expect(list.items.find((r: Body) => r.id === S.run)).toMatchObject(expected);
    const detail = ok(await send("GET", `/api/v1/admin/connectors/${S.connector}/runs/${S.run}`, { session: auditor }));
    expect(detail.run).toMatchObject(expected);
    expect(detail.actionableError).toMatchObject({
      errorCode: "connector.secret_unresolvable",
      params: { name: `z13c-${MARKER}` },
      includesRestrictedRecords: true,
    });
    const connector = ok(await send("GET", `/api/v1/admin/connectors/${S.connector}`, { session: auditor }));
    expect(connector.lastRun).toMatchObject(expected);
    expect(connector.actionableError).toMatchObject({
      params: { name: `z13c-${MARKER}` },
      includesRestrictedRecords: true,
    });
    // The connector's own configuration (config.credentialRefs) names the IT-bound secret as configured; it is not an
    // error text and is outside D-228 (2) (see the T-DG6-BE-Z13C handback §7), so it is left out of this check.
    const { config: _config, ...connectorServed } = connector;
    for (const body of [tested, list, detail, connectorServed]) expect(JSON.stringify(body)).not.toContain(S.benefit);
    // Authorization: another organization's reader 404.
    expect(
      (await send("GET", `/api/v1/admin/connectors/${S.connector}/runs/${S.run}`, { session: outsider })).status,
    ).toBe(404);
    // The stored run is unchanged.
    const after = await api.db
      .selectFrom("integration_run")
      .select("error_message")
      .where("id", "=", S.run)
      .executeTakeFirstOrThrow();
    expect(after.error_message).toBe(stored.error_message);
  });

  it("execution history: errorDetail naming the benefit is redacted for AUD (list and get)", async () => {
    // The worker's own starter wrapper (runAsStarter, as withStarterRule registers raid.corrective_benefit under
    // starter.kpi_deviation) around a handler that throws handleBenefitVariance's error on its last attempt: the
    // wrapper records the failed execution with error_detail = the thrown message.
    const text = `benefit ${S.benefit} is not in organization ${w.orgB.id}`;
    await expect(
      runAsStarter(
        api.db,
        STARTER_RULE_BY_QUEUE["raid.corrective_benefit"]!,
        "raid.corrective_benefit",
        {
          outboxEventId: randomUUID(),
          eventType: "benefit.variance_evaluated",
          schemaVersion: 1,
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
        },
        `be-z13c-${randomUUID()}`,
        { retryCount: 5, retryLimit: 5 },
        () => Promise.reject(new Error(text)),
      ),
    ).rejects.toThrow(text);
    const exec = await api.db
      .selectFrom("automation_execution")
      .select(["id", "automation_rule_id", "status", "error_detail"])
      .where("trigger_key", "=", `benefit.variance_evaluated:${S.measurement}`)
      .executeTakeFirstOrThrow();
    S.execution = exec.id;
    // The stored row keeps the real text (the redaction is a view).
    expect(exec).toMatchObject({ status: "failed", error_detail: text });
    const one = ok(await send("GET", `/api/v1/admin/automation-executions/${exec.id}`, { session: auditor }));
    expect(one).toMatchObject({
      errorDetail: `benefit ${MARKER} is not in organization ${w.orgB.id}`,
      includesRestrictedRecords: true,
    });
    const list = ok(
      await send("GET", `/api/v1/admin/automation-executions?ruleId=${exec.automation_rule_id}&limit=100`, {
        session: auditor,
      }),
    );
    expect(list.items.find((e: Body) => e.id === exec.id)).toMatchObject({
      errorDetail: `benefit ${MARKER} is not in organization ${w.orgB.id}`,
      includesRestrictedRecords: true,
    });
    for (const body of [one, list]) expect(JSON.stringify(body)).not.toContain(S.benefit);
    expect((await send("GET", `/api/v1/admin/automation-executions/${exec.id}`, { session: outsider })).status).toBe(
      404,
    );
  });

  it("after an explicit grant, the same readers see the real error texts and no marker", async () => {
    await grantTo(techUserId);
    await grantTo(w.auditor.id);
    const exc = ok(await send("GET", `${EXC}/${S.exception}`, { session: tech }));
    expect(exc.lastErrorMessage).toBe(`benefit ${S.benefit} is not in organization ${w.orgB.id}`);
    expect(exc).not.toHaveProperty("includesRestrictedRecords");
    const detail = ok(await send("GET", `/api/v1/admin/connectors/${S.connector}/runs/${S.run}`, { session: auditor }));
    expect(detail.run.errorMessage).toContain(S.benefit);
    expect(detail.run).not.toHaveProperty("includesRestrictedRecords");
    expect(detail.actionableError.params).toEqual({ name: `z13c-${S.benefit}` });
    expect(detail.actionableError).not.toHaveProperty("includesRestrictedRecords");
    const exec = ok(await send("GET", `/api/v1/admin/automation-executions/${S.execution}`, { session: auditor }));
    expect(exec.errorDetail).toContain(S.benefit);
  });
});
