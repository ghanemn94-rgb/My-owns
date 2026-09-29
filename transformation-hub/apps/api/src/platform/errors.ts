import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from '@hub/domain';
import { AuditService } from './audit.service';
import type { RequestContext } from './context';

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

const KIND_STATUS: Record<DomainError['kind'], number> = {
  rule_violation: 422,
  conflict: 409,
  not_found: 404,
  forbidden: 403,
  invalid: 400,
};

/** Map PostgreSQL errors to safe problem responses (no SQL, no constraint internals beyond a code). */
function fromPg(e: { code?: string; message?: string; constraint?: string }): ProblemBody | null {
  switch (e.code) {
    case '23505':
      return { type: 'about:blank', title: 'Conflict', status: 409, code: 'db.unique_violation', detail: 'A record with the same identifier already exists.' };
    case '23503':
      // Includes composite (project_id, id) FKs: a reference to a record outside this project.
      return { type: 'about:blank', title: 'Invalid reference', status: 422, code: 'db.invalid_reference', detail: 'A referenced record does not exist in this project.' };
    case '23514':
      return { type: 'about:blank', title: 'Invalid value', status: 422, code: 'db.check_violation', detail: 'A value violates a data rule.' };
    case '42501':
      // RLS WITH CHECK violation → treat as not found (never reveal other projects)
      return { type: 'about:blank', title: 'Not found', status: 404, code: 'not_found' };
    case '22P02':
      return { type: 'about:blank', title: 'Invalid input', status: 400, code: 'db.invalid_text_representation' };
    case 'P0001': {
      const m = /^(\w+):\s*(.*)$/.exec(e.message ?? '');
      return { type: 'about:blank', title: 'Rule violation', status: 422, code: m ? `db.${m[1]}` : 'db.rule_violation', detail: m ? m[2] : undefined };
    }
    case '40001':
    case '40P01':
      return { type: 'about:blank', title: 'Conflict', status: 409, code: 'db.serialization_failure', detail: 'Concurrent update — reload and retry.' };
    default:
      return null;
  }
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('http');
  constructor(private readonly audit: AuditService) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { hubCtx?: RequestContext; hubRouteId?: string }>();
    const res = http.getResponse<Response>();
    const correlationId = req.hubCtx?.correlationId ?? (req.headers['x-correlation-id'] as string | undefined);
    let body: ProblemBody;

    if (exception instanceof DomainError) {
      body = {
        type: 'about:blank',
        title: exception.kind === 'rule_violation' ? 'Rule violation' : exception.kind,
        status: KIND_STATUS[exception.kind],
        code: exception.code,
        detail: exception.message,
        details: exception.details,
      };
    } else if (exception instanceof ZodError) {
      body = {
        type: 'about:blank',
        title: 'Validation failed',
        status: 400,
        code: 'validation_failed',
        details: { issues: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      };
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const r = exception.getResponse();
      const detail = typeof r === 'string' ? r : ((r as { message?: string | string[] }).message?.toString() ?? exception.message);
      body = { type: 'about:blank', title: HttpStatus[status] ?? 'Error', status, code: (r as { code?: string }).code ?? `http.${status}`, detail };
    } else {
      // Drizzle wraps driver errors (DrizzleQueryError.cause) — walk the cause chain to find the PostgreSQL error.
      let e: unknown = exception;
      let pg: ProblemBody | null = null;
      for (let i = 0; i < 4 && e && !pg; i++) {
        pg = fromPg(e as { code?: string; message?: string });
        e = (e as { cause?: unknown }).cause;
      }
      if (pg) body = pg;
      else {
        // Log the error class/message/stack but never SQL text or bound parameters (may contain data or secrets).
        const err = exception as Error & { query?: string; params?: unknown };
        const safeMessage = (err?.message ?? String(exception)).replace(/Failed query:[\s\S]*$/m, 'Failed query: [redacted]');
        this.log.error(`unhandled error [${correlationId}] ${err?.name ?? 'Error'}: ${safeMessage}`);
        body = { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', detail: 'An unexpected error occurred.' };
      }
    }
    body.correlationId = correlationId;

    // Denied / rejected mutation attempts are audited even though the business transaction rolled back (AT-05, AT-13).
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    if (req.hubCtx && mutating && [403, 404, 409, 422].includes(body.status)) {
      const projectId = (req.params as Record<string, string> | undefined)?.projectId ?? null;
      await this.audit.recordDetached(req.hubCtx, {
        action: req.hubRouteId ?? `${req.method} ${req.route?.path ?? req.path}`,
        projectId,
        outcome: body.status === 403 || body.status === 404 ? 'denied' : 'rejected',
        reason: `${body.code}${body.detail ? `: ${body.detail}` : ''}`.slice(0, 1000),
        entityType: 'request',
      });
    }

    res.status(body.status).type('application/problem+json').send(JSON.stringify(body));
  }
}
