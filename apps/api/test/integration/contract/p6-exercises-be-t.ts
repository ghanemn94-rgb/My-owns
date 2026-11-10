// P6 contract exercises of BE-T (p6-work-split §D.1 and §2 rule 16; T-DG6-BE-T): the eight assistant operations (the
// setting and the conversations), each with a success and every declared refusal it can reach, through the validating
// client. The provider is the local test adapter (no network); BE-T's answer seam answers no_sources, so no model is
// called. The setting is installation-wide: it is turned OFF again at the end, so later exercises see the assistant
// disabled (a disabled row; the A21 suites that need "no row" run on their own databases). Every value is SYNTHETIC; the
// authorization reference is a made-up ticket id that the product records but does not verify.
import { expect } from "vitest";
import type { z } from "zod";
import {
  assistantConversationDetail,
  assistantConversationPage,
  assistantConversationView,
  assistantMessagePostResult,
} from "../../../src/modules/assistant/conversations.ts";
import { assistantSettingView } from "../../../src/modules/assistant/settings.ts";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P6_MIRRORS_BE_T: Readonly<Record<string, z.ZodType>> = {
  getAssistantSetting: assistantSettingView,
  putAssistantSetting: assistantSettingView,
  enableAssistant: assistantSettingView,
  disableAssistant: assistantSettingView,
  listAssistantConversations: assistantConversationPage,
  createAssistantConversation: assistantConversationView,
  getAssistantConversation: assistantConversationDetail,
  postAssistantMessage: assistantMessagePostResult,
};

