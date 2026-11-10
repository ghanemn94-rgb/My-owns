// The ADR-0059 §9 read-time re-check also covers the conversation HISTORY given to the model (§5), and a suggestion
// stored before 0128 can still be taken to a draft (T-DG6-BE-RG2; F-DG6-960, F-DG6-970, F-DG6-980, F-DG6-971;
// REQ-S17-007 "The assistant retrieves only records the user may read, cites them, and labels outputs as suggestions";
// ADR-0059 §5 and §9 amendment of 2026-11-10 and its RG2 addendum; migration 0129).
// Against a real PostgreSQL, through the real API, with the SHIPPED `http_endpoint` provider pointed at the suite's local
// fake chat-completions server (test/support/fake-model.ts; loopback, NOT a model and NOT an IT endpoint). For a later
// turn the fake can answer from the chat messages it was sent (`answerFrom`), as a model asked "repeat your last answer"
// does. The cases:
//   1. F-DG6-960/970/980 (the reviewers' sequence): answer A1 is generated from tA1 and tA2; tA2 is revoked; A1 is
//      withheld. A follow-up in the same conversation: the request to the model holds no A1 text (the withheld answer is
//      dropped from the history), and no served answer contains it.
//   2. Inheritance: an answer A2 generated with A1 in its history stores A1's context too; when a record of A1's context
//      becomes unreadable later, A2 is withheld as well (though A2's own data block never held that record).
//   3. A history answer stored before 0128 (context NULL) is checked by its citations (the fallback) before it is sent.
//   4. F-DG6-971: a suggestion stored before 0128 (context NULL, readable citations) is taken to a draft (200); a NEW
//      suggestion or answer without a context is still refused at INSERT (0129).
// The before-fix reproductions are the round-2 probes of the three reviewers (docs/delivery/test-evidence/DG6/
// {domain,code-security,qa}/round-2/); cases 1 and 4 are their sequences with the expected outcome.
// All data is SYNTHETIC. Nothing approves anything (G1-G6) or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { FakeModel, type FakeChatMessage } from "../../support/fake-model.ts";
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
const TITLE_3 = "Vestibora synthetic program three";
const PROMPT = "Zephyrine synthetic program";
const PROMPT_3 = "Vestibora";
const HIDDEN = "HIDDEN-FACT-4417 of program two";
const X_WORD = "Historitora";

let a: AssistantWorld;
let fake: FakeModel;
let tA1: string;
let tA2: string;
let tA3: string;

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
      authorizationReference: "IT-APPROVAL-SYNTHETIC-BE-RG2",
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
    `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic BE-RG2'
      where user_id = $2 and revoked_at is null and scope_type = 'transformation' and scope_id = $3`,
    [a.w.grantor.id, userId, transformationId],
  );
}

const getConversation = async (session: Session, id: string) => {
  const res = await call<Body>(a.api.app, "GET", `${C}/${id}`, { session });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Body;
};

/** The stored generation context of a message or suggestion (never served; read here as the test owner). */
async function contextOf(table: "assistant_message" | "assistant_suggestion", id: string) {
  const r = await a.api.owner.query(`SELECT context_records FROM ${table} WHERE id = $1`, [id]);
  return r.rows[0]?.context_records as { recordType: string; recordId: string }[] | null;
}

/** A model that repeats its last answer from the history it was sent (citing every record given). */
function echoLastAnswer(): void {
  fake.configure({
    kind: "envelope",
    answer: "unused",
    citeRecords: () => true,
    answerFrom: (messages: readonly FakeChatMessage[]) => {
      const last = messages.filter((m) => m.role === "assistant").at(-1);
      return last ? `As I said before: ${last.content}` : "Synthetic answer: there is no earlier answer to repeat.";
    },
  });
}

/**
 * Puts one row into the state of a row stored before 0128 (context NULL), with owner-only DDL on the scratch database:
 * the row's user triggers are paused for one UPDATE (0111's guards, the append-only trigger, 0128's immutability, the
 * version step). The rule that requires a context on NEW rows is left as the installed migrations define it: a NOT VALID
 * CHECK (0128; dropped and re-added around the UPDATE) or the BEFORE INSERT trigger of 0129 (an INSERT-only rule, so
 * nothing to do). The same helper therefore runs before and after the fix.
 */
