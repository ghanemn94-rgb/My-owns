// @mth/api skeleton (T-DG1-ARCH-01). backend-workflow-engineer replaces the body with the Fastify bootstrap:
// load config (@mth/config) -> create pg pool (@mth/db) -> register platform plugins -> register P1 modules ->
// serve the web bundle -> listen. Module boundaries are fixed in ./modules.ts (ADR-0002).
export { API_MODULES, P1_MODULES, type ApiModule } from "./modules.ts";

export const API_BASE_PATH = "/api/v1";
