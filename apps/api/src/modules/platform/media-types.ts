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

/**
 * The media type essence of a Content-Type header (RFC 9110 §8.3.1): the part before any parameter, trimmed and
 * lower-cased; "" when the header is absent or empty. Parameters (charset ...) never change the media type.
 */
export function mediaTypeEssence(contentType: string | string[] | undefined): string {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  if (value === undefined) return "";
  const semicolon = value.indexOf(";");
  return (semicolon === -1 ? value : value.slice(0, semicolon)).trim().toLowerCase();
}

/** The media types the request's route accepts. */
export function consumesOf(request: FastifyRequest): readonly string[] {
  return request.routeOptions.config?.consumes ?? DEFAULT_CONSUMES;
}

/** The declared 400 for a request media type the operation does not declare. */
export function undeclaredMediaTypeProblem(consumes: readonly string[]): HttpProblem {
  return problems.badRequest("validation.content_type", `Send the request body as ${consumes.join(" or ")}.`);
}

/** Throws the 400 problem when the request carries a body whose media type its route does not declare. */
export function assertDeclaredMediaType(request: FastifyRequest): void {
  if (request.is404 || !willParseBody(request)) return;
  const consumes = consumesOf(request);
  if (!consumes.includes(mediaTypeEssence(request.headers["content-type"]))) throw undeclaredMediaTypeProblem(consumes);
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
    try {
      assertDeclaredMediaType(request);
    } catch (err) {
      // The unread body is not drained: like Fastify's own parser errors, the connection closes after the response.
      reply.header("connection", "close");
      throw err;
    }
    return payload;
  });
}
