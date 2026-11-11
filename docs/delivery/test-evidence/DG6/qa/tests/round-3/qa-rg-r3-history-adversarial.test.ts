// qa-verifier DG6 re-gate round 3 (T-DG6-REV-QA-RG-R3): adversarial probe of the T-DG6-BE-RG2 repair of the history
// channel (F-DG6-960/970/980) and of the 0129 insert rule (F-DG6-971). NOT part of the candidate: copied into a
// disposable clone at apps/api/test/integration/assistant/ and run with
// `npx vitest run --configLoader runner --project integration <file>`.
//
// Uses the SHIPPED http_endpoint provider and the suite's local fake model (loopback; NOT a model). Cases beyond the
// shipped history-recheck.test.ts:
//   P1 transitive inheritance PAST the 6-message window (A1 falls out of the window; the latest answer was never given
//      A1 directly, only answers that inherited it);
//   P2 a revocation that commits WHILE the model call is in flight (after historyFor checked readability);
//   P3 a suggestion of an answer that inherited context: withheld and not takeable (404) after the revocation;
//   P4 the code-security probe's disclosure: after the revocation, a prompt that retrieves no record sends nothing of
//      the revoked record to the model (so any revoked title in the reply can only come from the fake itself);
//   P5 the inheritance cap: 50 answers x 20 distinct records = 1,000 keys, stored without truncation and without a
//      history drop; the 51st turn is refused (conversation full);
//   P6 the disclosed 0128 -> 0129 window: an answer stored with only its own data block as context (as RG1 code
//      stored it) that repeats a withheld answer: characterised, not asserted as a defect.
// All data is SYNTHETIC. Nothing approves anything (G1-G6) or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { FakeModel, type FakeChatMessage } from "../../support/fake-model.ts";
import { call, createTransformationRow, createUser, grant, signIn, type Session } from "../../support/harness.ts";
import { ask, C, ifm, newConversation, S, startAssistantWorld, type AssistantWorld, type Body } from "./be-u-fixtures.ts";

const TITLE_1 = "Plumbarine synthetic program one";
const TITLE_2 = "Plumbarine synthetic program two";
const TITLE_3 = "Ostrovelle synthetic program three";
const PROMPT = "Plumbarine synthetic program";
const PROMPT_3 = "Ostrovelle";
const HIDDEN = "HIDDEN-FACT-9903 of program two";

let a: AssistantWorld;
let fake: FakeModel;
let tA1: string;
let tA2: string;
let tA3: string;

