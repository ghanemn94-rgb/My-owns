// Suggestions and "to draft" (ADR-0059 §5, §6, §10; REQ-S17-008 "drafts require a human to save and submit";
// REQ-S17-007 citations; T-DG6-BE-U) against a real PostgreSQL. The model is the local fake chat-completions server
// (apps/api/test/support/fake-model.ts, loopback; NOT a model and NOT an IT endpoint) behind the HTTP adapter, so the
// envelope can carry every suggestion kind. Covers: output handling (citations limited to the items given, all of them
// when the model cites none; at most 5 suggestions, invalid kinds and fields dropped, none on an unfocused
// conversation; a provider failure is `unavailable`), and takeAssistantSuggestionToDraft: charter.edit /
// executive_decision.create (403 without), assistant.suggestion_not_draftable, assistant.suggestion_already_taken,
// 428/409, AUD 403, another user's suggestion 404, the authorization re-check at commit (403, nothing written), one
// audit event with prior and new version, writes nothing outside assistant_suggestion, and the pure mapping table
// equals the P5 form definitions' keys. All data is SYNTHETIC; nothing approves anything (G1-G6) or touches DG0-DG7.
import { sql } from "@mth/db";
import { charterFields, executiveDecisionCreate, executiveDecisionUpdate } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DRAFT_FIELD_LIMITS } from "../../../src/modules/assistant/guardrails.ts";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { DRAFT_FIELD_MAP, draftPayloadOf } from "../../../src/modules/assistant/suggestions.ts";
import { FakeModel } from "../../support/fake-model.ts";
import { call, signIn, type Session } from "../../support/harness.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import {
  ask,
  enableTestAdapter,
  ifm,
  newConversation,
  S,
  snapshot,
  startAssistantWorld,
  type AssistantWorld,
  type Body,
} from "./be-u-fixtures.ts";

let a: AssistantWorld;
let fake: FakeModel;
const X_WORD = "Suggestaria";

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
      authorizationReference: "IT-APPROVAL-SYNTHETIC-BE-U",
      requestTimeoutMs: 5000,
      maxOutputTokens: 512,
      maxContextRecords: 5,
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
  expect(on.status).toBe(200);
}

const CHARTER = { kind: "charter_draft", fields: { case_for_change: "Synthetic case.", in_scope: "Synthetic scope." } };
const BRIEF = {
  kind: "decision_brief_draft",
  fields: {
    decision: "Synthetic decision",
    why_now: "Synthetic urgency.",
    recommendation: "Synthetic option A.",
    impact_if_delayed: "Synthetic delay impact.",
  },
};
const ADVICE = { kind: "missing_evidence", text: "Synthetic: attach the steering minutes." };
const RECOVERY = { kind: "recovery_action", text: "Synthetic: re-plan wave 2." };

const PROMPT = `Draft a charter for the ${X_WORD} transformation`;
const TO_DRAFT = (id: string) => `/api/v1/assistant/suggestions/${id}/to-draft`;
const take = (session: Session, id: string, version: number | null) =>
  call<Body>(a.api.app, "POST", TO_DRAFT(id), { session, headers: version === null ? {} : ifm(version) });
const suggestionRow = (id: string) =>
  a.api.db.selectFrom("assistant_suggestion").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

