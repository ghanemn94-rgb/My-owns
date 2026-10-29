// Connectors, configuration versions, mappings and the connector service identity (ADR-0055 §1, §4, §9; ADR-0053 §1;
// REQ-S17-001; p6-work-split §B/A.1; T-DG6-BE-L), against the run's disposable PostgreSQL:
//  1. create writes the connector (disabled, version 1), configuration version 1, the service identity and 3 audit
//     events in ONE transaction (one request id); the identity is `connector:<id>` with declared = granted =
//     ['transformation.read'];
//  2. the 422 refusals: a credential with a value, a secret-like settings key, a credential in the endpoint URL, a
//     duplicate mapping target, a test adapter without mode, a missing or foreign target; nothing is written;
//     409 connector.code_taken;
//  3. put: a configuration is version n+1, names alone keep it; If-Match 428 and 409; mappings put/get;
//  4. enable/disable: the status machine, the reason, queued runs cancelled; AUD and KDS 403 on every mutation;
//     ADM_TECH configures; an outsider 404; a transformation-level reader sees only connectors that target it;
//  5. authorization re-checked at commit (a right lost meanwhile is 403, nothing written);
//  6. `verification` is not_verified until a succeeded test on the CURRENT configuration version; a failing test
//     gives the actionable error (why code, form and import fallbacks); a webhook connector cannot be tested (422);
//  7. the credential view never contains a value (response scan) and says whether each reference resolves;
//  8. the database mappings of the slice B/A guards (db-errors.ts).
// The adapter and the secret provider here are test doubles defined in this file (BE-L2 ships the real local test
// adapter). Every value is SYNTHETIC. Configuring a connector approves nothing; nothing here touches DG0-DG7.
import { insertAuditEvent, sql } from "@mth/db";
import type { FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConnectorAdapterError,
  createConnectorAdapterRegistry,
  setConnectorAdapters,
  type ConnectorAdapter,
  type ConnectorAdapterRegistry,
} from "../../../src/modules/integrations/adapters/port.ts";
import { jsonbTextBytes, putConnector } from "../../../src/modules/integrations/connectors.ts";
import { setConnectorSecretProviders } from "../../../src/modules/integrations/secret-refs.ts";
import {
  createSecretProviderRegistry,
  HttpProblem,
  secretValue,
  type SecretProviderRegistry,
} from "../../../src/modules/platform/index.ts";
import { mapP6IntegrationsError } from "../../../src/modules/platform/db-errors.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  auditOf,
  call,
  createBu,
  createTransformationRow,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const L = "/api/v1/admin/connectors";
const SECRET_VALUE = "s3cr3t-VALUE-be-l-9f2c";
const SECRET_NAME = "MTH_TEST_CONNECTOR_SECRET";

/** The test double of the local test adapter (BE-L2 ships the real one): mode healthy | failing | stopped. */
const fakeTestAdapter: ConnectorAdapter = {
  kind: "test_adapter",
  async fetch(config) {
    const mode = config.adapterSettings["mode"];
    if (mode === "failing") throw new ConnectorAdapterError("connector.source_unavailable");
    if (mode === "stopped") throw new ConnectorAdapterError("connector.stopped");
    const rows = Array.from({ length: 3 }, (_, i) => ({ kpi: `KPI-${i + 1}`, amount: `${i + 1}.50` }));
    return { rows, sourceRowCount: 3, sourceControlTotal: "7.5" };
  },
  async dispatch() {
    return { outcome: "no_response" };
  },
  async outcome() {
    return { outcome: "no_response" };
  },
};

let api: TestApi;
let w: World;
let admin: Session; // ADM_TECH + ADM_ACCESS @ A: connector.read + configure + run
let auditor: Session; // AUD @ A: connector.read only
let kds: Session; // KDS @ A: connector.read + connector.run, no configure
let nobody: Session;
let tdReader: Session; // TD @ transformation T1 only: connector.read there
let transformationT1: string;
let transformationT2: string;
let previousAdapters: ConnectorAdapterRegistry;
let previousSecrets: SecretProviderRegistry | null;

function config(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceSystemId: "synthetic.kpi-source:v1",
    endpointUrl: null,
    credentialRefs: { api: { provider: "env", name: SECRET_NAME } },
    fieldMappings: [
      { source: "kpi", target: "kpiId" },
      { source: "amount", target: "value" },
    ],
    targetTransformationId: transformationT1,
    cadence: "manual",
    retryMaxAttempts: 3,
    retryBackoffSeconds: 60,
    commitMode: "manual",
    commitOnBehalfOf: null,
    outboundActions: [],
    reconciliationRule: "row_count",
    adapterSettings: { mode: "healthy" },
    reason: "Synthetic connector for the BE-L suite.",
    ...over,
  };
}

