// Trustworthy rate-limit keys (F-DG1-142, ADR-0007 T-3). The global limiter runs on onRequest, BEFORE the session is
// resolved in PostgreSQL, and must stay there so floods are refused without a database lookup. Keying it on the raw
// cookie value let every fabricated cookie open a fresh bucket. Instead, the limiter asks this process-local map,
// which only the identity hook fills, and only after a session cookie RESOLVED to a live session:
//   - token seen valid within the TTL -> key `u:<userId>` (the authenticated subject: all of a user's sessions share it);
//   - anything else (no cookie, unknown, forged, expired or revoked token) -> the caller falls back to the client IP,
//     which Fastify derives from the socket or from X-Forwarded-For only through the configured TRUST_PROXY hops.
// A token that fails to resolve is forgotten at once, so a revoked session drops back to the IP bucket on its next
// request. Entries are keyed by SHA-256 of the token (never the raw value), bounded in number (oldest evicted first)
// and expire after the session idle timeout. Only live sessions can add entries, so an anonymous client cannot grow it.
import { sha256 } from "./sessions.ts";

export class RateLimitSubjects {
  private readonly entries = new Map<string, { readonly userId: string; readonly expiresAt: number }>();

  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs: number, maxEntries = 50_000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /** The authenticated subject for this cookie value, or null when it has not been validated recently. */
  subjectOf(token: string, now: number = Date.now()): string | null {
    const key = sha256(token).toString("hex");
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    return entry.userId;
  }

  /** Called by the identity hook after `token` resolved to a live session of `userId` (and on sign-in). */
  remember(token: string, userId: string, now: number = Date.now()): void {
    const key = sha256(token).toString("hex");
    this.entries.delete(key); // re-insert: Map order is the eviction order (least recently validated first)
    this.entries.set(key, { userId, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Called when `token` did not resolve (unknown, expired, revoked) or was revoked by sign-out/rotation. */
  forget(token: string): void {
    this.entries.delete(sha256(token).toString("hex"));
  }

  get size(): number {
    return this.entries.size;
  }
}
