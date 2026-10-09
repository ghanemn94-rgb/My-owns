// platform: HTTP plumbing (ADR-0002). Depends on no other module.
export { HttpProblem, problems, type DenialInfo } from "./problem.ts";
export {
  DependencyCycleProblem,
  mapDatabaseGuardError,
  pointerOfColumn,
  type CycleNode,
  type PgErrorLike,
} from "./db-errors.ts";
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
  incompleteBodyProblem,
  isIncompleteBodyError,
  isValidAccess,
  problemForError,
  registerNotFoundHandler,
  registerPlatformHooks,
  sendProblem,
  type AuthzTracker,
  type ErrorRequestSource,
  type NotFoundOptions,
  type PlatformOptions,
  type RawBodyState,
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
  canonicalContentType,
  consumesOf,
  contentTypeFieldLines,
  decideMediaType,
  DEFAULT_CONSUMES,
  JSON_MEDIA_TYPE,
  mediaTypeEssence,
  OCTET_STREAM_MEDIA_TYPE,
  parametersAcceptable,
  parseContentType,
  registerMediaTypeEnforcement,
  restrictParserTo,
  SUPPORTED_REQUEST_MEDIA_TYPES,
  undeclaredMediaTypeProblem,
  unquoteParameterValue,
  willParseBody,
  type MediaTypeDecision,
  type ParsedMediaType,
  type RouteConsumesSource,
} from "./media-types.ts";
export {
  bodyUnconsumed,
  closeIfBodyUnconsumed,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_GRACE_MS,
  LINGER_CAP_MS,
  lingerOnClose,
  registerConnectionHygiene,
  RST_AVOIDANCE_DELAY_MS,
  type ConnectionHygieneOptions,
} from "./connection-hygiene.ts";
export { registerHealthRoutes } from "./health.ts";
export { createInFlight, registerInFlightTracking, type InFlight } from "./in-flight.ts";
export type { ModuleDeps, ModuleRegistration } from "./deps.ts";
export { ADVISORY_LOCK_CLASSES, type AdvisoryLockClassName } from "./advisory-locks.ts";
// P4 slice H (T-DG4-BE-L; ADR-0036 §6): the material-change port kpi calls and workflows implements (server.ts wires it).
export {
  materialChangePort,
  setMaterialChangePort,
  type BenefitFormulaVersionChange,
  type MaterialChangePort,
} from "./material-change.ts";
