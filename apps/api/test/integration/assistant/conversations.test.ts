// Assistant conversations and messages (ADR-0059 §3, §9, §10; REQ-S17-007, REQ-S17-009, REQ-S17-010;
// p6-work-split §D.1; T-DG6-BE-T) against a real PostgreSQL, on this suite's own scratch database (the assistant
// setting is installation-wide). Covers: zero requests to a (fake) model while the assistant is off, and 422
// assistant.disabled on create and post; reading history while off; ownership (another user's conversation is 404);
// the focus transformation needs transformation.read (404); AUD 403 on every conversation route; If-Match 428/409;
// one audit event per conversation version; authorization re-checked at commit (create and post); reply_pending and
// the `interrupted` recovery; conversation_full; the rate-limit class `assistant` (429); the cursor-paginated list; the
// read-time ReadScope re-check (a revoked grant withholds an earlier answer and its suggestion); the one log line per
// post carries no prompt text. BE-T's answer seam is a stub (no_sources): no model is called here even when enabled;
// BE-U's tests cover retrieval and the provider call. Since T-DG6-BE-X3B buildServer registers BE-U's two retrieval
// ports (the playbook port finds passages for these prompts); this file tests the conversation frame with nothing
// retrievable, so it clears both ports after each buildServer (noRetrievalPorts) and puts the suite app's back at the
// end; composition.test.ts covers the composed ports. All data is SYNTHETIC; nothing approves anything (G1-G6) or
// touches DG0-DG7.
import { migrate } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import {
  registerAssistantEvidenceTextPort,
  registerAssistantPlaybookPassagePort,
} from "../../../src/modules/assistant/retrieval.ts";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { providerFor, testAdapter } from "../../../src/modules/assistant/provider.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { FakeModel } from "../../support/fake-model.ts";
import {
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
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let scratchDb: string;
let fake: FakeModel;
let admin: Session; // ADM_TECH (configures; also uses)
let office: Session; // TO @ org A (assistant.use, transformation.read)
let auditor: Session; // AUD (no assistant.use)
let nobody: Session;
let tA1: string; // a transformation in BU a1
let tA2: string; // a transformation in BU a2

const S = "/api/v1/admin/assistant";
const C = "/api/v1/assistant/conversations";
const ifm = (v: number | string) => ({ "if-match": `"${v}"` });
const PROMPT_CANARY = "synthetic-prompt-canary-4410";

async function setting(body: Record<string, unknown>, enabled: boolean): Promise<void> {
  let current = await loadSetting(api.db);
  if (current?.enabled) {
    const off = await call<Body>(api.app, "POST", `${S}/disable`, {
      session: admin,
      body: { reason: "Synthetic: off" },
      headers: ifm(current.version),
    });
    expect(off.status).toBe(200);
    current = await loadSetting(api.db);
  }
  const saved = await call<Body>(api.app, "PUT", S, {
    session: admin,
    body: {
      providerKind: "test_adapter",
      endpointUrl: null,
      apiStyle: null,
      modelName: null,
      credentialRef: null,
      authorizationReference: "IT-APPROVAL-SYNTHETIC-0100",
      requestTimeoutMs: 30000,
      maxOutputTokens: 1024,
      maxContextRecords: 8,
      reason: "Synthetic: configure",
      ...body,
    },
    headers: ifm(current?.version ?? 0),
  });
  expect(saved.status).toBe(200);
  if (enabled) {
    const on = await call<Body>(api.app, "POST", `${S}/enable`, {
      session: admin,
      body: { reason: "Synthetic: on" },
      headers: ifm(saved.body.version),
    });
    expect(on.status).toBe(200);
  }
}

const create = (session: Session, body: Record<string, unknown> = { title: "Synthetic conversation" }) =>
  call<Body>(api.app, "POST", C, { session, body });
const post = (session: Session, id: string, version: number | null, content = "What is the case for change?") =>
  call<Body>(api.app, "POST", `${C}/${id}/messages`, {
    session,
    body: { content },
    headers: version === null ? {} : ifm(version),
  });
const conversationRow = (id: string) =>
  api.db.selectFrom("assistant_conversation").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const auditsOf = (id: string) =>
  api.db.selectFrom("audit_event").selectAll().where("record_id", "=", id).orderBy("seq").execute();

/**
 * Appends one message directly (owner role; test-only), following the 0111 guards: the conversation steps by one and
 * flips awaiting_reply in the same transaction. Used to set up states the API reaches only over time.
 */
async function appendRaw(
  conversationId: string,
  ownerId: string,
  messages: readonly (
    | { author: "user"; content: string; awaitingSince?: string }
    | { author: "assistant"; replyKind: string; content?: string; citations?: unknown[]; suggestion?: Body }
  )[],
): Promise<void> {
  const client = await api.owner.connect();
  try {
    await client.query("begin");
    for (const m of messages) {
      const user = m.author === "user";
      const since = user ? (m.awaitingSince ?? null) : null;
      const step = await client.query(
        `update assistant_conversation set message_count = message_count + 1, awaiting_reply = $2,
           awaiting_since = case when $2 then coalesce($3::timestamptz, now()) else null end,
           last_message_at = now(), version = version + 1, updated_by = owner_user_id
         where id = $1 returning message_count, organization_id, transformation_id, version`,
        [conversationId, user, since],
      );
      const { message_count: seq, organization_id: org, transformation_id: tx, version } = step.rows[0];
      // ADR-0004: every version has its audit event in the same transaction (the 0111 guards check it).
      await client.query(
        `insert into audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action,
           record_type, record_id, prior_version, new_version, request_id, source)
         values ($1, $2, $3, 'user', $4, $5, 'assistant_conversation', $6, $7, $8, 'synthetic-fixture', 'api')`,
        [
          crypto.randomUUID(),
          org,
          tx,
          ownerId,
          user ? "assistant_conversation.message_posted" : "assistant_conversation.reply_recorded",
          conversationId,
          version - 1,
          version,
        ],
      );
      const id = crypto.randomUUID();
      if (user) {
        await client.query(
          `insert into assistant_message (id, conversation_id, organization_id, seq, author, content, created_by)
           values ($1, $2, $3, $4, 'user', $5, $6)`,
          [id, conversationId, org, seq, m.content, ownerId],
        );
      } else {
        const answer = m.replyKind === "answer";
        await client.query(
          `insert into assistant_message (id, conversation_id, organization_id, seq, author, reply_kind, content,
             citations, provider_kind, setting_version, latency_ms, created_by)
           values ($1, $2, $3, $4, 'assistant', $5, $6, $7::jsonb, $8, $9, $10, $11)`,
          [
            id,
            conversationId,
            org,
            seq,
            m.replyKind,
            m.content ?? null,
            JSON.stringify(m.citations ?? []),
            answer ? "test_adapter" : null,
            answer ? 1 : null,
            answer ? 0 : null,
            ownerId,
          ],
        );
        if (m.suggestion) {
          const suggestionId = crypto.randomUUID();
          await client.query(
            `insert into assistant_suggestion (id, organization_id, transformation_id, conversation_id, message_id,
               owner_user_id, ordinal, kind, target_record_type, fields, text_content, citations, created_by, updated_by)
             values ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9::jsonb, $10, $11::jsonb, $6, $6)`,
            [
              suggestionId,
              org,
              tx,
              conversationId,
              id,
              ownerId,
              m.suggestion.kind,
              m.suggestion.target ?? null,
              m.suggestion.fields ? JSON.stringify(m.suggestion.fields) : null,
              m.suggestion.text ?? null,
              JSON.stringify(m.citations ?? []),
            ],
          );
          await client.query(
            `insert into audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action,
               record_type, record_id, prior_version, new_version, request_id, source)
             values ($1, $2, $3, 'user', $4, 'assistant_suggestion.created', 'assistant_suggestion', $5, null, 1,
               'synthetic-fixture', 'api')`,
            [crypto.randomUUID(), org, tx, ownerId, suggestionId],
          );
        }
      }
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function userWith(
  roles: readonly [string, { type: "organization" | "business_unit" | "transformation"; id: string }][],
) {
  const u = await createUser(api.db, w.orgA.id);
  for (const [role, scope] of roles) await grant(api.db, w.grantor.id, u.id, role, scope, w.orgA.id);
  return { id: u.id, session: await signIn(api.app, u.subject) };
}

/** Clears the two retrieval ports the last buildServer registered; returns the ones it removed (T-DG6-BE-X3B). */
function noRetrievalPorts(): () => void {
  const evidence = registerAssistantEvidenceTextPort(null);
  const playbook = registerAssistantPlaybookPassagePort(null);
  return () => {
    registerAssistantEvidenceTextPort(evidence);
    registerAssistantPlaybookPassagePort(playbook);
  };
}
let restoreRetrievalPorts: () => void = () => undefined;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_asst_conv");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  restoreRetrievalPorts = noRetrievalPorts();
  w = await seedWorld(api.db);
  fake = await new FakeModel().start();
  admin = await signIn(api.app, w.admin.subject);
  office = await signIn(api.app, w.office.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  tA1 = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  tA2 = await createTransformationRow(api.db, w.orgA.id, w.a2, w.grantor.id);
  testAdapter.reset();
}, 120_000);
afterAll(async () => {
  await fake.stop();
  restoreRetrievalPorts();
  await api.close();
  await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

describe("off means no call (REQ-S17-009; ADR-0059 §3)", () => {
  it("with no setting row: create is 422 assistant.disabled, the list is empty and readable", async () => {
    expect(await loadSetting(api.db)).toBeUndefined();
    const res = await create(office);
    expect([res.status, res.body.code]).toEqual([422, "assistant.disabled"]);
    expect(res.body.detail).toBe("The assistant is turned off. Every other feature works without it.");
    const list = await call<Body>(api.app, "GET", C, { session: office });
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ items: [], nextCursor: null, assistantEnabled: false });
  });

  it("an http endpoint saved but DISABLED gets zero requests: post and create answer 422; history stays readable", async () => {
    // A conversation exists from a time the assistant was on.
    await setting({}, true);
    const conv = await create(office, { title: "Synthetic: before the switch-off", transformationId: tA1 });
    expect(conv.status).toBe(201);
    await setting(
      {
        providerKind: "http_endpoint",
        endpointUrl: fake.url,
        apiStyle: "openai_chat_completions",
        modelName: "synthetic-model",
      },
      false,
    );
    const before = fake.requestCount;
    const posted = await post(office, conv.body.id, conv.body.version);
    expect([posted.status, posted.body.code]).toEqual([422, "assistant.disabled"]);
    expect([(await create(office)).status]).toEqual([422]);
    expect(fake.requestCount).toBe(before);
    expect(fake.requestCount).toBe(0);
    expect(testAdapter.requestCount()).toBe(0);
    // Nothing was appended; the conversation and the list read while off.
    expect((await conversationRow(conv.body.id)).message_count).toBe(0);
    const got = await call<Body>(api.app, "GET", `${C}/${conv.body.id}`, { session: office });
    expect(got.status).toBe(200);
    expect(got.body.messages).toEqual([]);
    expect((await call<Body>(api.app, "GET", C, { session: office })).body.items).toHaveLength(1);
  });

  it("enabled with the HTTP endpoint, BE-T's stub seam answers no_sources and still sends nothing to the model", async () => {
    const current = (await loadSetting(api.db))!;
    const on = await call<Body>(api.app, "POST", `${S}/enable`, {
      session: admin,
      body: { reason: "Synthetic: on (http)" },
      headers: ifm(current.version),
    });
    expect(on.status).toBe(200);
    const conv = await create(office, { title: "Synthetic: http" });
    const res = await post(office, conv.body.id, 1);
    expect(res.status).toBe(201);
    expect(res.body.reply).toMatchObject({ replyKind: "no_sources", content: null, providerKind: null });
    expect(fake.requestCount).toBe(0);
    await setting({}, true); // back to the test adapter, enabled, for the rest of the suite
  });
});

describe("assistantEnabled: whether the assistant is on, for every holder of assistant.use (T-DG6-BE-X5; REQ-S17-007)", () => {
  // The setting fields that only getAssistantSetting may return (assistant.configure or operations.read).
  const SETTING_KEYS = [
    "configured",
    "enabled",
    "providerKind",
    "endpointUrl",
    "apiStyle",
    "modelName",
    "credentialRef",
    "authorizationReference",
    "requestTimeoutMs",
    "maxOutputTokens",
    "maxContextRecords",
    "enabledAt",
    "enabledBy",
    "reason",
  ];
  const listAs = (session: Session, query = "?limit=1") => call<Body>(api.app, "GET", `${C}${query}`, { session });

  it("a TL without assistant.configure or operations.read: 403 on the setting, and the list says on/off and nothing else", async () => {
    const lead = (await userWith([["TL", { type: "transformation", id: tA1 }]])).session;
    // The admin read stays closed to this user (the admin screens are unchanged).
    expect((await call<Body>(api.app, "GET", S, { session: lead })).status).toBe(403);
    await setting({}, true);
    const on = await listAs(lead);
    expect(on.status).toBe(200);
    expect(on.body.assistantEnabled).toBe(true);
    expect(Object.keys(on.body).sort()).toEqual(["assistantEnabled", "items", "nextCursor"]);
    const text = JSON.stringify(on.body);
    for (const key of SETTING_KEYS) expect(Object.hasOwn(on.body, key)).toBe(false);
    expect(text).not.toContain("IT-APPROVAL-SYNTHETIC-0100"); // the authorization reference
    expect(text).not.toContain("test_adapter"); // the provider kind
    // The filter and the cursor do not change the signal.
    expect((await listAs(lead, `?limit=1&transformationId=${tA1}`)).body.assistantEnabled).toBe(true);
    // Off (a saved but disabled HTTP endpoint): false, and the endpoint, model and credential reference stay hidden.
    await setting(
      {
        providerKind: "http_endpoint",
        endpointUrl: fake.url,
        apiStyle: "openai_chat_completions",
        modelName: "synthetic-model-x5",
        credentialRef: { provider: "env", name: "MTH_SYNTHETIC_X5_KEY" },
      },
      false,
    );
    const before = fake.requestCount;
    const off = await listAs(lead);
    expect([off.status, off.body.assistantEnabled]).toEqual([200, false]);
    for (const s of [fake.url, "synthetic-model-x5", "MTH_SYNTHETIC_X5_KEY"])
      expect(JSON.stringify(off.body)).not.toContain(s);
    // Enabled HTTP endpoint: true, still nothing of the setting, and reading the signal sends nothing to the model.
    const current = (await loadSetting(api.db))!;
    const enabled = await call<Body>(api.app, "POST", `${S}/enable`, {
      session: admin,
      body: { reason: "Synthetic: on (http, X5)" },
      headers: ifm(current.version),
    });
    expect(enabled.status).toBe(200);
    const onHttp = await listAs(lead);
    expect(onHttp.body.assistantEnabled).toBe(true);
    for (const s of [fake.url, "synthetic-model-x5", "MTH_SYNTHETIC_X5_KEY"])
      expect(JSON.stringify(onHttp.body)).not.toContain(s);
    expect(fake.requestCount).toBe(before);
    await setting({}, true); // back to the test adapter, enabled, for the rest of the suite
  });

  it("agrees with create: when the list says false, create answers 422 assistant.disabled; when true, create succeeds", async () => {
    await setting({}, false);
    expect((await listAs(office)).body.assistantEnabled).toBe(false);
    expect((await create(office)).body.code).toBe("assistant.disabled");
    await setting({}, true);
    expect((await listAs(office)).body.assistantEnabled).toBe(true);
    expect((await create(office, { title: "Synthetic: X5 agrees" })).status).toBe(201);
  });

  it("the signal is providerFor's answer: a test adapter saved and enabled is refused under NODE_ENV=production", async () => {
    // The route computes assistantEnabled as providerFor(setting, …, { nodeEnv }) !== null, the check create and post
    // make. This suite's server runs outside production (where the row is on); the production answer of the same row
    // is null, so a production server reports false (the settings suite tests the production refusals themselves).
    await setting({}, true);
    const row = (await loadSetting(api.db))!;
    expect(row.enabled).toBe(true);
    expect((await listAs(office)).body.assistantEnabled).toBe(true);
    expect(providerFor(row, null, { nodeEnv: "test" })).not.toBeNull();
    expect(providerFor(row, null, { nodeEnv: "production" })).toBeNull();
  });

  it("AUD, a user without assistant.use and an anonymous caller learn nothing: 403, 403, 401", async () => {
    await setting({}, true);
    for (const session of [auditor, nobody]) {
      const res = await listAs(session);
      expect(res.status).toBe(403);
      expect(Object.hasOwn(res.body, "assistantEnabled")).toBe(false);
    }
    const anon = await call<Body>(api.app, "GET", `${C}?limit=1`);
    expect(anon.status).toBe(401);
    expect(Object.hasOwn(anon.body, "assistantEnabled")).toBe(false);
  });
});

describe("authorization and ownership (ADR-0059 §10)", () => {
  it("AUD and a user without assistant.use get 403 on every conversation route", async () => {
    const own = await create(office, { title: "Synthetic: office" });
    expect(own.status).toBe(201);
    for (const session of [auditor, nobody]) {
      expect((await call(api.app, "GET", C, { session })).status).toBe(403);
      expect((await create(session)).status).toBe(403);
      expect((await call(api.app, "GET", `${C}/${own.body.id}`, { session })).status).toBe(403);
      expect((await post(session, own.body.id, 1)).status).toBe(403);
    }
    expect((await call(api.app, "GET", C)).status).toBe(401);
  });

  it("another user's conversation is 404 on read and post, and never listed", async () => {
    const own = await create(office, { title: "Synthetic: private" });
    const other = await userWith([["TO", { type: "organization", id: w.orgA.id }]]);
    expect((await call(api.app, "GET", `${C}/${own.body.id}`, { session: other.session })).status).toBe(404);
    expect((await post(other.session, own.body.id, 1)).status).toBe(404);
    expect((await call(api.app, "GET", `${C}/${crypto.randomUUID()}`, { session: office })).status).toBe(404);
    const list = await call<Body>(api.app, "GET", C, { session: other.session });
    expect(list.body.items).toEqual([]);
    expect((await conversationRow(own.body.id)).message_count).toBe(0);
  });

  it("a focus transformation the caller cannot read is 404 (TL on tA1 asks about tA2); a readable one is accepted", async () => {
    const lead = (await userWith([["TL", { type: "transformation", id: tA1 }]])).session;
    const refused = await create(lead, { title: "Synthetic", transformationId: tA2 });
    expect(refused.status).toBe(404);
    expect((await create(lead, { title: "Synthetic", transformationId: crypto.randomUUID() })).status).toBe(404);
    const ok = await create(lead, { title: "Synthetic: own BU", transformationId: tA1 });
    expect(ok.status).toBe(201);
    expect(ok.body.transformationId).toBe(tA1);
  });

  it("create: validation (400), version 1 with no message, Location and ETag, one audit event", async () => {
    expect((await create(office, { title: "" })).status).toBe(400);
    expect((await create(office, { title: "x".repeat(201) })).status).toBe(400);
    expect((await create(office, { title: "Synthetic", extra: true })).status).toBe(400);
    const blank = await call<Body>(api.app, "POST", C, { session: office, body: { title: "   " }, contract: false });
    expect(blank.status).toBe(400);
    const res = await create(office, { title: "Synthetic: audited" });
    expect(res.status).toBe(201);
    expect(res.headers["location"]).toBe(`${C}/${res.body.id}`);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.body).toMatchObject({ version: 1, messageCount: 0, awaitingReply: false, lastMessageAt: null });
    const events = await auditsOf(res.body.id);
    expect(events.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["assistant_conversation.created", null, 1],
    ]);
  });

  it("create re-checks assistant.use at commit: revoked while waiting is 403 and nothing is created", async () => {
    const u = await userWith([["TO", { type: "organization", id: w.orgA.id }]]);
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", C, { session: u.session, body: { title: "Synthetic commit" }, contract: false }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const rows = await api.db
      .selectFrom("assistant_conversation")
      .select("id")
      .where("owner_user_id", "=", u.id)
      .execute();
    expect(rows).toEqual([]);
  });
});

describe("postAssistantMessage (ADR-0059 §9)", () => {
  it("validation (400), If-Match (428 missing, 409 stale), then one turn: prompt + reply, two versions, two audit events", async () => {
    const conv = await create(office, { title: "Synthetic: turn", transformationId: tA1 });
    const id = conv.body.id;
    expect((await post(office, id, 1, "")).status).toBe(400);
    expect((await post(office, id, 1, "x".repeat(4001))).status).toBe(400);
    const blank = await call<Body>(api.app, "POST", `${C}/${id}/messages`, {
      session: office,
      body: { content: "   " },
      headers: ifm(1),
      contract: false,
    });
    expect(blank.status).toBe(400);
    expect((await post(office, id, null)).status).toBe(428);
    const stale = await post(office, id, 5);
    expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    expect((await conversationRow(id)).message_count).toBe(0);

    const res = await post(office, id, 1, `Summarize the case for change ${PROMPT_CANARY}`);
    expect(res.status).toBe(201);
    expect(res.headers["etag"]).toBe('"3"');
    expect(res.body.conversation).toMatchObject({ version: 3, messageCount: 2, awaitingReply: false });
    expect(res.body.userMessage).toMatchObject({
      seq: 1,
      author: "user",
      label: "user_prompt",
      content: `Summarize the case for change ${PROMPT_CANARY}`,
      replyKind: null,
    });
    expect(res.body.reply).toMatchObject({
      seq: 2,
      author: "assistant",
      label: "assistant_suggestion",
      replyKind: "no_sources",
      content: null,
      contentWithheld: false,
      citations: [],
      latencyMs: null,
    });
    expect(res.body.suggestions).toEqual([]);
    const events = await auditsOf(id);
    expect(events.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["assistant_conversation.created", null, 1],
      ["assistant_conversation.message_posted", 1, 2],
      ["assistant_conversation.reply_recorded", 2, 3],
    ]);
    // Audit events never carry message text (§9 logging rule 4).
    expect(JSON.stringify(events)).not.toContain(PROMPT_CANARY);
    // The stub sent nothing to any provider.
    expect(testAdapter.requestCount()).toBe(0);
    // The stored conversation reads back the same turn.
    const got = await call<Body>(api.app, "GET", `${C}/${id}`, { session: office });
    expect(got.headers["etag"]).toBe('"3"');
    expect(got.body.messages.map((m: Body) => [m.seq, m.author, m.replyKind])).toEqual([
      [1, "user", null],
      [2, "assistant", "no_sources"],
    ]);
  });

  it("post re-checks assistant.use at commit: revoked while waiting is 403 and nothing is appended", async () => {
    const u = await userWith([["TO", { type: "organization", id: w.orgA.id }]]);
    const conv = await create(u.session, { title: "Synthetic commit post" });
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", `${C}/${conv.body.id}/messages`, {
          session: u.session,
          body: { content: "Synthetic question" },
          headers: ifm(1),
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await conversationRow(conv.body.id)).toMatchObject({ message_count: 0, version: 1 });
  });

  it("a reply still awaited is 409 assistant.reply_pending; one awaited past the timeout + 60 s is recovered as `interrupted`", async () => {
    const pending = await create(office, { title: "Synthetic: pending" });
    await appendRaw(pending.body.id, w.office.id, [{ author: "user", content: "Synthetic earlier question" }]);
    const busy = await post(office, pending.body.id, 2);
    expect([busy.status, busy.body.code]).toEqual([409, "assistant.reply_pending"]);
    expect((await conversationRow(pending.body.id)).message_count).toBe(1);

    const stuck = await create(office, { title: "Synthetic: stuck" });
    const longAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    await appendRaw(stuck.body.id, w.office.id, [
      { author: "user", content: "Synthetic unanswered question", awaitingSince: longAgo },
    ]);
    const res = await post(office, stuck.body.id, 2);
    expect(res.status).toBe(201);
    expect(res.body.userMessage.seq).toBe(3);
    expect(res.body.reply.seq).toBe(4);
    expect(res.body.conversation).toMatchObject({ messageCount: 4, version: 5, awaitingReply: false });
    const got = await call<Body>(api.app, "GET", `${C}/${stuck.body.id}`, { session: office });
    expect(got.body.messages.map((m: Body) => [m.seq, m.author, m.replyKind])).toEqual([
      [1, "user", null],
      [2, "assistant", "interrupted"],
      [3, "user", null],
      [4, "assistant", "no_sources"],
    ]);
    const events = await auditsOf(stuck.body.id);
    expect(events.map((e) => [e.action, e.new_version])).toEqual([
      ["assistant_conversation.created", 1],
      ["assistant_conversation.message_posted", 2], // the fixture's unanswered prompt
      ["assistant_conversation.reply_recorded", 3], // the interrupted reply, appended by the API
      ["assistant_conversation.message_posted", 4],
      ["assistant_conversation.reply_recorded", 5],
    ]);
    expect(events.slice(2).every((e) => e.request_id !== "synthetic-fixture")).toBe(true);
  });

  it("a conversation with 98 messages takes one last turn (100); then 422 assistant.conversation_full, nothing appended", async () => {
    const conv = await create(office, { title: "Synthetic: full" });
    const pairs = Array.from({ length: 49 }, (_, i) => [
      { author: "user" as const, content: `Synthetic question ${i + 1}` },
      { author: "assistant" as const, replyKind: "no_sources" },
    ]).flat();
    await appendRaw(conv.body.id, w.office.id, pairs);
    const row = await conversationRow(conv.body.id);
    expect(row.message_count).toBe(98);
    const last = await post(office, conv.body.id, row.version);
    expect(last.status).toBe(201);
    expect(last.body.conversation.messageCount).toBe(100);
    const res = await post(office, conv.body.id, last.body.conversation.version);
    expect([res.status, res.body.code]).toEqual([422, "assistant.conversation_full"]);
    expect(res.body.detail).toBe("This conversation has reached 100 messages. Start a new conversation.");
    expect((await conversationRow(conv.body.id)).message_count).toBe(100);
  });

  it("when an `interrupted` reply must be appended first, at most 97 messages so far: 97 takes a turn, 99 is full", async () => {
    const longAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const pairs = (n: number) =>
      Array.from({ length: n }, (_, i) => [
        { author: "user" as const, content: `Synthetic question ${i + 1}` },
        { author: "assistant" as const, replyKind: "no_sources" },
      ]).flat();
    const ok = await create(office, { title: "Synthetic: 97 stuck" });
    await appendRaw(ok.body.id, w.office.id, [
      ...pairs(48),
      { author: "user", content: "Synthetic unanswered", awaitingSince: longAgo },
    ]);
    const okRow = await conversationRow(ok.body.id);
    expect(okRow.message_count).toBe(97);
    const turn = await post(office, ok.body.id, okRow.version);
    expect(turn.status).toBe(201);
    expect(turn.body.conversation.messageCount).toBe(100);

    const full = await create(office, { title: "Synthetic: 99 stuck" });
    await appendRaw(full.body.id, w.office.id, [
      ...pairs(49),
      { author: "user", content: "Synthetic unanswered", awaitingSince: longAgo },
    ]);
    const fullRow = await conversationRow(full.body.id);
    const res = await post(office, full.body.id, fullRow.version);
    expect([res.status, res.body.code]).toEqual([422, "assistant.conversation_full"]);
    expect((await conversationRow(full.body.id)).message_count).toBe(99);
  });
});

