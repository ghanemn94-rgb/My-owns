// Code-security reviewer, DG6 clean re-gate round 2 (T-DG6-REV-CS-RG-R2): reproduction probe, NOT product code.
// Copy to apps/api/test/integration/assistant/ in a DISPOSABLE clone and run with
//   npx vitest run --configLoader runner --project integration apps/api/test/integration/assistant/zz-sec-r2-assistant-history.test.ts
//
// Question: after the F-DG6-920 repair (0128 context_records), does the ADR-0059 §9 read-time re-check cover every
// record an answer was generated from? The model request also carries the HISTORY (ADR-0059 §5: the last 6 prompts and
// answer contents of the conversation; conversations.ts historyOf). historyOf re-checks nothing, and the new answer's
// context_records lists only THIS turn's retrieval items.
//
// The model here is a loopback echo server on the shipped http_endpoint provider (no real model, no network): turn 1 it
// answers a fixed text naming both records; on a later turn it repeats its previous answer from the history, as a real
// model asked "repeat that" does. It cites ref 1 (the record still readable). All data is SYNTHETIC. Nothing here
// approves anything (G1-G6) or touches DG0-DG7.
//
// The test PASSES when the defect is reproduced (each observation is also printed with a [SEC-R2] prefix).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { call, createTransformationRow, createUser, grant, signIn, type Session } from "../../support/harness.ts";
import { ask, C, ifm, newConversation, S, startAssistantWorld, type AssistantWorld, type Body } from "./be-u-fixtures.ts";

const TITLE_1 = "Zephyrine synthetic program one";
const TITLE_2 = "Zephyrine synthetic program two";
const PROMPT = "Zephyrine synthetic program";

let a: AssistantWorld;
let server: Server;
let port = 0;
const requests: Body[] = [];
let tA1: string;
let tA2: string;

/** The loopback echo model (openai_chat_completions wire format). */
function startEcho(): Promise<void> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Body;
      requests.push(body);
      const msgs = (body.messages ?? []) as { role: string; content: string }[];
      const previous = msgs.filter((m) => m.role === "assistant").pop();
      const answer = previous
        ? `As I said before: ${previous.content}`
        : `Synthetic answer: ${TITLE_1} and ${TITLE_2} are both behind plan.`;
      const content = JSON.stringify({ answer, citations: [1], suggestions: [] });
      res.writeHead(200, { "content-type": "application/json", connection: "close" });
      res.end(
        JSON.stringify({
          id: "synthetic",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        }),
      );
    });
  });
  server.keepAliveTimeout = 1;
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    }),
  );
}

async function enableEcho(): Promise<void> {
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
      endpointUrl: `http://127.0.0.1:${port}/v1/chat/completions`,
      apiStyle: "openai_chat_completions",
      modelName: "synthetic-echo",
      credentialRef: null,
      authorizationReference: "IT-APPROVAL-SYNTHETIC-SEC-R2",
      requestTimeoutMs: 5000,
      maxOutputTokens: 512,
      maxContextRecords: 20,
      reason: "Synthetic: the local echo model",
    },
    headers: ifm(off.body.version),
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const on = await call<Body>(a.api.app, "POST", `${S}/enable`, {
    session: a.admin,
    body: { reason: "Synthetic: on (echo)" },
    headers: ifm(saved.body.version),
  });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
}

async function revokeTl(userId: string, transformationId: string): Promise<void> {
  await a.api.owner.query(
    `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic SEC-R2'
      where user_id = $2 and revoked_at is null and scope_type = 'transformation' and scope_id = $3`,
    [a.w.grantor.id, userId, transformationId],
  );
}

beforeAll(async () => {
  a = await startAssistantWorld("mth_sec_r2_hist", { x: "Historiana", y: "Echolaria" });
  await startEcho();
  await enableEcho();
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
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await a?.close();
});

