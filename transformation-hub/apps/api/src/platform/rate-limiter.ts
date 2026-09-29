import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from './config';

/**
 * Simple fixed-window rate limiter (per process) — REQ-DAT-016. Keys: session id (authenticated) or IP (public).
 * For multi-replica deployments an ingress-level limiter should complement it (ADR-0017).
 */
@Injectable()
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Returns true when the request is allowed. */
  hit(key: string, kind: 'read' | 'mutation' | 'public', now = Date.now()): boolean {
    const limit = kind === 'public' ? this.config.rateLimits.publicPerMinute : kind === 'mutation' ? this.config.rateLimits.mutationsPerMinute : this.config.rateLimits.perMinute;
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

  private gc(now: number) {
    for (const [k, w] of this.windows) if (now - w.start >= 60_000) this.windows.delete(k);
  }
}