describe("the list (cursor-paginated, own only, updatedAt desc then id desc)", () => {
  it("pages with a stable order; a tampered cursor is 400; the transformation filter applies", async () => {
    const u = await userWith([["TO", { type: "organization", id: w.orgA.id }]]);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push((await create(u.session, { title: `Synthetic ${i}`, transformationId: tA1 })).body.id);
    ids.push((await create(u.session, { title: "Synthetic unfocused" })).body.id);
    const all = await call<Body>(api.app, "GET", C, { session: u.session });
    expect(all.body.items.map((c: Body) => c.id)).toEqual([...ids].reverse());
    const first = await call<Body>(api.app, "GET", `${C}?limit=2`, { session: u.session });
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await call<Body>(api.app, "GET", `${C}?limit=2&cursor=${first.body.nextCursor}`, {
      session: u.session,
    });
    expect([...first.body.items, ...second.body.items].map((c: Body) => c.id)).toEqual([...ids].reverse());
    expect(second.body.nextCursor).toBeNull();
    const bad = await call<Body>(api.app, "GET", `${C}?cursor=not-a-cursor`, { session: u.session, contract: false });
    expect(bad.status).toBe(400);
    const otherFilter = await call<Body>(
      api.app,
      "GET",
      `${C}?limit=2&transformationId=${tA1}&cursor=${first.body.nextCursor}`,
      {
        session: u.session,
        contract: false,
      },
    );
    expect(otherFilter.status).toBe(400);
    const focused = await call<Body>(api.app, "GET", `${C}?transformationId=${tA1}`, { session: u.session });
    expect(focused.body.items.map((c: Body) => c.id)).toEqual(ids.slice(0, 3).reverse());
  });
});

