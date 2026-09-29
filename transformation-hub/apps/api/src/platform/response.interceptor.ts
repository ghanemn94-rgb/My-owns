import { CallHandler, ExecutionContext, HttpException, Inject, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { HubRequest } from './contracts';
import { routeOf } from './contracts';
import { APP_CONFIG, AppConfig } from './config';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Keys present in the handler's output but dropped by the schema (= over-exposure), as dotted paths (max 5). */
export function extraKeys(orig: unknown, parsed: unknown, path = '', out: string[] = []): string[] {
  if (out.length >= 5) return out;
  if (Array.isArray(orig) && Array.isArray(parsed)) {
    orig.forEach((v, i) => extraKeys(v, parsed[i], `${path}[${i}]`, out));
  } else if (isPlainObject(orig) && isPlainObject(parsed)) {
    for (const k of Object.keys(orig)) {
      if (orig[k] === undefined) continue;
      const p = path ? `${path}.${k}` : k;
      if (!(k in parsed)) out.push(p);
      else extraKeys(orig[k], parsed[k], p, out);
      if (out.length >= 5) break;
    }
  }
  return out;
}

/**
 * Output-contract enforcement (ARCH-18). Every JSON response is parsed with the route's `response` schema:
 *  - fields not declared in the contract are STRIPPED in every mode (defence against over-exposure);
 *  - in test, drift or undeclared fields fail loudly (500 contract.response_mismatch); in development they log a warning;
 *  - in production a schema failure is logged and the original body is returned (availability), undeclared fields are
 *    still stripped.
 */
@Injectable()
export class ResponseContractInterceptor implements NestInterceptor {
  private readonly log = new Logger('contract');
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const route = routeOf(context.getHandler());
    const req = context.switchToHttp().getRequest<HubRequest>();
    if (!route || route.binary || !req.hubRouteId) return next.handle();
    const mode = this.config.nodeEnv;
    return next.handle().pipe(
      map((body) => {
        const r = route.response.safeParse(body);
        let detail: string | null = null;
        if (!r.success) {
          detail = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        } else {
          const extra = extraKeys(body, r.data);
          if (extra.length) detail = `undeclared field(s): ${extra.join(', ')}`;
        }
        if (detail && mode === 'test') throw new HttpException({ message: `Response does not match contract ${route.id}: ${detail}`, code: 'contract.response_mismatch' }, 500);
        if (detail) this.log[mode === 'production' ? 'error' : 'warn'](`response of ${route.id} does not match its contract: ${detail}`);
        return r.success ? r.data : body;
      }),
    );
  }
}
