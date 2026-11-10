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
//   6. the generation context (§5, §9 amendment of 2026-11-10; F-DG6-920): the record keys of EVERY record item given
//      to the model, cited or not, stored beside the citations (0128 `context_records`) so the read-time re-check
//      covers every record the answer was generated from, not only those the model chose to cite.
//   7. the inherited context (§5, §9 RG2 addendum; F-DG6-960/970/980): the history given to the model holds earlier
//      answers, so the stored context also lists every record each of THOSE was generated from (their context, or for
//      a row stored before 0128 their record citations; conversations.ts historyFor). A later revocation of any of them
//      then withholds this answer too. The history itself was already re-checked for the caller before it was given.
// The model's output is text: it is never interpreted as a command, and nothing here writes (§7).
import type { Db } from "@mth/db";
import type { Principal } from "../access/index.ts";
import { answerText, citationsFor, classifyPrompt, filterSuggestions } from "./guardrails.ts";
import { buildModelRequest } from "./prompt.ts";
import type { AssistantSettingRow, Citation, ModelProvider, ProviderErrorCode, QuotedItem } from "./provider.ts";
import { retrieve } from "./retrieval.ts";

export type RefusalCode =
  | "assistant.refused.approval"
  | "assistant.refused.benefit_validation"
  | "assistant.refused.value_change"
  | "assistant.refused.evidence";

/** The key of one record given to the model (0128 `p6_assistant_context_records_valid`): no version, no text. */
export interface ContextRecord {
  readonly recordType: Extract<Citation, { source: "record" }>["recordType"];
  readonly recordId: string;
}

/**
 * The most record keys one stored generation context holds (0129 `p6_assistant_context_records_valid`). It is the
 * bound of the union, so a context is never truncated: a conversation holds at most 100 messages, hence at most 50
 * answers, each given at most 20 record items (0111 `max_context_records` <= 20), and an answer's context is the union
 * of its own data block and the contexts of the earlier answers of the SAME conversation it was given as history
 * (transitively), so it never exceeds 50 x 20 = 1,000 keys. conversations.ts historyFor still drops a history answer
 * whose context would not fit beside a full data block (fail closed: the model is not given it), so the bound holds
 * even if those limits change.
 */
export const CONTEXT_RECORDS_MAX = 1000;

/** §5/§9 (F-DG6-920): the distinct record keys of every record item given to the model, in the order given. */
export function contextRecordsOf(items: readonly QuotedItem[]): ContextRecord[] {
  return mergeContextRecords(
    items.flatMap(({ citation: c }) =>
      c.source === "record" ? [{ recordType: c.recordType, recordId: c.recordId }] : [],
    ),
  );
}

/** The distinct record keys of `lists`, in order (first occurrence kept). */
export function mergeContextRecords(...lists: readonly (readonly ContextRecord[])[]): ContextRecord[] {
  const seen = new Set<string>();
  const out: ContextRecord[] = [];
  for (const list of lists)
    for (const r of list) {
      const key = `${r.recordType}:${r.recordId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ recordType: r.recordType, recordId: r.recordId });
    }
  return out;
}

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
  /**
   * Every record the earlier answers in `history` were generated from (F-DG6-960/970/980; conversations.ts
   * historyFor): inherited into this answer's stored context.
   */
  readonly historyContext: readonly ContextRecord[];
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
      /**
       * Every record the answer was generated from: each record item given to the model, cited or not (F-DG6-920),
       * then the inherited context of the history answers given (F-DG6-960/970/980). A superset of the record
       * citations; at most CONTEXT_RECORDS_MAX keys.
       */
      readonly contextRecords: readonly ContextRecord[];
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
    contextRecords: mergeContextRecords(contextRecordsOf(items), input.historyContext),
    suggestions: kept,
    latencyMs: result.latencyMs,
    dataItems: items.length,
    droppedSuggestions: dropped,
  };
}
