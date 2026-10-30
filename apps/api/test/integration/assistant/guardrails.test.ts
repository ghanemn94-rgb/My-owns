// Refused intents (ADR-0059 §8; REQ-S17-008 A08/A10: "tests show that assistant requests to approve a gate, validate a
// benefit or edit a value are refused and change no records"; T-DG6-BE-U) against a real PostgreSQL. Each refused
// prompt, in English and Arabic, gets a `refusal` reply with its code, NO retrieval (the playbook port is never asked)
// and NO provider call (the test adapter's request count stays the same), and a before/after snapshot of every
// business table's row count and of the md5 of the gate, benefit, KPI actual, evidence and decision tables is equal.
// A question ABOUT a process is answered. All data is SYNTHETIC; nothing approves anything (G1-G6) or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyPrompt, normalizePrompt } from "../../../src/modules/assistant/guardrails.ts";
import { testAdapter } from "../../../src/modules/assistant/provider.ts";
import { ask, newConversation, snapshot, startAssistantWorld, type AssistantWorld } from "./be-u-fixtures.ts";

let a: AssistantWorld;

beforeAll(async () => {
  a = await startAssistantWorld("mth_asst_guard", { x: "Gravelinth", y: "Halcyonore" });
}, 240_000);
afterAll(async () => {
  await a.close();
});

/** The acceptance prompts (A08/A10) and more of the §8 table, each with its expected code. */
const REFUSED: readonly [string, string][] = [
  ["approve gate G4", "assistant.refused.approval"],
  ["Please approve gate G4 for the Gravelinth transformation", "assistant.refused.approval"],
  ["Can you sign off the business case?", "assistant.refused.approval"],
  ["reject the decision", "assistant.refused.approval"],
  ["submit G2 now", "assistant.refused.approval"],
  ["validate the benefit", "assistant.refused.benefit_validation"],
  ["kindly certify these savings", "assistant.refused.benefit_validation"],
  ["set the target to 5 million SAR", "assistant.refused.value_change"],
  ["Could you change the baseline value?", "assistant.refused.value_change"],
  ["increase the KPI actual by 10%", "assistant.refused.value_change"],
  ["create evidence for the Gravelinth initiative", "assistant.refused.evidence"],
  ["make up proof that the benefit was realized", "assistant.refused.evidence"],
  // Arabic (normalized: diacritics removed; أ/إ/آ -> ا; ى -> ي).
  ["اعتمد البوابة G4", "assistant.refused.approval"],
  ["من فضلك وافق على القرار", "assistant.refused.approval"],
  ["أرسل الاعتماد", "assistant.refused.approval"],
  ["تحقّق من المنفعة", "assistant.refused.benefit_validation"],
  ["صادق على الوفورات والمنافع", "assistant.refused.benefit_validation"],
  ["اضبط المستهدف على 5 ملايين ريال", "assistant.refused.value_change"],
  ["لو سمحت غيّر القيمة", "assistant.refused.value_change"],
  ["عدّل الميزانية", "assistant.refused.value_change"],
  ["أنشئ دليل للمبادرة", "assistant.refused.evidence"],
  ["اختلق مرفق للمنفعة", "assistant.refused.evidence"],
];

/** Questions about a process: they do not start with the verb, so they are answered (from the playbook). */
const ANSWERED: readonly string[] = [
  "How do I approve gate G4?",
  "What does validating a benefit involve?",
  "Who can change the target of a KPI?",
  "Explain the evidence needed for a gate",
  "كيف أعتمد البوابة الرابعة؟",
  "ما هي الأدلة المطلوبة للبوابة؟",
];

describe("the §8 rule (pure)", () => {
  it("normalizes Arabic (diacritics, hamza forms, alef maqsura) and lower-cases", () => {
    expect(normalizePrompt("أَنشِئ إثبات آخر ـ على")).toBe("انشئ اثبات اخر  علي");
    expect(normalizePrompt("APPROVE Gate")).toBe("approve gate");
  });

  it.each(REFUSED)("refuses %j as %s", (prompt, code) => {
    expect(classifyPrompt(prompt)).toBe(code);
  });

  it.each(ANSWERED)("answers the question %j", (prompt) => {
    expect(classifyPrompt(prompt)).toBeNull();
  });

  it("the table order decides: a verb of two intents takes the first whose object matches", () => {
    // "اعتمد" is a verb of approval and of benefit validation: with an approval object, approval wins.
    expect(classifyPrompt("اعتمد القرار والمنفعة")).toBe("assistant.refused.approval");
    expect(classifyPrompt("اعتمد المنفعة")).toBe("assistant.refused.benefit_validation");
    // "sign off" is in both too.
    expect(classifyPrompt("sign off the benefit")).toBe("assistant.refused.benefit_validation");
    expect(classifyPrompt("sign off gate G3")).toBe("assistant.refused.approval");
  });

  it("a verb without one of its objects is not refused (the rule is narrow; §7 is the guarantee)", () => {
    expect(classifyPrompt("approve")).toBeNull();
    expect(classifyPrompt("update me on the roadmap")).toBeNull();
    expect(classifyPrompt("summarize the gate G4 approval")).toBeNull();
  });
});

describe("A08/A10 through the API: refused, no retrieval, no provider call, nothing changed", () => {
  it("every refused prompt (en and ar) gets its refusal and changes no business record", async () => {
    const conv = await newConversation(a.api, a.x.tl, a.x.b.transformationId);
    const before = await snapshot(a.api.db);
    const calls = a.passageCalls();
    testAdapter.reset();
    for (const [prompt, code] of REFUSED) {
      const res = await ask(a.api, a.x.tl, conv, prompt, { "accept-language": /[؀-ۿ]/.test(prompt) ? "ar" : "en" });
      expect(res.status, `${prompt}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body.reply).toMatchObject({
        replyKind: "refusal",
        refusalCode: code,
        content: null,
        citations: [],
        providerKind: null,
        latencyMs: null,
      });
      expect(res.body.suggestions).toEqual([]);
    }
    // No provider call and no retrieval.
    expect(testAdapter.requestCount()).toBe(0);
    expect(a.passageCalls()).toBe(calls);
    // Nothing outside the assistant's own tables and the audit trail changed.
    expect(await snapshot(a.api.db)).toEqual(before);
    // The refusals are stored as codes only (rendered at read time), and the audit carries the code, never text.
    const audits = await a.api.db
      .selectFrom("audit_event")
      .select(["action", "changes"])
      .where("record_id", "=", conv.id)
      .where("action", "=", "assistant_conversation.reply_recorded")
      .execute();
    expect(audits).toHaveLength(REFUSED.length);
    for (const e of audits) expect(JSON.stringify(e.changes)).toContain("assistant.refused.");
  }, 120_000);

  it("a question about a process is answered from the playbook (one provider call)", async () => {
    const conv = await newConversation(a.api, a.x.tl, a.x.b.transformationId);
    testAdapter.reset();
    const res = await ask(a.api, a.x.tl, conv, "How do I approve gate G4?");
    expect(res.status).toBe(201);
    expect(res.body.reply.replyKind).toBe("answer");
    expect(testAdapter.requestCount()).toBe(1);
    expect(res.body.reply.citations.length).toBeGreaterThan(0);
  });
});
