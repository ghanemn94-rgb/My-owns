// The ADR-0059 §9 read-time re-check covers EVERY record an answer was generated from, not only the records the model
// chose to cite (T-DG6-BE-RG1; F-DG6-920; REQ-S17-007 "The assistant retrieves only records the user may read, cites
// them, and labels outputs as suggestions"; ADR-0059 §5 and §9 amendment of 2026-11-10; migration 0128).
// Against a real PostgreSQL, through the real API, with the SHIPPED `http_endpoint` provider pointed at the suite's local
// fake chat-completions server (test/support/fake-model.ts; loopback, NOT a model and NOT an IT endpoint). The fake
// cites only a SUBSET of the records it was given (`citeRecords`), as a real model may do, or as an instruction inside an
// uploaded text evidence file may steer it to (REQ-S17-011). The cases:
//   1. F-DG6-920: an answer cites one of two given records; the grant on the UNCITED one is revoked; the answer is
//      withheld (content null, contentWithheld true) and no longer shows the revoked record's title.
//   2. The cited record's grant is revoked: still withheld, the citation readable false (the shipped rule).
//   3. Nothing revoked: the answer is still readable, and its stored context lists both records.
//   4. A suggestion built from an answer whose uncited benefit becomes unreadable (marked sensitive, ADR-0051 §2) is
//      withheld the same way, and cannot be taken to a draft (404).
//   5. A row stored before 0128 (context NULL) falls back to its citations (the documented fallback).
// The first-half reproduction is the code-security round-1 probe (docs/delivery/test-evidence/DG6/code-security/
// round-1/repro/zz-sec-r1-assistant-uncited.test.ts); case 1 is its sequence with the expected outcome.
// All data is SYNTHETIC. Nothing approves anything (G1-G6) or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { FakeModel } from "../../support/fake-model.ts";
import { call, createTransformationRow, createUser, grant, signIn, type Session } from "../../support/harness.ts";
import {
  ask,
  C,
  ifm,
  newConversation,
  S,
  startAssistantWorld,
  type AssistantWorld,
  type Body,
} from "./be-u-fixtures.ts";

const TITLE_1 = "Zephyrine synthetic program one";
const TITLE_2 = "Zephyrine synthetic program two";
const PROMPT = "Zephyrine synthetic program";
const X_WORD = "Contextaria";

let a: AssistantWorld;
let fake: FakeModel;
let tA1: string;
let tA2: string;