function createBody(over: Record<string, unknown> = {}, configOver: Record<string, unknown> = {}) {
  return {
    organizationId: w.orgA.id,
    code: uniq("conn-").toLowerCase(),
    nameEn: "Synthetic KPI source",
    nameAr: "مصدر مؤشرات اصطناعي",
    adapterKind: "test_adapter",
    targetKind: "kpi_actual",
    config: config(configOver),
    ...over,
  };
}

async function create(over: Record<string, unknown> = {}, configOver: Record<string, unknown> = {}) {
  return call<Body>(api.app, "POST", L, { session: admin, body: createBody(over, configOver) });
}

async function connectorsWithCode(code: string): Promise<number> {
  const r = await api.db
    .selectFrom("connector")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("code", "=", code)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const bu = await createBu(api.db, w.orgA.id);
  transformationT1 = await createTransformationRow(api.db, w.orgA.id, bu, w.grantor.id);
  transformationT2 = await createTransformationRow(api.db, w.orgA.id, bu, w.grantor.id);
  const kdsUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, kdsUser.id, "KDS", { type: "organization", id: w.orgA.id }, w.orgA.id);
  const td = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, td.id, "TD", { type: "transformation", id: transformationT1 }, w.orgA.id);
  admin = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  kds = await signIn(api.app, kdsUser.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  tdReader = await signIn(api.app, td.subject);
  previousAdapters = setConnectorAdapters(createConnectorAdapterRegistry([fakeTestAdapter]));
  const secrets = createSecretProviderRegistry();
  secrets.register({
    id: "env",
    get: async (name) => (name === SECRET_NAME ? secretValue(SECRET_VALUE) : undefined),
  });
  previousSecrets = setConnectorSecretProviders(secrets);
});

afterAll(async () => {
  setConnectorAdapters(previousAdapters);
  setConnectorSecretProviders(previousSecrets);
  await api?.close();
});

