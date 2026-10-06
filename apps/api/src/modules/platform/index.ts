// platform: HTTP plumbing (ADR-0002). Depends on no other module.
export { HttpProblem, problems, type DenialInfo } from "./problem.ts";
export { mapDatabaseGuardError, pointerOfColumn, type PgErrorLike } from "./db-errors.ts";
export {
  assertNoInvalidCharacters,
  findInvalidCharacter,
  invalidCharacterProblem,
  parse,
  parseBody,
  parseQuery,
} from "./validation.ts";
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
  problemForError,
  registerPlatformHooks,
  sendProblem,
  type AuthzTracker,
  type PlatformOptions,
  type RouteAccess,
} from "./hooks.ts";
export {
  BAD_URL_DETAIL,
  clientErrorProblem,
  createClientErrorHandler,
  createFrameworkErrorHandler,
  frameworkProblem,
  type SecurityHeaders,
} from "./framework-errors.ts";
export {
  assertDecodableQuery,
  createJsonBodyParser,
  decodeUtf8Body,
  INVALID_QUERY_DETAIL,
  INVALID_UTF8_BODY_DETAIL,
  invalidQueryProblem,
  invalidUtf8BodyProblem,
  parseQueryString,
  undecodableQueryPointer,
  type JsonTextParser,
} from "./request-encoding.ts";
export {
  assertDeclaredMediaType,
  consumesOf,
  DEFAULT_CONSUMES,
  JSON_MEDIA_TYPE,
  mediaTypeEssence,
  OCTET_STREAM_MEDIA_TYPE,
  registerMediaTypeEnforcement,
  restrictParserTo,
  SUPPORTED_REQUEST_MEDIA_TYPES,
  undeclaredMediaTypeProblem,
  willParseBody,
} from "./media-types.ts";
export { registerHealthRoutes } from "./health.ts";
export type { ModuleDeps, ModuleRegistration } from "./deps.ts";