async function enableFake(): Promise<void> {
  const current = (await loadSetting(a.api.db))!;
  const off = await call<Body>(a.api.app, "POST", `${S}/disable`, {
    session: a.admin,
    body: { reason: "Synthetic: off" },
    headers: ifm(current.version),
  });
  expect(off.status).toBe(200);
  const saved = await call<Body>(a.api.app, "PUT", S, {
    session: a.admin,
    body: {
      providerKind: "http_endpoint",
      endpointUrl: fake.url,
      apiStyle: "openai_chat_completions",
      modelName: "synthetic-model",
      credentialRef: null,
      authorizationReference: "IT-APPROVAL-SYNTHETIC-BE-RG1",
      requestTimeoutMs: 5000,
      maxOutputTokens: 512,
      maxContextRecords: 20,
      reason: "Synthetic: the local fake model",
    },
    headers: ifm(off.body.version),
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const on = await call<Body>(a.api.app, "POST", `${S}/enable`, {
    session: a.admin,
    body: { reason: "Synthetic: on (fake)" },
    headers: ifm(saved.body.version),
  });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
}

/** A fresh user with TL on each transformation of `scopes`. */
async function userWithTl(...scopes: string[]): Promise<{ id: string; session: Session }> {
  const u = await createUser(a.api.db, a.w.orgA.id);
  for (const t of scopes)
    await grant(a.api.db, a.w.grantor.id, u.id, "TL", { type: "transformation", id: t }, a.w.orgA.id);
  return { id: u.id, session: await signIn(a.api.app, u.subject) };
}

async function revokeTl(userId: string, transformationId: string): Promise<void> {
  await a.api.owner.query(
    `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic BE-RG1'
      where user_id = $2 and revoked_at is null and scope_type = 'transformation' and scope_id = $3`,
    [a.w.grantor.id, userId, transformationId],
  );
}

const getConversation = async (session: Session, id: string) => {
  const res = await call<Body>(a.api.app, "GET", `${C}/${id}`, { session });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Body;
};

/** Asks PROMPT (unfocused) with the fake citing tA1 only; checks both records were given and only tA1 is cited. */
async function askCitingTa1(session: Session): Promise<{ conversationId: string; reply: Body }> {
  fake.configure({
    kind: "envelope",
    answer: `Synthetic answer: ${TITLE_1} and ${TITLE_2} are both behind plan.`,
    citeRecords: (i) => i.id === tA1,
  });
  const conv = await newConversation(a.api, session, null);
  const res = await ask(a.api, session, conv, PROMPT);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body.reply.replyKind).toBe("answer");
  const given = FakeModel.dataRecordsOf(fake.requests[fake.requests.length - 1]!.body).map((i) => i.id);
  expect(given).toEqual(expect.arrayContaining([tA1, tA2]));
  const cited = (res.body.reply.citations as Body[]).filter((c) => c.source === "record").map((c) => c.recordId);
  expect(cited).toEqual([tA1]);
  expect(res.body.reply.contentWithheld).toBe(false);
  return { conversationId: conv.id as string, reply: res.body.reply };
}

beforeAll(async () => {
  a = await startAssistantWorld("mth_asst_ctx", { x: X_WORD, y: "Uncitedora" });
  fake = await new FakeModel().start();
  await enableFake();
  tA1 = await createTransformationRow(a.api.db, a.w.orgA.id, a.w.a1, a.w.grantor.id);
  tA2 = await createTransformationRow(a.api.db, a.w.orgA.id, a.w.a2, a.w.grantor.id);
  for (const [t, title] of [
    [tA1, TITLE_1],
    [tA2, TITLE_2],
  ] as const)
    await a.api.db
      .insertInto("search_document")
      .values({
        id: crypto.randomUUID(),
        organization_id: a.w.orgA.id,
        transformation_id: t,
        record_type: "transformation",
        record_id: t,
        record_version: 1,
        title,
        summary: `Synthetic confidential summary of ${title}`,
        source_audit_seq: "0",
      })
      .onConflict((oc) => oc.constraint("search_document_record_key").doNothing())
      .execute();
}, 240_000);

afterAll(async () => {
  await fake?.stop();
  await a?.close();
});

describe("ADR-0059 §9: the read-time re-check covers every record given to the model (F-DG6-920)", () => {
  it("F-DG6-920: the answer cites one of two given records; the UNCITED one is revoked; the answer is withheld", async () => {
    const u = await userWithTl(tA1, tA2);
    const { conversationId } = await askCitingTa1(u.session);
    await revokeTl(u.id, tA2);
    // The owner can no longer read the uncited record directly.
    const direct = await call<Body>(a.api.app, "GET", `/api/v1/transformations/${tA2}`, { session: u.session });
    expect(direct.status).toBe(404);
    const after = await getConversation(u.session, conversationId);
    const reply = after.messages[1];
    console.log("[BE-RG1 case 1] after revoking the uncited record: contentWithheld =", reply.contentWithheld);
    expect(reply).toMatchObject({ author: "assistant", replyKind: "answer", content: null, contentWithheld: true });
    // The citations are shown as they were (only the cited record, still readable); the uncited record is not named.
    expect(reply.citations.filter((c: Body) => c.source === "record")).toEqual([
      { source: "record", recordType: "transformation", recordId: tA1, recordVersion: 1, readable: true },
    ]);
    expect(JSON.stringify(after)).not.toContain(TITLE_2);
    expect(JSON.stringify(after)).not.toContain(tA2);
    // The prompt (the user's own text) stays readable.
    expect(after.messages[0]).toMatchObject({ content: PROMPT, contentWithheld: false });
  });

  it("the cited record is revoked: the answer is withheld and that citation is readable false", async () => {
    const u = await userWithTl(tA1, tA2);
    const { conversationId } = await askCitingTa1(u.session);
    await revokeTl(u.id, tA1);
    const reply = (await getConversation(u.session, conversationId)).messages[1];
    console.log("[BE-RG1 case 2] after revoking the cited record: contentWithheld =", reply.contentWithheld);
    expect(reply).toMatchObject({ content: null, contentWithheld: true });
    expect(reply.citations.filter((c: Body) => c.source === "record")).toEqual([
      { source: "record", recordType: "transformation", recordId: tA1, recordVersion: 1, readable: false },
    ]);
  });

  it("nothing revoked: the answer stays readable, and its stored context lists both records given", async () => {
    const u = await userWithTl(tA1, tA2);
    const { conversationId, reply: posted } = await askCitingTa1(u.session);
    const reply = (await getConversation(u.session, conversationId)).messages[1];
    console.log("[BE-RG1 case 3] nothing revoked: contentWithheld =", reply.contentWithheld);
    expect(reply).toMatchObject({ contentWithheld: false, content: posted.content });
    expect(reply.content).toContain(TITLE_2);
    // The stored generation context (0128): every record item given, beside the citations; never served.
    const row = await a.api.db
      .selectFrom("assistant_message")
      .selectAll()
      .where("id", "=", reply.id)
      .executeTakeFirstOrThrow();
    const context = (row as unknown as { context_records: { recordType: string; recordId: string }[] | null })
      .context_records;
    console.log("[BE-RG1 case 3] stored context_records:", JSON.stringify(context));
    expect(context).toEqual(
      expect.arrayContaining([
        { recordType: "transformation", recordId: tA1 },
        { recordType: "transformation", recordId: tA2 },
      ]),
    );
    expect(Object.keys(reply)).not.toContain("contextRecords");
    expect(Object.keys(reply)).not.toContain("context_records");
  });

  it("a suggestion built from an answer whose uncited record becomes unreadable is withheld and cannot be taken (404)", async () => {
    const xt = a.x.b.transformationId;
    const benefit = a.x.records.find((r) => r.type === "benefit")!;
    expect(benefit).toBeDefined();
    const u = await userWithTl(xt);
    const advice = { kind: "recovery_action", text: "Synthetic: re-plan the benefit ramp." };
    const charter = { kind: "charter_draft", fields: { case_for_change: "Synthetic case from the benefit." } };
    // The fake cites every record item EXCEPT the benefit (a subset of what it was given).
    fake.configure({
      kind: "envelope",
      answer: "Synthetic answer quoting the benefit's ramp.",
      citeRecords: (i) => i.recordType !== "benefit",
      suggestions: [advice, charter],
    });
    const conv = await newConversation(a.api, u.session, xt);
    const res = await ask(a.api, u.session, conv, X_WORD);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const given = FakeModel.dataRecordsOf(fake.requests[fake.requests.length - 1]!.body);
    expect(given.map((i) => i.id)).toContain(benefit.id);
    const cited = (res.body.reply.citations as Body[]).filter((c) => c.source === "record");
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.map((c) => c.recordId)).not.toContain(benefit.id);
    expect(res.body.suggestions).toHaveLength(2);
    expect(res.body.suggestions.every((s: Body) => s.contentWithheld === false)).toBe(true);
    const charterId: string = res.body.suggestions.find((s: Body) => s.kind === "charter_draft").id;
    const row = await a.api.db
      .selectFrom("assistant_suggestion")
      .selectAll()
      .where("id", "=", charterId)
      .executeTakeFirstOrThrow();
    const context = (row as unknown as { context_records: { recordId: string }[] | null }).context_records;
    console.log(
      "[BE-RG1 case 4] suggestion context holds the uncited benefit:",
      JSON.stringify(context?.map((c) => c.recordId).includes(benefit.id)),
    );

    // The benefit becomes sensitive (ADR-0051 §2): the TL is no named party and holds no grant, so it is unreadable.
    const office = await signIn(a.api.app, a.w.office.subject);
    const marked = await call<Body>(a.api.app, "PUT", `${a.x.b.base}/records/benefit/${benefit.id}/sensitivity`, {
      session: office,
      headers: { "if-match": '"0"' },
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit (BE-RG1)" },
    });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    expect((await call<Body>(a.api.app, "GET", benefit.viewUrl, { session: u.session })).status).toBe(404);
    // The cited records stay readable.
    expect((await call<Body>(a.api.app, "GET", `/api/v1/transformations/${xt}`, { session: u.session })).status).toBe(
      200,
    );

    const after = await getConversation(u.session, conv.id);
    console.log(
      "[BE-RG1 case 4] after the uncited benefit became unreadable: answer withheld =",
      after.messages[1].contentWithheld,
      "suggestions withheld =",
      JSON.stringify(after.suggestions.map((s: Body) => s.contentWithheld)),
    );
    expect(after.messages[1]).toMatchObject({ content: null, contentWithheld: true });
    expect(after.suggestions).toHaveLength(2);
    for (const s of after.suggestions as Body[])
      expect(s).toMatchObject({ contentWithheld: true, textContent: null, fields: null });
    expect(JSON.stringify(after)).not.toContain("re-plan the benefit ramp");
    expect(JSON.stringify(after)).not.toContain("Synthetic case from the benefit.");
    // Taking the charter suggestion to a draft is refused like an unreadable citation (404), and nothing changes.
    const taken = await call<Body>(a.api.app, "POST", `/api/v1/assistant/suggestions/${charterId}/to-draft`, {
      session: u.session,
      headers: ifm(1),
    });
    console.log("[BE-RG1 case 4] take-to-draft status:", taken.status);
    expect(taken.status).toBe(404);
    const still = await a.api.db
      .selectFrom("assistant_suggestion")
      .select("status")
      .where("id", "=", charterId)
      .executeTakeFirstOrThrow();
    expect(still.status).toBe("proposed");
    // 0128: a suggestion's context never changes (even for the table owner), so the check cannot be weakened later.
    const changed = await a.api.owner
      .query("UPDATE assistant_suggestion SET context_records = '[]'::jsonb WHERE id = $1", [charterId])
      .then(
        () => "updated",
        (e: { constraint?: string }) => e.constraint,
      );
    expect(changed).toBe("assistant_suggestion_context_immutable");
  });

  it("a row stored before 0128 (no context) falls back to its citations (ADR-0059 §9 amendment)", async () => {
    // A third TL grant keeps assistant.use after both revocations below.
    const u = await userWithTl(tA1, tA2, a.y.b.transformationId);
    const { conversationId, reply } = await askCitingTa1(u.session);
    // Put the reply into the state of an answer stored before 0128: context NULL, the required rule NOT VALID as
    // 0128 leaves it (owner-only DDL on the scratch database; the append-only trigger is paused for this one row).
    const id = reply.id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await a.api.owner.query(`
      DO $$ BEGIN
        ALTER TABLE assistant_message DROP CONSTRAINT assistant_message_context_records_required;
        ALTER TABLE assistant_message DISABLE TRIGGER assistant_message_append_only;
        UPDATE assistant_message SET context_records = NULL WHERE id = '${id}';
        ALTER TABLE assistant_message ENABLE TRIGGER assistant_message_append_only;
        ALTER TABLE assistant_message ADD CONSTRAINT assistant_message_context_records_required
          CHECK (author <> 'assistant' OR reply_kind IS DISTINCT FROM 'answer' OR context_records IS NOT NULL) NOT VALID;
      END $$`);
    // Uncited revoked: the legacy row knows only its citations, so it stays readable (the documented limit).
    await revokeTl(u.id, tA2);
    expect((await getConversation(u.session, conversationId)).messages[1]).toMatchObject({ contentWithheld: false });
    // Cited revoked: withheld, as before 0128.
    await revokeTl(u.id, tA1);
    expect((await getConversation(u.session, conversationId)).messages[1]).toMatchObject({
      content: null,
      contentWithheld: true,
    });
  });
});