describe("the read-time ReadScope re-check (ADR-0059 §9; REQ-S17-007)", () => {
  it("an answer citing a record the owner can no longer read is withheld (content null, readable false), with its suggestion", async () => {
    // ADM_TECH gives assistant.use but no record read; TL on tA1 gives transformation.read on tA1.
    const u = await userWith([
      ["ADM_TECH", { type: "organization", id: w.orgA.id }],
      ["TL", { type: "transformation", id: tA1 }],
    ]);
    await api.db
      .insertInto("search_document")
      .values({
        id: crypto.randomUUID(),
        organization_id: w.orgA.id,
        transformation_id: tA1,
        record_type: "transformation",
        record_id: tA1,
        record_version: 1,
        title: "Synthetic fixture transformation",
        source_audit_seq: "0",
      })
      .onConflict((oc) => oc.constraint("search_document_record_key").doNothing())
      .execute();
    const conv = await create(u.session, { title: "Synthetic: re-check", transformationId: tA1 });
    expect(conv.status).toBe(201);
    const citation = { source: "record", recordType: "transformation", recordId: tA1, recordVersion: 1 };
    const playbook = { source: "playbook", blockRef: "B0042", playbookVersion: "1.0" };
    await appendRaw(conv.body.id, u.id, [
      { author: "user", content: "Synthetic question about tA1" },
      {
        author: "assistant",
        replyKind: "answer",
        content: "Synthetic answer quoting the tA1 record",
        citations: [citation, playbook],
        suggestion: { kind: "recovery_action", text: "Synthetic recovery advice for tA1" },
      },
    ]);
    const readable = await call<Body>(api.app, "GET", `${C}/${conv.body.id}`, { session: u.session });
    expect(readable.status).toBe(200);
    const answer = readable.body.messages[1];
    expect(answer).toMatchObject({ content: "Synthetic answer quoting the tA1 record", contentWithheld: false });
    expect(answer.citations).toEqual([{ ...citation, readable: true }, playbook]);
    expect(readable.body.suggestions[0]).toMatchObject({
      textContent: "Synthetic recovery advice for tA1",
      contentWithheld: false,
      label: "assistant_suggestion",
    });

    // Revoke only the TL grant: the user keeps assistant.use but can no longer read tA1.
    await api.owner.query(
      `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic re-check'
        where user_id = $2 and revoked_at is null and role_id = (select id from role where code = 'TL')`,
      [w.grantor.id, u.id],
    );
    const withheld = await call<Body>(api.app, "GET", `${C}/${conv.body.id}`, { session: u.session });
    expect(withheld.status).toBe(200);
    const hidden = withheld.body.messages[1];
    expect(hidden).toMatchObject({ content: null, contentWithheld: true });
    expect(hidden.citations).toEqual([{ ...citation, readable: false }, playbook]);
    expect(withheld.body.suggestions[0]).toMatchObject({ textContent: null, fields: null, contentWithheld: true });
    expect(JSON.stringify(withheld.body)).not.toContain("quoting the tA1 record");
    expect(JSON.stringify(withheld.body)).not.toContain("recovery advice for tA1");
    // The user prompt is the user's own text and stays visible.
    expect(withheld.body.messages[0].content).toBe("Synthetic question about tA1");
  });

  it("a citation of a record that is not (or no longer) indexed is treated as unreadable (fail closed)", async () => {
    const conv = await create(office, { title: "Synthetic: unindexed" });
    const ghost = { source: "record", recordType: "initiative", recordId: crypto.randomUUID(), recordVersion: 1 };
    await appendRaw(conv.body.id, w.office.id, [
      { author: "user", content: "Synthetic" },
      { author: "assistant", replyKind: "answer", content: "Synthetic ghost answer", citations: [ghost] },
    ]);
    const got = await call<Body>(api.app, "GET", `${C}/${conv.body.id}`, { session: office });
    expect(got.body.messages[1]).toMatchObject({ content: null, contentWithheld: true });
  });
});

