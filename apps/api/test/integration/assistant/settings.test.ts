// Administration > AI assistant (ADR-0059 §3, §10; REQ-S17-009; p6-work-split §D.1; T-DG6-BE-T) against a real
// PostgreSQL. The setting is installation-wide (one row), so this suite runs on its own scratch database: no other
// integration file sees its rows. Covers, for every mutation (§2 rule 4): authorization at request start and at commit
// (a grant revoked meanwhile is 403 and nothing is written), validation, If-Match (428 missing, 409 stale, "0" creates),
// one audit event per version with prior and new version and no credential in it, and AUD read-only (200 on the GET,
// 403 on every write). Also: a fresh database is OFF (configured false, enabled false, ETag "0"); a PUT never enables;
// enabling needs every §3 field; locked fields while enabled; already_enabled / already_disabled; the production
// refusals of the test adapter and of http://; the endpoint and credential-reference refusals; ADM_ACCESS and
// ADM_METHOD cannot configure. All data is SYNTHETIC; the authorization reference is a made-up ticket id, and the
// product does not (and here cannot) check it with IT. Nothing approves anything or touches DG0-DG7.
import { migrate } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import {
  assistantSettingRefusals,
  checkedSettingUpdate,
  enableRefusal,
  loadSetting,
} from "../../../src/modules/assistant/settings.ts";
import type { AssistantSettingRow } from "../../../src/modules/assistant/provider.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let scratchDb: string;
let admin: Session; // ADM_ACCESS + ADM_TECH @ org A (configures)
let auditor: Session; // AUD @ org A (operations.read)
let office: Session; // TO @ org A (operations.read; no configure)
let nobody: Session;
let admAccess: Session; // ADM_ACCESS only
let admMethod: Session; // ADM_METHOD only

const S = "/api/v1/admin/assistant";
const ifm = (v: number | string) => ({ "if-match": `"${v}"` });
const CREDENTIAL_CANARY = "synthetic-canary-model-key-73fd";
const AUTH_REF = "IT-APPROVAL-SYNTHETIC-0001";

const httpSetting = (over: Record<string, unknown> = {}) => ({
  providerKind: "http_endpoint",
  endpointUrl: "https://model.example.invalid/v1/chat/completions",
  apiStyle: "openai_chat_completions",
  modelName: "synthetic-model-1",
  credentialRef: { provider: "env", name: "MTH_TEST_ASSISTANT_KEY" },
  authorizationReference: AUTH_REF,
  requestTimeoutMs: 30000,
  maxOutputTokens: 1024,
  maxContextRecords: 8,
  reason: "Synthetic test: configure the assistant",
  ...over,
});

async function auditsOf(recordId: string) {
  return api.db
    .selectFrom("audit_event")
    .selectAll()
    .where("record_id", "=", recordId)
    .where("record_type", "=", "assistant_setting")
    .orderBy("seq")
    .execute();
}

async function userWith(role: string): Promise<{ id: string; session: Session }> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, role, { type: "organization", id: w.orgA.id }, w.orgA.id);
  return { id: u.id, session: await signIn(api.app, u.subject) };
}

const put = (body: unknown, ifMatch: number | string | null, session = admin) =>
  call<Body>(api.app, "PUT", S, { session, body, headers: ifMatch === null ? {} : ifm(ifMatch) });
const toggle = (to: "enable" | "disable", ifMatch: number | string | null, session = admin, reason = "Synthetic") =>
  call<Body>(api.app, "POST", `${S}/${to}`, {
    session,
    body: { reason: `${reason} toggle` },
    headers: ifMatch === null ? {} : ifm(ifMatch),
  });

