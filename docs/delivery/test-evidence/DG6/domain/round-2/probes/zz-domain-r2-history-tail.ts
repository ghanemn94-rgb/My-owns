// domain-reviewer DG6 re-gate round 2 probe (T-DG6-REV-DOM-RG-R2). Appended to lines 17-147 of
// apps/api/test/integration/assistant/context-recheck.test.ts (the shared setup: fake model, enableFake, userWithTl,
// revokeTl, getConversation, askCitingTa1) to form apps/api/test/integration/assistant/zz-domain-r2-history.test.ts in a
// disposable clone only. SYNTHETIC data. Nothing approves anything (G1-G6) or touches DG0-DG7.
//
// Question: after the owner loses access to a record, the ADR-0059 §9 re-check withholds the earlier answer that was
// generated from it (F-DG6-920 repair). Does a LATER turn of the same conversation still hand that withheld answer's
// text to the model as history (conversations.ts historyOf), and is the later answer then re-checked against it?
describe("domain r2: a withheld answer and the history of the next turn", () => {
  it("the withheld answer's text is (or is not) sent to the model as history; the next answer's withheld state", async () => {
    const u = await userWithTl(tA1, tA2);
    // Turn 1: both records given; the fake cites only tA1; the answer text names TITLE_2 (as in case 1).
    const { conversationId } = await askCitingTa1(u.session);
    await revokeTl(u.id, tA2);
    const before = await getConversation(u.session, conversationId);
    console.log("[DOM-R2-H] turn 1 after revoking tA2: contentWithheld =", before.messages[1].contentWithheld);
    expect(before.messages[1].contentWithheld).toBe(true);

    // Turn 2: the same owner asks again in the same conversation. The fake now answers by repeating its previous
    // answer (what a real model may do when asked "repeat that" or "summarise what you said").
    fake.configure({
      kind: "envelope",
      answer: "Synthetic answer repeating the previous turn.",
      citeRecords: (i) => i.id === tA1,
    });
    const conv = { id: conversationId };
    const res = await ask(a.api, u.session, conv, "Repeat your previous answer about Zephyrine synthetic program");
    console.log("[DOM-R2-H] turn 2 status", res.status, "replyKind", res.body?.reply?.replyKind);
    const req = fake.requests[fake.requests.length - 1]!.body as { messages: { role: string; content: string }[] };
    const history = req.messages.filter((m) => !m.content.startsWith("DATA (")).map((m) => m.content);
    const withheldTextSent = history.some((c) => c.includes(TITLE_2));
    console.log("[DOM-R2-H] turn 2 request: messages =", req.messages.length, "; withheld turn-1 text (names TITLE_2) sent as history =", withheldTextSent);
    const given = FakeModel.dataRecordsOf(req as unknown as Record<string, unknown>).map((i) => i.id);
    console.log("[DOM-R2-H] turn 2 data block record ids include tA2 =", given.includes(tA2));
    const row = await a.api.db
      .selectFrom("assistant_message")
      .selectAll()
      .where("conversation_id", "=", conversationId)
      .orderBy("seq", "desc")
      .executeTakeFirstOrThrow();
    const ctx = (row as unknown as { context_records: { recordId: string }[] | null }).context_records;
    console.log("[DOM-R2-H] turn 2 stored context_records include tA2 =", (ctx ?? []).some((r) => r.recordId === tA2));
    const after = await getConversation(u.session, conversationId);
    console.log(
      "[DOM-R2-H] turn 2 answer served: contentWithheld =",
      after.messages[3]?.contentWithheld,
      "content =",
      JSON.stringify(after.messages[3]?.content),
    );
    // Recorded as observations; the verdict is judged in the review record.
    expect(res.status).toBe(201);
  });
});
