// F-DG2-290 (T-DG2-BE13): client bytes become text only through a strict UTF-8 decoder. Ill-formed input is the
// declared 400 ValidationError; it is never rewritten to U+FFFD, and it never reaches a handler as raw percent text
// that the client meant to be decoded. This is the byte-level counterpart of F-DG2-260 (lone surrogates in JSON
// escapes) and F-DG2-231 (U+0000).
//
//   1. JSON bodies: Fastify's default `application/json` parser reads the body with `setEncoding('utf8')`, so invalid
//      bytes became U+FFFD. With a Content-Length the decoded byte count then no longer matched and Fastify raised
//      FST_ERR_CTP_INVALID_CONTENT_LENGTH (unmapped -> 500 internal); chunked, the replaced text was stored. The parser
//      below receives the raw Buffer (`parseAs: "buffer"`, so the length check compares raw bytes) and decodes it with
//      `TextDecoder("utf-8", { fatal: true })`. A decode failure is 400 `validation.json` at pointer "": RFC 8259 §8.1
//      requires JSON exchanged between systems to be UTF-8, so a body that is not UTF-8 is not a JSON text - the same
//      classification and code as every other undecodable body (invalid or empty JSON). `validation.invalid_character`
//      stays reserved for a decoded U+0000/lone surrogate at a field pointer, which this failure has no field for.
//      One leading UTF-8 byte order mark (EF BB BF) is accepted and stripped (RFC 8259 §8.1 lets a parser ignore it;
//      the default parser stripped one too); a second U+FEFF is not JSON whitespace, so it stays invalid JSON.
//   2. Query strings: Fastify's default parser (fast-querystring) keeps an undecodable value as its raw percent text
//      (`?q=%FF` reached the handler as the literal "%FF", CESU-8 `%ED%A0%80` likewise). `parseQueryString` keeps the
//      same object shape but records the first undecodable component; the central preHandler check answers 400
//      `validation.format` at `/query/<key>` (`/query` when the key itself is undecodable) (the path's FST_ERR_BAD_URL code), after authentication and CSRF.
//      Routes that reject such input in their own declared form (`invalidCharacters: "route"`, the OIDC callback's
//      302) still receive the raw-text fallback and keep their behaviour.
import type { FastifyRequest } from "fastify";
import { problems, type HttpProblem } from "./problem.ts";

/** The leading UTF-8 byte order mark, once decoded. */
const BOM = 0xfeff;

export const INVALID_UTF8_BODY_DETAIL = "The request body is not valid UTF-8 JSON.";
export const INVALID_QUERY_DETAIL = "The query string contains an invalid percent-encoding.";

/**
 * Strict UTF-8 decoding of a request body. Returns null for any ill-formed sequence (invalid or truncated bytes,
 * overlong forms, CESU-8 surrogates). One leading BOM is stripped. A fresh decoder per call: `fatal` decoders are not
 * shared across requests, so a failed decode can never leave state behind.
 */
export function decodeUtf8Body(body: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    return text.charCodeAt(0) === BOM ? text.slice(1) : text;
  } catch {
    return null;
  }
}

/** The 400 problem for a JSON body that is not valid UTF-8. */
export function invalidUtf8BodyProblem(): HttpProblem {
  return problems.badRequest("validation.json", INVALID_UTF8_BODY_DETAIL);
}

/** Fastify's default JSON parse step (secure-json-parse with prototype-poisoning protection) for a decoded string. */
export type JsonTextParser = (
  request: FastifyRequest,
  body: string,
  done: (err: Error | null, value?: unknown) => void,
) => void;

/**
 * The `application/json` content-type parser (register with `parseAs: "buffer"`). Decodes strictly, then hands the
 * text to Fastify's default JSON parser, so empty-body and invalid-JSON errors (FST_ERR_CTP_EMPTY_JSON_BODY /
 * FST_ERR_CTP_INVALID_JSON_BODY -> validation.json) and prototype-poisoning protection stay exactly as before.
 * A text that still starts with U+FEFF after the one stripped BOM is refused as invalid JSON here, because the default
 * parser would silently strip a second one.
 */
