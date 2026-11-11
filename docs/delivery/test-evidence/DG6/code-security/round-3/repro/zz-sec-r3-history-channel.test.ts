// Code-security reviewer, DG6 clean re-gate round 3 (T-DG6-REV-CS-RG-R3): verification probe, NOT product code.
// Copy to apps/api/test/integration/assistant/ in a DISPOSABLE clone and run with
//   npx vitest run --project integration apps/api/test/integration/assistant/zz-sec-r3-history-channel.test.ts
//
// Verifies F-DG6-960/970/980 (history channel) and F-DG6-971 (pre-0128 suggestion to draft) on candidate 32e41b55,
// independently of the implementer's history-recheck.test.ts:
//   R3-1  my round-2 sequence (zz-sec-r2-assistant-history.test.ts) with ONE change: the loopback echo model no longer
//         answers a hard-coded text naming both titles on a turn without history; it names only the titles of the data
//         block it was actually sent (a model cannot know a title it was not given). The fixed outcome is asserted.
//   R3-2  transitive inheritance BEYOND the 6-message history window: A1 is generated from tA1+tA2; A2..A5 are each
//         generated from tA3 only and repeat the previous answer; by turn 5 A1 is out of the window, yet A5's stored
//         context must still hold tA2 (through A2..A4). After revoking tA2 every answer is withheld, the next request
//         carries no tA2 text, and its history holds only the owner's own prompts.
//   R3-3  F-DG6-971: a suggestion put into the pre-0128 state (context NULL; the "required" rule left as the installed
//         migrations define it) is taken to a draft (200); a pre-0128 suggestion whose CITED record becomes unreadable
//         is refused (404, fail closed); a NEW suggestion without a context is still refused at INSERT.
// The shipped http_endpoint provider is pointed at a loopback echo server (no real model, no network). All data is
// SYNTHETIC. Nothing here approves anything (G1-G6) or touches DG0-DG7.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { call, createTransformationRow, createUser, grant, signIn, type Session } from "../../support/harness.ts";
import { ask, C, ifm, newConversation, S, startAssistantWorld, type AssistantWorld, type Body } from "./be-u-fixtures.ts";

const TITLE_1 = "Zephyrine synthetic program one";
const TITLE_2 = "Zephyrine synthetic program two";
const TITLE_3 = "Quillmora synthetic program three";
const PROMPT = "Zephyrine synthetic program";
const PROMPT_3 = "Quillmora";
const X_WORD = "Legacitorix";

let a: AssistantWorld;
let server: Server;
let port = 0;
const requests: Body[] = [];
let tA1: string;
let tA2: string;
let tA3: string;
/** What the echo model returns as suggestions on the next request (charter draft for R3-3). */
let nextSuggestions: unknown[] = [];

type Msg = { role: string; content: string };
const messagesOf = (b: Body): Msg[] =>
  ((b.messages ?? []) as Msg[]).filter((m) => typeof m.content === "string" && typeof m.role === "string");
/** The titles of the record items of the request's data block ("DATA (" message), as the provider wrote them. */
function dataTitles(b: Body): string[] {
  const data = messagesOf(b).find((m) => m.content.startsWith("DATA ("));
  if (!data) return [];
  return [TITLE_1, TITLE_2, TITLE_3].filter((t) => data.content.includes(t));
}

/** Loopback echo model: repeat the last assistant history message; else describe ONLY what the data block holds. */
function startEcho(): Promise<void> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Body;
      requests.push(body);
      const previous = messagesOf(body)
        .filter((m) => m.role === "assistant")
        .pop();
      const titles = dataTitles(body);
      const answer = previous
        ? `As I said before: ${previous.content}`
        : titles.length > 0
          ? `Synthetic answer: ${titles.join(" and ")} behind plan.`
          : "Synthetic answer: nothing in the data block names a program.";
      const content = JSON.stringify({ answer, citations: [1], suggestions: nextSuggestions });
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
      authorizationReference: "IT-APPROVAL-SYNTHETIC-SEC-R3",
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
    `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic SEC-R3'
      where user_id = $2 and revoked_at is null and scope_type = 'transformation' and scope_id = $3`,
    [a.w.grantor.id, userId, transformationId],
  );
}

