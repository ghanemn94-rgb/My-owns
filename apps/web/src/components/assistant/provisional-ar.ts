// The provisional-Arabic label of the assistant's texts (T-DG6-FE-E; p6-work-split §D.3: "i18n/{en,ar}/assistant.json
// (new; Arabic marked provisional)"). JSON catalogues cannot carry comments, so the label lives here as data that
// assistant-i18n.test.ts binds to the catalogues: every Arabic text of the `assistant` namespace and of the assistant
// block of `problems` is PROVISIONAL and awaits a Mobily language review.
//  - "adr": ADR-0059 gives the Arabic and labels it provisional (§1, the suggestion label): used exactly.
//  - "fe-e": ADR-0059 gives English only (§3, §4, §8, §10); the Arabic was written by T-DG6-FE-E.
// A key ending in "." stands for every key below that prefix. When a reviewed translation replaces a text, remove its
// entry here in the same change. (The FE-A list `i18n/provisional-ar-p6.ts` is FE-A's file; the handback asks the
// orchestrator whether to fold these entries into it.)

export type AssistantArabicSource = "adr" | "fe-e";

export const ASSISTANT_PROVISIONAL_ARABIC: Readonly<Record<string, AssistantArabicSource>> = {
  "assistant.label": "adr",
  "assistant.panel.": "fe-e",
  "assistant.reply.": "fe-e",
  "assistant.citations.": "fe-e",
  "assistant.suggestion.": "fe-e",
  "assistant.admin.": "fe-e",
  "problems.assistant__disabled": "fe-e",
  "problems.assistant__reply_pending": "fe-e",
  "problems.assistant__conversation_full": "fe-e",
  "problems.assistant__enable_incomplete": "fe-e",
  "problems.assistant__locked_while_enabled": "fe-e",
  "problems.assistant__already_enabled": "fe-e",
  "problems.assistant__already_disabled": "fe-e",
  "problems.assistant__test_adapter_not_allowed": "fe-e",
  "problems.assistant__insecure_endpoint": "fe-e",
  "problems.assistant__endpoint_invalid": "fe-e",
  "problems.assistant__credential_ref_invalid": "fe-e",
  "problems.assistant__suggestion_not_draftable": "fe-e",
  "problems.assistant__suggestion_already_taken": "fe-e",
};
