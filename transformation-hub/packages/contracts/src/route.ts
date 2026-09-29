import { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Access requirement of a route:
 *  - 'public'         : no session (health, login bootstrap)
 *  - 'authenticated'  : any valid session (e.g. /me)
 *  - '<permission>'   : permission key checked in the project of `:projectId` (RBAC) — services add ABAC checks
 *  - { org: '<permission>' } : organization-level permission (admin, portfolio)
 */
export type RouteAccess = 'public' | 'authenticated' | string | { org: string };

export interface RouteDef<
  P extends z.ZodTypeAny = z.ZodTypeAny,
  Q extends z.ZodTypeAny = z.ZodTypeAny,
  B extends z.ZodTypeAny = z.ZodTypeAny,
  R extends z.ZodTypeAny = z.ZodTypeAny,
> {
  id: string;
  method: HttpMethod;
  path: string; // Express-style, e.g. /api/v1/projects/:projectId/decisions/:decisionId/submit
  summary: string;
  tags: string[];
  access: RouteAccess;
  params: P;
  query: Q;
  body: B;
  response: R;
  /** Mutations that change a status must be explicit commands (documented in the OpenAPI description). */
  command?: boolean;
  /** Response is a file stream rather than JSON. */
  binary?: boolean;
  /** Request body is raw bytes (application/octet-stream) — e.g. document upload; `body` schema is not applied. */
  upload?: boolean;
}

const EmptyObject = z.object({}).strict();

export function defineRoute<
  P extends z.ZodTypeAny = typeof EmptyObject,
  Q extends z.ZodTypeAny = typeof EmptyObject,
  B extends z.ZodTypeAny = typeof EmptyObject,
  R extends z.ZodTypeAny = z.ZodTypeAny,
>(def: {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  tags: string[];
  access: RouteAccess;
  params?: P;
  query?: Q;
  body?: B;
  response: R;
  command?: boolean;
  binary?: boolean;
  upload?: boolean;
}): RouteDef<P, Q, B, R> {
  return {
    ...def,
    params: (def.params ?? EmptyObject) as P,
    query: (def.query ?? EmptyObject) as Q,
    body: (def.body ?? EmptyObject) as B,
  };
}

export type RouteParams<T> = T extends RouteDef<infer P, any, any, any> ? z.infer<P> : never;
export type RouteQuery<T> = T extends RouteDef<any, infer Q, any, any> ? z.input<Q> : never;
export type RouteBody<T> = T extends RouteDef<any, any, infer B, any> ? z.input<B> : never;
export type RouteResponse<T> = T extends RouteDef<any, any, any, infer R> ? z.infer<R> : never;

/** Validated input handed to controllers. */
export interface RouteInput<T> {
  params: T extends RouteDef<infer P, any, any, any> ? z.infer<P> : never;
  query: T extends RouteDef<any, infer Q, any, any> ? z.infer<Q> : never;
  body: T extends RouteDef<any, any, infer B, any> ? z.infer<B> : never;
}

/** Global registry — every route module registers here; the API checks controllers against it at boot. */
export const ROUTES: Record<string, RouteDef> = {};

export function registerRoutes<T extends Record<string, RouteDef>>(routes: T): T {
  for (const r of Object.values(routes)) {
    if (ROUTES[r.id]) throw new Error(`Duplicate route id ${r.id}`);
    ROUTES[r.id] = r;
  }
  return routes;
}

export function buildPath(path: string, params: Record<string, string | number>): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`Missing path param ${k}`);
    return encodeURIComponent(String(v));
  });
}
