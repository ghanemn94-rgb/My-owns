// The shape of a P7 route guard (T-DG7-BE-A; the P7 permission wiring). Each P7 route file exports one table that maps
// every contract operation it owns to its method, its Fastify path and the permission code its route declares in
// `config.access`. The owning task registers each route with exactly that permission, so every code of P7_PERMISSIONS
// (packages/shared/src/permissions.ts) is reachable from a route guard; src/p7-wiring.test.ts pins the tables against
// the contract and against P7_PERMISSIONS. A permission code here is an authorization check, never an approval.
import type { Permission } from "@mth/shared";

export interface P7RouteGuard {
  readonly method: "GET" | "POST" | "PUT";
  /** The Fastify path (`:param`), equal to the contract path with `{param}` written as `:param`. */
  readonly path: string;
  readonly permission: Permission;
}