beforeAll(async () => {
  process.env["MTH_TEST_ASSISTANT_KEY"] = CREDENTIAL_CANARY;
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_asst_set");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  office = await signIn(api.app, w.office.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  admAccess = (await userWith("ADM_ACCESS")).session;
  admMethod = (await userWith("ADM_METHOD")).session;
}, 120_000);
afterAll(async () => {
  delete process.env["MTH_TEST_ASSISTANT_KEY"];
  await api.close();
  await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

// The tests below run in file order on one installation-wide row: each states the state it starts from.
describe("a fresh install: the assistant is OFF (REQ-S17-009 'a fresh install shows AI disabled')", () => {
  it('no row: configured false, enabled false, every field at its default, version 0, ETag "0", telemetry off', async () => {
    const res = await call<Body>(api.app, "GET", S, { session: admin });
    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBe('"0"');
    expect(res.body).toEqual({
      configured: false,
      enabled: false,
      providerKind: null,
      endpointUrl: null,
      apiStyle: null,
      modelName: null,
      credentialRef: null,
      authorizationReference: null,
      requestTimeoutMs: 30000,
      maxOutputTokens: 1024,
      maxContextRecords: 8,
      enabledAt: null,
      enabledBy: null,
      telemetryEnabled: false,
      reason: null,
      version: 0,
      updatedAt: null,
    });
    expect(await loadSetting(api.db)).toBeUndefined(); // reading writes nothing
  });

  it("AUD and TO read through operations.read; a user with neither code gets 403", async () => {
    for (const session of [auditor, office]) {
      const res = await call<Body>(api.app, "GET", S, { session });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    }
    expect((await call(api.app, "GET", S, { session: nobody })).status).toBe(403);
    expect((await call(api.app, "GET", S)).status).toBe(401);
  });

  it("enable and disable answer 404 while no setting is saved (and write nothing)", async () => {
    expect((await toggle("enable", 1)).status).toBe(404);
    expect((await toggle("disable", 1)).status).toBe(404);
    expect(await loadSetting(api.db)).toBeUndefined();
  });
});

describe("putAssistantSetting", () => {
  it("AUD, TO, ADM_ACCESS, ADM_METHOD and a user without codes get 403 on PUT, enable and disable; nothing is written", async () => {
    for (const session of [auditor, office, admAccess, admMethod, nobody]) {
      expect((await put(httpSetting(), 0, session)).status).toBe(403);
      expect((await toggle("enable", 0, session)).status).toBe(403);
      expect((await toggle("disable", 0, session)).status).toBe(403);
    }
    expect(await loadSetting(api.db)).toBeUndefined();
  });

  it("refuses an invalid body (400), the endpoint and credential refusals (422), a bad reason (422), and a missing If-Match (428), before writing", async () => {
    expect((await put({ ...httpSetting(), extra: 1 }, 0)).status).toBe(400);
    expect((await put(httpSetting({ requestTimeoutMs: 10 }), 0)).status).toBe(400);
    expect((await put(httpSetting({ modelName: "bad model name" }), 0)).status).toBe(400);
    for (const endpointUrl of [
      "ftp://model.example.invalid/v1",
      "https://user:pass@model.example.invalid/v1",
      "https://model.example.invalid/v1?key=synthetic",
      "https://model.example.invalid/v1#frag",
      "not a url",
    ]) {
      const res = await call<Body>(api.app, "PUT", S, {
        session: admin,
        body: httpSetting({ endpointUrl }),
        headers: ifm(0),
        contract: false,
      });
      expect([res.status, res.body.code], endpointUrl).toEqual([422, "assistant.endpoint_invalid"]);
    }
    for (const credentialRef of [
      CREDENTIAL_CANARY,
      { provider: "env", name: "X", value: CREDENTIAL_CANARY },
      { provider: "Not Valid", name: "X" },
      42,
    ]) {
      const res = await call<Body>(api.app, "PUT", S, {
        session: admin,
        body: httpSetting({ credentialRef }),
        headers: ifm(0),
        contract: false,
      });
      expect([res.status, res.body.code]).toEqual([422, "assistant.credential_ref_invalid"]);
      expect(JSON.stringify(res.body)).not.toContain(CREDENTIAL_CANARY);
    }
    const shape = await put(httpSetting({ providerKind: "test_adapter" }), 0);
    expect([shape.status, shape.body.code]).toEqual([422, "assistant.test_adapter_shape"]);
    const reason = await call<Body>(api.app, "PUT", S, {
      session: admin,
      body: httpSetting({ reason: "   " }),
      headers: ifm(0),
      contract: false,
    });
    expect([reason.status, reason.body.code]).toEqual([422, "admin.reason_required"]);
    expect((await put(httpSetting(), null)).status).toBe(428);
    expect(await loadSetting(api.db)).toBeUndefined();
  });

  it('If-Match "0" creates the row DISABLED (version 1); a second "0" is 409; one audit event with no credential value', async () => {
    const created = await put(httpSetting(), 0);
    expect(created.status).toBe(200);
    expect(created.headers["etag"]).toBe('"1"');
    expect(created.body).toMatchObject({
      configured: true,
      enabled: false,
      providerKind: "http_endpoint",
      credentialRef: { provider: "env", name: "MTH_TEST_ASSISTANT_KEY" },
      authorizationReference: AUTH_REF,
      telemetryEnabled: false,
      enabledAt: null,
      enabledBy: null,
      version: 1,
    });
    expect((await put(httpSetting(), 0)).status).toBe(409);
    const row = (await loadSetting(api.db))!;
    expect(row.enabled).toBe(false);
    const events = await auditsOf(row.id);
    expect(events.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["assistant_setting.changed", null, 1],
    ]);
    expect(events[0]!.reason).toBe("Synthetic test: configure the assistant");
    const changes = events[0]!.changes as Body;
    expect(changes.changed_fields.to).toEqual(expect.arrayContaining(["providerKind", "endpointUrl", "credentialRef"]));
    expect(changes.authorization_reference.to).toBe(AUTH_REF);
    expect(JSON.stringify(events)).not.toContain(CREDENTIAL_CANARY);
    // The history row is the trigger's (0111); exactly one per version.
    const history = await api.db
      .selectFrom("assistant_setting_change")
      .select(["record_version", "enabled"])
      .where("assistant_setting_id", "=", row.id)
      .execute();
    expect(history).toEqual([{ record_version: 1, enabled: false }]);
  });

  it("a stale If-Match is 409 and writes nothing; a current one updates (version 2) with one audit event naming the changed fields", async () => {
    const stale = await put(httpSetting({ modelName: "synthetic-model-2" }), 7);
    expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    const updated = await put(httpSetting({ modelName: "synthetic-model-2", reason: "Synthetic: change model" }), 1);
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ modelName: "synthetic-model-2", version: 2, enabled: false });
    const row = (await loadSetting(api.db))!;
    const events = await auditsOf(row.id);
    expect(events.map((e) => [e.prior_version, e.new_version])).toEqual([
      [null, 1],
      [1, 2],
    ]);
    expect((events[1]!.changes as Body).changed_fields.to).toEqual(["modelName"]);
  });

  it("authorization is re-checked at commit: assistant.configure revoked while the PUT waits is 403, nothing written", async () => {
    const u = await userWith("ADM_TECH");
    const before = (await loadSetting(api.db))!;
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "PUT", S, {
          session: u.session,
          headers: ifm(before.version),
          body: httpSetting({ modelName: "synthetic-model-3", reason: "Synthetic commit-time check" }),
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const after = (await loadSetting(api.db))!;
    expect(after.version).toBe(before.version);
    expect(after.model_name).toBe("synthetic-model-2");
  });
});

