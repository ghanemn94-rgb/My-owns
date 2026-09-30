// HTTP Idempotency-Key (ADR-0007 §6; table idempotency_record). Same user + key + request -> the original response
// for 24 hours; same key with a different request -> 422. Runs inside the caller's transaction, serialized per
// (user, key) with an advisory lock, so two concurrent retries cannot both create the record.
import { createHash } from "node:crypto";
import { sql, type Tx } from "@mth/db";
import { z } from "zod";
import { canonicalJson } from "./cursor.ts";
import { problems } from "./problem.ts";

export const IDEMPOTENCY_TTL_HOURS = 24;
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method.toUpperCase()} ${path}\n${canonicalJson(body ?? null)}`)
    .digest("hex");
}

export interface StoredResponse<B> {
  readonly status: number;
  readonly body: B;
  readonly replayed: boolean;
}

export async function withIdempotency<B>(
  tx: Tx,
  input: { userId: string; key: string; requestHash: string },
  run: () => Promise<{ status: number; body: B }>,
): Promise<StoredResponse<B>> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`idem:${input.userId}:${input.key}`}, 0))`.execute(tx);
  const existing = await tx
    .selectFrom("idempotency_record")
    .select(["request_hash", "response_status", "response_body", sql<boolean>`expires_at > now()`.as("live")])
    .where("user_id", "=", input.userId)
    .where("key", "=", input.key)
    .executeTakeFirst();
  if (existing?.live) {
    if (existing.request_hash !== input.requestHash) {
      throw problems.businessRule(
        "idempotency.key_reused",
        "This Idempotency-Key was already used for a different request.",
      );
    }
    return { status: existing.response_status, body: existing.response_body as B, replayed: true };
  }
  if (existing) {
    await tx
      .deleteFrom("idempotency_record")
      .where("user_id", "=", input.userId)
      .where("key", "=", input.key)
      .execute();
  }
  const result = await run();
  await tx
    .insertInto("idempotency_record")
    .values({
      user_id: input.userId,
      key: input.key,
      request_hash: input.requestHash,
      response_status: result.status,
      response_body: JSON.stringify(result.body),
      expires_at: sql<Date>`now() + make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})`,
    })
    .execute();
  return { ...result, replayed: false };
}