describe("SEC-R2: the conversation history carries a withheld answer's text to the model and into a served answer", () => {
  it("after revocation, the withheld turn-1 answer is re-sent as history and resurfaces in an unwithheld turn-2 answer", async () => {
    const u = await createUser(a.api.db, a.w.orgA.id);
    for (const t of [tA1, tA2])
      await grant(a.api.db, a.w.grantor.id, u.id, "TL", { type: "transformation", id: t }, a.w.orgA.id);
    const session: Session = await signIn(a.api.app, u.subject);

    // Turn 1: both records are given; the answer names both.
    const conv = await newConversation(a.api, session, null);
    const t1 = await ask(a.api, session, conv, PROMPT);
    expect(t1.status, JSON.stringify(t1.body)).toBe(201);
    expect(t1.body.reply.replyKind).toBe("answer");
    expect(t1.body.reply.content).toContain(TITLE_2);

    // Revoke the grant on tA2: the owner can no longer read it; the turn-1 answer is withheld (the 0128 repair works).
    await revokeTl(u.id, tA2);
    const direct = await call<Body>(a.api.app, "GET", `/api/v1/transformations/${tA2}`, { session });
    console.log("[SEC-R2] direct read of tA2 after revocation:", direct.status);
    expect(direct.status).toBe(404);
    const mid = await call<Body>(a.api.app, "GET", `${C}/${conv.id}`, { session });
    console.log("[SEC-R2] turn-1 answer after revocation: contentWithheld =", mid.body.messages[1].contentWithheld);
    expect(mid.body.messages[1]).toMatchObject({ content: null, contentWithheld: true });

    // Turn 2, after the revocation: the user asks again in the same conversation.
    const before = requests.length;
    const t2 = await ask(a.api, session, conv, "Please repeat your previous answer");
    expect(t2.status, JSON.stringify(t2.body)).toBe(201);
    const sent = requests[before]!;
    const msgs = (sent.messages ?? []) as { role: string; content: string }[];
    const historyHasTitle2 = msgs.some((m) => m.role === "assistant" && m.content.includes(TITLE_2));
    const dataMsg = msgs.find((m) => typeof m.content === "string" && m.content.startsWith("DATA ("));
    console.log("[SEC-R2] turn-2 request: history (assistant role) holds the revoked title:", historyHasTitle2);
    console.log("[SEC-R2] turn-2 request: data block holds tA2:", dataMsg?.content.includes(tA2) ?? false);
    console.log("[SEC-R2] turn-2 reply: replyKind =", t2.body.reply.replyKind, "contentWithheld =", t2.body.reply.contentWithheld);
    console.log("[SEC-R2] turn-2 reply content:", JSON.stringify(t2.body.reply.content));

    const after = await call<Body>(a.api.app, "GET", `${C}/${conv.id}`, { session });
    const m = after.body.messages as Body[];
    console.log(
      "[SEC-R2] GET conversation after turn 2:",
      JSON.stringify(m.map((x) => ({ seq: x.seq, author: x.author, withheld: x.contentWithheld }))),
    );
    console.log("[SEC-R2] GET conversation body contains the revoked title:", JSON.stringify(after.body).includes(TITLE_2));
    const row = await a.api.db
      .selectFrom("assistant_message")
      .selectAll()
      .where("id", "=", t2.body.reply.id)
      .executeTakeFirstOrThrow();
    console.log("[SEC-R2] turn-2 stored context_records:", JSON.stringify((row as Body).context_records));

    // The defect, asserted: revoked text was sent to the provider after the revocation, and is served again.
    expect(historyHasTitle2).toBe(true);
    expect(dataMsg?.content.includes(tA2) ?? false).toBe(false);
    expect(m[1]).toMatchObject({ contentWithheld: true });
    expect(m[3]).toMatchObject({ author: "assistant", replyKind: "answer", contentWithheld: false });
    expect(m[3].content).toContain(TITLE_2);
  });
});