describe("createConnector (ADR-0055 §1)", () => {
  it("writes the connector, configuration version 1, its service identity and 3 audit events in one transaction", async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.headers["location"]).toBe(`${L}/${res.body.id}`);
    expect(res.body).toMatchObject({
      status: "disabled",
      version: 1,
      verification: "not_verified",
      lastSuccessAt: null,
      lastRun: null,
      actionableError: null,
      config: { versionNo: 1, cadence: "manual", reconciliationRule: "row_count" },
    });
    const id = res.body.id as string;
    const identity = await api.db
      .selectFrom("service_identity")
      .selectAll()
      .where("connector_id", "=", id)
      .executeTakeFirstOrThrow();
    expect(identity).toMatchObject({
      code: `connector:${id}`,
      subject_kind: "connector",
      scope_level: "organization",
      organization_id: w.orgA.id,
      declared_permission_codes: ["transformation.read"],
      granted_permission_codes: ["transformation.read"],
    });
    expect(res.body.serviceIdentityId).toBe(identity.id);
    const version = await api.db
      .selectFrom("connector_config_version")
      .selectAll()
      .where("connector_id", "=", id)
      .execute();
    expect(version.map((v) => v.version_no)).toEqual([1]);
    const events = [
      ...(await auditOf(api.db, id)),
      ...(await auditOf(api.db, version[0]!.id)),
      ...(await auditOf(api.db, identity.id)),
    ];
    expect(events.map((e) => e.action)).toEqual([
      "connector.created",
      "connector_config_version.created",
      "service_identity.created",
    ]);
    // One request, one transaction: the three events share the request id (and the deferred FK checks passed).
    expect(new Set(events.map((e) => e.request_id)).size).toBe(1);
    expect(events.every((e) => e.actor_user_id === w.admin.id)).toBe(true);
  });

  it("refuses a credential with a value, a secret-like settings key and a credential in the URL (422; nothing written)", async () => {
    const cases: [Record<string, unknown>, Record<string, unknown>, string][] = [
      [
        {},
        { credentialRefs: { api: { provider: "env", name: SECRET_NAME, value: "hunter2" } } },
        "/config/credentialRefs/api",
      ],
      [{}, { credentialRefs: { password: "hunter2" } }, "/config/credentialRefs/password"],
      [{}, { adapterSettings: { mode: "healthy", apiToken: "abc" } }, "/config/adapterSettings/apiToken"],
      [
        {},
        { adapterSettings: { mode: "healthy", nested: { Password: "abc" } } },
        "/config/adapterSettings/nested/Password",
      ],
      [
        { adapterKind: "http_pull" },
        { endpointUrl: "https://user:pw@source.example.invalid/x", adapterSettings: {} },
        "/config/endpointUrl",
      ],
      [
        { adapterKind: "http_pull" },
        { endpointUrl: "https://source.example.invalid/x?access_token=abc", adapterSettings: {} },
        "/config/endpointUrl",
      ],
    ];
    for (const [over, configOver, pointer] of cases) {
      const body = createBody(over, configOver);
      const res = await call<Body>(api.app, "POST", L, { session: admin, body });
      expect(res.status, JSON.stringify(configOver)).toBe(422);
      expect(res.body.code).toBe("connector.secret_value_refused");
      expect(res.body.detail).toBe(
        "Credentials are stored only as references to a secret that IT holds. Enter a secret reference, not the secret itself.",
      );
      expect(res.body.errors[0].pointer).toBe(pointer);
      expect(JSON.stringify(res.body)).not.toContain("hunter2");
      expect(await connectorsWithCode(body.code)).toBe(0);
    }
  });

  it("refuses invalid mappings, adapter settings and targets with their 422 codes (nothing written)", async () => {
    const otherOrgTransformation = await createTransformationRow(
      api.db,
      w.orgB.id,
      await createBu(api.db, w.orgB.id),
      w.grantor.id,
    );
    const cases: [Record<string, unknown>, Record<string, unknown>, string][] = [
      [
        {},
        {
          fieldMappings: [
            { source: "a", target: "value" },
            { source: "b", target: "value" },
          ],
        },
        "connector.mappings_invalid",
      ],
      [{}, { fieldMappings: [{ source: "   ", target: "value" }] }, "connector.mappings_invalid"],
      [{}, { fieldMappings: [{ source: "a" }] }, "connector.mappings_invalid"],
      [{}, { adapterSettings: {} }, "connector.adapter_settings_invalid"],
      [{}, { adapterSettings: { mode: "sleepy" } }, "connector.adapter_settings_invalid"],
      [{}, { adapterSettings: { mode: "healthy", fixture: "x".repeat(4100) } }, "connector.adapter_settings_invalid"],
      [{}, { endpointUrl: "https://source.example.invalid/x" }, "connector.adapter_settings_invalid"],
      [{ adapterKind: "http_pull" }, { adapterSettings: {} }, "connector.adapter_settings_invalid"],
      [
        { adapterKind: "http_pull" },
        {
          endpointUrl: "https://source.example.invalid/",
          outboundActions: ["deliverable_status_push"],
          adapterSettings: {},
        },
        "connector.adapter_settings_invalid",
      ],
      [
        { adapterKind: "webhook", targetKind: "none" },
        { targetTransformationId: null, fieldMappings: [], adapterSettings: {} },
        "connector.adapter_settings_invalid",
      ],
      [{}, { targetTransformationId: null }, "connector.target_invalid"],
      [{}, { targetTransformationId: otherOrgTransformation }, "connector.target_invalid"],
      [{ targetKind: "none" }, {}, "connector.target_invalid"],
    ];
    for (const [over, configOver, code] of cases) {
      const body = createBody(over, configOver);
      const res = await call<Body>(api.app, "POST", L, { session: admin, body });
      expect(res.status, `${code} ${JSON.stringify(configOver).slice(0, 120)}`).toBe(422);
      expect(res.body.code).toBe(code);
      expect(await connectorsWithCode(body.code)).toBe(0);
    }
  });

  it("answers 409 connector.code_taken for a code already used in the organization", async () => {
    const first = await create();
    expect(first.status).toBe(201);
    const again = await create({ code: first.body.code });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("connector.code_taken");
    expect(again.body.detail).toBe("A connector with this code already exists in this organization.");
    expect(await connectorsWithCode(first.body.code)).toBe(1);
  });

  it("is refused to AUD and KDS (403), to an outsider (403) and for an unknown organization (404); 400 on a bad body", async () => {
    for (const session of [auditor, kds, nobody]) {
      const body = createBody();
      const res = await call<Body>(api.app, "POST", L, { session, body });
      expect(res.status).toBe(403);
      expect(await connectorsWithCode(body.code)).toBe(0);
    }
    expect(
      (await call<Body>(api.app, "POST", L, { session: admin, body: createBody({ organizationId: uuidv7() }) })).status,
    ).toBe(404);
    expect((await call<Body>(api.app, "POST", L, { session: admin, body: { ...createBody(), extra: 1 } })).status).toBe(
      400,
    );
    expect((await call<Body>(api.app, "POST", L, { body: createBody() })).status).toBe(401);
  });
});

