// qa-verifier DG6 re-gate round 2 (T-DG6-REV-QA-RG-R2): an adversarial probe of the F-DG6-920 repair (ADR-0059 §9
// amendment of 2026-11-10, migration 0128). NOT part of the candidate: copied into a disposable clone at
// apps/api/test/integration/assistant/ and run with `npx vitest run --project integration <file>`.
//
// Question: the repair re-checks every record an answer was GENERATED FROM (citations ∪ context_records). But the
// prompt sent to the model also carries the conversation HISTORY (ADR-0059 §5: the last 6 user prompts and `answer`
// contents; conversations.ts historyOf). historyOf reads the stored `content` directly, without the §9 re-check. So
// after an answer A1 is withheld (the owner lost access to a record it was generated from), the next post in the same
// conversation (a) sends A1's withheld text to the model provider again, and (b) a model that repeats its earlier
// answer produces a new answer A2 whose citations/context name only records still readable, so A2 is served
// readable and carries the text the re-check withheld.
//
// Uses the SHIPPED http_endpoint provider and the suite's local fake model (loopback; NOT a model). The fake's
// `respond` is wrapped in this file only to echo the last assistant history message, as a model asked "repeat your
// last answer" would. All data is SYNTHETIC. Nothing approves anything (G1-G6) or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { FakeModel } from "../../support/fake-model.ts";
import { call, createTransformationRow, createUser, grant, signIn, type Session } from "../../support/harness.ts";
import { ask, C, ifm, newConversation, S, startAssistantWorld, type AssistantWorld, type Body } from "./be-u-fixtures.ts";

const TITLE_1 = "Quarzelline synthetic program one";
const TITLE_2 = "Quarzelline synthetic program two";
const PROMPT = "Quarzelline synthetic program";
const HIDDEN = "HIDDEN-FACT-7731 from program two";

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
      authorizationReference: "IT-APPROVAL-SYNTHETIC-QA-RG-R2",
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

async function userWithTl(...scopes: string[]): Promise<{ id: string; session: Session }> {
  const u = await createUser(a.api.db, a.w.orgA.id);
  for (const t of scopes)
    await grant(a.api.db, a.w.grantor.id, u.id, "TL", { type: "transformation", id: t }, a.w.orgA.id);
  return { id: u.id, session: await signIn(a.api.app, u.subject) };
}

async function revokeTl(userId: string, transformationId: string): Promise<void> {
  await a.api.owner.query(
    `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic QA-RG-R2'
      where user_id = $2 and revoked_at is null and scope_type = 'transformation' and scope_id = $3`,
    [a.w.grantor.id, userId, transformationId],
  );
}

type Msg = { role: string; content: string };
const messagesOf = (body: Record<string, unknown> | null): Msg[] =>
  Array.isArray(body?.["messages"]) ? (body!["messages"] as Msg[]) : [];

/** Makes the fake answer with the text of the last assistant HISTORY message it was sent (a model repeating itself). */
function echoHistory(): void {
  const f = fake as unknown as { respond: (res: unknown, body: Record<string, unknown> | null) => void };
  const orig = f.respond.bind(fake);
  f.respond = (res, body) => {
    const last = messagesOf(body)
      .filter((m) => m.role === "assistant")
      .at(-1);
    fake.configure({
      kind: "envelope",
      answer: `As I said before: ${last?.content ?? "(no history)"}`,
      citeRecords: () => true,
    });
    orig(res, body);
  };
}

beforeAll(async () => {
  a = await startAssistantWorld("mth_qa_hist", { x: "Historiana", y: "Otherworda" });
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

describe("QA-RG-R2: the history of a withheld answer (ADR-0059 §5 history vs §9 re-check)", () => {
  it("after A1 is withheld, the next post re-sends A1's text to the model and a repeated answer A2 is served readable", async () => {
    const u = await userWithTl(tA1, tA2);
    // A1: generated from both records (cites both), quoting a fact of program two.
    fake.configure({ kind: "envelope", answer: `Synthetic answer: ${TITLE_2} has ${HIDDEN}.`, citeRecords: () => true });
    const conv = await newConversation(a.api, u.session, null);
    const r1 = await ask(a.api, u.session, conv, PROMPT);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.reply.replyKind).toBe("answer");
    expect(r1.body.reply.content).toContain(HIDDEN);

    // The owner loses access to program two.
    await revokeTl(u.id, tA2);
    const direct = await call<Body>(a.api.app, "GET", `/api/v1/transformations/${tA2}`, { session: u.session });
    console.log("[QA-RG-R2 hist] direct read of program two after revocation:", direct.status);
    expect(direct.status).toBe(404);
    const g1 = await call<Body>(a.api.app, "GET", `${C}/${conv.id}`, { session: u.session });
    console.log("[QA-RG-R2 hist] A1 after revocation: contentWithheld =", g1.body.messages[1].contentWithheld);
    expect(g1.body.messages[1]).toMatchObject({ content: null, contentWithheld: true });

    // The next post in the same conversation.
    echoHistory();
    const before = fake.requests.length;
    const r2 = await ask(a.api, u.session, conv, `${PROMPT}: repeat your last answer`);
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    const sent = fake.requests.slice(before);
    expect(sent.length).toBe(1);
    const history = messagesOf(sent[0]!.body).filter((m) => m.role === "assistant");
    const resent = history.some((m) => m.content.includes(HIDDEN));
    console.log("[QA-RG-R2 hist] the request of post 2 carries the WITHHELD A1 text as history:", resent);
    const given = FakeModel.dataRecordsOf(sent[0]!.body).map((i) => i.id);
    console.log(
      "[QA-RG-R2 hist] data block of post 2 holds program one:",
      given.includes(tA1),
      "program two:",
      given.includes(tA2),
    );

    const g2 = await call<Body>(a.api.app, "GET", `${C}/${conv.id}`, { session: u.session });
    const a2 = g2.body.messages[3];
    console.log(
      "[QA-RG-R2 hist] A2: replyKind =",
      a2.replyKind,
      "contentWithheld =",
      a2.contentWithheld,
      "content holds the withheld fact:",
      String(a2.content).includes(HIDDEN),
    );
    console.log("[QA-RG-R2 hist] A1 still withheld:", g2.body.messages[1].contentWithheld);
    // The expected behaviour (ADR-0059 §9 "a revoked grant hides earlier answers too"): the withheld text is not
    // re-sent and not re-served. These two assertions FAIL on the candidate if the history path bypasses §9.
    expect.soft(resent, "withheld A1 text re-sent to the model as history").toBe(false);
    expect.soft(a2.contentWithheld === false && String(a2.content).includes(HIDDEN), "A2 re-serves A1's withheld text").toBe(false);
  });
});