describe("enableAssistant and disableAssistant (the audited state machine)", () => {
  it("enabling an incomplete setting is 422 assistant.enable_incomplete (no authorization reference)", async () => {
    const current = (await loadSetting(api.db))!;
    const cleared = await put(
      httpSetting({ modelName: "synthetic-model-2", authorizationReference: null }),
      current.version,
    );
    expect(cleared.status).toBe(200);
    const res = await toggle("enable", cleared.body.version);
    expect([res.status, res.body.code]).toEqual([422, "assistant.enable_incomplete"]);
    expect(res.body.detail).toBe(
      "To turn the assistant on, enter the provider, the company authorization reference and, for an HTTP endpoint, the endpoint, the API style and the model.",
    );
    expect((await loadSetting(api.db))!.enabled).toBe(false);
  });

  it("enable needs If-Match (428), refuses stale (409), then turns on with the stamp and one audit event", async () => {
    const current = (await loadSetting(api.db))!;
    const ready = await put(httpSetting({ modelName: "synthetic-model-2" }), current.version);
    expect(ready.status).toBe(200);
    expect((await toggle("enable", null)).status).toBe(428);
    expect((await toggle("enable", ready.body.version - 1)).status).toBe(409);
    const blank = await call<Body>(api.app, "POST", `${S}/enable`, {
      session: admin,
      body: { reason: "  " },
      headers: ifm(ready.body.version),
      contract: false,
    });
    expect([blank.status, blank.body.code]).toEqual([422, "admin.reason_required"]);
    const on = await toggle("enable", ready.body.version);
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ enabled: true, enabledBy: w.admin.id, version: ready.body.version + 1 });
    expect(on.body.enabledAt).not.toBeNull();
    expect(on.headers["etag"]).toBe(`"${on.body.version}"`);
    const row = (await loadSetting(api.db))!;
    const last = (await auditsOf(row.id)).at(-1)!;
    expect([last.action, last.prior_version, last.new_version]).toEqual([
      "assistant_setting.enabled",
      ready.body.version,
      on.body.version,
    ]);
    expect((last.changes as Body).authorization_reference.to).toBe(AUTH_REF);
    expect(last.reason).toBe("Synthetic toggle");
    expect(JSON.stringify(last)).not.toContain(CREDENTIAL_CANARY);
  });

  it("a second enable is 422 assistant.already_enabled", async () => {
    const v = (await loadSetting(api.db))!.version;
    const res = await toggle("enable", v);
    expect([res.status, res.body.code]).toEqual([422, "assistant.already_enabled"]);
  });

  it("while enabled, the provider, endpoint, API style, model, credential and authorization reference are locked (422); the limits are not", async () => {
    const v = (await loadSetting(api.db))!.version;
    for (const change of [
      { providerKind: "test_adapter", endpointUrl: null, apiStyle: null, credentialRef: null },
      { endpointUrl: "https://other.example.invalid/v1" },
      { modelName: "synthetic-model-9" },
      { credentialRef: { provider: "file", name: "model_key" } },
      { credentialRef: null },
      { authorizationReference: "IT-APPROVAL-SYNTHETIC-0002" },
    ]) {
      const res = await put(httpSetting({ modelName: "synthetic-model-2", ...change }), v);
      expect([res.status, res.body.code], JSON.stringify(change)).toEqual([422, "assistant.locked_while_enabled"]);
    }
    const limits = await put(
      httpSetting({ modelName: "synthetic-model-2", requestTimeoutMs: 45000, maxContextRecords: 5 }),
      v,
    );
    expect(limits.status).toBe(200);
    expect(limits.body).toMatchObject({ enabled: true, requestTimeoutMs: 45000, maxContextRecords: 5, version: v + 1 });
  });

  it("authorization is re-checked at commit for disable: revoked while waiting is 403 and the assistant stays on", async () => {
    const u = await userWith("ADM_TECH");
    const v = (await loadSetting(api.db))!.version;
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", `${S}/disable`, {
          session: u.session,
          headers: ifm(v),
          body: { reason: "Synthetic commit-time disable" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect((await loadSetting(api.db))!).toMatchObject({ enabled: true, version: v });
  });

  it("disable turns it off (stamp cleared, audited); a second disable is 422 assistant.already_disabled", async () => {
    const v = (await loadSetting(api.db))!.version;
    const off = await toggle("disable", v);
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ enabled: false, enabledAt: null, enabledBy: null, version: v + 1 });
    const row = (await loadSetting(api.db))!;
    expect((await auditsOf(row.id)).at(-1)!.action).toBe("assistant_setting.disabled");
    const again = await toggle("disable", v + 1);
    expect([again.status, again.body.code]).toEqual([422, "assistant.already_disabled"]);
    // Every version has exactly one audit event and one history row.
    const events = await auditsOf(row.id);
    expect(events.map((e) => e.new_version)).toEqual(Array.from({ length: row.version }, (_, i) => i + 1));
    const history = await api.db
      .selectFrom("assistant_setting_change")
      .select("record_version")
      .where("assistant_setting_id", "=", row.id)
      .orderBy("record_version")
      .execute();
    expect(history.map((h) => h.record_version)).toEqual(events.map((e) => e.new_version));
  });

  it("the test adapter can be saved and enabled outside production (no endpoint, API style or credential)", async () => {
    const v = (await loadSetting(api.db))!.version;
    const saved = await put(
      httpSetting({
        providerKind: "test_adapter",
        endpointUrl: null,
        apiStyle: null,
        credentialRef: null,
        modelName: null,
      }),
      v,
    );
    expect(saved.status).toBe(200);
    const on = await toggle("enable", saved.body.version);
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ enabled: true, providerKind: "test_adapter" });
    expect((await toggle("disable", on.body.version)).status).toBe(200);
  });
});

