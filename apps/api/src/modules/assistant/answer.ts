// The answer seam of postAssistantMessage (ADR-0059 §9 steps 3-5; p6-work-split §D.1, §D.2).
// T-DG6-BE-T shipped the signature (conversations.ts calls it between its two transactions, OUTSIDE any transaction,
// §2 rule 4); T-DG6-BE-U fills the body:
//   1. guardrails (§8): a refused intent is a `refusal` with its code: NO retrieval and NO provider call;
//   2. retrieval (§4): one pass, from the prompt only, as the caller (search and ReadScope; the two injected ports);
//   3. nothing found: `no_sources` ("Nothing was sent to the model."), NO provider call;
//   4. the provider (§2): one request, built by prompt.ts (§5: record and document text only as quoted data);
//   5. output handling (§5): plain text of at most 8,000 characters, citations limited to the items given (all of them
//      when the model cites none), suggestions filtered by §6. A provider failure is `unavailable` with its code, never
//      an empty answer (§11).
// The model's output is text: it is never interpreted as a command, and nothing here writes (§7).
import type { Db } from "@mth/db";
import type { Principal } from "../access/index.ts";
import { answerText, citationsFor, classifyPrompt, filterSuggestions } from "./guardrails.ts";
import { buildModelRequest } from "./prompt.ts";
import type { AssistantSettingRow, Citation, ModelProvider, ProviderErrorCode } from "./provider.ts";
import { retrieve } from "./retrieval.ts";

export type RefusalCode =
  | "assistant.refused.approval"
  | "assistant.refused.benefit_validation"
  | "assistant.refused.value_change"
  | "assistant.refused.evidence";

/** A suggestion that passed the guardrails (§5, §6), ready to be stored on the answer. */
export interface SuggestionDraft {
  readonly kind: "charter_draft" | "decision_brief_draft" | "recovery_action" | "missing_evidence";
  readonly targetRecordType: "charter" | "T16" | null;
  readonly fields: Readonly<Record<string, string>> | null;
  readonly textContent: string | null;
  readonly citations: readonly Citation[];
}

export interface AnswerInput {
  readonly db: Db;
  /** The conversation's owner, as freshly loaded for this request (retrieval runs as this principal only). */
  readonly principal: Principal;
  readonly conversation: {
    readonly id: string;
    readonly organizationId: string;
    readonly transformationId: string | null;
  };
  /** The user's message as typed. */
  readonly prompt: string;
  /** At most the last 6 prompts and answers of the conversation, oldest first (refusals and errors excluded). */
  readonly history: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly setting: AssistantSettingRow;
  /** The provider of the enabled setting (providerFor; never null here). */
  readonly provider: ModelProvider;
  readonly locale: "en" | "ar";
  readonly signal: AbortSignal;
}

/** What one turn produced; `dataItems` and `droppedSuggestions` feed the one log line (§9 logging rule 3). */
export type AnswerOutcome = { readonly dataItems: number; readonly droppedSuggestions: number } & (
  | { readonly kind: "refusal"; readonly refusalCode: RefusalCode }
  | { readonly kind: "no_sources" }
  | { readonly kind: "unavailable"; readonly errorCode: ProviderErrorCode; readonly latencyMs: number }
  | {
      readonly kind: "answer";
      /** Plain text, 1-8,000 characters (truncateText). */
      readonly content: string;
      /** At least one (§5: those the model cites, else every item given). */
      readonly citations: readonly Citation[];
      readonly suggestions: readonly SuggestionDraft[];
      readonly latencyMs: number;
    }
);

/** ADR-0059 §4 item 2: what the answer says when evidence files of other types were given by title only. */
export const UNREAD_FILES_NOTE = {
  en: "Only plain text and CSV evidence is read; other files are cited by title only.",
  ar: "تُقرأ أدلة النص العادي وCSV فقط؛ أما الملفات الأخرى فيُستشهد بها بعناوينها فقط. (ترجمة مؤقتة)",
} as const;

/** The seam: guardrails -> retrieval -> provider -> reply. */
export async function answer(input: AnswerInput): Promise<AnswerOutcome> {
  const refusal = classifyPrompt(input.prompt);
  if (refusal !== null) return { kind: "refusal", refusalCode: refusal, dataItems: 0, droppedSuggestions: 0 };

  const { items, unreadEvidenceFiles } = await retrieve(input);
  if (items.length === 0) return { kind: "no_sources", dataItems: 0, droppedSuggestions: 0 };

  const result = await input.provider.complete(buildModelRequest(input, items), input.signal);
  if (!result.ok)
    return {
      kind: "unavailable",
      errorCode: result.errorCode,
      latencyMs: result.latencyMs,
      dataItems: items.length,
      droppedSuggestions: 0,
    };

  const note = unreadEvidenceFiles ? `\n\n${input.locale === "ar" ? UNREAD_FILES_NOTE.ar : UNREAD_FILES_NOTE.en}` : "";
  const content = answerText(result.answer, 8000 - note.length);
  if (content === null)
    // An answer with no visible text is not an answer (§11: never an empty answer).
    return {
      kind: "unavailable",
      errorCode: "assistant.provider_response_invalid",
      latencyMs: result.latencyMs,
      dataItems: items.length,
      droppedSuggestions: result.suggestions.length,
    };
  const citations = citationsFor(items, result.citedRefs);
  const { kept, dropped } = filterSuggestions(
    result.suggestions,
    citations,
    input.conversation.transformationId !== null,
  );
  return {
    kind: "answer",
    content: `${content}${note}`,
    citations,
    suggestions: kept,
    latencyMs: result.latencyMs,
    dataItems: items.length,
    droppedSuggestions: dropped,
  };
}
