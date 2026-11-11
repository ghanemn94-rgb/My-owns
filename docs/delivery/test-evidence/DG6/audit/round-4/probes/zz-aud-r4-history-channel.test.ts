// release-auditor DG6 round 4 (T-DG6-AUDIT-RG-R4): my own reproduction attempt of the last repaired defect
// (F-DG6-960/970/980: a withheld assistant answer re-sent to the model as conversation history). NOT part of the
// candidate: copied into a disposable clone at apps/api/test/integration/assistant/ and run with
// `npx vitest run --project integration <file>`. Uses the SHIPPED http_endpoint provider and the suite's local fake
// chat-completions server (loopback; not a model). All data is SYNTHETIC. Nothing approves anything (G1-G6) or
// touches DG0-DG7.
//
// It differs from the reviewers' probes in combining both earlier defect classes:
//   - A1 names a fact of program two but CITES ONLY program one (the F-DG6-920 partial-citation angle);
//   - A2 is generated BEFORE the revocation by a model that repeats A1 from the history, and also cites only
//     program one, so only the history-context inheritance can make it carry program two;
//   - after revoking program two, both must be withheld, and a third post must not carry the fact to the model
//     (history) nor serve it back (A3).
// A control step shows that, before the revocation, the history channel really carries A1 to the model, so the
// "not re-sent" result after the revocation is a property of the repair and not of the probe.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { FakeModel, type FakeChatMessage } from "../../support/fake-model.ts";
import { call, createTransformationRow, createUser, grant, signIn, type Session } from "../../support/harness.ts";
import { ask, C, ifm, newConversation, S, startAssistantWorld, type AssistantWorld, type Body } from "./be-u-fixtures.ts";

const TITLE_1 = "Velmorite synthetic program one";
const TITLE_2 = "Velmorite synthetic program two";
const PROMPT = "Velmorite synthetic program";
const HIDDEN = "AUDIT-R4-HIDDEN-5523 of program two";

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
      authorizationReference: "IT-APPROVAL-SYNTHETIC-AUD-R4",
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
    `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic AUD-R4'
      where user_id = $2 and revoked_at is null and scope_type = 'transformation' and scope_id = $3`,
    [a.w.grantor.id, userId, transformationId],
  );
}

const lastAssistant = (messages: readonly FakeChatMessage[]): string =>
  messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "(no assistant history)";
const onlyProgramOne = (item: { id: string }): boolean => item.id === tA1;

beforeAll(async () => {
  a = await startAssistantWorld("mth_aud_r4", { x: "Auditoria", y: "Otheraudia" });
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

describe("AUD-R4: the history channel of a withheld answer (F-DG6-960/970/980), partial citation + pre-revocation repeat", () => {
  it("a revoked record's fact is neither re-sent to the model nor re-served, through A1, A2 (inherited) or A3", async () => {
    const u = await userWithTl(tA1, tA2);
    const conv = await newConversation(a.api, u.session, null);

    // A1: given both records, names a fact of program two, cites program one only.
    fake.configure({ kind: "envelope", answer: `Synthetic answer: ${TITLE_2} has ${HIDDEN}.`, citeRecords: onlyProgramOne });
    const r1 = await ask(a.api, u.session, conv, PROMPT);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.reply.content).toContain(HIDDEN);
    const req1 = fake.requests.at(-1)!;
    console.log("[AUD-R4] turn 1 data block ids hold program one:", FakeModel.dataRecordsOf(req1.body).some((i) => i.id === tA1),
      "program two:", FakeModel.dataRecordsOf(req1.body).some((i) => i.id === tA2));

    // A2, BEFORE the revocation: a model repeating A1 from the history, citing program one only.
    fake.configure({ kind: "envelope", answer: "unused", answerFrom: (m) => `Repeating: ${lastAssistant(m)}`, citeRecords: onlyProgramOne });
    const before2 = fake.requests.length;
    const r2 = await ask(a.api, u.session, conv, `${PROMPT}: repeat your last answer`);
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    const hist2 = FakeModel.messagesOf(fake.requests[before2]!.body).filter((m) => m.role === "assistant");
    const control = hist2.some((m) => m.content.includes(HIDDEN));
    console.log("[AUD-R4] CONTROL before revocation: the turn-2 request carries A1's text as history:", control);
    expect(control, "control: the history channel carries A1 while it is readable").toBe(true);
    expect(r2.body.reply.content).toContain(HIDDEN);

    // Revoke program two.
    await revokeTl(u.id, tA2);
    const direct = await call<Body>(a.api.app, "GET", `/api/v1/transformations/${tA2}`, { session: u.session });
    console.log("[AUD-R4] direct read of program two after revocation:", direct.status);
    expect(direct.status).toBe(404);

    const g = await call<Body>(a.api.app, "GET", `${C}/${conv.id}`, { session: u.session });
    const a1 = g.body.messages[1];
    const a2 = g.body.messages[3];
    console.log("[AUD-R4] after revocation: A1 contentWithheld =", a1.contentWithheld, "A2 (inherited) contentWithheld =", a2.contentWithheld);
    console.log("[AUD-R4] GET body holds the hidden fact:", JSON.stringify(g.body).includes(HIDDEN), "holds program two's id:", JSON.stringify(g.body).includes(tA2));

    // A3: the model again repeats its last answer from whatever history it is given.
    const before3 = fake.requests.length;
    const r3 = await ask(a.api, u.session, conv, `${PROMPT}: repeat your last answer again`);
    expect(r3.status, JSON.stringify(r3.body)).toBe(201);
    const req3 = fake.requests[before3]!;
    const msgs3 = FakeModel.messagesOf(req3.body);
    const resent = msgs3.some((m) => m.content.includes(HIDDEN));
    console.log("[AUD-R4] turn-3 request roles:", JSON.stringify(msgs3.map((m) => m.role)));
    console.log("[AUD-R4] turn-3 request (any message) carries the hidden fact:", resent);
    console.log("[AUD-R4] turn-3 data block holds program two:", FakeModel.dataRecordsOf(req3.body).some((i) => i.id === tA2));
    const g3 = await call<Body>(a.api.app, "GET", `${C}/${conv.id}`, { session: u.session });
    const a3 = g3.body.messages[5];
    console.log("[AUD-R4] A3 replyKind =", a3.replyKind, "contentWithheld =", a3.contentWithheld, "content =", JSON.stringify(a3.content));
    console.log("[AUD-R4] final GET body holds the hidden fact:", JSON.stringify(g3.body).includes(HIDDEN));

    expect.soft(a1, "A1 withheld").toMatchObject({ content: null, contentWithheld: true });
    expect.soft(a2, "A2 (generated with A1 in its history) withheld").toMatchObject({ content: null, contentWithheld: true });
    expect.soft(resent, "the hidden fact is re-sent to the model").toBe(false);
    expect.soft(JSON.stringify(g3.body).includes(HIDDEN), "the hidden fact is re-served").toBe(false);
    expect.soft(JSON.stringify(g3.body).includes(tA2), "program two's id is served").toBe(false);
  });
});
