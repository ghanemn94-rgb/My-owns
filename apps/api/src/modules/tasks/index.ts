// tasks (P4; ADR-0025 §4; p4-work-split §I+C.1, T-DG4-BE-A): My Work items and the in-app inbox. A leaf business module:
// domain modules create items only through createWorkItemOnce (S-13) and never insert into work_item themselves.
// Items store an i18n key and parameters, never a sentence (S-6). P4 has no email or messaging channel.
//
// Public interface:
//  - registerTasksModule: wiring hook called by the composition root (server.ts);
//  - createWorkItemOnce / closeWorkItemsOfSubject: the creation and system-close services (ADR-0025 §4);
//  - SYSTEM_MANAGED_KINDS, toWorkItem, toInboxNotification.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerTaskRoutes } from "./routes.ts";

export {
  closeWorkItemsOfSubject,
  createWorkItemOnce,
  type MessageParamValue,
  type WorkItemInput,
  type WorkItemOnceResult,
} from "./service.ts";
export { SYSTEM_MANAGED_KINDS, taskRefusals, toInboxNotification, toWorkItem } from "./routes.ts";

/** Wiring hook called by the composition root (server.ts). */
export function registerTasksModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = registerTaskRoutes(app, deps);
  return Object.freeze({ module: "tasks", status: "active", deliversIn: "P4", routes: Object.freeze(routes) });
}
