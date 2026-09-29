import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';
import { DbService } from './db.service';
import type { HubRequest } from './contracts';

/**
 * Runs every handler inside a single DB transaction carrying the RLS context (second half of the mandatory flow:
 * business rules + change + audit + outbox commit atomically or not at all).
 */
@Injectable()
export class TxInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<HubRequest>();
    if (!req.hubCtx) return next.handle();
    return from(this.db.run(req.hubCtx, () => lastValueFrom(next.handle(), { defaultValue: undefined })));
  }
}
