// ETag / If-Match (ADR-0003 optimistic concurrency, ADR-0007 §6) and small response helpers.
import type { FastifyReply, FastifyRequest } from "fastify";
import { problems } from "./problem.ts";

export const etag = (version: number): string => `"${version}"`;

const IF_MATCH = /^"([1-9][0-9]{0,9})"$/;

/**
 * The version the client claims to be changing. Missing header -> 428. Malformed (including `*` and weak tags,
 * which make no sense for a version) -> 400.
 */
export function requireIfMatch(request: FastifyRequest): number {
  const raw = request.headers["if-match"];
  if (raw === undefined || raw === "") throw problems.preconditionRequired();
  const value = Array.isArray(raw) ? raw[0] : raw;
  const m = IF_MATCH.exec(value ?? "");
  if (!m)
    throw problems.badRequest("validation.if_match", 'If-Match must be a strong ETag such as "3".', "/header/If-Match");
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n > 2_147_483_647)
    throw problems.badRequest("validation.if_match", "If-Match version is out of range.", "/header/If-Match");
  return n;
}

export function sendVersioned<T extends { version: number }>(
  reply: FastifyReply,
  status: number,
  body: T,
  location?: string,
): FastifyReply {
  reply.header("ETag", etag(body.version));
  if (location) reply.header("Location", location);
  return reply.code(status).send(body);
}

export const iso = (d: Date): string => d.toISOString();
export const isoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString());
