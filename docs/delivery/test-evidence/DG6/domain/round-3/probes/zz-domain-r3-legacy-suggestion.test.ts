// domain-reviewer DG6 re-gate round 3: code-security's round-2 F-DG6-971 reproduction, adapted only where 0129 changed the
// catalogue (no CHECK to drop; the state query reads the trigger). SYNTHETIC; nothing approves anything.
// Code-security reviewer, DG6 clean re-gate round 2 (T-DG6-REV-CS-RG-R2): reproduction probe, NOT product code.
// Copy to apps/api/test/integration/assistant/ in a DISPOSABLE clone and run with
//   npx vitest run --project integration apps/api/test/integration/assistant/zz-sec-r2-legacy-suggestion-to-draft.test.ts
//
// Question: ADR-0059 §9 amendment and the data dictionary say a suggestion stored before 0128 (context_records NULL)
// keeps working under the citations fallback. 0128 adds `assistant_suggestion_context_records_required`
// CHECK (context_records IS NOT NULL) NOT VALID. In PostgreSQL a NOT VALID CHECK skips only the EXISTING rows at
// ALTER time; it is enforced on every later INSERT and UPDATE of a row. takeAssistantSuggestionToDraft UPDATEs the
// suggestion (proposed -> taken_to_draft), so a pre-0128 suggestion violates the CHECK on that UPDATE.
//
// The pre-0128 state is made exactly as context-recheck.test.ts case 5 makes it for a message: owner-only DDL on the
// scratch database (drop the required CHECK, pause the table's user triggers (0128 immutability, 0111 guard, version step) for that one UPDATE, set the one row's context NULL, restore
// both, the CHECK again NOT VALID as 0128 leaves it). Shipped http_endpoint provider + the suite's loopback fake model.
// All data is SYNTHETIC. Nothing here approves anything (G1-G6) or touches DG0-DG7.
//
// The test PASSES when the defect is reproduced (observations printed with a [SEC-R2-L] prefix).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { FakeModel } from "../../support/fake-model.ts";
import { call, createUser, grant, signIn, type Session } from "../../support/harness.ts";
import { ask, ifm, newConversation, S, startAssistantWorld, type AssistantWorld, type Body } from "./be-u-fixtures.ts";

const X_WORD = "Legacitora";

let a: AssistantWorld;
let fake: FakeModel;

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
      authorizationReference: "IT-APPROVAL-SYNTHETIC-SEC-R2-L",
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

beforeAll(async () => {
  a = await startAssistantWorld("mth_sec_r2_legacy", { x: X_WORD, y: "Controlora" });
  fake = await new FakeModel().start();
  await enableFake();
}, 240_000);

afterAll(async () => {
  await fake?.stop();
  await a?.close();
});

async function charterSuggestion(session: Session): Promise<string> {
  fake.configure({
    kind: "envelope",
    answer: "Synthetic answer for a charter draft.",
    citations: [1],
    suggestions: [{ kind: "charter_draft", fields: { case_for_change: "Synthetic case for change (SEC-R2-L)." } }],
  });
  const conv = await newConversation(a.api, session, a.x.b.transformationId);
  const res = await ask(a.api, session, conv, X_WORD);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const s = (res.body.suggestions as Body[]).find((x) => x.kind === "charter_draft");
  expect(s, JSON.stringify(res.body)).toBeDefined();
  return s.id as string;
}

describe("SEC-R2-L: a suggestion stored before 0128 cannot be taken to a draft", () => {
  it("control: a suggestion stored after 0128 is taken to a draft (200)", async () => {
    const u = await createUser(a.api.db, a.w.orgA.id);
    await grant(a.api.db, a.w.grantor.id, u.id, "TL", { type: "transformation", id: a.x.b.transformationId }, a.w.orgA.id);
    const session = await signIn(a.api.app, u.subject);
    const id = await charterSuggestion(session);
    const taken = await call<Body>(a.api.app, "POST", `/api/v1/assistant/suggestions/${id}/to-draft`, {
      session,
      headers: ifm(1),
    });
    console.log("[SEC-R2-L] control (post-0128 row) to-draft status:", taken.status);
    expect(taken.status, JSON.stringify(taken.body)).toBe(200);
  });

  it("pre-0128 row (context NULL, the required CHECK NOT VALID as 0128 leaves it): to-draft fails", async () => {
    const u = await createUser(a.api.db, a.w.orgA.id);
    await grant(a.api.db, a.w.grantor.id, u.id, "TL", { type: "transformation", id: a.x.b.transformationId }, a.w.orgA.id);
    const session = await signIn(a.api.app, u.subject);
    const id = await charterSuggestion(session);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    // domain r3 adaptation: on a database migrated through 0129 the CHECK no longer exists (0129 replaced it by a
    // BEFORE INSERT trigger), so only the triggers are paused for the one UPDATE that makes the pre-0128 state.
    await a.api.owner.query(`
      DO $$ BEGIN
        ALTER TABLE assistant_suggestion DISABLE TRIGGER USER;
        UPDATE assistant_suggestion SET context_records = NULL WHERE id = '${id}';
        ALTER TABLE assistant_suggestion ENABLE TRIGGER USER;
      END $$`);
    const state = await a.api.owner.query(
      `SELECT s.context_records IS NULL AS ctx_null, s.status,
              EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = 'assistant_suggestion_context_records_required') AS check_exists,
              EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'assistant_suggestion_context_records_required') AS trigger_exists
         FROM assistant_suggestion s WHERE s.id = $1`,
      [id],
    );
    console.log("[SEC-R2-L] legacy state:", JSON.stringify(state.rows[0]));
    expect(state.rows[0]).toMatchObject({ ctx_null: true, status: "proposed", check_exists: false, trigger_exists: true });

    // The documented fallback: the conversation still serves it (citations only).
    const taken = await call<Body>(a.api.app, "POST", `/api/v1/assistant/suggestions/${id}/to-draft`, {
      session,
      headers: ifm(1),
    });
    console.log("[SEC-R2-L] legacy row to-draft status:", taken.status, "body:", JSON.stringify(taken.body));
    const after = await a.api.owner.query(`SELECT status, version FROM assistant_suggestion WHERE id = $1`, [id]);
    console.log("[SEC-R2-L] legacy row after the call:", JSON.stringify(after.rows[0]));
    // Direct UPDATE as the owner role shows the database reason.
    const direct = await a.api.owner
      .query(`UPDATE assistant_suggestion SET status = 'taken_to_draft', taken_at = now(), taken_by = owner_user_id,
                updated_by = owner_user_id, version = version + 1 WHERE id = $1`, [id])
      .then(
        () => "updated",
        (e: { code?: string; constraint?: string }) => `${e.code} ${e.constraint}`,
      );
    console.log("[SEC-R2-L] direct owner UPDATE of the legacy row:", direct);

    // domain r3: the FIXED behaviour, asserted (the round-2 probe asserted the defect). The API call took the row to a
    // draft, so the later direct UPDATE (same transition) is no longer a 23514 constraint refusal.
    expect(taken.status).toBe(200);
    expect(after.rows[0]).toMatchObject({ status: "taken_to_draft" });
    expect(direct).not.toBe("23514 assistant_suggestion_context_records_required");
  });
});
