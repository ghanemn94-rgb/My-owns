import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from './config';

/**
 * Fixed-window rate limiter (per process) — REQ-DAT-016. Classes and keys (docs/deployment/rate-limits.md):
 *
 *   public          per client IP (behind a trusted proxy: the forwarded client address, ADR-0017) — unauthenticated routes
 *   read / mutation per SESSION — reads (GET/HEAD) and state-changing requests
 *   user_read /     per IDENTITY (user id) across all of the user's sessions, so that opening sessions does not multiply
 *   user_mutation   the budget
 *   heavy           per IDENTITY — expensive endpoints (uploads, report generation and exports, file downloads, AI asks),
 *                   counted in addition to the read/mutation classes
 *
 * Every refusal is 429 problem+json (`rate_limited`) with a Retry-After header (seconds until the window ends).
 * For multi-replica deployments an ingress/gateway limiter complements it: each replica counts on its own.
 */
export type RateClass = 'read' | 'mutation' | 'public' | 'user_read' | 'user_mutation' | 'heavy';

@Injectable()
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  limit(kind: RateClass): number {
    const l = this.config.rateLimits;
    switch (kind) {
      case 'public':
        return l.publicPerMinute;
      case 'mutation':
        return l.mutationsPerMinute;
      case 'user_read':
        return l.userPerMinute;
      case 'user_mutation':
        return l.userMutationsPerMinute;
      case 'heavy':
        return l.heavyPerMinute;
      default:
        return l.perMinute;
    }
  }

  /** Returns true when the request is allowed. */
  hit(key: string, kind: RateClass, now = Date.now()): boolean {
    const limit = this.limit(kind);
    const k = `${kind}:${key}`;
    const w = this.windows.get(k);
    if (!w || now - w.start >= 60_000) {
      this.windows.set(k, { start: now, count: 1 });
      if (this.windows.size > 50_000) this.gc(now);
      return true;
    }
    w.count++;
    return w.count <= limit;
  }

  /** Seconds until the key's current window ends (for the Retry-After header of a 429). */
  retryAfterSeconds(key: string, kind: RateClass, now = Date.now()): number {
    const w = this.windows.get(`${kind}:${key}`);
    return w ? Math.max(1, Math.ceil((w.start + 60_000 - now) / 1000)) : 1;
  }

  /**
   * Count an event in the key's current 60-second window and return the count (no limit). Used to coalesce repeated
   * security events (CSRF denials, SEC-P1R-01) so that a client cannot write one audit row per request.
   */
  tally(key: string, now = Date.now()): number {
    const k = `tally:${key}`;
    const w = this.windows.get(k);
    if (!w || now - w.start >= 60_000) {
      this.windows.set(k, { start: now, count: 1 });
      if (this.windows.size > 50_000) this.gc(now);
      return 1;
    }
    return ++w.count;
  }

  private gc(now: number) {
    for (const [k, w] of this.windows) if (now - w.start >= 60_000) this.windows.delete(k);
  }
}

/**
 * Routes of the `heavy` class (besides every upload route): they render, export, stream files or call a model.
 * `apps/api/test/ops/dat-016-rate-limits.spec.ts` checks that each id is a registered route.
 */
export const HEAVY_ROUTE_IDS: ReadonlySet<string> = new Set([
  'reporting.generateReport',
  'reporting.requestReportExport',
  'reporting.downloadReportExport',
  'documents.downloadVersion',
  'ai.ask',
]);