export async function exerciseP6BeTOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject); // ADM_TECH: configures
  const office = await signIn(api.app, w.office.subject); // TO: uses
  const auditor = await signIn(api.app, w.auditor.subject); // AUD: reads the setting, 403 on every write
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  const S = "/api/v1/admin/assistant";
  const C = "/api/v1/assistant/conversations";
  const ifm = (v: number | string) => ({ "if-match": `"${v}"` });
  const setting = (over: Record<string, unknown> = {}) => ({
    providerKind: "test_adapter",
    endpointUrl: null,
    apiStyle: null,
    modelName: null,
    credentialRef: null,
    authorizationReference: "IT-APPROVAL-SYNTHETIC-CONTRACT",
    requestTimeoutMs: 30000,
    maxOutputTokens: 1024,
    maxContextRecords: 8,
    reason: "Synthetic contract exercise",
    ...over,
  });

  // getAssistantSetting: 200 (ADM_TECH; AUD through operations.read); 401; 403.
  const got = await mirrored("GET", S, { session: auditor });
  expect(got.status).toBe(200);
  expect(got.body.telemetryEnabled).toBe(false);
  expect((await mirrored("GET", S)).status).toBe(401);
  expect((await mirrored("GET", S, { session: nobody })).status).toBe(403);
  const initial = await mirrored("GET", S, { session: admin });
  expect(initial.status).toBe(200);
  let version = initial.body.version as number;

  // enableAssistant / disableAssistant before any row: 404.
  if (version === 0) {
    const reason = { reason: "Synthetic contract exercise" };
    expect((await mirrored("POST", `${S}/enable`, { session: admin, body: reason, headers: ifm(1) })).status).toBe(404);
    expect((await mirrored("POST", `${S}/disable`, { session: admin, body: reason, headers: ifm(1) })).status).toBe(
      404,
    );
  }

  // putAssistantSetting: 400; 401; 403 (AUD); 422 (endpoint, credential, test-adapter shape); 428; 409; 200.
  const put = (body: unknown, ifMatch: number | null, session = admin) =>
    mirrored("PUT", S, { session, body, headers: ifMatch === null ? {} : ifm(ifMatch) });
  expect((await put({ ...setting(), extra: 1 }, version)).status).toBe(400);
  expect((await mirrored("PUT", S, { body: setting(), headers: ifm(version) })).status).toBe(401);
  expect((await put(setting(), version, auditor)).status).toBe(403);
  const badUrl = await put(
    setting({ providerKind: "http_endpoint", endpointUrl: "https://model.example.invalid/v1?key=x" }),
    version,
  );
  expect([badUrl.status, badUrl.body.code]).toEqual([422, "assistant.endpoint_invalid"]);
  const badRef = await put(setting({ providerKind: "http_endpoint", credentialRef: { provider: "env" } }), version);
  expect([badRef.status, badRef.body.code]).toEqual([422, "assistant.credential_ref_invalid"]);
  expect((await put(setting(), null)).status).toBe(428);
  expect((await put(setting(), version + 5)).status).toBe(409);
  // A saved setting without the authorization reference cannot be enabled.
  const incomplete = await put(setting({ authorizationReference: null }), version);
  expect(incomplete.status).toBe(200);
  expect(incomplete.body).toMatchObject({ configured: true, enabled: false });
  version = incomplete.body.version;

  // enableAssistant: 400; 401; 403; 409; 422 (incomplete); 428; then 200; then 422 already_enabled.
  const toggle = (
    to: string,
    ifMatch: number | null,
    session = admin,
    body: unknown = { reason: "Synthetic toggle" },
  ) => mirrored("POST", `${S}/${to}`, { session, body, headers: ifMatch === null ? {} : ifm(ifMatch) });
  expect((await toggle("enable", version, admin, { why: "x" })).status).toBe(400);
  expect((await mirrored("POST", `${S}/enable`, { body: { reason: "Synthetic" }, headers: ifm(version) })).status).toBe(
    401,
  );
  expect((await toggle("enable", version, auditor)).status).toBe(403);
  expect((await toggle("enable", version + 3)).status).toBe(409);
  expect((await toggle("enable", null)).status).toBe(428);
  const notReady = await toggle("enable", version);
  expect([notReady.status, notReady.body.code]).toEqual([422, "assistant.enable_incomplete"]);
  const ready = await put(setting(), version);
  expect(ready.status).toBe(200);
  const on = await toggle("enable", ready.body.version);
  expect(on.status).toBe(200);
  expect(on.body.enabled).toBe(true);
  version = on.body.version;
  expect((await toggle("enable", version)).body.code).toBe("assistant.already_enabled");
  const locked = await put(setting({ authorizationReference: "IT-APPROVAL-SYNTHETIC-OTHER" }), version);
  expect([locked.status, locked.body.code]).toEqual([422, "assistant.locked_while_enabled"]);

  // createAssistantConversation: 201; 400; 401; 403 (AUD); 404 (a transformation the caller cannot read).
  const created = await mirrored("POST", C, { session: office, body: { title: "Synthetic contract conversation" } });
  expect(created.status).toBe(201);
  expect(created.headers["location"]).toBe(`${C}/${created.body.id}`);
  const id = created.body.id as string;
  expect((await mirrored("POST", C, { session: office, body: { title: "" } })).status).toBe(400);
  expect((await mirrored("POST", C, { body: { title: "Synthetic" } })).status).toBe(401);
  expect((await mirrored("POST", C, { session: auditor, body: { title: "Synthetic" } })).status).toBe(403);
  const focus404 = await mirrored("POST", C, {
    session: office,
    body: { title: "Synthetic", transformationId: missing },
  });
  expect(focus404.status).toBe(404);

  // postAssistantMessage: 201; 400; 401; 403; 404; 409 (stale); 428.
  const M = `${C}/${id}/messages`;
  const ask = { content: "Synthetic contract question" };
  expect((await mirrored("POST", M, { session: office, body: { content: "" }, headers: ifm(1) })).status).toBe(400);
  expect((await mirrored("POST", M, { body: ask, headers: ifm(1) })).status).toBe(401);
  expect((await mirrored("POST", M, { session: auditor, body: ask, headers: ifm(1) })).status).toBe(403);
  expect(
    (await mirrored("POST", `${C}/${missing}/messages`, { session: office, body: ask, headers: ifm(1) })).status,
  ).toBe(404);
  expect((await mirrored("POST", M, { session: office, body: ask, headers: ifm(9) })).status).toBe(409);
  expect((await mirrored("POST", M, { session: office, body: ask })).status).toBe(428);
  const posted = await mirrored("POST", M, { session: office, body: ask, headers: ifm(1) });
  expect(posted.status).toBe(201);
  expect(posted.body.reply).toMatchObject({
    author: "assistant",
    label: "assistant_suggestion",
    // T-DG6-BE-U replaced the stub seam: retrieval may find records or playbook passages for the question (an answer
    // from the local test adapter), or nothing (no_sources); either is a valid reply (ADR-0059 §4, §9).
    replyKind: expect.stringMatching(/^(answer|no_sources)$/),
  });

  // listAssistantConversations: 200; 400; 401; 403.
  const list = await mirrored("GET", `${C}?limit=1`, { session: office });
  expect(list.status).toBe(200);
  expect(list.body.items.map((c: { id: string }) => c.id)).toContain(id);
  expect(list.body.assistantEnabled).toBe(true); // T-DG6-BE-X5: the user-level availability signal while on
  expect((await mirrored("GET", `${C}?limit=0`, { session: office })).status).toBe(400);
  expect((await mirrored("GET", C)).status).toBe(401);
  expect((await mirrored("GET", C, { session: auditor })).status).toBe(403);

  // getAssistantConversation: 200; 400; 401; 403; 404.
  const detail = await mirrored("GET", `${C}/${id}`, { session: office });
  expect(detail.status).toBe(200);
  expect(detail.body.messages).toHaveLength(2);
  expect((await mirrored("GET", `${C}/not-a-uuid`, { session: office })).status).toBe(400);
  expect((await mirrored("GET", `${C}/${id}`)).status).toBe(401);
  expect((await mirrored("GET", `${C}/${id}`, { session: auditor })).status).toBe(403);
  expect((await mirrored("GET", `${C}/${missing}`, { session: office })).status).toBe(404);

  // disableAssistant: 403 (AUD); 200; 422 already_disabled. Then the conversation routes refuse with 422 disabled.
  expect((await toggle("disable", version, auditor)).status).toBe(403);
  const off = await toggle("disable", version);
  expect(off.status).toBe(200);
  expect(off.body.enabled).toBe(false);
  expect((await toggle("disable", off.body.version)).body.code).toBe("assistant.already_disabled");
  const disabledPost = await mirrored("POST", M, {
    session: office,
    body: ask,
    headers: ifm(posted.body.conversation.version),
  });
  expect([disabledPost.status, disabledPost.body.code]).toEqual([422, "assistant.disabled"]);
  const disabledCreate = await mirrored("POST", C, { session: office, body: { title: "Synthetic while off" } });
  expect([disabledCreate.status, disabledCreate.body.code]).toEqual([422, "assistant.disabled"]);
  // T-DG6-BE-X5: the list still reads while off, and now says the assistant is off.
  const offList = await mirrored("GET", `${C}?limit=1`, { session: office });
  expect([offList.status, offList.body.assistantEnabled]).toEqual([200, false]);
}