/** Asks once in a conversation focused on X with the fake answering `suggestions`; returns the post response. */
async function suggest(session: Session, suggestions: unknown[], citations: unknown = [1]): Promise<Body> {
  fake.configure({ kind: "envelope", answer: "Synthetic answer from the fake.", citations, suggestions });
  const conv = await newConversation(a.api, session, a.x.b.transformationId);
  const res = await ask(a.api, session, conv, PROMPT);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

beforeAll(async () => {
  a = await startAssistantWorld("mth_asst_sugg", { x: X_WORD, y: "Sidewinderow" });
  fake = await new FakeModel().start();
  await enableFake();
}, 240_000);
afterAll(async () => {
  await fake.stop();
  await a.close();
});

describe("output handling (ADR-0059 §5)", () => {
  it("cited refs are limited to the items given; at most 5 suggestions; invalid kinds and fields are dropped", async () => {
    const posted = await suggest(
      a.x.tl,
      [
        { kind: "approve_gate", fields: { gate: "G4" } }, // not a kind
        { kind: "charter_draft", fields: { case_for_change: "x", target_value: "5000000" } }, // a non-text field
        { kind: "decision_brief_draft", fields: { decision: "d".repeat(501) } }, // decision is at most 500
        { kind: "decision_brief_draft", fields: { options: "A or B" } }, // options are left to the human
        { kind: "missing_evidence" }, // advice without text
        CHARTER,
        BRIEF,
        ADVICE,
        RECOVERY,
        { ...CHARTER, fields: { thesis_change: "Synthetic thesis." } },
        { ...ADVICE, text: "Synthetic: a sixth valid one is beyond 5." },
      ],
      [1, 99, 1, -3, "2"],
    );
    expect(posted.reply.replyKind).toBe("answer");
    expect(posted.reply.citations).toHaveLength(1); // ref 1 only: 99 and -3 were not given, "2" is not a number
    expect(posted.suggestions.map((s: Body) => s.kind)).toEqual([
      "charter_draft",
      "decision_brief_draft",
      "missing_evidence",
      "recovery_action",
      "charter_draft",
    ]);
    for (const s of posted.suggestions) {
      expect(s.label).toBe("assistant_suggestion");
      expect(s.status).toBe("proposed");
      expect(s.citations).toEqual(posted.reply.citations);
    }
    const request = fake.requests[fake.requests.length - 1]!.body!;
    expect(request["tools"]).toBeUndefined();
    expect(request["functions"]).toBeUndefined();
  });

  it("an answer that cites nothing cites every item given; plain text content is the answer with no suggestion", async () => {
    const posted = await suggest(a.x.tl, [CHARTER], []);
    const given = JSON.parse(
      (fake.requests[fake.requests.length - 1]!.body!["messages"] as { content: string }[])
        .at(-2)!
        .content.split("\n")
        .slice(1)
        .join("\n"),
    ) as unknown[];
    expect(posted.reply.citations).toHaveLength(given.length);
    fake.configure({ kind: "text", content: "Synthetic plain text answer." });
    const conv = await newConversation(a.api, a.x.tl, a.x.b.transformationId);
    const res = await ask(a.api, a.x.tl, conv, PROMPT);
    expect(res.body.reply).toMatchObject({ replyKind: "answer", content: "Synthetic plain text answer." });
    expect(res.body.reply.citations.length).toBeGreaterThan(0);
    expect(res.body.suggestions).toEqual([]);
  });

  it("no suggestion on a conversation without a transformation focus", async () => {
    fake.configure({ kind: "envelope", answer: "Synthetic.", citations: [1], suggestions: [CHARTER] });
    const conv = await newConversation(a.api, a.x.tl, null);
    const res = await ask(a.api, a.x.tl, conv, PROMPT);
    expect(res.body.reply.replyKind).toBe("answer");
    expect(res.body.suggestions).toEqual([]);
  });

  it("a provider failure is `unavailable` with its code, never an empty answer", async () => {
    fake.configure({ kind: "status", status: 500 });
    const conv = await newConversation(a.api, a.x.tl, a.x.b.transformationId);
    const res = await ask(a.api, a.x.tl, conv, PROMPT);
    expect(res.body.reply).toMatchObject({
      replyKind: "unavailable",
      errorCode: "assistant.provider_error",
      content: null,
    });
    fake.configure({ kind: "envelope", answer: "   ", citations: [1], suggestions: [] });
    const blank = await ask(a.api, a.x.tl, conv, PROMPT);
    expect(blank.body.reply).toMatchObject({
      replyKind: "unavailable",
      errorCode: "assistant.provider_response_invalid",
    });
  });
});

describe("takeAssistantSuggestionToDraft (ADR-0059 §6, §10)", () => {
  it("the owner takes a charter suggestion: a FormDraftCreate prefill, one audit event, nothing else written", async () => {
    const posted = await suggest(a.x.tl, [CHARTER]);
    const s = posted.suggestions[0];
    const before = await snapshot(a.api.db);
    expect((await take(a.x.tl, s.id, null)).status).toBe(428);
    const stale = await take(a.x.tl, s.id, 7);
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const res = await take(a.x.tl, s.id, 1);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["etag"]).toBe('"2"');
    expect(res.body.suggestion).toMatchObject({ id: s.id, status: "taken_to_draft", version: 2 });
    expect(res.body.transformationId).toBe(a.x.b.transformationId);
    const charter = await a.api.db
      .selectFrom("charter")
      .select(["id", "version"])
      .where("transformation_id", "=", a.x.b.transformationId)
      .executeTakeFirst();
    expect(res.body.draft).toEqual({
      recordType: "charter",
      recordId: charter?.id ?? null,
      baseRecordVersion: charter?.version ?? null,
      payload: { sourceFields: { caseForChange: "Synthetic case.", inScope: "Synthetic scope." } },
    });
    // Writes nothing outside assistant_suggestion (and its audit event): no draft, no charter change, no record.
    expect(await snapshot(a.api.db)).toEqual(before);
    const audit = await a.api.db
      .selectFrom("audit_event")
      .selectAll()
      .where("record_id", "=", s.id)
      .orderBy("seq")
      .execute();
    expect(audit.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["assistant_suggestion.created", null, 1],
      ["assistant_suggestion.taken_to_draft", 1, 2],
    ]);
    expect(JSON.stringify(audit[1]!.changes)).not.toContain("Synthetic case.");
    // Twice: 422 already taken (whatever version is sent).
    for (const v of [2, 1]) {
      const again = await take(a.x.tl, s.id, v);
      expect([again.status, again.body.code]).toEqual([422, "assistant.suggestion_already_taken"]);
      expect(again.body.detail).toBe("This suggestion was already turned into a draft.");
    }
  });

  it("a decision brief becomes a new T16 draft (no record id), mapped to the decision's request fields", async () => {
    const posted = await suggest(a.x.tl, [BRIEF]);
    const res = await take(a.x.tl, posted.suggestions[0].id, 1);
    expect(res.status).toBe(200);
    expect(res.body.draft).toEqual({
      recordType: "T16",
      recordId: null,
      baseRecordVersion: null,
      payload: {
        sourceFields: {
          title: "Synthetic decision",
          whyNow: "Synthetic urgency.",
          recommendation: "Synthetic option A.",
          impactOfDelay: "Synthetic delay impact.",
        },
      },
    });
  });

  it("advice is not draftable (422); AUD and a user without assistant.use get 403; another user's id is 404", async () => {
    const posted = await suggest(a.x.tl, [ADVICE, CHARTER]);
    const [advice, charter] = posted.suggestions;
    const refused = await take(a.x.tl, advice.id, 1);
    expect([refused.status, refused.body.code, refused.body.detail]).toEqual([
      422,
      "assistant.suggestion_not_draftable",
      "This suggestion is advice. Only a charter or decision-brief suggestion can become a draft.",
    ]);
    const nobody = await signIn(a.api.app, a.w.nobody.subject);
    expect((await take(a.auditor, charter.id, 1)).status).toBe(403);
    expect((await take(nobody, charter.id, 1)).status).toBe(403);
    expect((await call(a.api.app, "POST", TO_DRAFT(charter.id), { headers: ifm(1) })).status).toBe(401);
    // Another user who can read X and edit its charter: still not their suggestion.
    const office = await signIn(a.api.app, a.w.office.subject);
    expect((await take(office, charter.id, 1)).status).toBe(404);
    expect((await take(a.x.tl, crypto.randomUUID(), 1)).status).toBe(404);
    expect((await suggestionRow(charter.id)).status).toBe("proposed");
  });

  it("the target's write permission is needed: FIN (no charter.edit, no executive_decision.create) gets 403", async () => {
    const fin = a.x.b.s.fin;
    const posted = await suggest(fin, [CHARTER, BRIEF]);
    expect(posted.suggestions).toHaveLength(2);
    for (const s of posted.suggestions) {
      const res = await take(fin, s.id, 1);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect((await suggestionRow(s.id)).status).toBe("proposed");
    }
  });

  it("authorization is re-checked at commit: a grant revoked meanwhile is 403 and nothing is written", async () => {
    // A user of their own (the session lock helper revokes all of a user's grants).
    const { createUser, grant } = await import("../../support/harness.ts");
    const u = await createUser(a.api.db, a.w.orgA.id);
    const scope = { type: "transformation" as const, id: a.x.b.transformationId };
    await grant(a.api.db, a.w.grantor.id, u.id, "TL", scope, a.w.orgA.id);
    const session = await signIn(a.api.app, u.subject);
    const posted = await suggest(session, [CHARTER]);
    const s = posted.suggestions[0];
    const audits = async () =>
      (await a.api.db.selectFrom("audit_event").select("id").where("record_id", "=", s.id).execute()).length;
    const before = await audits();
    const res = await afterIdentity(
      a.api,
      u.id,
      () => take(session, s.id, 1),
      () => revokeAll(a.api, a.w.grantor.id, u.id),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect((await suggestionRow(s.id)).status).toBe("proposed");
    expect(await audits()).toBe(before);
  });

  it("a suggestion whose citations the owner can no longer read is withheld and cannot be taken (404)", async () => {
    const { createUser, grant } = await import("../../support/harness.ts");
    const u = await createUser(a.api.db, a.w.orgA.id);
    await grant(
      a.api.db,
      a.w.grantor.id,
      u.id,
      "TL",
      { type: "transformation", id: a.x.b.transformationId },
      a.w.orgA.id,
    );
    const session = await signIn(a.api.app, u.subject);
    fake.configure({ kind: "envelope", answer: "Synthetic.", citations: [], suggestions: [CHARTER] });
    const conv = await newConversation(a.api, session, a.x.b.transformationId);
    const res = await ask(a.api, session, conv, `Synthetic ${X_WORD} initiative`);
    const s = res.body.suggestions[0];
    expect(s.citations.some((c: Body) => c.source === "record")).toBe(true);
    await revokeAll(a.api, a.w.grantor.id, u.id);
    await grant(a.api.db, a.w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: a.w.orgA.id }, a.w.orgA.id);
    const again = await signIn(a.api.app, u.subject);
    expect((await take(again, s.id, 1)).status).toBe(404);
    expect((await suggestionRow(s.id)).status).toBe("proposed");
  });
});