describe("production refusals (NODE_ENV=production; the pure checks the routes call)", () => {
  const body = (over: Record<string, unknown>) => ({
    providerKind: "http_endpoint" as "http_endpoint" | "test_adapter" | null,
    endpointUrl: "https://model.example.invalid/v1" as string | null,
    apiStyle: "openai_chat_completions" as const,
    modelName: "synthetic-model-1" as string | null,
    credentialRef: null as unknown,
    authorizationReference: AUTH_REF as string | null,
    requestTimeoutMs: 30000,
    maxOutputTokens: 1024,
    maxContextRecords: 8,
    reason: "Synthetic production check",
    ...over,
  });

  it("saving refuses the test adapter (assistant.test_adapter_not_allowed) and http:// (assistant.insecure_endpoint)", () => {
    expect(() =>
      checkedSettingUpdate(body({ providerKind: "test_adapter", endpointUrl: null, apiStyle: null }), {
        production: true,
      }),
    ).toThrow(expect.objectContaining({ status: 422, code: "assistant.test_adapter_not_allowed" }) as unknown as Error);
    expect(() =>
      checkedSettingUpdate(body({ endpointUrl: "http://model.example.invalid/v1" }), { production: true }),
    ).toThrow(
      expect.objectContaining({
        status: 422,
        code: "assistant.insecure_endpoint",
        detail: "The model endpoint must use HTTPS in production.",
      }) as unknown as Error,
    );
    // Outside production both are accepted; https is accepted in production.
    expect(
      checkedSettingUpdate(body({ endpointUrl: "http://127.0.0.1:1/v1" }), { production: false }).endpoint_url,
    ).toBe("http://127.0.0.1:1/v1");
    expect(checkedSettingUpdate(body({}), { production: true }).endpoint_url).toBe("https://model.example.invalid/v1");
  });

  it("enabling refuses the same two in production, after the completeness check", () => {
    const row = (over: Partial<AssistantSettingRow>) =>
      ({
        provider_kind: "http_endpoint",
        endpoint_url: "https://model.example.invalid/v1",
        api_style: "openai_chat_completions",
        model_name: "synthetic-model-1",
        authorization_reference: AUTH_REF,
        ...over,
      }) as AssistantSettingRow;
    expect(enableRefusal(row({}), { production: true })).toBeNull();
    expect(enableRefusal(row({ provider_kind: "test_adapter" }), { production: true })?.code).toBe(
      "assistant.test_adapter_not_allowed",
    );
    expect(enableRefusal(row({ provider_kind: "test_adapter" }), { production: false })).toBeNull();
    expect(enableRefusal(row({ endpoint_url: "http://model.example.invalid/v1" }), { production: true })?.code).toBe(
      "assistant.insecure_endpoint",
    );
    expect(enableRefusal(row({ model_name: null }), { production: true })?.code).toBe("assistant.enable_incomplete");
    expect(enableRefusal(row({ authorization_reference: null }), { production: false })?.code).toBe(
      "assistant.enable_incomplete",
    );
    expect(assistantSettingRefusals.testAdapterNotAllowed().detail).toBe(
      "The test adapter cannot be used in production.",
    );
  });
});
