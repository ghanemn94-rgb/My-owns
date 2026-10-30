// The answer seam of postAssistantMessage (ADR-0059 §9 steps 3-5; p6-work-split §D.1, §D.2).
// T-DG6-BE-T ships this STUB: it retrieves nothing, calls no provider and always answers `no_sources` ("No record or
// playbook passage you can read matches this question. Nothing was sent to the model."). T-DG6-BE-U replaces the body
// of `answer` with guardrails (§8) -> retrieval (§4) -> provider (§2) -> reply (§5) and keeps this signature, which
// conversations.ts (BE-T) calls between its two transactions, outside any transaction (§2 rule 4).
import type { Db } from "@mth/db";
import type { Principal } from "../access/index.ts";
import type { AssistantSettingRow, Citation, ModelProvider, ProviderErrorCode } from "./provider.ts";

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

/** The seam. BE-T's stub: nothing retrieved, nothing sent to a model. */
export function answer(_input: AnswerInput): Promise<AnswerOutcome> {
  return Promise.resolve({ kind: "no_sources", dataItems: 0, droppedSuggestions: 0 });
}