async function userWithTl(...scopes: string[]): Promise<{ id: string; session: Session }> {
  const u = await createUser(a.api.db, a.w.orgA.id);
  for (const t of scopes)
    await grant(a.api.db, a.w.grantor.id, u.id, "TL", { type: "transformation", id: t }, a.w.orgA.id);
  return { id: u.id, session: await signIn(a.api.app, u.subject) };
}

async function contextIds(table: "assistant_message" | "assistant_suggestion", id: string): Promise<string[] | null> {
  const r = await a.api.owner.query(`SELECT context_records FROM ${table} WHERE id = $1`, [id]);
  const v = r.rows[0]?.context_records as { recordId: string }[] | null;
  return v === null ? null : v.map((x) => x.recordId);
}

/** Pre-0128 state for one suggestion: context NULL. Whatever rule requires a context on NEW rows is kept as installed. */
async function makePre0128Suggestion(id: string): Promise<string> {
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  const r = await a.api.owner.query(`
    DO $$ DECLARE had boolean; BEGIN
      had := EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_suggestion_context_records_required'
                       AND conrelid = 'assistant_suggestion'::regclass);
      IF had THEN ALTER TABLE assistant_suggestion DROP CONSTRAINT assistant_suggestion_context_records_required; END IF;
      ALTER TABLE assistant_suggestion DISABLE TRIGGER USER;
      UPDATE assistant_suggestion SET context_records = NULL WHERE id = '${id}';
      ALTER TABLE assistant_suggestion ENABLE TRIGGER USER;
      IF had THEN ALTER TABLE assistant_suggestion ADD CONSTRAINT assistant_suggestion_context_records_required
                    CHECK (context_records IS NOT NULL) NOT VALID; END IF;
      PERFORM set_config('sec_r3.had_check', had::text, false);
    END $$;
    SELECT current_setting('sec_r3.had_check') AS had_check`);
  const rows = (Array.isArray(r) ? r.at(-1).rows : r.rows) as { had_check: string }[];
  expect(await contextIds("assistant_suggestion", id)).toBeNull();
  return rows[0]!.had_check;
}

beforeAll(async () => {
  a = await startAssistantWorld("mth_sec_r3_hist", { x: X_WORD, y: "Echolarix" });
  await startEcho();
  await enableEcho();
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
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await a?.close();
});

