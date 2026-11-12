// The shape of a P7 route guard (T-DG7-BE-A; the P7 permission wiring), as in transfer/guards.ts. A module never
// imports another module's internals (ADR-0002), so retention declares its own copy. Each retention route file exports
// one table that maps every contract operation it owns to its method, its Fastify path and the permission code its
// route declares in `config.access`; src/p7-wiring.test.ts pins the tables against the contract and P7_PERMISSIONS.
// retention.configure changes a class's action, period and IT approval REFERENCE text: holding it approves nothing.
import type { Permission } from "@mth/shared";

export interface P7RouteGuard {
  readonly method: "GET" | "POST" | "PUT";
  /** The Fastify path (`:param`), equal to the contract path with `{param}` written as `:param`. */
  readonly path: string;
  readonly permission: Permission;
}
