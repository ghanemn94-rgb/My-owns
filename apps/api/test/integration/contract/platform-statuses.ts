// Platform-layer statuses (T-DG2-ARCH-03, ADR-0007 §5b). Some statuses come from the PLATFORM LAYER, before or
// around any handler: hooks, authentication/CSRF, the rate limiter, the If-Match prologue, validation and
// framework/parser errors. A status the platform can return but an operation does not declare is contract drift.
// This rule derives each operation's platform statuses from the route's declared access and the contract's If-Match
// parameter, and lists every one that is undeclared:
//
//   status | derived from                                  | platform source
//   -------+-----------------------------------------------+-------------------------------------------------------
//   400    | every operation except NO_400_OPERATIONS      | central request check, parsers, framework errors (§5a)
//   401    | access is not { public: true }                | identity preValidation hook: no resolved session
//   403    | not public AND unsafe method (POST/PUT/...)   | identity preValidation hook: Origin / X-CSRF-Token
//   428    | the operation takes the If-Match parameter    | If-Match prologue (`platform/http.ts`): header missing
//   409    | the operation takes the If-Match parameter    | the same prologue: stale version (VersionConflict)
//   429    | every operation                               | @fastify/rate-limit (global, plus the auth routes' own)
//
// 429 on the health operations: the limiter's allowList exempts only the exact request URLs `/healthz` and `/readyz`.
// The same operation called with a query string is counted and can answer 429. The live sweep below shows this.
//
// Deliberately NOT derived (D-067, ADR-0007 §5b): 500 `internal` (a failure, never a contract response), 408 (a
// connection-level request timeout written before routing), and 404 for an unmatched route (no operation matched).
import { expect } from "vitest";
import type { Operation } from "../../support/contract.ts";
import { call, type TestApi } from "../../support/harness.ts";
import { NO_400_OPERATIONS } from "./malformed-input.ts";

/** Statuses the platform can produce that are out of the contract by design (D-067). */
export const OUT_OF_CONTRACT_BY_DESIGN: readonly number[] = [404, 408, 500];

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface RouteAccessInfo {
  readonly method: string;
  readonly url: string;
  readonly access?: unknown;
}

const toOpenApi = (url: string) => url.replace(/:([A-Za-z]+)/g, "{$1}");

function takesIfMatch(op: Operation, openapi: Record<string, unknown>): boolean {
  const pathItem = (openapi["paths"] as Record<string, Record<string, unknown>>)[op.path]!;
  const operation = pathItem[op.method.toLowerCase()] as Record<string, unknown>;
  const params = [
    ...((pathItem["parameters"] as Record<string, unknown>[] | undefined) ?? []),
    ...((operation["parameters"] as Record<string, unknown>[] | undefined) ?? []),
  ];
  return params.some(
    (p) =>
      p["$ref"] === "#/components/parameters/IfMatch" ||
      (p["in"] === "header" && String(p["name"]).toLowerCase() === "if-match"),
  );
}

/** Whether the route declares `{ public: true }`. Falls back to the contract's `security: []` for unrouted operations. */
function isPublic(op: Operation, routes: readonly RouteAccessInfo[], openapi: Record<string, unknown>): boolean {
  const route = routes.find((r) => r.method === op.method && toOpenApi(r.url) === op.path);
  if (route) return Boolean(route.access && (route.access as { public?: unknown }).public === true);
  const operation = (openapi["paths"] as Record<string, Record<string, Record<string, unknown>>>)[op.path]![
    op.method.toLowerCase()
  ]!;
  return Array.isArray(operation["security"]) && (operation["security"] as unknown[]).length === 0;
}

/** The statuses the platform layer can return for this operation (independent of its handler). */
export function platformStatuses(
  op: Operation,
  routes: readonly RouteAccessInfo[],
  openapi: Record<string, unknown>,
): number[] {
  const statuses = new Set<number>([429]);
  if (!NO_400_OPERATIONS.has(op.operationId)) statuses.add(400);
  if (!isPublic(op, routes, openapi)) {
    statuses.add(401);
    if (UNSAFE.has(op.method)) statuses.add(403);
  }
  if (takesIfMatch(op, openapi)) {
    statuses.add(428);
    statuses.add(409);
  }
  return [...statuses].sort();
}

/** `<operationId> <status>` for every platform status an operation does not declare (empty when the contract is complete). */
export function undeclaredPlatformStatuses(
  operations: readonly Operation[],
  routes: readonly RouteAccessInfo[],
  openapi: Record<string, unknown>,
): string[] {
  return operations.flatMap((op) =>
    platformStatuses(op, routes, openapi)
      .filter((s) => !(String(s) in op.responses))
      .map((s) => `${op.operationId} ${s}`),
  );
}

/** A URL for the operation: any well-formed path values (the limiter answers before routing parameters matter). */
function urlFor(op: Operation): string {
  return op.path.replace(/\{([A-Za-z]+)\}/g, (_, name: string) => {
    if (name === "gateCode") return "G1";
    if (name === "dimensionCode") return "strategy";
    if (name === "submissionNo" || name === "versionNo") return "1";
    // P4 (T-DG4-BE-A): a seeded job schedule code and a governance matrix kind.
    if (name === "jobCode") return "approval.escalation_scan";
    if (name === "matrixKind") return "raci";
    return crypto.randomUUID();
  });
}

/**
 * Live sweep: on an API whose limits are 1 per minute, every operation is called twice (unauthenticated, from one
 * client IP). The second call of each is a 429 RateLimited problem, checked against the contract by the validating
 * client. The health operations are called with a query string (see above); the bare health URLs stay exempt.
 */
export async function exerciseRateLimitSweep(limited: TestApi, operations: readonly Operation[]): Promise<string[]> {
  const limitedOps: string[] = [];
  for (const op of operations) {
    const url = op.path === "/healthz" || op.path === "/readyz" ? `${op.path}?probe=1` : urlFor(op);
    // The first call spends the bucket; its own outcome (401, 404, 302...) is not under test here.
    await call(limited.app, op.method, url, { contract: false });
    const res = await call<{ type: string; code: string; status: number }>(limited.app, op.method, url);
    expect([op.operationId, res.status], JSON.stringify(res.body)).toEqual([op.operationId, 429]);
    expect(res.body).toMatchObject({ type: "urn:mth:problem:rate-limited", code: "rate_limited", status: 429 });
    expect(res.headers["retry-after"], op.operationId).toBeDefined();
    limitedOps.push(op.operationId);
  }
  // The allowList: the bare health URLs are never limited, even with the bucket spent.
  for (const path of ["/healthz", "/readyz"]) {
    for (let i = 0; i < 3; i += 1) {
      const res = await call(limited.app, "GET", path);
      expect([path, res.status]).toEqual([path, 200]);
    }
  }
  return limitedOps;
}
