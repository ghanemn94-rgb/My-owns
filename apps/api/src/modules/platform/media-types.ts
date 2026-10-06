// F-DG2-320 (T-DG2-BE14): every operation accepts only the request media types its contract declares.
//
// Before: Fastify's built-in `text/plain` parser (which decodes with U+FFFD replacement) and the root `application/json`
// parser applied to every route, and the evidence `application/octet-stream` parser, registered on the root instance,
// applied to every route too. So `uploadEvidenceContent` (declared: octet-stream only) stored a chunked text/plain upload
// with its invalid bytes rewritten to U+FFFD (200, sha256 of the rewritten bytes), answered a JSON object or array with
// an undeclared 500 and stored a JSON string's decoded text; and a JSON operation accepted text/plain and octet-stream.
//
// Now, implemented once:
//   1. each route declares `config.consumes` (default `application/json`; the octet-stream operation declares its own),
//      checked at registration (non-empty, only media types that have a parser) - the contract test asserts that the
//      set equals the operation's declared `requestBody.content` for every operation;
//   2. one central `preParsing` hook refuses any other media type with the existing 400 `validation.content_type`,
//      BEFORE any body byte is read, parsed, handed to a handler or stored. It applies exactly when Fastify would run a
//      content-type parser (`willParseBody` mirrors fastify/lib/handleRequest.js), so bodiless requests behave as before:
//      GET/HEAD/TRACE are never checked, and a POST/PUT/PATCH/DELETE with no Content-Type and no body reaches its handler;
//   3. the parsers re-check the route's set (defence in depth), and the `text/plain` parser is removed: no operation
//      declares it.
// The 400 precedes authentication (401) exactly like the framework's own unknown-media-type refusal did, because body
// parsing runs before the preValidation authentication hook; rate limiting (onRequest) still applies first.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { problems, type HttpProblem } from "./problem.ts";

export const JSON_MEDIA_TYPE = "application/json";
export const OCTET_STREAM_MEDIA_TYPE = "application/octet-stream";

/** The request media types the API has parsers for (no operation declares any other one). */
export const SUPPORTED_REQUEST_MEDIA_TYPES: ReadonlySet<string> = new Set([JSON_MEDIA_TYPE, OCTET_STREAM_MEDIA_TYPE]);

/** A route that declares no `consumes` accepts JSON only (86 operations declare application/json bodies). */
export const DEFAULT_CONSUMES: readonly string[] = [JSON_MEDIA_TYPE];

declare module "fastify" {
  interface FastifyContextConfig {
    /**
     * F-DG2-320: the request media types the operation declares in docs/api/openapi.yaml (lower-case essences).
     * Default `["application/json"]`. Any other media type is refused with 400 `validation.content_type`.
     */
    consumes?: readonly string[];
  }
}

/** Methods for which Fastify never parses a body (fastify.js kSupportedHTTPMethods.bodyless). */
const BODYLESS_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "TRACE"]);

/**
 * True when Fastify will run a content-type parser for this request (mirrors fastify 5 lib/handleRequest.js): a
 * body-carrying method with a Content-Type header, or without one but with a Transfer-Encoding or a Content-Length
 * other than "0". Requests that Fastify hands straight to the handler are never refused here.
 */
export function willParseBody(request: Pick<FastifyRequest, "method" | "headers">): boolean {
  if (BODYLESS_METHODS.has(request.method)) return false;
  const headers = request.headers;
  if (headers["content-type"] !== undefined) return true;
  const contentLength = headers["content-length"];
  return headers["transfer-encoding"] !== undefined || !(contentLength === undefined || contentLength === "0");
}

// T-DG2-BE15 (F-DG2-350, F-DG2-351): ONE media-type decision per request, made in the central preParsing hook.
//   - The Content-Type is parsed per RFC 9110 §8.3.1 (`parseContentType`): field-value OWS at both ends is dropped
//     (§5.5), OWS (SP/HTAB) is allowed around every ";" (`parameters = *( OWS ";" OWS [ parameter ] )`), the essence is
//     the lower-cased `type/subtype`, parameter values are tokens or quoted-strings. Anything else is malformed and
//     refused. A request is accepted iff its essence is in the route's declared `consumes` (and, on application/json,
//     any charset parameter is UTF-8: see `parametersAcceptable`).
//   - An accepted request's header is rewritten to the canonical `essence[; name=value]...` before Fastify reads it
//     (handleRequest runs after preParsing), so Fastify's prefix lookup (lib/contentTypeParser.js getParser: exact key,
//     or the key followed by ";" or " ") always finds the declared parser: the check and the lookup can't disagree.
//   - An unmatched route (`request.is404`) never has its body parsed or refused: the Content-Type is removed so no
//     parser matches, Fastify hands the request straight to the not-found handler (404 not_found for every media type),
//     and the connection is closed after the response (the unread body is never drained into the server).