describe("SEC-R3: the history channel after T-DG6-BE-RG2 (F-DG6-960/970/980)", () => {
  it("R3-1: my round-2 sequence with a data-driven echo: no revoked text reaches the model or a served answer", async () => {
    nextSuggestions = [];
    const u = await userWithTl(tA1, tA2);
    const conv = await newConversation(a.api, u.session, null);
    const t1 = await ask(a.api, u.session, conv, PROMPT);
    expect(t1.status, JSON.stringify(t1.body)).toBe(201);
    console.log("[SEC-R3-1] turn-1 reply:", JSON.stringify(t1.body.reply.content));
    expect(t1.body.reply.content).toContain(TITLE_2);

    await revokeTl(u.id, tA2);
    expect((await call<Body>(a.api.app, "GET", `/api/v1/transformations/${tA2}`, { session: u.session })).status).toBe(
      404,
    );
    const before = requests.length;
    const t2 = await ask(a.api, u.session, conv, "Please repeat your previous answer");
    console.log("[SEC-R3-1] turn-2 status:", t2.status, "replyKind:", t2.body.reply?.replyKind);
    expect(t2.status, JSON.stringify(t2.body)).toBe(201);
    const sent = requests.slice(before);
    const sentJson = JSON.stringify(sent);
    console.log("[SEC-R3-1] model requests on turn 2:", sent.length, "| any holds the revoked title:", sentJson.includes(TITLE_2));
    console.log(
      "[SEC-R3-1] turn-2 history roles:",
      JSON.stringify(sent.map((b) => messagesOf(b).map((m) => m.role))),
    );
    console.log("[SEC-R3-1] turn-2 reply:", JSON.stringify(t2.body.reply.content), "withheld:", t2.body.reply.contentWithheld);
    const after = await call<Body>(a.api.app, "GET", `${C}/${conv.id}`, { session: u.session });
    const m = after.body.messages as Body[];
    console.log("[SEC-R3-1] GET:", JSON.stringify(m.map((x) => ({ seq: x.seq, author: x.author, withheld: x.contentWithheld }))));
    console.log("[SEC-R3-1] GET body holds the revoked title:", JSON.stringify(after.body).includes(TITLE_2));
    expect(sentJson).not.toContain(TITLE_2);
    expect(sentJson).not.toContain(tA2);
    expect(JSON.stringify(t2.body)).not.toContain(TITLE_2);
    expect(m[1]).toMatchObject({ content: null, contentWithheld: true });
    expect(JSON.stringify(after.body)).not.toContain(TITLE_2);
  });

  it("R3-2: inheritance is transitive beyond the 6-message window; a revocation withholds the whole chain", async () => {
    nextSuggestions = [];
    const u = await userWithTl(tA1, tA2, tA3);
    const conv = await newConversation(a.api, u.session, null);
    const replies: Body[] = [];
    const r1 = await ask(a.api, u.session, conv, PROMPT);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    replies.push(r1.body.reply);
    for (let i = 2; i <= 5; i++) {
      const before = requests.length;
      const r = await ask(a.api, u.session, conv, PROMPT_3);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const body = requests[before]!;
      const roles = messagesOf(body).map((m) => m.role);
      const holdsA1 = messagesOf(body).some((m) => m.role === "assistant" && m.content === r1.body.reply.content);
      console.log(`[SEC-R3-2] turn ${i}: roles ${JSON.stringify(roles)} | data titles ${JSON.stringify(dataTitles(body))} | A1 itself in the history: ${holdsA1}`);
      expect(dataTitles(body)).toEqual([TITLE_3]);
      if (i === 5) expect(holdsA1).toBe(false);
      replies.push(r.body.reply);
    }
    // At turn 5 the history window is P2 A2 P3 A3 P4 A4: A1 is no longer in it.
    const ctx5 = await contextIds("assistant_message", replies[4]!.id);
    console.log("[SEC-R3-2] A5 stored context ids (tA3, tA1, tA2 expected in some order):", JSON.stringify(ctx5?.map((x) => (x === tA1 ? "tA1" : x === tA2 ? "tA2" : x === tA3 ? "tA3" : x))));
    expect(replies[4]!.content).toContain(TITLE_2);
    expect(ctx5).toEqual(expect.arrayContaining([tA1, tA2, tA3]));

    await revokeTl(u.id, tA2);
    const after = await call<Body>(a.api.app, "GET", `${C}/${conv.id}`, { session: u.session });
    const answers = (after.body.messages as Body[]).filter((x) => x.author === "assistant");
    console.log("[SEC-R3-2] after revoking tA2, answers withheld:", JSON.stringify(answers.map((x) => x.contentWithheld)));
    console.log("[SEC-R3-2] GET body holds the revoked title:", JSON.stringify(after.body).includes(TITLE_2), "| tA2 id:", JSON.stringify(after.body).includes(tA2));
    expect(answers.map((x) => x.contentWithheld)).toEqual([true, true, true, true, true]);
    expect(JSON.stringify(after.body)).not.toContain(TITLE_2);
    expect(JSON.stringify(after.body)).not.toContain(tA2);

    const before6 = requests.length;
    const r6 = await ask(a.api, u.session, conv, PROMPT_3);
    expect(r6.status, JSON.stringify(r6.body)).toBe(201);
    const body6 = requests[before6]!;
    const roles6 = messagesOf(body6).map((m) => m.role);
    console.log("[SEC-R3-2] turn 6 roles:", JSON.stringify(roles6), "| request holds the revoked title:", JSON.stringify(body6).includes(TITLE_2));
    console.log("[SEC-R3-2] turn 6 reply:", JSON.stringify(r6.body.reply.content), "withheld:", r6.body.reply.contentWithheld);
    expect(JSON.stringify(body6)).not.toContain(TITLE_2);
    expect(JSON.stringify(r6.body)).not.toContain(TITLE_2);
    // The history now holds only the owner's own prompts (the 6 latest), every answer having been dropped.
    expect(roles6.filter((r) => r === "assistant")).toEqual([]);
  });
});

