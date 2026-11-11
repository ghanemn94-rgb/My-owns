// domain-reviewer DG6 re-gate round 3 probe (T-DG6-REV-DOM-RG-R3). Appended to lines 17-147 of
// apps/api/test/integration/assistant/context-recheck.test.ts (the shared setup: fake model, enableFake, userWithTl,
// revokeTl, getConversation, askCitingTa1) to form apps/api/test/integration/assistant/zz-domain-r3-history.test.ts in a
// disposable clone only. SYNTHETIC data. Nothing approves anything (G1-G6) or touches DG0-DG7.
//
// Verifies the T-DG6-BE-RG2 repair of F-DG6-960/970/980 adversarially, with an ECHO model (answers with the text of the
// last assistant message in its history, else a fixed text that names NO record):
//   R1  my round-2 sequence (owner TL on tA1, tA2; turn 1 given both, cites tA1; revoke tA2; "repeat") - the withheld
//       answer is not in the history, and no served text names TITLE_2.
//   R2  transitive inheritance past the 6-message history window: A1 (from tA1+tA2) is echoed through A2..A5 whose own
//       data blocks hold only tA3; after revoking tA2 EVERY answer A1..A5 is withheld, although A1 is out of the window
//       of the last turns; turn 6 is sent no TITLE_2 and serves none.
//   R3  restoring the grant makes A1 readable again (no permanent loss); its next turn may carry it again.
import { FakeModel as FM } from "../../support/fake-model.ts";

const TITLE_3 = "Quillvane synthetic program three";
const NEUTRAL = "Synthetic neutral answer with no record named.";
const echo = (messages: readonly { role: string; content: string }[]): string => {
  const prev = [...messages].reverse().find((m) => m.role === "assistant");
  return prev === undefined ? NEUTRAL : `Repeating: ${prev.content}`;
};
const lastRequestTexts = () => {
  const body = fake.requests[fake.requests.length - 1]!.body as Record<string, unknown>;
  return FM.messagesOf(body);
};
const historyHas = (needle: string) =>
  lastRequestTexts().some((m) => !m.content.startsWith("DATA (") && m.role !== "system" && m.content.includes(needle));

let tA3: string;

