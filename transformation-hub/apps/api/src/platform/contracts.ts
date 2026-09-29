import { applyDecorators, createParamDecorator, ExecutionContext, RequestMapping, RequestMethod, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { RouteDef, RouteInput } from '@hub/contracts';
import type { RequestContext } from './context';

export const ROUTE_META = 'hub:route';

const METHOD: Record<RouteDef['method'], RequestMethod> = {
  GET: RequestMethod.GET,
  POST: RequestMethod.POST,
  PUT: RequestMethod.PUT,
  PATCH: RequestMethod.PATCH,
  DELETE: RequestMethod.DELETE,
};

/** Bind a controller method to a contract route (path, method, access, schemas). */
export function ApiRoute(def: RouteDef) {
  return applyDecorators(RequestMapping({ path: def.path, method: METHOD[def.method] }), SetMetadata(ROUTE_META, def));
}

export function routeOf(handler: object): RouteDef | undefined {
  return Reflect.getMetadata(ROUTE_META, handler) as RouteDef | undefined;
}

type HubRequest = Request & { hubCtx?: RequestContext; hubInput?: RouteInput<RouteDef>; hubRouteId?: string };

/** Validated input (params/query/body) — populated by the ContractGuard. */
export const Input = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<HubRequest>();
  if (!req.hubInput) throw new Error('Route input was not validated (missing @ApiRoute?)');
  return req.hubInput;
});

/** Request context (principal, scope, correlation id). */
export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<HubRequest>();
  if (!req.hubCtx) throw new Error('No request context (public route?)');
  return req.hubCtx;
});

export type { HubRequest };
