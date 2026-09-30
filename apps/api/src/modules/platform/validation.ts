// Request validation with the shared zod schemas (ADR-0007 §5). Bodies, query strings and params are validated
// before a handler does anything else; failures become 400 problems with RFC 6901 pointers.
import type { FieldError } from "@mth/shared";
import type { z } from "zod";
import { problems } from "./problem.ts";

type Where = "body" | "query" | "params" | "header";

function toFieldErrors(error: z.ZodError, where: Where): FieldError[] {
  return error.issues.map((issue) => {
    const path = issue.path.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1"));
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