async function enableFake(maxContextRecords = 20): Promise<void> {
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
      authorizationReference: "IT-APPROVAL-SYNTHETIC-QA-RG-R3",
      requestTimeoutMs: 5000,
      maxOutputTokens: 512,
      maxContextRecords,
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

async function userWithTl(...scopes: string[]): Promise<{ id: string; session: Session }> {
  const u = await createUser(a.api.db, a.w.orgA.id);
  for (const t of scopes)
    await grant(a.api.db, a.w.grantor.id, u.id, "TL", { type: "transformation", id: t }, a.w.orgA.id);
  return { id: u.id, session: await signIn(a.api.app, u.subject) };
}

async function revokeTl(userId: string, transformationId: string): Promise<void> {
  await a.api.owner.query(
    `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic QA-RG-R3'
      where user_id = $2 and revoked_at is null and scope_type = 'transformation' and scope_id = $3`,
    [a.w.grantor.id, userId, transformationId],
  );
}

const getConversation = async (session: Session, id: string) => {
  const res = await call<Body>(a.api.app, "GET", `${C}/${id}`, { session });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Body;
};

async function contextOf(table: "assistant_message" | "assistant_suggestion", id: string) {
  const r = await a.api.owner.query(`SELECT context_records FROM ${table} WHERE id = $1`, [id]);
  return r.rows[0]?.context_records as { recordType: string; recordId: string }[] | null;
}

function echoLastAnswer(suggestions?: unknown[]): void {
  fake.configure({
    kind: "envelope",
    answer: "unused",
    citeRecords: () => true,
    ...(suggestions ? { suggestions } : {}),
    answerFrom: (messages: readonly FakeChatMessage[]) => {
      const last = messages.filter((m) => m.role === "assistant").at(-1);
      return last ? `As I said before: ${last.content}` : "Synthetic answer: there is no earlier answer to repeat.";
    },
  } as never);
}

async function indexDoc(t: string, title: string, recordType = "transformation", recordId = t): Promise<void> {
  await a.api.db
    .insertInto("search_document")
    .values({
      id: crypto.randomUUID(),
      organization_id: a.w.orgA.id,
      transformation_id: t,
      record_type: recordType,
      record_id: recordId,
      record_version: 1,
      title,
      summary: `Synthetic confidential summary of ${title}`,
      source_audit_seq: "0",
    } as never)
    .onConflict((oc) => oc.constraint("search_document_record_key").doNothing())
    .execute();
}

beforeAll(async () => {
  a = await startAssistantWorld("mth_qa_r3_hist", { x: "Historiqua", y: "Otherwordqa" });
  fake = await new FakeModel().start();
  await enableFake();
  tA1 = await createTransformationRow(a.api.db, a.w.orgA.id, a.w.a1, a.w.grantor.id);
  tA2 = await createTransformationRow(a.api.db, a.w.orgA.id, a.w.a2, a.w.grantor.id);
  tA3 = await createTransformationRow(a.api.db, a.w.orgA.id, a.w.a1, a.w.grantor.id);
  await indexDoc(tA1, TITLE_1);
  await indexDoc(tA2, TITLE_2);
  await indexDoc(tA3, TITLE_3);
}, 240_000);

afterAll(async () => {
  await fake?.stop();
  await a?.close();
});

describe("QA-RG-R3: adversarial checks of the RG2 history repair (ADR-0059 §5/§9)", () => {
  it("P1: transitive inheritance past the 6-message window", async () => {
    const u = await userWithTl(tA1, tA2, tA3);
    const conv = await newConversation(a.api, u.session, null);
    fake.configure({ kind: "envelope", answer: `Synthetic answer: ${TITLE_2} has ${HIDDEN}.`, citeRecords: () => true });
    const r1 = await ask(a.api, u.session, conv, PROMPT);
    expect(r1.status).toBe(201);
    echoLastAnswer();
    // Five more turns about tA3 only; each repeats the previous answer (so the HIDDEN text propagates).
    const replies: Body[] = [r1.body.reply];
    for (let i = 0; i < 5; i++) {
      const r = await ask(a.api, u.session, conv, `${PROMPT_3} turn ${i + 2}`);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      replies.push(r.body.reply);
    }
    // The last request no longer holds A1 itself in its 6-message window (A1 = seq 2; window = last 6 messages).
    const lastReq = fake.requests.at(-1)!;
    const histAssistant = FakeModel.messagesOf(lastReq.body).filter((m) => m.role === "assistant");
    console.log("[QA-RG-R3 P1] last request: assistant history messages =", histAssistant.length);
    expect(histAssistant.length).toBe(3);
    const last = replies.at(-1)!;
    expect(String(last.content)).toContain(HIDDEN);
    const ctx = await contextOf("assistant_message", last.id);
    console.log("[QA-RG-R3 P1] A6 context:", JSON.stringify(ctx?.map((c) => c.recordId === tA2 ? "tA2" : c.recordId === tA1 ? "tA1" : c.recordId === tA3 ? "tA3" : c.recordId)));
    expect(ctx?.some((c) => c.recordId === tA2)).toBe(true);
    await revokeTl(u.id, tA2);
    const after = await getConversation(u.session, conv.id);
    const answers = (after.messages as Body[]).filter((m) => m.author === "assistant");
    console.log("[QA-RG-R3 P1] withheld after revoking tA2:", JSON.stringify(answers.map((m) => m.contentWithheld)));
    expect(answers.every((m) => m.contentWithheld === true)).toBe(true);
    expect(JSON.stringify(after)).not.toContain(HIDDEN);
    expect(JSON.stringify(after)).not.toContain(TITLE_2);
    // The next turn: no withheld text reaches the model.
    const before = fake.requests.length;
    const r7 = await ask(a.api, u.session, conv, `${PROMPT_3}: repeat your last answer`);
    expect(r7.status).toBe(201);
    const body = JSON.stringify(fake.requests[before]!.body);
    console.log("[QA-RG-R3 P1] turn-7 request holds HIDDEN:", body.includes(HIDDEN), "TITLE_2:", body.includes(TITLE_2));
    expect(body).not.toContain(HIDDEN);
    expect(body).not.toContain(TITLE_2);
    expect(JSON.stringify(r7.body)).not.toContain(HIDDEN);
  });

  it("P2: a revocation that commits while the model call is in flight still withholds the new answer", async () => {
    const u = await userWithTl(tA1, tA2);
    const conv = await newConversation(a.api, u.session, null);
    fake.configure({ kind: "envelope", answer: `Synthetic answer: ${TITLE_2} has ${HIDDEN}.`, citeRecords: () => true });
    expect((await ask(a.api, u.session, conv, PROMPT)).status).toBe(201);
    // Turn 2 is about tA1 only ... but the prompt still matches tA2; use a model that repeats, and revoke DURING the call.
    echoLastAnswer();
    const f = fake as unknown as { respond: (res: unknown, body: Record<string, unknown> | null) => void };
    const orig = f.respond.bind(fake);
    let revokedDuringCall = false;
    f.respond = (res, body) => {
      void revokeTl(u.id, tA2).then(() => {
        revokedDuringCall = true;
        orig(res, body);
      });
    };
    const before = fake.requests.length;
    const r2 = await ask(a.api, u.session, conv, `${PROMPT_3}: repeat your last answer`);
    f.respond = orig;
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    const sentBody = JSON.stringify(fake.requests[before]!.body);
    console.log(
      "[QA-RG-R3 P2] revoked during the call:", revokedDuringCall,
      "| the request (checked before the revocation) held A1:", sentBody.includes(HIDDEN),
      "| reply as served by the POST: contentWithheld =", r2.body.reply.contentWithheld,
      "holds HIDDEN:", String(r2.body.reply.content).includes(HIDDEN),
    );
    const after = await getConversation(u.session, conv.id);
    const ans = (after.messages as Body[]).filter((m) => m.author === "assistant");
    console.log("[QA-RG-R3 P2] GET after: withheld =", JSON.stringify(ans.map((m) => m.contentWithheld)));
    expect(ans.every((m) => m.contentWithheld === true)).toBe(true);
    expect(JSON.stringify(after)).not.toContain(HIDDEN);
    // The POST response itself (served after transaction 2) must not hold the withheld text either.
    expect.soft(JSON.stringify(r2.body), "POST reply re-serves HIDDEN after an in-flight revocation").not.toContain(HIDDEN);
  });

  it("P3: a suggestion of an answer that inherited context is withheld and cannot be taken to a draft after revocation", async () => {
    const u = await userWithTl(tA1, tA2);
    const conv = await newConversation(a.api, u.session, tA1);
    // A1 on the focus tA1 ... the focus limits retrieval to tA1, so put tA2's content in via a non-focused turn first?
    // Instead: A1 in a NON-focused conversation cannot carry suggestions; here the focus is tA1 and A1 cites tA1 only.
    // The inheritance chain needs a history answer whose context holds tA2: make A1 hold tA2 by pre-0129-style storage
    // is not wanted; so grant TL on tA2 and use a conversation focused on tA1 whose data block can only hold tA1.
    // => P3 checks the plain inheritance into suggestions: A1 (context tA1) -> A2 suggestion inherits tA1; revoke tA1.
    fake.configure({ kind: "envelope", answer: `Synthetic answer: ${TITLE_1} is behind plan.`, citeRecords: () => true });
    expect((await ask(a.api, u.session, conv, PROMPT)).status).toBe(201);
    echoLastAnswer([{ kind: "charter_draft", fields: { case_for_change: "Synthetic case for change (QA-RG-R3)." } }]);
    const r2 = await ask(a.api, u.session, conv, `${PROMPT_3}: draft a charter`);
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    const s = (r2.body.suggestions as Body[] | undefined)?.find((x) => x.kind === "charter_draft");
    console.log("[QA-RG-R3 P3] A2 data block ids:", JSON.stringify(FakeModel.dataRecordsOf(fake.requests.at(-1)!.body).map((i) => i.id === tA1 ? "tA1" : i.id)), "suggestion:", s?.id ?? null);
    expect(s).toBeDefined();
    const sctx = await contextOf("assistant_suggestion", s!.id);
    const mctx = await contextOf("assistant_message", r2.body.reply.id);
    expect(sctx).toEqual(mctx);
    expect(sctx?.some((c) => c.recordId === tA1)).toBe(true);
    await revokeTl(u.id, tA1);
    const after = await getConversation(u.session, conv.id);
    const sv = (after.suggestions as Body[]).find((x) => x.id === s!.id);
    console.log("[QA-RG-R3 P3] suggestion after revoking tA1: contentWithheld =", sv?.contentWithheld);
    expect(sv?.contentWithheld).toBe(true);
    const taken = await call<Body>(a.api.app, "POST", `/api/v1/assistant/suggestions/${s!.id}/to-draft`, {
      session: u.session,
      headers: ifm(1),
    });
    console.log("[QA-RG-R3 P3] to-draft after revocation:", taken.status, taken.body?.code ?? "");
    expect(taken.status).toBe(404);
  });

  it("P4: after the revocation a prompt that retrieves no record sends nothing of the revoked record", async () => {
    const u = await userWithTl(tA1, tA2);
    const conv = await newConversation(a.api, u.session, null);
    fake.configure({ kind: "envelope", answer: `Synthetic answer: ${TITLE_1} and ${TITLE_2}; ${HIDDEN}.`, citeRecords: () => true });
    expect((await ask(a.api, u.session, conv, PROMPT)).status).toBe(201);
    await revokeTl(u.id, tA2);
    echoLastAnswer();
    const before = fake.requests.length;
    const r2 = await ask(a.api, u.session, conv, "Please repeat your previous answer");
    expect(r2.status).toBe(201);
    const body = JSON.stringify(fake.requests[before]!.body);
    const ctx = await contextOf("assistant_message", r2.body.reply.id);
    console.log(
      "[QA-RG-R3 P4] request holds TITLE_2:", body.includes(TITLE_2), "HIDDEN:", body.includes(HIDDEN), "tA2 id:", body.includes(tA2),
      "| data records:", FakeModel.dataRecordsOf(fake.requests[before]!.body).length,
      "| stored context:", JSON.stringify(ctx), "| reply:", JSON.stringify(r2.body.reply.content),
    );
    expect(body).not.toContain(TITLE_2);
    expect(body).not.toContain(HIDDEN);
    expect(body).not.toContain(tA2);
    expect(JSON.stringify(r2.body)).not.toContain(TITLE_2);
  });

  it("P5: the 1,000-key bound: 50 answers x 20 distinct records are stored in full; turn 51 is refused", async () => {
    // 50 groups of 20 synthetic index entries (raid_entry keys on tA1), each group matched by its own word.
    const u = await userWithTl(tA1);
    const words = Array.from({ length: 50 }, (_, g) => `Qzgrp${String.fromCharCode(97 + (g % 26))}${String.fromCharCode(97 + Math.floor(g / 26))}x`);
    for (const [g, w] of words.entries())
      for (let i = 0; i < 20; i++) await indexDoc(tA1, `${w} synthetic raid item ${g}-${i}`, "raid_entry", crypto.randomUUID());
    const conv = await newConversation(a.api, u.session, null);
    fake.configure({ kind: "envelope", answer: "Synthetic answer: noted.", citeRecords: () => true });
    let last: Body = null;
    const sizes: number[] = [];
    const histAnswers: number[] = [];
    for (const [g, w] of words.entries()) {
      const before = fake.requests.length;
      const r = await ask(a.api, u.session, conv, w);
      expect(r.status, `turn ${g + 1}: ${JSON.stringify(r.body)}`).toBe(201);
      expect(r.body.reply.replyKind).toBe("answer");
      const req = fake.requests[before]!.body;
      sizes.push(FakeModel.dataRecordsOf(req).length);
      histAnswers.push(FakeModel.messagesOf(req).filter((m) => m.role === "assistant").length);
      last = r.body.reply;
    }
    const ctx = await contextOf("assistant_message", last.id);
    console.log(
      "[QA-RG-R3 P5] data block sizes min/max:", Math.min(...sizes), Math.max(...sizes),
      "| history answers on turn 50:", histAnswers.at(-1),
      "| turn-50 context length:", ctx?.length,
    );
    expect(Math.min(...sizes)).toBe(20);
    expect(histAnswers.at(-1)).toBe(3);
    expect(ctx?.length).toBe(1000);
    const r51 = await ask(a.api, u.session, conv, words[0]!);
    console.log("[QA-RG-R3 P5] turn 51:", r51.status, r51.body?.code ?? "");
    expect(r51.status).toBe(422);
  }, 600_000);

  it("P6: the disclosed 0128 -> 0129 window (characterisation only)", async () => {
    const u = await userWithTl(tA1, tA2, tA3);
    const conv = await newConversation(a.api, u.session, null);
    fake.configure({ kind: "envelope", answer: `Synthetic answer: ${TITLE_2} has ${HIDDEN}.`, citeRecords: () => true });
    expect((await ask(a.api, u.session, conv, PROMPT)).status).toBe(201);
    echoLastAnswer();
    const at = fake.requests.length;
    const r2 = await ask(a.api, u.session, conv, `${PROMPT_3}: repeat`);
    expect(r2.status).toBe(201);
    // Simulate RG1 storage of A2 (context = its own data block only, no inheritance), as rows stored between 0128 and
    // 0129 hold: owner-only DDL on the scratch database. (Run 1 of this probe gave the user no grant on tA3, so A2 was a
    // no_sources reply, which may hold no context: 0128 assistant_message_context_records_valid refused the UPDATE.)
    const own = FakeModel.dataRecordsOf(fake.requests[at]!.body).map((i) => ({ recordType: i.recordType, recordId: i.id }));
    console.log("[QA-RG-R3 P6] A2 own data block:", JSON.stringify(own.map((r) => (r.recordId === tA1 ? "tA1" : r.recordId === tA2 ? "tA2" : r.recordId))),
      "| stored (RG2) context:", JSON.stringify((await contextOf("assistant_message", r2.body.reply.id))?.map((r) => (r.recordId === tA1 ? "tA1" : r.recordId === tA2 ? "tA2" : r.recordId))));
    expect(own.some((r) => r.recordId === tA2)).toBe(false);
    await a.api.owner.query(`
      DO $$ BEGIN
        ALTER TABLE assistant_message DISABLE TRIGGER USER;
        UPDATE assistant_message SET context_records = '${JSON.stringify(own)}'::jsonb
         WHERE id = '${r2.body.reply.id}';
        ALTER TABLE assistant_message ENABLE TRIGGER USER;
      END $$`);
    await revokeTl(u.id, tA2);
    const after = await getConversation(u.session, conv.id);
    const a2 = (after.messages as Body[])[3];
    console.log(
      "[QA-RG-R3 P6] an RG1-stored repeat (no inherited context) after the revocation: contentWithheld =", a2.contentWithheld,
      "holds HIDDEN:", String(a2.content).includes(HIDDEN),
    );
    // Turn 3: defence 1 still keeps A1 out of the request, but the RG1-stored A2 is readable and is sent as history.
    const before = fake.requests.length;
    expect((await ask(a.api, u.session, conv, `${PROMPT_3}: again`)).status).toBe(201);
    console.log("[QA-RG-R3 P6] turn-3 request holds HIDDEN (via the RG1-stored A2):", JSON.stringify(fake.requests[before]!.body).includes(HIDDEN));
  });

  it("P8: F-DG6-971 independently: a pre-0128 suggestion is taken to a draft; INSERT without a context and removing one fail", async () => {
    const u = await userWithTl(tA1);
    const conv = await newConversation(a.api, u.session, tA1);
    fake.configure({
      kind: "envelope",
      answer: `Synthetic answer: ${TITLE_1} is behind plan.`,
      citeRecords: () => true,
      suggestions: [{ kind: "charter_draft", fields: { case_for_change: "Synthetic case for change (QA-RG-R3 P8)." } }],
    } as never);
    const r = await ask(a.api, u.session, conv, PROMPT);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const s = (r.body.suggestions as Body[]).find((x) => x.kind === "charter_draft")!;
    expect(s).toBeDefined();
    // The state of a row stored before 0128 (context NULL): owner-only DDL, user triggers paused for one UPDATE. No
    // CHECK needs dropping on this candidate (0129 made the rule INSERT-only); record what the catalogue holds.
    const cons = await a.api.owner.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'assistant_suggestion'::regclass AND conname LIKE '%context_records%' ORDER BY 1`,
    );
    const trg = await a.api.owner.query(
      `SELECT tgname, tgtype FROM pg_trigger WHERE tgrelid = 'assistant_suggestion'::regclass AND tgname LIKE '%context_records%' ORDER BY 1`,
    );
    console.log("[QA-RG-R3 P8] constraints:", JSON.stringify(cons.rows.map((x) => x.conname)), "| triggers:", JSON.stringify(trg.rows));
    await a.api.owner.query(`
      DO $$ BEGIN
        ALTER TABLE assistant_suggestion DISABLE TRIGGER USER;
        UPDATE assistant_suggestion SET context_records = NULL WHERE id = '${s.id}';
        ALTER TABLE assistant_suggestion ENABLE TRIGGER USER;
      END $$`);
    expect(await contextOf("assistant_suggestion", s.id)).toBeNull();
    const taken = await call<Body>(a.api.app, "POST", `/api/v1/assistant/suggestions/${s.id}/to-draft`, {
      session: u.session,
      headers: ifm(1),
    });
    console.log("[QA-RG-R3 P8] pre-0128 suggestion to-draft:", taken.status, JSON.stringify(taken.body).slice(0, 160));
    expect(taken.status, JSON.stringify(taken.body)).toBe(200);
    const row = await a.api.owner.query(`SELECT status, version, context_records FROM assistant_suggestion WHERE id = $1`, [s.id]);
    console.log("[QA-RG-R3 P8] row after:", JSON.stringify(row.rows[0]));
    expect(row.rows[0]).toMatchObject({ status: "taken_to_draft", version: 2, context_records: null });
    // A context can never be set later on such a row (immutability), and a NEW row without a context is refused.
    const setLater = await a.api.owner
      .query(`UPDATE assistant_suggestion SET context_records = '[]'::jsonb WHERE id = $1`, [s.id])
      .then(() => "ok", (e: { code?: string; constraint?: string; message: string }) => `${e.code} ${e.constraint ?? e.message}`);
    console.log("[QA-RG-R3 P8] owner UPDATE setting a context on the pre-0128 row:", setLater);
    expect(setLater).not.toBe("ok");
    const ins = await a.api.owner
      .query(
        `INSERT INTO assistant_suggestion (id, organization_id, transformation_id, conversation_id, message_id, owner_user_id, ordinal, kind, target_record_type, fields, text_content, citations, context_records, created_by, updated_by)
         SELECT gen_random_uuid(), organization_id, transformation_id, conversation_id, message_id, owner_user_id, 5, kind, target_record_type, fields, text_content, citations, NULL, created_by, updated_by
           FROM assistant_suggestion WHERE id = $1`,
        [s.id],
      )
      .then(() => "ok", (e: { code?: string; constraint?: string; message: string }) => `${e.code} ${e.constraint ?? e.message}`);
    console.log("[QA-RG-R3 P8] INSERT of a new suggestion without a context:", ins);
    expect(ins).toBe("23514 assistant_suggestion_context_records_required");
  });

  it("P7: a re-grant restores the history (no permanent drop), and refusals are never in the history", async () => {
    const u = await userWithTl(tA1, tA2);
    const conv = await newConversation(a.api, u.session, null);
    fake.configure({ kind: "envelope", answer: `Synthetic answer: ${TITLE_2} has ${HIDDEN}.`, citeRecords: () => true });
    expect((await ask(a.api, u.session, conv, PROMPT)).status).toBe(201);
    await revokeTl(u.id, tA2);
    await grant(a.api.db, a.w.grantor.id, u.id, "TL", { type: "transformation", id: tA2 }, a.w.orgA.id);
    echoLastAnswer();
    const before = fake.requests.length;
    const r2 = await ask(a.api, u.session, conv, `${PROMPT}: repeat`);
    expect(r2.status).toBe(201);
    const held = JSON.stringify(fake.requests[before]!.body).includes(HIDDEN);
    console.log("[QA-RG-R3 P7] after re-grant the history holds A1 again:", held);
    expect(held).toBe(true);
  });
});