export function createJsonBodyParser(
  parseJsonText: JsonTextParser,
): (request: FastifyRequest, body: Buffer | string, done: (err: Error | null, value?: unknown) => void) => void {
  return (request, body, done) => {
    const text = typeof body === "string" ? body : decodeUtf8Body(body);
    if (text === null) {
      done(invalidUtf8BodyProblem());
      return;
    }
    if (text.charCodeAt(0) === BOM) {
      done(problems.badRequest("validation.json", "The request body is not valid JSON."));
      return;
    }
    parseJsonText(request, text, done);
  };
}

// ------------------------------------------------------------------------------------------------ query strings

/**
 * Query objects whose raw text held an undecodable component, with the RFC 6901 pointer of the first one:
 * `/query/<key>` when only the value is undecodable, `/query` when the key itself is (its raw text is never echoed).
 */
const undecodableQueries = new WeakMap<object, string>();

/** Null-prototype container, like Fastify's own query object (no prototype keys, `__proto__` is an ordinary key). */
function emptyQuery(): Record<string, string | string[]> {
  return Object.create(null) as Record<string, string | string[]>;
}

/** decodeURIComponent after `+` -> space; null when the component is not valid percent-encoded UTF-8. */
function decodeComponent(raw: string): string | null {
  const plus = raw.includes("+") ? raw.replace(/\+/g, " ") : raw;
  if (!plus.includes("%")) return plus;
  try {
    return decodeURIComponent(plus);
  } catch {
    return null;
  }
}

/**
 * Fastify `routerOptions.querystringParser`. Same shape as the default (fast-querystring): `&`-separated pairs, the
 * first `=` splits key and value, `+` is a space, a key without `=` has the value "", repeated keys become arrays,
 * empty segments are skipped. Every component is decoded strictly; an undecodable one keeps its raw text (so routes
 * exempt from the central check behave as before) and marks the object, which `undecodableQueryPointer` reports.
 * Never throws: it runs inside the router, before any hook or error handler.
 */
export function parseQueryString(input: string): Record<string, string | string[]> {
  // Accumulated in a Map and copied once: no computed member on the result (ADR-0002 architecture rule), and a key
  // such as `__proto__` stays an ordinary own property of the null-prototype object.
  const pairs = new Map<string, string | string[]>();
  let firstBad: string | null = null;
  for (const segment of input.length === 0 ? [] : input.split("&")) {
    if (segment.length === 0) continue;
    const eq = segment.indexOf("=");
    const rawKey = eq === -1 ? segment : segment.slice(0, eq);
    const rawValue = eq === -1 ? "" : segment.slice(eq + 1);
    const decodedKey = decodeComponent(rawKey);
    const decodedValue = decodeComponent(rawValue);
    const key = decodedKey ?? rawKey.replace(/\+/g, " ");
    const value = decodedValue ?? rawValue.replace(/\+/g, " ");
    if (firstBad === null) {
      if (decodedKey === null) firstBad = "/query";
      else if (decodedValue === null) firstBad = `/query/${escapeToken(decodedKey)}`;
    }
    const current = pairs.get(key);
    if (current === undefined) pairs.set(key, value);
    else if (Array.isArray(current)) current.push(value);
    else pairs.set(key, [current, value]);
  }
  const result = Object.assign(emptyQuery(), Object.fromEntries(pairs));
  if (firstBad !== null) undecodableQueries.set(result, firstBad);
  return result;
}

/** The pointer of the first undecodable query component of a query object built by `parseQueryString`, or null. */
export function undecodableQueryPointer(query: unknown): string | null {
  if (query === null || typeof query !== "object") return null;
  return undecodableQueries.get(query) ?? null;
}

/** RFC 6901 escaping of one reference token. */
function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** The 400 problem for an undecodable query component, at `/query/<key>` (or `/query`). */
export function invalidQueryProblem(pointer: string): HttpProblem {
  return problems.badRequest("validation.format", INVALID_QUERY_DETAIL, pointer);
}

/** Throws the 400 problem when the request's query string held an undecodable component. */
export function assertDecodableQuery(request: { query?: unknown }): void {
  const pointer = undecodableQueryPointer(request.query);
  if (pointer !== null) throw invalidQueryProblem(pointer);
}
