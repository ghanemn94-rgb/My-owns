// Request validation with the shared zod schemas (ADR-0007 §5). Bodies, query strings and params are validated
// before a handler does anything else; failures become 400 problems with RFC 6901 pointers.
import type { FieldError } from "@mth/shared";
import { hasInvalidCharacter, INVALID_CHARACTER_CODE } from "@mth/shared/schemas";
import type { z } from "zod";
import { problems } from "./problem.ts";

type Where = "body" | "query" | "params" | "header";

/** RFC 6901 escaping of one reference token. */
function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function toFieldErrors(error: z.ZodError, where: Where): FieldError[] {
  return error.issues.map((issue) => {
    const path = issue.path.map((p) => escapeToken(String(p)));
    const pointer = where === "body" ? `/${path.join("/")}` : `/${where}/${path.join("/")}`;
    // Custom messages in the shared schemas are already i18n keys (e.g. "validation.timezone").
    const code = /^validation\.[a-z_.]+$/.test(issue.message)
      ? issue.message
      : issue.code === "unrecognized_keys"
        ? "validation.unknown_field"
        : `validation.${issue.code}`;
    return { pointer: pointer === "/" && where === "body" ? "" : pointer, code, message: issue.message };
  });
}

export function parse<S extends z.ZodType>(schema: S, value: unknown, where: Where): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw problems.validation(toFieldErrors(result.error, where));
  return result.data;
}

/** A body is required: an absent or non-object body is a 400, not a crash. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
    throw problems.validation([
      { pointer: "", code: "validation.body_required", message: "A JSON object body is required." },
    ]);
  }
  return parse(schema, body, "body");
}

/** Query strings: every key must be known (strict), repeated keys arrive as arrays. */
export function parseQuery<S extends z.ZodType>(schema: S, query: unknown): z.output<S> {
  return parse(schema, query ?? {}, "query");
}

/**
 * A container this check walks: parsed JSON objects/arrays and Fastify's query/params objects (which have a custom,
 * Object-less prototype, so a plain-prototype test would skip them). Binary bodies are never walked: a stream (the
 * application/octet-stream evidence upload), a Buffer/typed array or an ArrayBuffer.
 */
function isWalkableContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return true;
  if (value === null || typeof value !== "object") return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
  if (Symbol.asyncIterator in value || typeof (value as { pipe?: unknown }).pipe === "function") return false;
  return true;
}

/**
 * F-DG2-231 / F-DG2-260: the RFC 6901 pointer of the first string (value or object key) under `value` that contains
 * U+0000 or a lone UTF-16 surrogate (`hasInvalidCharacter`), or null. Only parsed JSON and query/params objects are walked; a streamed or binary body (the application/octet-stream
 * evidence upload) is never read here. Iterative, so a deeply nested body cannot overflow the stack.
 */
export function findInvalidCharacter(value: unknown, basePointer = ""): string | null {
  const stack: Array<readonly [unknown, string]> = [[value, basePointer]];
  while (stack.length > 0) {
    const [current, pointer] = stack.pop()!;
    if (typeof current === "string") {
      if (hasInvalidCharacter(current)) return pointer;
      continue;
    }
    if (!isWalkableContainer(current)) continue;
    const entries: Array<readonly [string, unknown]> = Array.isArray(current)
      ? current.map((v, i) => [String(i), v] as const)
      : Object.entries(current);
    // Pushed in reverse, so the first offending field in document order is reported. A key with U+0000 is pushed as
    // an offending string, so it is reported in the same order as the values.
    for (const [key, child] of entries.reverse()) {
      stack.push([hasInvalidCharacter(key) ? key : child, `${pointer}/${escapeToken(key)}`]);
    }
  }
  return null;
}

/** The 400 problem for a request string that contains U+0000 or a lone surrogate (F-DG2-231, F-DG2-260). */
export function invalidCharacterProblem(pointer: string) {
  return problems.validation([
    {
      pointer,
      code: INVALID_CHARACTER_CODE,
      message: "The text contains an unsupported character (U+0000 or an unpaired UTF-16 surrogate).",
    },
  ]);
}

/**
 * F-DG2-231 / F-DG2-260: the central request check. Rejects a JSON body, query string or path parameter that contains
 * U+0000 (PostgreSQL text cannot store it; SQLSTATE 22021) or a lone UTF-16 surrogate (stored as U+FFFD in text, refused
 * by jsonb with SQLSTATE 22P02) anywhere with 400 `validation.invalid_character` at the field's
 * pointer: `/field` in the body, `/query/<key>` and `/params/<key>` otherwise (the pointer style of `parse`). Runs
 * once per request, as a `preHandler` hook, so no route can miss it; nothing is read from or written to the database.
 */
export function assertNoInvalidCharacters(request: { body?: unknown; query?: unknown; params?: unknown }): void {
  const pointer =
    findInvalidCharacter(request.params, "/params") ??
    findInvalidCharacter(request.query, "/query") ??
    findInvalidCharacter(request.body, "");
  if (pointer !== null) throw invalidCharacterProblem(pointer);
}
