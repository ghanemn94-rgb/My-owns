// The optional assistant's web seams (T-DG6-FE-E; p6-work-split §D.3; ADR-0059): the request paths of the nine
// `assistant` operations (operationId in the comment), their query keys under ["p6", "assistant", …], the read hooks,
// the response shapes (mirrors of docs/api/openapi.yaml `Assistant*`; no @mth/shared mirror exists at this revision),
// and the record links of the citation chips.
//
// Off means hidden (ADR-0059 §3, §11): `useAssistantAvailability` answers "on" only when the server says the assistant
// is on for the caller. It reads `assistantEnabled` from listAssistantConversations (limit 1; assistant.use, every role
// except AUD), never the admin setting read (getAssistantSetting needs assistant.configure or operations.read, so an
// ordinary user got 403 there and never saw the panel: QA-B D2, repaired by T-DG6-BE-X5). A failed or pending read is
// "unknown" and the panel is not shown: never "On" by guess.
import { useQuery } from "@tanstack/react-query";
import { api, apiRequest, ApiError } from "../../api/client.ts";
import { shouldRetry } from "../../api/queries.ts";
import type { Me } from "../../api/types.ts";
import { canAnywhere } from "../../auth/permissions.ts";

// ------------------------------------------------------------------------------------------------ shapes (openapi)
export type AssistantProviderKind = "http_endpoint" | "test_adapter";

export interface SecretRef {
  readonly provider: string;
  readonly name: string;
}

export interface AssistantSetting {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly providerKind: AssistantProviderKind | null;
  readonly endpointUrl: string | null;
  readonly apiStyle: "openai_chat_completions" | null;
  readonly modelName: string | null;
  readonly credentialRef: SecretRef | null;
  readonly authorizationReference: string | null;
  readonly requestTimeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxContextRecords: number;
  readonly enabledAt: string | null;
  readonly enabledBy: string | null;
  readonly telemetryEnabled: false;
  readonly reason: string | null;
  readonly version: number;
  readonly updatedAt: string | null;
}

export interface AssistantSettingUpdate {
  readonly providerKind: AssistantProviderKind | null;
  readonly endpointUrl: string | null;
  readonly apiStyle: "openai_chat_completions" | null;
  readonly modelName: string | null;
  readonly credentialRef: SecretRef | null;
  readonly authorizationReference: string | null;
  readonly requestTimeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxContextRecords: number;
  readonly reason: string;
}

export const SEARCH_RECORD_TYPES = [
  "transformation",
  "initiative",
  "kpi_definition",
  "benefit",
  "raid_entry",
  "dependency",
  "decision",
  "deliverable",
  "evidence",
  "business_case",
  "lesson",
  "change_request",
] as const;
export type SearchRecordType = (typeof SEARCH_RECORD_TYPES)[number];

export interface AssistantRecordCitation {
  readonly source: "record";
  readonly recordType: SearchRecordType;
  readonly recordId: string;
  readonly recordVersion: number;
  readonly readable: boolean;
}

export interface AssistantPlaybookCitation {
  readonly source: "playbook";
  readonly blockRef: string;
  readonly playbookVersion: "1.0";
}

export type AssistantCitation = AssistantRecordCitation | AssistantPlaybookCitation;

export interface AssistantConversation {
  readonly id: string;
  readonly organizationId: string;
  readonly ownerUserId: string;
  readonly transformationId: string | null;
  readonly title: string;
  readonly messageCount: number;
  readonly awaitingReply: boolean;
  readonly lastMessageAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AssistantConversationPage {
  readonly items: readonly AssistantConversation[];
  readonly nextCursor: string | null;
  /** Whether the assistant is on for the caller now (the only setting information a user receives; T-DG6-BE-X5). */
  readonly assistantEnabled: boolean;
}

export const REPLY_KINDS = ["answer", "refusal", "no_sources", "unavailable", "interrupted"] as const;
export type AssistantReplyKind = (typeof REPLY_KINDS)[number];
export const REFUSAL_CODES = [
  "assistant.refused.approval",
  "assistant.refused.benefit_validation",
  "assistant.refused.value_change",
  "assistant.refused.evidence",
] as const;
export type AssistantRefusalCode = (typeof REFUSAL_CODES)[number];
export const PROVIDER_ERROR_CODES = [
  "assistant.provider_timeout",
  "assistant.provider_unreachable",
  "assistant.provider_error",
  "assistant.provider_response_invalid",
] as const;

export interface AssistantMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly author: "user" | "assistant";
  readonly label: "user_prompt" | "assistant_suggestion";
  readonly replyKind: AssistantReplyKind | null;
  readonly refusalCode: AssistantRefusalCode | null;
  readonly errorCode: string | null;
  readonly content: string | null;
  readonly contentWithheld: boolean;
  readonly citations: readonly AssistantCitation[];
  readonly providerKind: AssistantProviderKind | null;
  readonly modelName: string | null;
  readonly settingVersion: number | null;
  readonly latencyMs: number | null;
  readonly createdAt: string;
}

