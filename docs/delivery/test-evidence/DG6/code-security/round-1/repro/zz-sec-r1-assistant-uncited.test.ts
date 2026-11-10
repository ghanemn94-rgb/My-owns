// code-security-reviewer, DG6 re-gate round 1 (T-DG6-REV-CS-RG-R1): reproduction for the ADR-0059 §9 read-time
// re-check. Run from a disposable clone only, copied to apps/api/test/integration/assistant/ (the relative imports
// assume that location):
//   tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/assistant/zz-sec-r1-assistant-uncited.test.ts
// Claim under test: ADR-0059 §9 says "an answer that cites a record the owner can no longer read is returned with
// content: null ... So a revoked grant hides earlier answers too", and §5 says every answer lists the records "it was
// generated from". answer.ts stores only the refs the MODEL chose to cite (guardrails.ts citationsFor), so a record
// that was given to the model (and quoted in the answer) but not cited is never re-checked: after the grant on it is
// revoked, the stored answer, including that record's text, is still served to the owner.
// The model is the suite's local fake chat-completions server (no network). All data is SYNTHETIC.
import { migrate } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { FakeModel } from "../../support/fake-model.ts";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const S = "/api/v1/admin/assistant";
const C = "/api/v1/assistant/conversations";
const ifm = (v: number | string) => ({ "if-match": `"${v}"` });
const TITLE_1 = "Zephyrine synthetic program one";
const TITLE_2 = "Zephyrine synthetic program two";

let api: TestApi;
let scratchDb: string;
let fake: FakeModel;
let w: World;
let admin: Session;
let tA1: string;
let tA2: string;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_sec_r1_uncited");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  fake = await new FakeModel().start();
  admin = await signIn(api.app, w.admin.subject);
  tA1 = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  tA2 = await createTransformationRow(api.db, w.orgA.id, w.a2, w.grantor.id);
  for (const [t, title] of [
    [tA1, TITLE_1],
    [tA2, TITLE_2],
  ] as const)
    await api.db
      .insertInto("search_document")
      .values({
        id: crypto.randomUUID(),
        organization_id: w.orgA.id,
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
  const now = await loadSetting(api.db);
  const saved = await call<Body>(api.app, "PUT", S, {
    session: admin,
    body: {
      providerKind: "http_endpoint",
      endpointUrl: fake.url,
      apiStyle: "openai_chat_completions",
      modelName: "synthetic-model",
      credentialRef: null,
      authorizationReference: "IT-APPROVAL-SYNTHETIC-SEC-R1",
      requestTimeoutMs: 5000,
      maxOutputTokens: 512,
      maxContextRecords: 5,
      reason: "Synthetic: the local fake model",
    },
    headers: ifm(now?.version ?? 0),
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const on = await call<Body>(api.app, "POST", `${S}/enable`, {
    session: admin,
    body: { reason: "Synthetic: on (fake)" },
    headers: ifm(saved.body.version),
  });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
}, 120_000);

afterAll(async () => {
  await fake?.stop();
  await api?.close();
  await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

describe("SEC-R1 reproduction: an uncited record given to the model escapes the read-time re-check", () => {
  it("after the grant on the uncited record is revoked, the stored answer (quoting it) is still served", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TL", { type: "transformation", id: tA1 }, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TL", { type: "transformation", id: tA2 }, w.orgA.id);
    const session = await signIn(api.app, u.subject);

    // The model answers from BOTH records it was given, but cites only ref 1 (an envelope a real model may return; an
    // instruction inside an uploaded evidence text could also steer it to do so, REQ-S17-011).
    fake.configure({
      kind: "envelope",
      answer: `Synthetic answer: ${TITLE_1} and ${TITLE_2} are both behind plan.`,
      citations: [1],
    });
    const conv = await call<Body>(api.app, "POST", C, { session, body: { title: "Synthetic SEC-R1" } });
    expect(conv.status, JSON.stringify(conv.body)).toBe(201);
    const res = await call<Body>(api.app, "POST", `${C}/${conv.body.id}/messages`, {
      session,
      body: { content: "Zephyrine synthetic program" },
      headers: ifm(conv.body.version),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.reply.replyKind).toBe("answer");

    // What the model was given: both records (the data block names both titles).
    const sent = JSON.stringify(fake.requests[fake.requests.length - 1]);
    console.log("[SEC-R1] data block holds title 1:", sent.includes(TITLE_1), "title 2:", sent.includes(TITLE_2));
    expect(sent).toContain(TITLE_1);
    expect(sent).toContain(TITLE_2);

    // What was stored as the answer's sources: only the cited record.
    const cited = (res.body.reply.citations as Body[]).filter((c) => c.source === "record");
    console.log("[SEC-R1] stored record citations:", JSON.stringify(cited));
    expect(cited).toHaveLength(1);
    const citedId: string = cited[0].recordId;
    const uncitedId = citedId === tA1 ? tA2 : tA1;
    const uncitedTitle = uncitedId === tA1 ? TITLE_1 : TITLE_2;

    // Revoke the grant on the UNCITED record's transformation only.
    await api.owner.query(
      `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic SEC-R1'
        where user_id = $2 and revoked_at is null and scope_type = 'transformation' and scope_id = $3`,
      [w.grantor.id, u.id, uncitedId],
    );
    // The owner can no longer read the uncited record directly.
    const direct = await call<Body>(api.app, "GET", `/api/v1/transformations/${uncitedId}`, { session });
    console.log("[SEC-R1] direct read of the uncited transformation after revocation:", direct.status);

    const after = await call<Body>(api.app, "GET", `${C}/${conv.body.id}`, { session });
    expect(after.status).toBe(200);
    const reply = after.body.messages[1];
    console.log("[SEC-R1] after revocation: contentWithheld =", reply.contentWithheld, "content =", reply.content);
    // ADR-0059 §9 expects the answer to be withheld; the candidate serves it, including the revoked record's title.
    expect(reply.contentWithheld).toBe(false);
    expect(String(reply.content)).toContain(uncitedTitle);
  });
});
