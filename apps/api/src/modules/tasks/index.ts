// tasks (P4; ADR-0025 §4; p4-work-split §I+C.1, T-DG4-BE-A): My Work items and the in-app inbox. A leaf business module:
// domain modules create items only through createWorkItemOnce (S-13) and never insert into work_item themselves.
// Items store an i18n key and parameters, never a sentence (S-6). P4 has no email or messaging channel.
//
// Public interface:
//  - registerTasksModule: wiring hook called by the composition root (server.ts);
//  - createWorkItemOnce / closeWorkItemsOfSubject: the creation and system-close services (ADR-0025 §4);
//  - rescheduleWorkItemsOfSubject / reassignWorkItemOfSubject: an item follows its source's due date and owner
//    (T-DG4-BE-R1; D-102, D-105);
//  - SYSTEM_MANAGED_KINDS, toWorkItem, toInboxNotification.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { registerTaskRoutes } from "./routes.ts";

export {
  closeWorkItemsOfSubject,
  createWorkItemOnce,
  reassignWorkItemOfSubject,
  rescheduleWorkItemsOfSubject,
  type MessageParamValue,
  type WorkItemInput,
  type WorkItemOnceResult,
  type WorkItemReassignResult,
  type WorkItemSourceRef,
} from "./service.ts";
export { SYSTEM_MANAGED_KINDS, taskRefusals, toInboxNotification, toWorkItem } from "./routes.ts";
// T-DG4-KBE-G2 (ADR-0037 §1 item 2, §7, §9): the open work items of one user, read-only (My Work, the header).
export { loadOpenWorkItems, type OpenWorkItemFact } from "./dashboard-facts.ts";

/** Wiring hook called by the composition root (server.ts). */
export function registerTasksModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = registerTaskRoutes(app, deps);
  return Object.freeze({ module: "tasks", status: "active", deliversIn: "P4", routes: Object.freeze(routes) });
}
