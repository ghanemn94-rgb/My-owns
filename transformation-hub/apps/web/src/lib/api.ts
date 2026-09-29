/**
 * Typed API client. Every call goes through a route definition from `@hub/contracts`, so the path, method,
 * params, query, body and response types all come from the same source the API validates against.
 *
 * - Same-origin (`/api/...` is rewritten to the API by next.config.ts) so the httpOnly session cookie is sent.
 * - Every non-GET request carries `x-csrf-token` = the readable `hub_csrf` cookie (double-submit).
 * - Failures throw `ApiError` built from the RFC 7807 problem document (status, code, detail, correlationId).
 */
import { buildPath, type RouteBody, type RouteDef, type RouteParams, type RouteQuery, type RouteResponse } from '@hub/contracts';

export const CSRF_COOKIE = 'hub_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | undefined;
  readonly title: string | undefined;
  readonly correlationId: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(init: {
    status: number;
    code: string;
    detail?: string;
    title?: string;
    correlationId?: string;
    details?: Record<string, unknown>;
  }) {
    super(init.detail ?? init.title ?? init.code);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.detail = init.detail;
    this.title = init.title;
    this.correlationId = init.correlationId;
    this.details = init.details;
  }

  /** 404 means "not found OR not authorized" — callers must not distinguish the two. */
  get isHidden(): boolean {
    return this.status === 404;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isConflict(): boolean {
    return this.status === 409;
  }
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export interface CallOptions<R extends RouteDef> {
  params?: RouteParams<R>;
  query?: RouteQuery<R>;
  body?: RouteBody<R>;
  signal?: AbortSignal;
}

function toQueryString(query: unknown): string {
  if (!query || typeof query !== 'object') return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function toApiError(res: Response): Promise<ApiError> {
  let problem: Record<string, unknown> = {};
  try {
    problem = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error body (e.g. proxy failure) */
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return new ApiError({
    status: res.status,
    code: str(problem.code) ?? (res.status === 502 || res.status === 503 || res.status === 504 ? 'api.unavailable' : `http.${res.status}`),
    detail: str(problem.detail),
    title: str(problem.title),
    correlationId: str(problem.correlationId) ?? res.headers.get('x-correlation-id') ?? undefined,
    details: problem.details && typeof problem.details === 'object' ? (problem.details as Record<string, unknown>) : undefined,
  });
}

export async function api<R extends RouteDef>(route: R, opts: CallOptions<R> = {}): Promise<RouteResponse<R>> {
  const url = buildPath(route.path, (opts.params ?? {}) as Record<string, string>) + toQueryString(opts.query);
  const headers: Record<string, string> = { accept: 'application/json' };
  const init: RequestInit = { method: route.method, credentials: 'same-origin', headers, signal: opts.signal, cache: 'no-store' };
  if (route.method !== 'GET') {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers[CSRF_HEADER] = csrf;
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError({ status: 0, code: 'network.unreachable', detail: (e as Error)?.message });
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as RouteResponse<R>;
  return (await res.json()) as RouteResponse<R>;
}
