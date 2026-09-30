// @mth/api public surface. The process entry point is ./main.ts (`node dist/main.js`); importing this module never
// starts a server. Module boundaries are fixed in ./modules.ts (ADR-0002) and enforced by the architecture test.
export { API_MODULES, P1_MODULES, type ApiModule } from "./modules.ts";
export { buildServer, defaultWebRoot, JSON_BODY_LIMIT_BYTES, type RouteRecord, type ServerOptions } from "./server.ts";
export { OidcService } from "./modules/identity/index.ts";

export const API_BASE_PATH = "/api/v1";