describe("putConnector, mappings, enable and disable", () => {
  it("a configuration is a new version n+1; names alone keep it; If-Match 428 and 409", async () => {
    const c = (await create()).body;
    const one = `${L}/${c.id}`;
    const body = { nameEn: "Renamed", nameAr: "اسم جديد", config: config({ cadence: "daily", reason: "Daily now." }) };
    expect((await call<Body>(api.app, "PUT", one, { session: admin, body })).status).toBe(428);
    expect((await call<Body>(api.app, "PUT", one, { session: admin, body, headers: ifm(9) })).status).toBe(409);
    const put = await call<Body>(api.app, "PUT", one, { session: admin, body, headers: ifm(1) });
    expect(put.status).toBe(200);
    expect(put.headers["etag"]).toBe('"2"');
    expect(put.body).toMatchObject({ nameEn: "Renamed", version: 2, config: { versionNo: 2, cadence: "daily" } });
    const names = await call<Body>(api.app, "PUT", one, {
      session: admin,
      body: { nameEn: "Renamed again", nameAr: "اسم", config: null },
      headers: ifm(2),
    });
    expect(names.status).toBe(200);
    expect(names.body).toMatchObject({ version: 3, config: { versionNo: 2 } });
    const versions = await api.db
      .selectFrom("connector_config_version")
      .select("version_no")
      .where("connector_id", "=", c.id)
      .orderBy("version_no")
      .execute();
    expect(versions.map((v) => v.version_no)).toEqual([1, 2]);
    expect((await auditOf(api.db, c.id)).map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["connector.created", null, 1],
      ["connector.updated", 1, 2],
      ["connector.updated", 2, 3],
    ]);
    // A put with a refused configuration writes nothing.
    const bad = await call<Body>(api.app, "PUT", one, {
      session: admin,
      body: { ...body, config: config({ adapterSettings: { mode: "healthy", secret: "x" } }) },
      headers: ifm(3),
    });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("connector.secret_value_refused");
  });

  it("mappings: get with the connector's ETag; put is a new configuration version; 422 duplicate; 428/409", async () => {
    const c = (await create()).body;
    const path = `${L}/${c.id}/mappings`;
    const got = await call<Body>(api.app, "GET", path, { session: auditor });
    expect(got.status).toBe(200);
    expect(got.headers["etag"]).toBe('"1"');
    expect(got.body).toMatchObject({ connectorId: c.id, configVersionNo: 1, fieldMappings: c.config.fieldMappings });
    expect(Array.isArray(got.body.targetColumns)).toBe(true);
    const mappings = [{ source: "kpi_code", target: "kpiId" }];
    const body = { fieldMappings: mappings, reason: "Source renamed its column." };
    expect((await call<Body>(api.app, "PUT", path, { session: admin, body })).status).toBe(428);
    expect((await call<Body>(api.app, "PUT", path, { session: admin, body, headers: ifm(5) })).status).toBe(409);
    const dup = await call<Body>(api.app, "PUT", path, {
      session: admin,
      body: { fieldMappings: [...mappings, { source: "other", target: "kpiId" }], reason: "Duplicate." },
      headers: ifm(1),
    });
    expect(dup.status).toBe(422);
    expect(dup.body.code).toBe("connector.mappings_invalid");
    const put = await call<Body>(api.app, "PUT", path, { session: admin, body, headers: ifm(1) });
    expect(put.status).toBe(200);
    expect(put.headers["etag"]).toBe('"2"');
    expect(put.body).toMatchObject({ configVersionNo: 2, fieldMappings: mappings });
    const after = (await call<Body>(api.app, "GET", `${L}/${c.id}`, { session: admin })).body;
    expect(after.config).toMatchObject({ versionNo: 2, fieldMappings: mappings, reason: "Source renamed its column." });
    expect(after.config.cadence).toBe(c.config.cadence); // everything else is carried over
    expect((await auditOf(api.db, c.id)).at(-1)?.action).toBe("connector.mappings_changed");
  });

  it("enable and disable: the status machine, the reason, and the queued runs of a disabled connector are cancelled", async () => {
    const c = (await create()).body;
    const one = `${L}/${c.id}`;
    expect(
      (await call<Body>(api.app, "POST", `${one}/enable`, { session: admin, body: { reason: null } })).status,
    ).toBe(428);
    const enabled = await call<Body>(api.app, "POST", `${one}/enable`, {
      session: admin,
      body: { reason: null },
      headers: ifm(1),
    });
    expect(enabled.status).toBe(200);
    expect(enabled.body).toMatchObject({
      status: "enabled",
      statusReason: null,
      version: 2,
      verification: "not_verified",
    });
    const again = await call<Body>(api.app, "POST", `${one}/enable`, {
      session: admin,
      body: { reason: null },
      headers: ifm(2),
    });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe("invalid_transition");
    // A queued run (as the scheduler leaves one) is cancelled by the disable.
    const runId = uuidv7();
    await api.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("integration_run")
        .values({
          id: runId,
          organization_id: w.orgA.id,
          connector_id: c.id,
          config_version_no: 1,
          trigger_kind: "schedule",
          idempotency_key: `schedule:${c.id}:2026-10-29T00:00:00Z`,
          service_identity_id: c.serviceIdentityId,
          queued_at: sql<Date>`now()`,
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "system", actorUserId: null, source: "worker" },
        {
          action: "integration_run.queued",
          recordType: "integration_run",
          recordId: runId,
          organizationId: w.orgA.id,
          newVersion: 1,
        },
      );
    });
    expect(
      (await call<Body>(api.app, "POST", `${one}/disable`, { session: admin, body: {}, headers: ifm(2) })).status,
    ).toBe(400);
    const disabled = await call<Body>(api.app, "POST", `${one}/disable`, {
      session: admin,
      body: { reason: "Source maintenance window." },
      headers: ifm(2),
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body).toMatchObject({ status: "disabled", statusReason: "Source maintenance window.", version: 3 });
    const run = await api.db
      .selectFrom("integration_run")
      .selectAll()
      .where("id", "=", runId)
      .executeTakeFirstOrThrow();
    expect(run).toMatchObject({ status: "cancelled", version: 2 });
    expect((await auditOf(api.db, runId)).map((e) => e.action)).toEqual([
      "integration_run.queued",
      "integration_run.cancelled",
    ]);
    expect((await auditOf(api.db, c.id)).map((e) => e.action)).toEqual([
      "connector.created",
      "connector.enabled",
      "connector.disabled",
    ]);
  });

  it("every mutation is 403 for AUD and KDS (readers), 404 for an outsider; nothing is written", async () => {
    const c = (await create()).body;
    const one = `${L}/${c.id}`;
    const mutations: [string, string, unknown][] = [
      ["PUT", one, { nameEn: "x", nameAr: "x", config: null }],
      ["POST", `${one}/enable`, { reason: null }],
      ["POST", `${one}/disable`, { reason: "Synthetic." }],
      ["POST", `${one}/test`, {}],
      ["PUT", `${one}/mappings`, { fieldMappings: [], reason: "Synthetic." }],
    ];
    for (const [method, path, body] of mutations) {
      for (const session of [auditor, kds]) {
        const res = await call<Body>(api.app, method, path, { session, body, headers: ifm(1) });
        expect(res.status, `${method} ${path}`).toBe(403);
      }
      expect((await call<Body>(api.app, method, path, { session: nobody, body, headers: ifm(1) })).status).toBe(404);
      expect((await call<Body>(api.app, method, path, { body, headers: ifm(1) })).status).toBe(401);
    }
    const row = await api.db.selectFrom("connector").selectAll().where("id", "=", c.id).executeTakeFirstOrThrow();
    expect(row.version).toBe(1);
    expect((await auditOf(api.db, c.id)).length).toBe(1);
    const runs = await api.db.selectFrom("integration_run").select("id").where("connector_id", "=", c.id).execute();
    expect(runs).toEqual([]);
  });

  it("re-checks authorization at commit on the reloaded grants (a right lost meanwhile is 403; nothing written)", async () => {
    const c = (await create()).body;
    const request = {
      id: "be-l-commit-time",
      principal: { kind: "user", userId: w.admin.id, organizationId: w.orgA.id, grants: [], tracker: { decisions: 0 } },
      reauthenticate: async () => ({
        kind: "user",
        userId: w.admin.id,
        organizationId: w.orgA.id,
        grants: [],
        tracker: { decisions: 0 },
      }),
    } as unknown as FastifyRequest;
    let caught: unknown;
    try {
      await api.db
        .transaction()
        .execute((tx) => putConnector(tx, request, c.id, 1, { nameEn: "Lost", nameAr: "x", config: null }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpProblem);
    expect((caught as HttpProblem).status).toBe(403);
    const row = await api.db.selectFrom("connector").selectAll().where("id", "=", c.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ version: 1, name_en: "Synthetic KPI source" });
    expect((await auditOf(api.db, c.id)).length).toBe(1);
  });
});

