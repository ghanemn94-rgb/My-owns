// Route registration of the forms module (P5 slice B; p5-work-split §B.2-§B.4). T-DG5-BE-D fills the first two route
// files (schema reads, custom-field values); BE-E and BE-E2 add their own lines below, sequentially (§B.6).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerCustomValueRoutes } from "./custom-values.ts";
import { registerFormsKindProvider } from "./provider.ts";
import { registerFormSchemaReadRoutes } from "./schema-reads.ts";

/** Registers the forms routes and returns them as "METHOD /path". */
export function registerFormRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  // The form_schema kind's provider hooks into methodology's registry (ADR-0041 §2; T-DG5-BE-D).
  registerFormsKindProvider();
  return [
    ...registerFormSchemaReadRoutes(app, deps), // T-DG5-BE-D: listFormRecordTypes, getFormSchemaAdmin, getTransformationFormSchema
    ...registerCustomValueRoutes(app, deps), // T-DG5-BE-D: getFormRecordCustomFields, putFormRecordCustomFields
    // BE-E (history, comments, attachments) and BE-E2 (export, bulk, drafts) register here.
  ];
}
