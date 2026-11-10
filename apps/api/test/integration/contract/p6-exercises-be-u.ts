// P6 contract exercises of BE-U (p6-work-split §D.2 and §2 rule 16; T-DG6-BE-U): takeAssistantSuggestionToDraft, with
// a success and every declared refusal it can reach, through the validating client. The suggestions come from a real
// postAssistantMessage turn: the assistant is enabled with the HTTP adapter pointed at the LOCAL fake chat-completions
// server (loopback; NOT a model and NOT an IT endpoint), whose envelope carries a charter, an advice and a decision-
// brief suggestion; retrieval finds the playbook through the PlaybookPassagePort registered here as server.ts does.
// The assistant is turned OFF again at the end (as BE-T leaves it) and the port registration is restored. Every value
// is SYNTHETIC; the authorization reference is a made-up ticket id that the product records but does not verify.
import { expect } from "vitest";
import type { z } from "zod";
import { registerAssistantPlaybookPassagePort } from "../../../src/modules/assistant/retrieval.ts";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { assistantTakeToDraftResult } from "../../../src/modules/assistant/suggestions.ts";
import { createPlaybookPassagePort } from "../../../src/modules/methodology/playbook-passages.ts";
import { FakeModel } from "../../support/fake-model.ts";
import { call, createTransformationRow, signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P6_MIRRORS_BE_U: Readonly<Record<string, z.ZodType>> = {
  takeAssistantSuggestionToDraft: assistantTakeToDraftResult,
};

export async function exerciseP6BeUOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject); // ADM_TECH: configures
  const office = await signIn(api.app, w.office.subject); // TO: uses; holds charter.edit and executive_decision.create
  const auditor = await signIn(api.app, w.auditor.subject); // AUD: 403 on every assistant write
  const nobody = await signIn(api.app, w.nobody.subject);
  const S = "/api/v1/admin/assistant";
  const ifm = (v: number | string) => ({ "if-match": `"${v}"` });
  const fake = await new FakeModel().start();
  const previousPort = registerAssistantPlaybookPassagePort(createPlaybookPassagePort(api.db));
  try {
    // Setup through BE-T's operations (exercised in p6-exercises-be-t.ts): the HTTP adapter on the local fake, on.
    const current = await loadSetting(api.db);
    if (current?.enabled) {
      const off = await call(api.app, "POST", `${S}/disable`, {
        session: admin,
        body: { reason: "Synthetic contract exercise" },
        headers: ifm(current.version),
      });
      expect(off.status).toBe(200);
    }
    const saved = await call<{ version: number }>(api.app, "PUT", S, {
      session: admin,
      body: {
        providerKind: "http_endpoint",
        endpointUrl: fake.url,
        apiStyle: "openai_chat_completions",
        modelName: "synthetic-model",
        credentialRef: null,
        authorizationReference: "IT-APPROVAL-SYNTHETIC-CONTRACT-U",
        requestTimeoutMs: 5000,
        maxOutputTokens: 512,
        maxContextRecords: 4,
        reason: "Synthetic contract exercise",
      },
      headers: ifm((await loadSetting(api.db))?.version ?? 0),
    });
    expect(saved.status).toBe(200);
    const on = await call(api.app, "POST", `${S}/enable`, {
      session: admin,
      body: { reason: "Synthetic contract exercise" },
      headers: ifm(saved.body.version),
    });
    expect(on.status).toBe(200);
    fake.configure({
      kind: "envelope",
      answer: "Synthetic answer.",
      citations: [1],
      suggestions: [
        { kind: "charter_draft", fields: { case_for_change: "Synthetic case for change." } },
        { kind: "missing_evidence", text: "Synthetic: attach the steering minutes." },
        { kind: "decision_brief_draft", fields: { decision: "Synthetic decision", why_now: "Synthetic." } },
      ],
    });
    const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
    const conv = await call<{ id: string; version: number }>(api.app, "POST", "/api/v1/assistant/conversations", {
      session: office,
      body: { title: "Synthetic contract conversation", transformationId },
    });
    expect(conv.status).toBe(201);
    const posted = await call<{ suggestions: { id: string; kind: string }[] }>(
      api.app,
      "POST",
      `/api/v1/assistant/conversations/${conv.body.id}/messages`,
      { session: office, body: { content: "Draft a charter: what is the case for change?" }, headers: ifm(1) },
    );
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    const byKind = (k: string) => posted.body.suggestions.find((s) => s.kind === k)!.id;
    const charter = byKind("charter_draft");
    const advice = byKind("missing_evidence");
    const brief = byKind("decision_brief_draft");
    const to = (id: string) => `/api/v1/assistant/suggestions/${id}/to-draft`;

    // takeAssistantSuggestionToDraft: 400 (malformed id); 401; 403 (AUD; no assistant.use); 404 (missing); 428; 409;
    // 422 (advice: not draftable); 200 (charter, T16); 422 (already taken).
    expect((await mirrored("POST", to("not-a-uuid"), { session: office, headers: ifm(1) })).status).toBe(400);
    expect((await mirrored("POST", to(charter), { headers: ifm(1) })).status).toBe(401);
    expect((await mirrored("POST", to(charter), { session: auditor, headers: ifm(1) })).status).toBe(403);
    expect((await mirrored("POST", to(charter), { session: nobody, headers: ifm(1) })).status).toBe(403);
    expect((await mirrored("POST", to(crypto.randomUUID()), { session: office, headers: ifm(1) })).status).toBe(404);
    expect((await mirrored("POST", to(charter), { session: office })).status).toBe(428);
    expect((await mirrored("POST", to(charter), { session: office, headers: ifm(5) })).status).toBe(409);
    const notDraftable = await mirrored("POST", to(advice), { session: office, headers: ifm(1) });
    expect([notDraftable.status, notDraftable.body.code]).toEqual([422, "assistant.suggestion_not_draftable"]);
    const taken = await mirrored("POST", to(charter), { session: office, headers: ifm(1) });
    expect(taken.status).toBe(200);
    expect(taken.body.draft.recordType).toBe("charter");
    expect(taken.body.draft.payload).toEqual({ sourceFields: { caseForChange: "Synthetic case for change." } });
    const t16 = await mirrored("POST", to(brief), { session: office, headers: ifm(1) });
    expect([t16.status, t16.body.draft.recordType, t16.body.draft.recordId]).toEqual([200, "T16", null]);
    const twice = await mirrored("POST", to(charter), { session: office, headers: ifm(2) });
    expect([twice.status, twice.body.code]).toEqual([422, "assistant.suggestion_already_taken"]);
  } finally {
    // Back to OFF, as BE-T leaves it, and the port registration restored.
    const now = await loadSetting(api.db);
    if (now?.enabled)
      await call(api.app, "POST", `${S}/disable`, {
        session: admin,
        body: { reason: "Synthetic contract exercise" },
        headers: ifm(now.version),
      });
    registerAssistantPlaybookPassagePort(previousPort);
    await fake.stop();
  }
}