describe("the mapping table equals the P5 form definitions' keys (ADR-0059 §6)", () => {
  it("source keys are exactly the 0111 draft fields; targets are the records' write-request fields", async () => {
    for (const t of ["charter", "T16"] as const)
      expect(Object.keys(DRAFT_FIELD_MAP[t]).sort()).toEqual(Object.keys(DRAFT_FIELD_LIMITS[t]).sort());
    // Charter: the charter write request (charterWrite's fields) is the charter form.
    for (const target of Object.values(DRAFT_FIELD_MAP.charter)) expect(Object.keys(charterFields)).toContain(target);
    // T16: the executive decision's create and update requests.
    for (const target of Object.values(DRAFT_FIELD_MAP.T16)) {
      expect(Object.keys(executiveDecisionCreate.shape)).toContain(target);
      expect(Object.keys(executiveDecisionUpdate.shape)).toContain(target);
    }
    // T16's seeded form columns (0068 form_source_field) are the source keys.
    const t16 = await sql<{ field_key: string }>`
      SELECT field_key FROM form_source_field WHERE record_type = 'T16'`.execute(a.api.db);
    for (const key of Object.keys(DRAFT_FIELD_MAP.T16)) expect(t16.rows.map((r) => r.field_key)).toContain(key);
    // No money, rate, FTE, KPI, date, owner or option field can be carried.
    for (const k of [...Object.keys(DRAFT_FIELD_MAP.charter), ...Object.keys(DRAFT_FIELD_MAP.T16)])
      expect(k).not.toMatch(/value|amount|rate|fte|kpi|date|owner|option|target|sar/);
    expect(draftPayloadOf("T16", { decision: "D", unknown: "x" })).toEqual({ sourceFields: { title: "D" } });
  });

  it("the test adapter's own charter suggestion round-trips (no network)", async () => {
    await enableTestAdapter(a.api, a.admin);
    const conv = await newConversation(a.api, a.x.tl, a.x.b.transformationId);
    const res = await ask(a.api, a.x.tl, conv, `Please draft a charter for ${X_WORD}`);
    expect(res.body.suggestions).toHaveLength(1);
    const taken = await take(a.x.tl, res.body.suggestions[0].id, 1);
    expect(taken.status).toBe(200);
    expect(taken.body.draft.payload.sourceFields.caseForChange).toMatch(/^Test draft based on: /);
    await enableFake();
  });
});