export const SUGGESTION_KINDS = [
  "charter_draft",
  "decision_brief_draft",
  "recovery_action",
  "missing_evidence",
] as const;
export type AssistantSuggestionKind = (typeof SUGGESTION_KINDS)[number];

export interface AssistantSuggestion {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly transformationId: string;
  readonly ordinal: number;
  readonly kind: AssistantSuggestionKind;
  readonly label: "assistant_suggestion";
  readonly targetRecordType: "charter" | "T16" | null;
  readonly fields: Readonly<Record<string, string>> | null;
  readonly textContent: string | null;
  readonly contentWithheld: boolean;
  readonly citations: readonly AssistantCitation[];
  readonly status: "proposed" | "taken_to_draft";
  readonly takenAt: string | null;
  readonly version: number;
  readonly createdAt: string;
}

export interface AssistantConversationDetail {
  readonly conversation: AssistantConversation;
  readonly messages: readonly AssistantMessage[];
  readonly suggestions: readonly AssistantSuggestion[];
}

export interface AssistantMessagePostResult {
  readonly conversation: AssistantConversation;
  readonly userMessage: AssistantMessage;
  readonly reply: AssistantMessage;
  readonly suggestions: readonly AssistantSuggestion[];
}

export interface FormDraftCreate {
  readonly recordType: string;
  readonly recordId?: string | null;
  readonly baseRecordVersion?: number | null;
  readonly payload: Record<string, unknown>;
}

export interface AssistantTakeToDraftResult {
  readonly suggestion: AssistantSuggestion;
  readonly transformationId: string;
  readonly draft: FormDraftCreate;
}

/** The P5 form draft as `createFormDraft` returns it (only the fields this panel reads). */
export interface CreatedFormDraft {
  readonly id: string;
  readonly recordType: string;
  readonly recordId: string | null;
  readonly version: number;
}

// ------------------------------------------------------------------------------------------------ paths and keys
const v1 = "/api/v1";
const seg = encodeURIComponent;
export const assistantPaths = {
  setting: `${v1}/admin/assistant`, // getAssistantSetting, putAssistantSetting
  enable: `${v1}/admin/assistant/enable`, // enableAssistant
  disable: `${v1}/admin/assistant/disable`, // disableAssistant
  conversations: `${v1}/assistant/conversations`, // listAssistantConversations, createAssistantConversation
  conversation: (id: string) => `${v1}/assistant/conversations/${seg(id)}`, // getAssistantConversation
  messages: (id: string) => `${v1}/assistant/conversations/${seg(id)}/messages`, // postAssistantMessage
  toDraft: (suggestionId: string) => `${v1}/assistant/suggestions/${seg(suggestionId)}/to-draft`, // takeAssistantSuggestionToDraft
  /** The P5 createFormDraft of the suggestion's transformation (ADR-0041 §5): the human's own session creates the draft. */
  formDrafts: (tid: string) => `${v1}/transformations/${seg(tid)}/form-drafts`,
};

export const assistantKeys = {
  all: ["p6", "assistant"] as const,
  setting: ["p6", "assistant", "setting"] as const,
  /** Under `setting`, so every invalidation of the setting (the admin screen's toggles, the panel) refreshes it too. */
  availability: ["p6", "assistant", "setting", "availability"] as const,
  conversations: (transformationId: string | null) =>
    ["p6", "assistant", "conversations", transformationId ?? ""] as const,
  conversation: (id: string) => ["p6", "assistant", "conversation", id] as const,
};

// ------------------------------------------------------------------------------------------------ reads
/** The setting with its ETag version (ETag "0" when no row exists). */
export async function readAssistantSetting(): Promise<AssistantSetting> {
  const r = await apiRequest<AssistantSetting>(assistantPaths.setting);
  return r.data;
}

export function useAssistantSetting(enabled = true) {
  return useQuery({
    queryKey: assistantKeys.setting,
    queryFn: readAssistantSetting,
    enabled,
    retry: shouldRetry,
  });
}

