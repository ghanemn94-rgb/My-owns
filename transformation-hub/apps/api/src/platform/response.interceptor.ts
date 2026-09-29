import { CallHandler, ExecutionContext, HttpException, Inject, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { HubRequest } from './contracts';
import { routeOf } from './contracts';
import { APP_CONFIG, AppConfig } from './config';

/**
 * Output-contract enforcement (ARCH-18): in development and test every JSON response is validated against the route's
 * `response` schema — drift or over-exposure fails loudly (500 contract.response_mismatch in test, warning in dev).
 * In production the validated/stripped value is NOT recomputed (performance), but tests guarantee conformance.
 */
@Injectable()
export class ResponseContractInterceptor implements NestInterceptor {
  private readonly log = new Logger('contract');
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const route = routeOf(context.getHandler());
    const req = context.switchToHttp().getRequest<HubRequest>();
    if (!route || route.binary || this.config.nodeEnv === 'production' || !req.hubRouteId) return next.handle();
    return next.handle().pipe(
      map((body) => {
        const r = route.response.safeParse(body);
        if (r.success) return body;
        const detail = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        if (this.config.nodeEnv === 'test') throw new HttpException({ message: `Response does not match contract ${route.id}: ${detail}`, code: 'contract.response_mismatch' }, 500);
        this.log.warn(`response of ${route.id} does not match its contract: ${detail}`);
        return body;
      }),
    );
  }
}