async function makePre0128(table: "assistant_message" | "assistant_suggestion", id: string): Promise<void> {
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  const constraint = `${table}_context_records_required`;
  const check =
    table === "assistant_message"
      ? "author <> 'assistant' OR reply_kind IS DISTINCT FROM 'answer' OR context_records IS NOT NULL"
      : "context_records IS NOT NULL";
  await a.api.owner.query(`
    DO $$ DECLARE had boolean; BEGIN
      had := EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${constraint}' AND conrelid = '${table}'::regclass);
      IF had THEN EXECUTE 'ALTER TABLE ${table} DROP CONSTRAINT ${constraint}'; END IF;
      ALTER TABLE ${table} DISABLE TRIGGER USER;
      UPDATE ${table} SET context_records = NULL WHERE id = '${id}';
      ALTER TABLE ${table} ENABLE TRIGGER USER;
      IF had THEN EXECUTE 'ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK (${check.replace(/'/g, "''")}) NOT VALID'; END IF;
    END $$`);
  expect(await contextOf(table, id)).toBeNull();
}

beforeAll(async () => {
  a = await startAssistantWorld("mth_asst_hist", { x: X_WORD, y: "Echoviora" });
  fake = await new FakeModel().start();
  await enableFake();
  tA1 = await createTransformationRow(a.api.db, a.w.orgA.id, a.w.a1, a.w.grantor.id);
  tA2 = await createTransformationRow(a.api.db, a.w.orgA.id, a.w.a2, a.w.grantor.id);
  tA3 = await createTransformationRow(a.api.db, a.w.orgA.id, a.w.a1, a.w.grantor.id);
  for (const [t, title] of [
    [tA1, TITLE_1],
    [tA2, TITLE_2],
    [tA3, TITLE_3],
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

describe("ADR-0059 §5/§9: the history given to the model is re-checked, and inherited by the new answer (F-DG6-960/970/980)", () => {
  it("F-DG6-960/970/980: a withheld answer is not sent to the model as history, and no new answer re-serves it", async () => {
    const u = await userWithTl(tA1, tA2);
    // A1: generated from both records, quoting a fact of program two.
    fake.configure({
      kind: "envelope",
      answer: `Synthetic answer: ${TITLE_2} has ${HIDDEN}.`,
      citeRecords: () => true,
    });
    const conv = await newConversation(a.api, u.session, null);
    const r1 = await ask(a.api, u.session, conv, PROMPT);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.reply).toMatchObject({ replyKind: "answer", contentWithheld: false });
    expect(r1.body.reply.content).toContain(HIDDEN);

    // The owner loses access to program two: A1 is withheld (the F-DG6-920 repair).
    await revokeTl(u.id, tA2);
    expect((await call<Body>(a.api.app, "GET", `/api/v1/transformations/${tA2}`, { session: u.session })).status).toBe(
      404,
    );
    const mid = await getConversation(u.session, conv.id);
    expect(mid.messages[1]).toMatchObject({ content: null, contentWithheld: true });

    // The follow-up, with a model that repeats its last answer from the history.
    echoLastAnswer();
    const before = fake.requests.length;
    const r2 = await ask(a.api, u.session, conv, `${PROMPT}: repeat your last answer`);
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    const sent = fake.requests.slice(before);
    expect(sent).toHaveLength(1);
    const body = JSON.stringify(sent[0]!.body);
    const messages = FakeModel.messagesOf(sent[0]!.body);
    const history = messages.slice(1, -2); // system, history..., data block, prompt
    console.log(
      "[BE-RG2 case 1] the request of the follow-up carries the withheld A1 text:",
      body.includes(HIDDEN),
      "| history roles:",
      JSON.stringify(history.map((m) => m.role)),
      "| data block holds program two:",
      FakeModel.dataRecordsOf(sent[0]!.body).some((i) => i.id === tA2),
    );
    expect(body).not.toContain(HIDDEN);
    expect(body).not.toContain(TITLE_2);
    expect(FakeModel.dataRecordsOf(sent[0]!.body).map((i) => i.id)).not.toContain(tA2);
    // The withheld answer is DROPPED from the history; the owner's own prompt stays (it is never withheld).
    expect(history).toEqual([{ role: "user", content: PROMPT }]);

    // No served answer contains the withheld text.
    console.log(
      "[BE-RG2 case 1] follow-up reply: contentWithheld =",
      r2.body.reply.contentWithheld,
      "| holds the withheld fact:",
      String(r2.body.reply.content).includes(HIDDEN),
    );
    expect(JSON.stringify(r2.body)).not.toContain(HIDDEN);
    const after = await getConversation(u.session, conv.id);
    expect(after.messages[1]).toMatchObject({ content: null, contentWithheld: true });
    expect(after.messages[3]).toMatchObject({ author: "assistant", replyKind: "answer" });
    expect(JSON.stringify(after)).not.toContain(HIDDEN);
    expect(JSON.stringify(after)).not.toContain(TITLE_2);
  });

  it("inheritance: an answer generated with a history answer is withheld when that answer's context becomes unreadable", async () => {
    const u = await userWithTl(tA1, tA2, tA3);
    // A1: given tA1 and tA2, cites tA1 only (the uncited tA2 is in A1's stored context, 0128).
    fake.configure({
      kind: "envelope",
      answer: `Synthetic answer: ${TITLE_1} and ${TITLE_2} are both behind plan.`,
      citeRecords: (i) => i.id === tA1,
    });
    const conv = await newConversation(a.api, u.session, null);
    const r1 = await ask(a.api, u.session, conv, PROMPT);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);

    // A2: a different subject (data block: tA3 only), with A1 (still readable) in the history.
    echoLastAnswer();
    const before = fake.requests.length;
    const r2 = await ask(a.api, u.session, conv, `${PROMPT_3}: and how does that compare?`);
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    const sent = fake.requests[before]!;
    expect(FakeModel.dataRecordsOf(sent.body).map((i) => i.id)).toEqual([tA3]);
    expect(FakeModel.messagesOf(sent.body).some((m) => m.role === "assistant" && m.content.includes(TITLE_2))).toBe(
      true,
    );
    expect(r2.body.reply).toMatchObject({ replyKind: "answer", contentWithheld: false });
    expect(r2.body.reply.content).toContain(TITLE_2);
    const context = await contextOf("assistant_message", r2.body.reply.id);
    console.log("[BE-RG2 case 2] A2 stored context_records:", JSON.stringify(context?.map((c) => c.recordId)));
    // The new answer's context: its own data block first, then the context of every history answer given (A1's).
    expect(context).toEqual([
      { recordType: "transformation", recordId: tA3 },
      { recordType: "transformation", recordId: tA1 },
      { recordType: "transformation", recordId: tA2 },
    ]);
    // Its citations name only what it cited from its own data block.
    expect((r2.body.reply.citations as Body[]).filter((c) => c.source === "record").map((c) => c.recordId)).toEqual([
      tA3,
    ]);

    // tA2 becomes unreadable: A1 AND A2 are withheld, though A2's data block never held tA2.
    await revokeTl(u.id, tA2);
    const after = await getConversation(u.session, conv.id);
    console.log(
      "[BE-RG2 case 2] after revoking tA2: A1 withheld =",
      after.messages[1].contentWithheld,
      "A2 withheld =",
      after.messages[3].contentWithheld,
    );
    expect(after.messages[1]).toMatchObject({ content: null, contentWithheld: true });
    expect(after.messages[3]).toMatchObject({ content: null, contentWithheld: true });
    // A2's citation (tA3) is still readable; the inherited record is not named.
    expect(after.messages[3].citations.filter((c: Body) => c.source === "record")).toEqual([
      { source: "record", recordType: "transformation", recordId: tA3, recordVersion: 1, readable: true },
    ]);
    expect(JSON.stringify(after)).not.toContain(TITLE_2);
    expect(JSON.stringify(after)).not.toContain(tA2);

    // Transitively: a third answer given A2 (now withheld) as history does not receive it either.
    const before3 = fake.requests.length;
    const r3 = await ask(a.api, u.session, conv, `${PROMPT_3}: once more`);
    expect(r3.status, JSON.stringify(r3.body)).toBe(201);
    const sent3 = JSON.stringify(fake.requests[before3]!.body);
    expect(sent3).not.toContain(TITLE_2);
    expect(JSON.stringify(r3.body)).not.toContain(TITLE_2);
  });

  it("a history answer stored before 0128 (context NULL) is checked by its citations before it is sent", async () => {
    // A third TL grant keeps assistant.use after the revocation below.
    const u = await userWithTl(tA1, tA2, tA3);
    fake.configure({
      kind: "envelope",
      answer: `Synthetic answer: ${TITLE_2} has ${HIDDEN}.`,
      citeRecords: () => true,
    });
    const conv = await newConversation(a.api, u.session, null);
    const r1 = await ask(a.api, u.session, conv, PROMPT);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    await makePre0128("assistant_message", r1.body.reply.id);
    await revokeTl(u.id, tA2);
    echoLastAnswer();
    const before = fake.requests.length;
    const r2 = await ask(a.api, u.session, conv, `${PROMPT_3}: repeat your last answer`);
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    const body = JSON.stringify(fake.requests[before]!.body);
    console.log(
      "[BE-RG2 case 3] pre-0128 history answer re-sent after its cited record was revoked:",
      body.includes(HIDDEN),
    );
    expect(body).not.toContain(HIDDEN);
    expect(JSON.stringify(r2.body)).not.toContain(HIDDEN);
  });
});

describe("F-DG6-971: a suggestion stored before 0128 can be taken to a draft; new rows still need a context (0129)", () => {
  async function charterSuggestion(session: Session): Promise<{ id: string; messageId: string }> {
    fake.configure({
      kind: "envelope",
      answer: "Synthetic answer for a charter draft.",
      citations: [1],
      suggestions: [{ kind: "charter_draft", fields: { case_for_change: "Synthetic case for change (BE-RG2)." } }],
    });
    const conv = await newConversation(a.api, session, a.x.b.transformationId);
    const res = await ask(a.api, session, conv, X_WORD);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const s = (res.body.suggestions as Body[]).find((x) => x.kind === "charter_draft");
    expect(s, JSON.stringify(res.body)).toBeDefined();
    return { id: s.id as string, messageId: res.body.reply.id as string };
  }

  it("a pre-0128 suggestion (context NULL, readable citations) is taken to a draft (200)", async () => {
    const u = await userWithTl(a.x.b.transformationId);
    const { id } = await charterSuggestion(u.session);
    await makePre0128("assistant_suggestion", id);
    const taken = await call<Body>(a.api.app, "POST", `/api/v1/assistant/suggestions/${id}/to-draft`, {
      session: u.session,
      headers: ifm(1),
    });
    console.log(
      "[BE-RG2 case 4] pre-0128 suggestion to-draft:",
      taken.status,
      JSON.stringify(taken.body?.code ?? null),
    );
    expect(taken.status, JSON.stringify(taken.body)).toBe(200);
    expect(taken.body.suggestion).toMatchObject({ id, status: "taken_to_draft", version: 2, contentWithheld: false });
    expect(taken.body.draft).toMatchObject({
      recordType: "charter",
      payload: { sourceFields: { caseForChange: "Synthetic case for change (BE-RG2)." } },
    });
    const row = await a.api.owner.query(
      `SELECT status, version, context_records IS NULL AS ctx_null FROM assistant_suggestion WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ status: "taken_to_draft", version: 2, ctx_null: true });
    // Taken once: a second call is the business-rule refusal, not a data-rule failure.
    const again = await call<Body>(a.api.app, "POST", `/api/v1/assistant/suggestions/${id}/to-draft`, {
      session: u.session,
      headers: ifm(2),
    });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe("assistant.suggestion_already_taken");
  });

  it("a NEW suggestion or answer without a context is still refused at INSERT (and a context cannot be removed)", async () => {
    const u = await userWithTl(a.x.b.transformationId);
    const { id, messageId } = await charterSuggestion(u.session);
    // A suggestion stores its answer's whole context (own data block and inherited part alike; ADR-0059 §5).
    expect(await contextOf("assistant_suggestion", id)).toEqual(await contextOf("assistant_message", messageId));
    const refusalOf = async (statement: string, params: unknown[]) => {
      const client = await a.api.owner.connect();
      try {
        await client.query("begin");
        return await client.query(statement, params).then(
          () => "inserted",
          (e: { code?: string; constraint?: string }) => `${e.code} ${e.constraint}`,
        );
      } finally {
        await client.query("rollback");
        client.release();
      }
    };
    // A copy of the stored suggestion (ordinal 5) with no context.
    const suggestion = await refusalOf(
      `INSERT INTO assistant_suggestion (id, organization_id, transformation_id, conversation_id, message_id,
         owner_user_id, ordinal, kind, target_record_type, fields, text_content, citations, created_by, updated_by,
         context_records)
       SELECT gen_random_uuid(), organization_id, transformation_id, conversation_id, message_id, owner_user_id, 5, kind,
         target_record_type, fields, text_content, citations, created_by, updated_by, NULL
         FROM assistant_suggestion WHERE id = $1`,
      [id],
    );
    // A copy of the stored answer (the next seq) with no context.
    const answer = await refusalOf(
      `INSERT INTO assistant_message (id, conversation_id, organization_id, seq, author, reply_kind, content, citations,
         provider_kind, model_name, setting_version, latency_ms, created_by, context_records)
       SELECT gen_random_uuid(), conversation_id, organization_id, seq + 1, author, reply_kind, content, citations,
         provider_kind, model_name, setting_version, latency_ms, created_by, NULL
         FROM assistant_message WHERE id = $1`,
      [messageId],
    );
    console.log("[BE-RG2 case 5] INSERT without a context: suggestion ->", suggestion, "| answer ->", answer);
    expect(suggestion).toBe("23514 assistant_suggestion_context_records_required");
    expect(answer).toBe("23514 assistant_message_context_records_required");
    // A stored suggestion's context still never changes (0128), so it cannot be set to NULL either.
    const removed = await a.api.owner
      .query("UPDATE assistant_suggestion SET context_records = NULL WHERE id = $1", [id])
      .then(
        () => "updated",
        (e: { constraint?: string }) => e.constraint,
      );
    expect(removed).toBe("assistant_suggestion_context_immutable");
  });
});