/** Whether the caller may use the assistant at all (assistant.use; AUD and roles without it never see the panel). */
export function canUseAssistant(me: Me | undefined): boolean {
  return canAnywhere(me, "assistant.use");
}

export type AssistantAvailability = "on" | "off" | "unknown";

/**
 * "on" only when the availability read answers `assistantEnabled: true`. While pending or on a failure (including a
 * 403) it is "unknown"; with `assistantEnabled: false` it is "off". The panel shows only for "on".
 */
export function availabilityOf(query: {
  readonly data?: Pick<AssistantConversationPage, "assistantEnabled"> | undefined;
  readonly error?: unknown;
}): AssistantAvailability {
  if (query.data) return query.data.assistantEnabled === true ? "on" : "off";
  return "unknown";
}

/** The availability read: one page of one of the caller's own conversations, for its `assistantEnabled` flag. */
export function readAssistantAvailability(): Promise<AssistantConversationPage> {
  return api.get<AssistantConversationPage>(assistantPaths.conversations, { limit: 1 });
}

export function useAssistantAvailability(me: Me | undefined): AssistantAvailability {
  const may = canUseAssistant(me);
  const q = useQuery({
    queryKey: assistantKeys.availability,
    queryFn: readAssistantAvailability,
    enabled: may,
    retry: shouldRetry,
  });
  if (!may) return "off";
  return availabilityOf(q);
}

export function useAssistantConversations(transformationId: string | null, enabled = true) {
  return useQuery({
    queryKey: assistantKeys.conversations(transformationId),
    queryFn: () =>
      api.get<AssistantConversationPage>(assistantPaths.conversations, {
        limit: 20,
        ...(transformationId ? { transformationId } : {}),
      }),
    enabled,
    retry: shouldRetry,
  });
}

export function useAssistantConversation(id: string | null) {
  return useQuery({
    queryKey: assistantKeys.conversation(id ?? ""),
    queryFn: () => api.get<AssistantConversationDetail>(assistantPaths.conversation(id!)),
    enabled: id !== null,
    retry: shouldRetry,
  });
}

/** True for the 422 `assistant.disabled` answer (the assistant was turned off since the panel opened). */
export function isAssistantDisabledError(err: unknown): boolean {
  return err instanceof ApiError && err.code === "assistant.disabled";
}

// ------------------------------------------------------------------------------------------------ citation links
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCK_REF = /^B0[0-9]{3}$/;

/**
 * The screen of a cited record, or null when the product has no screen for it that this panel can address (a record
 * nested in a transformation needs the conversation's focus transformation; retrieval is limited to that focus when
 * it is set, ADR-0059 §4 item 1). A citation that is no longer readable never links.
 */
export function citationHref(citation: AssistantCitation, focusTransformationId: string | null): string | null {
  if (citation.source === "playbook")
    return BLOCK_REF.test(citation.blockRef) ? `/playbook/reader/${citation.blockRef}` : null;
  if (!citation.readable || !UUID.test(citation.recordId)) return null;
  const rid = citation.recordId;
  if (citation.recordType === "transformation") return `/transformations/${rid}`;
  const tid = focusTransformationId && UUID.test(focusTransformationId) ? focusTransformationId : null;
  if (!tid) return null;
  const base = `/transformations/${tid}`;
  switch (citation.recordType) {
    case "initiative":
      return `${base}/initiatives/${rid}`;
    case "kpi_definition":
      return `${base}/kpis/${rid}`;
    case "benefit":
      return `${base}/benefits/${rid}`;
    case "business_case":
      return `${base}/business-cases/${rid}`;
    case "change_request":
      return `${base}/change-requests/${rid}`;
    // No detail screen per record: the register of the focus transformation, where the record is listed.
    case "raid_entry":
      return `${base}/raid`;
    case "dependency":
      return `${base}/dependencies`;
    case "decision":
      return `${base}/decisions`;
    case "evidence":
      return `${base}/evidence`;
    case "lesson":
      return `${base}/lessons`;
    default:
      return null;
  }
}

/** The editor screen where a draft of the target record type is edited, saved and submitted by a person. */
export function draftEditorHref(targetRecordType: "charter" | "T16", transformationId: string): string {
  const base = `/transformations/${seg(transformationId)}`;
  return targetRecordType === "charter" ? `${base}/charter` : `${base}/executive-decisions`;
}