describe("domain r3: the history channel after T-DG6-BE-RG2", () => {
  beforeAll(async () => {
    tA3 = await createTransformationRow(a.api.db, a.w.orgA.id, a.w.a1, a.w.grantor.id);
    await a.api.db
      .insertInto("search_document")
      .values({
        id: crypto.randomUUID(),
        organization_id: a.w.orgA.id,
        transformation_id: tA3,
        record_type: "transformation",
        record_id: tA3,
        record_version: 1,
        title: TITLE_3,
        summary: `Synthetic confidential summary of ${TITLE_3}`,
        source_audit_seq: "0",
      })
      .onConflict((oc) => oc.constraint("search_document_record_key").doNothing())
      .execute();
  });

  it("R1: round-2 sequence with an echo model: nothing withheld is re-sent or re-served", async () => {
    const u = await userWithTl(tA1, tA2);
    const { conversationId } = await askCitingTa1(u.session);
    await revokeTl(u.id, tA2);
    const before = await getConversation(u.session, conversationId);
    console.log("[DOM-R3-R1] turn 1 after revoking tA2: contentWithheld =", before.messages[1].contentWithheld);
    expect(before.messages[1].contentWithheld).toBe(true);
    fake.configure({ kind: "envelope", answer: "unused", answerFrom: echo, citeRecords: (i) => i.id === tA1 });
    const res = await ask(a.api, u.session, { id: conversationId }, "Repeat your previous answer about Zephyrine synthetic program");
    expect(res.status).toBe(201);
    const msgs = lastRequestTexts();
    console.log("[DOM-R3-R1] turn 2 request roles =", JSON.stringify(msgs.map((m) => m.role)));
    console.log("[DOM-R3-R1] turn 2 history holds TITLE_2 =", historyHas(TITLE_2));
    expect(historyHas(TITLE_2)).toBe(false);
    expect(FM.dataRecordsOf(fake.requests[fake.requests.length - 1]!.body).map((i) => i.id)).not.toContain(tA2);
    console.log("[DOM-R3-R1] turn 2 reply withheld =", res.body.reply.contentWithheld, "content =", JSON.stringify(res.body.reply.content));
    expect(JSON.stringify(res.body)).not.toContain(TITLE_2);
    const after = await getConversation(u.session, conversationId);
    console.log("[DOM-R3-R1] GET after turn 2 names TITLE_2 =", JSON.stringify(after).includes(TITLE_2));
    expect(JSON.stringify(after)).not.toContain(TITLE_2);
  });

  it("R2: transitive inheritance past the 6-message window; R3: restoring the grant", async () => {
    const u = await userWithTl(tA1, tA2, tA3);
    const { conversationId } = await askCitingTa1(u.session);
    const conv = { id: conversationId };
    fake.configure({ kind: "envelope", answer: "unused", answerFrom: echo, citeRecords: () => true });
    for (let n = 2; n <= 5; n++) {
      const r = await ask(a.api, u.session, conv, `Quillvane turn ${n}: repeat your last answer`);
      expect(r.status).toBe(201);
      const given = FM.dataRecordsOf(fake.requests[fake.requests.length - 1]!.body).map((i) => i.id);
      expect(given).toEqual([tA3]);
      expect(r.body.reply.content).toContain(TITLE_2); // the echo carries A1's text forward while readable
    }
    const rows = await a.api.db
      .selectFrom("assistant_message")
      .selectAll()
      .where("conversation_id", "=", conversationId)
      .where("author", "=", "assistant")
      .orderBy("seq")
      .execute();
    const ctxHasTa2 = rows.map((r) =>
      ((r as unknown as { context_records: { recordId: string }[] | null }).context_records ?? []).some((k) => k.recordId === tA2),
    );
    console.log("[DOM-R3-R2] answers A1..A5 stored context includes tA2 =", JSON.stringify(ctxHasTa2));
    expect(ctxHasTa2).toEqual([true, true, true, true, true]);
    await revokeTl(u.id, tA2);
    const g = await getConversation(u.session, conversationId);
    const withheld = (g.messages as Body[]).filter((m) => m.author === "assistant").map((m) => m.contentWithheld);
    console.log("[DOM-R3-R2] after revoking tA2, answers A1..A5 contentWithheld =", JSON.stringify(withheld));
    expect(withheld).toEqual([true, true, true, true, true]);
    expect(JSON.stringify(g)).not.toContain(TITLE_2);
    const r6 = await ask(a.api, u.session, conv, "Quillvane turn 6: repeat your last answer");
    expect(r6.status).toBe(201);
    console.log("[DOM-R3-R2] turn 6 request roles =", JSON.stringify(lastRequestTexts().map((m) => m.role)), "history holds TITLE_2 =", historyHas(TITLE_2));
    expect(historyHas(TITLE_2)).toBe(false);
    console.log("[DOM-R3-R2] turn 6 reply withheld =", r6.body.reply.contentWithheld, "content =", JSON.stringify(r6.body.reply.content));
    expect(JSON.stringify(r6.body)).not.toContain(TITLE_2);
    // R3: restore the grant (a new TL assignment); the earlier answers are readable again, nothing is lost.
    await grant(a.api.db, a.w.grantor.id, u.id, "TL", { type: "transformation", id: tA2 }, a.w.orgA.id);
    const g2 = await getConversation(u.session, conversationId);
    const w2 = (g2.messages as Body[]).filter((m) => m.author === "assistant").map((m) => m.contentWithheld);
    console.log("[DOM-R3-R3] after restoring TL on tA2, answers contentWithheld =", JSON.stringify(w2));
    expect(w2.slice(0, 5)).toEqual([false, false, false, false, false]);
  });
});
