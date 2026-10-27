// P6 operations without a route yet, owned by backend task T-DG6-BE-T (slice D: the assistant setting and the
// conversation routes; ADR-0059 §2, §3, §9) (docs/architecture/p6-work-split.md §D). Remove an entry in the same change
// that registers its route and exercises it in the contract test. Must be empty when the DG6 candidate freezes. Only the
// owning task edits this file.
export const P6_PENDING_BE_T: readonly string[] = [
  "getAssistantSetting",
  "putAssistantSetting",
  "enableAssistant",
  "disableAssistant",
  "listAssistantConversations",
  "createAssistantConversation",
  "getAssistantConversation",
  "postAssistantMessage",
];