describe("SEC-R3: F-DG6-971 pre-0128 suggestions after 0129", () => {
  async function charterSuggestion(session: Session): Promise<string> {
    nextSuggestions = [{ kind: "charter_draft", fields: { case_for_change: "Synthetic case for change (SEC-R3)." } }];
    try {
      const conv = await newConversation(a.api, session, a.x.b.transformationId);
      const res = await ask(a.api, session, conv, X_WORD);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const s = (res.body.suggestions as Body[]).find((x) => x.kind === "charter_draft");
      expect(s, JSON.stringify(res.body)).toBeDefined();
      return s.id as string;
    } finally {
      nextSuggestions = [];
    }
  }

  it("R3-3a: a pre-0128 suggestion with readable citations is taken to a draft (200)", async () => {
    const u = await userWithTl(a.x.b.transformationId);
    const id = await charterSuggestion(u.session);
    const had = await makePre0128Suggestion(id);
    const rule = await a.api.owner.query(
      `SELECT (SELECT count(*) FROM pg_constraint WHERE conname = 'assistant_suggestion_context_records_required')::int AS checks,
              (SELECT count(*) FROM pg_trigger WHERE tgname = 'assistant_suggestion_context_records_required')::int AS triggers`,
    );
    console.log("[SEC-R3-3a] installed 'required' rule:", JSON.stringify(rule.rows[0]), "| CHECK existed:", had);
    const taken = await call<Body>(a.api.app, "POST", `/api/v1/assistant/suggestions/${id}/to-draft`, {
      session: u.session,
      headers: ifm(1),
    });
    console.log("[SEC-R3-3a] pre-0128 to-draft:", taken.status, JSON.stringify(taken.body?.code ?? taken.body?.suggestion?.status));
    expect(taken.status, JSON.stringify(taken.body)).toBe(200);
    const row = await a.api.owner.query(
      `SELECT status, version, context_records IS NULL AS ctx_null FROM assistant_suggestion WHERE id = $1`,
      [id],
    );
    console.log("[SEC-R3-3a] row after:", JSON.stringify(row.rows[0]));
    expect(row.rows[0]).toEqual({ status: "taken_to_draft", version: 2, ctx_null: true });
  });

  it("R3-3b: a pre-0128 suggestion whose cited record is no longer readable is refused (fail closed)", async () => {
    const u = await userWithTl(a.x.b.transformationId, tA3);
    const id = await charterSuggestion(u.session);
    await makePre0128Suggestion(id);
    await revokeTl(u.id, a.x.b.transformationId);
    const taken = await call<Body>(a.api.app, "POST", `/api/v1/assistant/suggestions/${id}/to-draft`, {
      session: u.session,
      headers: ifm(1),
    });
    console.log("[SEC-R3-3b] pre-0128 to-draft after revocation:", taken.status, JSON.stringify(taken.body?.code));
    expect([403, 404]).toContain(taken.status);
    const row = await a.api.owner.query(`SELECT status, version FROM assistant_suggestion WHERE id = $1`, [id]);
    expect(row.rows[0]).toEqual({ status: "proposed", version: 1 });
  });

  it("R3-3c: a NEW suggestion without a context is still refused at INSERT", async () => {
    const u = await userWithTl(a.x.b.transformationId);
    const id = await charterSuggestion(u.session);
    const client = await a.api.owner.connect();
    let outcome = "";
    try {
      await client.query("begin");
      outcome = await client
        .query(
          `INSERT INTO assistant_suggestion (id, organization_id, transformation_id, conversation_id, message_id,
             owner_user_id, ordinal, kind, target_record_type, fields, text_content, citations, created_by, updated_by,
             context_records)
           SELECT gen_random_uuid(), organization_id, transformation_id, conversation_id, message_id, owner_user_id, 5,
             kind, target_record_type, fields, text_content, citations, created_by, updated_by, NULL
             FROM assistant_suggestion WHERE id = $1`,
          [id],
        )
        .then(
          () => "inserted",
          (e: { code?: string; constraint?: string }) => `${e.code} ${e.constraint}`,
        );
    } finally {
      await client.query("rollback");
      client.release();
    }
    console.log("[SEC-R3-3c] INSERT of a new suggestion without a context:", outcome);
    expect(outcome).toBe("23514 assistant_suggestion_context_records_required");
  });
});