describe("the rate-limit class `assistant` and the log line (ADR-0052 §4; ADR-0059 §9 rule 3)", () => {
  it("over the per-minute budget a post is 429 with Retry-After; each post writes one log line without the prompt", async () => {
    const lines: string[] = [];
    const limited = await startApi({
      database: scratchDb,
      env: { ASSISTANT_RATE_LIMIT_PER_MINUTE: "2" },
      logStream: { write: (line: string) => void lines.push(line) },
    });
    noRetrievalPorts(); // this app registered its own pair; the file keeps nothing retrievable (BE-X3B)
    try {
      const session = await signIn(limited.app, w.office.subject);
      const conv = await call<Body>(limited.app, "POST", C, { session, body: { title: "Synthetic: limited" } });
      let version = conv.body.version as number;
      let firstReply: Body = null;
      for (let i = 0; i < 2; i++) {
        const ok = await call<Body>(limited.app, "POST", `${C}/${conv.body.id}/messages`, {
          session,
          body: { content: `Synthetic ${PROMPT_CANARY} ${i}` },
          headers: ifm(version),
        });
        expect(ok.status).toBe(201);
        firstReply ??= ok.body.reply;
        version = ok.body.conversation.version;
      }
      const over = await call<Body>(limited.app, "POST", `${C}/${conv.body.id}/messages`, {
        session,
        body: { content: "Synthetic third" },
        headers: ifm(version),
      });
      expect(over.status).toBe(429);
      expect(over.headers["retry-after"]).toBeDefined();
      // Reads are not in the class.
      expect((await call(limited.app, "GET", `${C}/${conv.body.id}`, { session })).status).toBe(200);
      const assistantLines = lines.filter((l) => l.includes('"assistant message"'));
      expect(assistantLines).toHaveLength(2);
      const parsed = JSON.parse(assistantLines[0]!) as Body;
      // T-DG6-BE-X3B: the line describes the reply actually given. Since BE-U, search retrieval can find a record for
      // "Synthetic ..." (the scoped search; this file clears only the two ports), so the reply is `answer` with its
      // items, or `no_sources` with none (the BE-C2 handback's deterministic seam at :670, which expected only the stub).
      expect(["answer", "no_sources"]).toContain(firstReply.replyKind);
      expect(parsed.assistant).toMatchObject({
        conversationId: conv.body.id,
        messageSeq: 2,
        replyKind: firstReply.replyKind,
        dataItems: firstReply.citations.length, // the local test adapter cites every item given (provider.ts)
        droppedSuggestions: 0,
      });
      expect(lines.join("\n")).not.toContain(PROMPT_CANARY);
    } finally {
      await limited.close();
    }
  });
});
