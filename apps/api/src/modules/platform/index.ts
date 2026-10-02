// platform: HTTP plumbing (ADR-0002). Depends on no other module.
export { HttpProblem, problems, type DenialInfo } from "./problem.ts";
export { mapDatabaseGuardError, pointerOfColumn, type PgErrorLike } from "./db-errors.ts";
export { parse, parseBody, parseQuery } from "./validation.ts";
export { etag, iso, isoOrNull, requireIfMatch, sendVersioned } from "./http.ts";
export {
  canonicalJson,
  cursorSchema,
  decodeCursor,
  encodeCursor,
  filterHash,
  limitSchema,
  paginate,
} from "./cursor.ts";
export {
  IDEMPOTENCY_TTL_HOURS,
  idempotencyKeySchema,
  requestHash,
  withIdempotency,
  type StoredResponse,
} from "./idempotency.ts";
export {
  genReqId,
  isValidAccess,
  registerPlatformHooks,
  sendProblem,
  type AuthzTracker,
  type PlatformOptions,
  type RouteAccess,
} from "./hooks.ts";
export { registerHealthRoutes } from "./health.ts";
export type { ModuleDeps, ModuleRegistration } from "./deps.ts";