/** The parsed media type of a Content-Type field value. */
export interface ParsedMediaType {
  /** Lower-cased `type/subtype`. */
  readonly essence: string;
  /** Parameters in order: lower-cased name, the value as sent (a token or a quoted-string, quotes kept). */
  readonly parameters: ReadonlyArray<readonly [name: string, value: string]>;
}

const TCHAR = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]$/;
const isTchar = (c: string): boolean => TCHAR.test(c);
const isOws = (c: string): boolean => c === " " || c === "\t";
/** qdtext = HTAB / SP / %x21 / %x23-5B / %x5D-7E / obs-text (%x80-FF). */
function isQdtext(code: number): boolean {
  return (
    code === 0x09 ||
    code === 0x20 ||
    code === 0x21 ||
    (code >= 0x23 && code <= 0x5b) ||
    (code >= 0x5d && code <= 0x7e) ||
    (code >= 0x80 && code <= 0xff)
  );
}
/** The character after "\" in a quoted-pair: HTAB / SP / VCHAR / obs-text. */
function isQuotedPairChar(code: number): boolean {
  return code === 0x09 || (code >= 0x20 && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
}

/**
 * Parses one Content-Type field value per RFC 9110 §8.3.1 (media-type = type "/" subtype parameters). Returns null for
 * an absent, empty, multi-valued (a header array) or malformed value: a list ("a/b, c/d"), a wildcard is a token so
 * `*\/*` parses (and is then refused because no route declares it), whitespace inside `type/subtype`, a parameter with
 * no "=" or an empty name/value, an unterminated quoted-string, or trailing text.
 */
export function parseContentType(header: string | string[] | undefined): ParsedMediaType | null {
  if (header === undefined || Array.isArray(header)) return null;
  let i = 0;
  let end = header.length;
  while (i < end && isOws(header.charAt(i))) i++;
  while (end > i && isOws(header.charAt(end - 1))) end--;
  const token = (): string => {
    const from = i;
    while (i < end && isTchar(header.charAt(i))) i++;
    return header.slice(from, i);
  };
  const type = token();
  if (type === "" || header.charAt(i) !== "/") return null;
  i++;
  const subtype = token();
  if (subtype === "") return null;
  const parameters: Array<readonly [string, string]> = [];
  for (;;) {
    while (i < end && isOws(header.charAt(i))) i++;
    if (i === end) break;
    if (header.charAt(i) !== ";") return null;
    i++;
    while (i < end && isOws(header.charAt(i))) i++;
    if (i === end || header.charAt(i) === ";") continue; // an empty parameter ("a/b;" or "a/b;;c=d") is allowed
    const name = token();
    if (name === "" || header.charAt(i) !== "=") return null;
    i++;
    let value: string;
    if (header.charAt(i) === '"') {
      const from = i;
      i++;
      for (;;) {
        if (i >= end) return null; // unterminated quoted-string
        const code = header.charCodeAt(i);
        if (code === 0x22) break;
        if (code === 0x5c) {
          if (i + 1 >= end || !isQuotedPairChar(header.charCodeAt(i + 1))) return null;
          i += 2;
        } else if (isQdtext(code)) i++;
        else return null;
      }
      i++;
      value = header.slice(from, i);
    } else {
      value = token();
      if (value === "") return null;
    }
    parameters.push([name.toLowerCase(), value]);
  }
  return { essence: `${type}/${subtype}`.toLowerCase(), parameters };
}

/** A parameter value without its quoted-string quoting. */
export function unquoteParameterValue(value: string): string {
  return value.startsWith('"') ? value.slice(1, -1).replace(/\\(.)/gs, "$1") : value;
}

/** The canonical `essence[; name=value]...` form: Fastify's parser lookup matches it for every accepted spelling. */
export function canonicalContentType(parsed: ParsedMediaType): string {
  return [parsed.essence, ...parsed.parameters.map(([name, value]) => `${name}=${value}`)].join("; ");
}

/**
 * The parameter rule per media type. application/json: every `charset` parameter must be UTF-8 (case-insensitive,
 * quoted or not). RFC 8259 §8.1 requires UTF-8 for JSON exchanged between systems and §11 defines no charset parameter;
 * the API decodes JSON as strict UTF-8 whatever the header says, so a body declared in another charset is refused up
 * front instead of being silently read as UTF-8. application/octet-stream: parameters carry no meaning for the stored
 * bytes (never decoded), so any well-formed parameter is accepted.
 */
export function parametersAcceptable(parsed: ParsedMediaType): boolean {
  if (parsed.essence !== JSON_MEDIA_TYPE) return true;
  return parsed.parameters.every(
    ([name, value]) => name !== "charset" || unquoteParameterValue(value).toLowerCase() === "utf-8",
  );
}

/**
 * The media type essence of a Content-Type header: the lower-cased type/subtype; "" when the header is absent,
 * multi-valued or malformed (never a match for any declared media type).
 */
export function mediaTypeEssence(contentType: string | string[] | undefined): string {
  return parseContentType(contentType)?.essence ?? "";
}

/** Where a route's declared media types live (a Fastify request, or a minimal stand-in in unit tests). */
export interface RouteConsumesSource {
  readonly routeOptions: { readonly config?: { readonly consumes?: readonly string[] } | undefined };
}

/** The media types the request's route accepts. */
export function consumesOf(request: RouteConsumesSource): readonly string[] {
  return request.routeOptions.config?.consumes ?? DEFAULT_CONSUMES;
}

/** The declared 400 for a request media type the operation does not declare. */
export function undeclaredMediaTypeProblem(consumes: readonly string[]): HttpProblem {
  return problems.badRequest("validation.content_type", `Send the request body as ${consumes.join(" or ")}.`);
}

/** The outcome of the one media-type decision for a request. */
export type MediaTypeDecision =
  | { readonly kind: "no-body" }
  | { readonly kind: "unmatched-route" }
  | { readonly kind: "accept"; readonly contentType: string }
  | { readonly kind: "refuse"; readonly problem: HttpProblem };

/** The one media-type decision (pure): see the header comment. */
export function decideMediaType(
  request: Pick<FastifyRequest, "method" | "headers" | "is404"> & RouteConsumesSource,
): MediaTypeDecision {
  if (!willParseBody(request)) return { kind: "no-body" };
  if (request.is404) return { kind: "unmatched-route" };
  const consumes = consumesOf(request);
  const parsed = parseContentType(request.headers["content-type"]);
  if (parsed === null || !consumes.includes(parsed.essence) || !parametersAcceptable(parsed))
    return { kind: "refuse", problem: undeclaredMediaTypeProblem(consumes) };
  return { kind: "accept", contentType: canonicalContentType(parsed) };
}

/**
 * Applies the decision to the request: throws the 400 problem on a refusal, rewrites an accepted header to its canonical
 * form, and removes the Content-Type of an unmatched route so no parser runs. Returns the decision.
 */
export function assertDeclaredMediaType(request: FastifyRequest): MediaTypeDecision {
  const decision = decideMediaType(request);
  // request.headers is the raw IncomingMessage header object (Fastify's getter returns it when no additional headers
  // were set), which handleRequest reads after preParsing to pick the parser.
  const headers = request.raw.headers;
  if (decision.kind === "refuse") throw decision.problem;
  if (decision.kind === "accept") headers["content-type"] = decision.contentType;
  if (decision.kind === "unmatched-route") delete headers["content-type"];
  return decision;
}

/** A content-type parser that first re-checks that its media type is one the route declares (defence in depth). */
export function restrictParserTo<Body>(
  mediaType: string,
  parser: (request: FastifyRequest, body: Body, done: (err: Error | null, value?: unknown) => void) => void,
): (request: FastifyRequest, body: Body, done: (err: Error | null, value?: unknown) => void) => void {
  return (request, body, done) => {
    const consumes = consumesOf(request);
    if (!consumes.includes(mediaType)) {
      done(undeclaredMediaTypeProblem(consumes));
      return;
    }
    parser(request, body, done);
  };
}

/** Throws at registration when a route declares an empty or unsupported `consumes` set. */
export function assertValidConsumes(method: string, url: string, consumes: unknown): void {
  if (consumes === undefined) return;
  const valid =
    Array.isArray(consumes) &&
    consumes.length > 0 &&
    consumes.every((t) => typeof t === "string" && SUPPORTED_REQUEST_MEDIA_TYPES.has(t));
  if (!valid)
    throw new Error(
      `route ${method} ${url} declares config.consumes ${JSON.stringify(consumes)}; expected a non-empty subset of ` +
        `${[...SUPPORTED_REQUEST_MEDIA_TYPES].join(", ")}; refusing to start`,
    );
}

/**
 * Registers the central media-type enforcement on the root instance: the registration check, the preParsing refusal
 * and the removal of Fastify's built-in text/plain parser. Call before any route is registered.
 */
export function registerMediaTypeEnforcement(app: FastifyInstance): void {
  app.removeContentTypeParser("text/plain");
  app.addHook("onRoute", (route) => {
    assertValidConsumes([route.method].flat().join(","), route.url, route.config?.consumes);
  });
  // preParsing runs after onRequest (request IDs, rate limiting) and before Fastify reads or parses any body byte.
  app.addHook("preParsing", async (request, reply, payload) => {
    let decision: MediaTypeDecision;
    try {
      decision = assertDeclaredMediaType(request);
    } catch (err) {
      // The unread body is not drained: like Fastify's own parser errors, the connection closes after the response.
      reply.header("connection", "close");
      throw err;
    }
    // An unmatched route's body is never read (whatever its size: bodyLimit does not apply to a body nobody reads);
    // close the connection after the 404 instead of draining it.
    if (decision.kind === "unmatched-route") reply.header("connection", "close");
    return payload;
  });
}