describe("reads: list, get and the transformation-level reader", () => {
  it("lists by code with a cursor; AUD and KDS read; an outsider gets 403; an unknown organization 404", async () => {
    const a = (await create({ code: `aa-${uniq("x").toLowerCase()}` })).body;
    await create({ code: `ab-${uniq("x").toLowerCase()}` });
    const first = await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgA.id}&limit=1`, { session: auditor });
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(typeof first.body.nextCursor).toBe("string");
    const second = await call<Body>(
      api.app,
      "GET",
      `${L}?organizationId=${w.orgA.id}&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      { session: kds },
    );
    expect(second.status).toBe(200);
    expect(second.body.items[0].code > first.body.items[0].code).toBe(true);
    const disabled = await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgA.id}&status=disabled&limit=100`, {
      session: admin,
    });
    expect(disabled.body.items.some((i: Body) => i.id === a.id)).toBe(true);
    expect((await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgA.id}`, { session: nobody })).status).toBe(
      403,
    );
    expect((await call<Body>(api.app, "GET", `${L}?organizationId=${uuidv7()}`, { session: admin })).status).toBe(404);
    expect((await call<Body>(api.app, "GET", `${L}?organizationId=x`, { session: admin })).status).toBe(400);
    expect((await call<Body>(api.app, "GET", `${L}/${a.id}`, { session: nobody })).status).toBe(404);
    expect((await call<Body>(api.app, "GET", `${L}/${uuidv7()}`, { session: admin })).status).toBe(404);
  });

  it("a transformation-level reader sees, read-only, only the connectors whose current configuration targets it", async () => {
    const mine = (await create()).body; // targets T1
    const other = (await create({}, { targetTransformationId: transformationT2 })).body;
    const list = await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgA.id}&limit=100`, { session: tdReader });
    expect(list.status).toBe(200);
    const ids = list.body.items.map((i: Body) => i.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(other.id);
    expect(list.body.items.every((i: Body) => i.config.targetTransformationId === transformationT1)).toBe(true);
    expect((await call<Body>(api.app, "GET", `${L}/${mine.id}`, { session: tdReader })).status).toBe(200);
    expect((await call<Body>(api.app, "GET", `${L}/${other.id}`, { session: tdReader })).status).toBe(404);
    // Read-only: TD holds no connector.configure.
    const put = await call<Body>(api.app, "PUT", `${L}/${mine.id}`, {
      session: tdReader,
      body: { nameEn: "x", nameAr: "x", config: null },
      headers: ifm(1),
    });
    expect(put.status).toBe(403);
  });
});

describe("testConnector and the derived verification, last success and actionable error", () => {
  it("is not_verified until a succeeded test on the CURRENT configuration version", async () => {
    const c = (await create()).body;
    const one = `${L}/${c.id}`;
    expect((await call<Body>(api.app, "GET", one, { session: admin })).body.verification).toBe("not_verified");
    const test = await call<Body>(api.app, "POST", `${one}/test`, { session: admin, body: {} });
    expect(test.status).toBe(200);
    expect(test.body).toMatchObject({
      triggerKind: "test",
      status: "succeeded",
      attemptNo: 1,
      configVersionNo: 1,
      requestedBy: w.admin.id,
      serviceIdentityId: c.serviceIdentityId,
      rowsRead: 3,
      rowsStaged: 0,
      rowsCommitted: null,
      rowsRejected: 0,
      rowsDuplicate: 0,
      errorCount: 0,
      errorCode: null,
      reconciliation: { status: "matched", sourceRowCount: 3 },
      importBatchId: null,
      version: 3,
    });
    expect((await auditOf(api.db, test.body.id)).map((e) => e.action)).toEqual([
      "integration_run.queued",
      "integration_run.started",
      "integration_run.succeeded",
    ]);
    const verified = (await call<Body>(api.app, "GET", one, { session: auditor })).body;
    expect(verified.verification).toBe("verified");
    expect(verified.lastSuccessAt).toBe(test.body.finishedAt);
    expect(verified.lastRun.id).toBe(test.body.id);
    expect(verified.actionableError).toBeNull();
    // A new configuration version is not verified by the earlier test; last success stays.
    const put = await call<Body>(api.app, "PUT", one, {
      session: admin,
      body: { nameEn: "x", nameAr: "x", config: config({ cadence: "weekly" }) },
      headers: ifm(1),
    });
    expect(put.body).toMatchObject({ verification: "not_verified", lastSuccessAt: test.body.finishedAt });
    // Nothing was committed or staged by the test.
    const actuals = await api.db
      .selectFrom("audit_event")
      .select("id")
      .where("request_id", "=", (await auditOf(api.db, test.body.id))[0]!.request_id)
      .where("record_type", "not in", ["integration_run"])
      .execute();
    expect(actuals).toEqual([]);
  });

  it("a failing or stopped adapter gives a failed run and the actionable error with the form and import fallbacks", async () => {
    const c = (await create({}, { adapterSettings: { mode: "stopped" } })).body;
    const one = `${L}/${c.id}`;
    const test = await call<Body>(api.app, "POST", `${one}/test`, { session: admin, body: {} });
    expect(test.status).toBe(200);
    expect(test.body).toMatchObject({
      status: "failed",
      errorCode: "connector.stopped",
      errorMessage: "The connector's test adapter is stopped.",
      rowsRead: null,
      rowsStaged: null,
      reconciliation: { status: "not_checked", sourceRowCount: null },
    });
    const got = (await call<Body>(api.app, "GET", one, { session: kds })).body;
    expect(got.verification).toBe("not_verified");
    expect(got.lastSuccessAt).toBeNull();
    expect(got.actionableError).toEqual({
      runId: test.body.id,
      triggerKind: "test",
      attemptNo: 1,
      finishedAt: test.body.finishedAt,
      errorCode: "connector.stopped",
      params: {},
      fallbacks: ["kpi_form", "import_file"],
    });
    // Back to healthy: a succeeded test clears the actionable error (it describes only failures after the last success).
    await call<Body>(api.app, "PUT", one, {
      session: admin,
      body: { nameEn: "x", nameAr: "x", config: config({ adapterSettings: { mode: "healthy" } }) },
      headers: ifm(1),
    });
    expect((await call<Body>(api.app, "POST", `${one}/test`, { session: admin, body: {} })).body.status).toBe(
      "succeeded",
    );
    const healed = (await call<Body>(api.app, "GET", one, { session: admin })).body;
    expect(healed).toMatchObject({ verification: "verified", actionableError: null });
  });

  it("names the unresolvable secret and the missing mapped column in the error (connector.secret_unresolvable, mapping_mismatch)", async () => {
    const noSecret = (await create({}, { credentialRefs: { api: { provider: "env", name: "MTH_TEST_MISSING" } } }))
      .body;
    const t1 = await call<Body>(api.app, "POST", `${L}/${noSecret.id}/test`, { session: admin, body: {} });
    expect(t1.body).toMatchObject({ status: "failed", errorCode: "connector.secret_unresolvable" });
    const e1 = (await call<Body>(api.app, "GET", `${L}/${noSecret.id}`, { session: admin })).body.actionableError;
    expect(e1).toMatchObject({ errorCode: "connector.secret_unresolvable", params: { name: "MTH_TEST_MISSING" } });
    const badMap = (await create({}, { fieldMappings: [{ source: "no_such_column", target: "value" }] })).body;
    const t2 = await call<Body>(api.app, "POST", `${L}/${badMap.id}/test`, { session: admin, body: {} });
    expect(t2.body).toMatchObject({ status: "failed", errorCode: "connector.mapping_mismatch" });
    const e2 = (await call<Body>(api.app, "GET", `${L}/${badMap.id}`, { session: admin })).body.actionableError;
    expect(e2.params).toEqual({ column: "no_such_column" });
  });

  it("409 connector.run_active while a run is queued or running; 422 for a connector type without a pull adapter", async () => {
    const c = (await create()).body;
    const runId = uuidv7();
    await api.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("integration_run")
        .values({
          id: runId,
          organization_id: w.orgA.id,
          connector_id: c.id,
          config_version_no: 1,
          trigger_kind: "schedule",
          idempotency_key: `schedule:${c.id}:2026-10-29T01:00:00Z`,
          service_identity_id: c.serviceIdentityId,
          queued_at: sql<Date>`now()`,
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "system", actorUserId: null, source: "worker" },
        {
          action: "integration_run.queued",
          recordType: "integration_run",
          recordId: runId,
          organizationId: w.orgA.id,
          newVersion: 1,
        },
      );
    });
    const busy = await call<Body>(api.app, "POST", `${L}/${c.id}/test`, { session: admin, body: {} });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe("connector.run_active");
    const runs = await api.db.selectFrom("integration_run").select("id").where("connector_id", "=", c.id).execute();
    expect(runs.map((r) => r.id)).toEqual([runId]);
    const hook = (await create({ adapterKind: "webhook" }, { adapterSettings: {} })).body;
    const refused = await call<Body>(api.app, "POST", `${L}/${hook.id}/test`, { session: admin, body: {} });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("connector.adapter_unavailable");
  });
});

describe("credentials are references only", () => {
  it("never returns a value (response scan); resolvable says whether each reference resolves now", async () => {
    const res = await create(
      {},
      {
        credentialRefs: {
          api: { provider: "env", name: SECRET_NAME },
          backup: { provider: "env", name: "MTH_TEST_NOT_PROVIDED" },
          vault: { provider: "it_vault", name: "connectors/kpi" },
        },
      },
    );
    expect(res.status).toBe(201);
    const scans = [
      res.raw.body,
      (await call<Body>(api.app, "GET", `${L}/${res.body.id}`, { session: admin })).raw.body,
      (await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgA.id}&limit=100`, { session: auditor })).raw.body,
      (await call<Body>(api.app, "POST", `${L}/${res.body.id}/test`, { session: admin, body: {} })).raw.body,
    ];
    for (const text of scans) expect(text).not.toContain(SECRET_VALUE);
    expect(res.body.config.credentialRefs).toEqual({
      api: { provider: "env", name: SECRET_NAME, resolvable: true },
      backup: { provider: "env", name: "MTH_TEST_NOT_PROVIDED", resolvable: false },
      vault: { provider: "it_vault", name: "connectors/kpi", resolvable: false },
    });
    // No row or audit event holds the value either.
    const stored = await api.db
      .selectFrom("connector_config_version")
      .select(sql<string>`credential_refs::text`.as("t"))
      .where("connector_id", "=", res.body.id)
      .executeTakeFirstOrThrow();
    expect(stored.t).not.toContain(SECRET_VALUE);
    const audits = await sql<{ t: string }>`SELECT changes::text AS t FROM audit_event WHERE record_id IN (
        SELECT id FROM connector_config_version WHERE connector_id = ${res.body.id}::uuid)`.execute(api.db);
    expect(audits.rows.every((r) => !r.t.includes(SECRET_VALUE))).toBe(true);
    // Without a provider registry (the composition line not run), resolvable is null (Unknown), never true.
    const saved = setConnectorSecretProviders(null);
    try {
      const unknown = (await call<Body>(api.app, "GET", `${L}/${res.body.id}`, { session: admin })).body;
      expect(unknown.config.credentialRefs.api.resolvable).toBeNull();
    } finally {
      setConnectorSecretProviders(saved);
    }
  });
});

