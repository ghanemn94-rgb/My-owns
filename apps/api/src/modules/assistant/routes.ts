// The assistant's routes (ADR-0059 §3, §9, §10; p6-work-split §D.1; T-DG6-BE-T): the setting (Administration > AI
// assistant) and the conversations. BE-U adds takeAssistantSuggestionToDraft (suggestions.ts) on its own line below.
// The assistant is OFF unless an administrator saved and enabled a setting; nothing here makes a network call while it
// is off, and nothing here writes outside the assistant's own tables and their audit events.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerAssistantConversationRoutes } from "./conversations.ts";
import { registerAssistantSettingRoutes } from "./settings.ts";
import { registerAssistantSuggestionRoutes } from "./suggestions.ts";

/** Registers this module's routes and returns them as "METHOD /path". */
export function registerAssistantRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  return [
    ...registerAssistantSettingRoutes(app, deps), // BE-T: the setting (§3)
    ...registerAssistantConversationRoutes(app, deps), // BE-T: conversations and messages (§9)
    ...registerAssistantSuggestionRoutes(app, deps), // BE-U: takeAssistantSuggestionToDraft (§6)
  ];
}