describe("database guards and their mappings (db-errors.ts, slices B/A)", () => {
  it("the API's jsonb size measure equals PostgreSQL's octet_length(jsonb::text)", async () => {
    const samples = [
      { mode: "healthy" },
      { mode: "healthy", fixture: [{ a: "1", b: "x y" }], n: 3, nested: { k: true } },
    ];
    for (const s of samples) {
      const r = await sql<{ n: number }>`SELECT octet_length(${JSON.stringify(s)}::jsonb::text)::int AS n`.execute(
        api.db,
      );
      expect(jsonbTextBytes(s)).toBe(r.rows[0]!.n);
    }
  });

  it("maps every guard the slice names to its code and status", () => {
    const expected: [string, number, string][] = [
      ["connector_organization_code_key", 409, "connector.code_taken"],
      ["connector_config_version_credential_refs", 422, "connector.secret_value_refused"],
      ["connector_config_version_no_secret_settings", 422, "connector.secret_value_refused"],
      ["connector_config_version_field_mappings", 422, "connector.mappings_invalid"],
      ["connector_config_version_adapter_shape", 422, "connector.adapter_settings_invalid"],
      ["connector_config_version_outbound_test_only", 422, "connector.adapter_settings_invalid"],
      ["connector_config_version_target_shape", 422, "connector.target_invalid"],
      ["integration_run_one_active", 409, "connector.run_active"],
      ["integration_run_one_retry_key", 409, "integration_run.not_retryable"],
      ["integration_run_retry_chain", 409, "integration_run.not_retryable"],
      ["outbound_write_idempotency_key", 409, "outbound_write.idempotency_key_reused"],
      ["outbound_write_action_allowed", 422, "outbound_write.action_not_allowed"],
      ["outbound_write_final", 409, "outbound_write.final"],
      ["outbound_write_transition", 409, "outbound_write.final"],
      ["deliverable_external_change_final", 409, "external_change.already_confirmed"],
      ["deliverable_external_change_evidence_verified", 422, "external_change.evidence_not_verified"],
      ["webhook_endpoint_connector_kind", 422, "webhook.connector_not_webhook"],
      ["webhook_endpoint_final", 409, "webhook.endpoint_disabled"],
      ["webhook_receipt_delivery_key", 409, "webhook.delivery_id_reused"],
      ["import_batch_transition", 409, "import.not_staged"],
      ["import_batch_final", 409, "import.not_staged"],
      ["import_batch_counts_match_rows", 500, "internal"],
    ];
    for (const [constraint, status, code] of expected) {
      const p = mapP6IntegrationsError({ code: "23514", constraint });
      expect(p?.status, constraint).toBe(status);
      expect(p?.code, constraint).toBe(code);
    }
    expect(mapP6IntegrationsError({ code: "23514", constraint: "something_else" })).toBeNull();
  });

  it("a connector row written past the API still meets the trigger: a test adapter without mode is refused", async () => {
    const c = (await create()).body;
    let caught: unknown;
    try {
      await api.db.transaction().execute(async (tx) => {
        await tx
          .insertInto("connector_config_version")
          .values({
            id: uuidv7(),
            organization_id: w.orgA.id,
            connector_id: c.id,
            version_no: 2,
            source_system_id: "synthetic",
            cadence: "manual",
            target_transformation_id: transformationT1,
            adapter_settings: JSON.stringify({}),
            reason: "Synthetic probe.",
            created_by: w.admin.id,
          })
          .execute();
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as { constraint?: string }).constraint).toBe("connector_config_version_adapter_shape");
  });
});
