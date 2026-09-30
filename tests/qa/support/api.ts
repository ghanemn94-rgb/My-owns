// qa-verifier acceptance support (DG1). A thin layer over the backend's integration harness, which starts the REAL
// Fastify app (inject, no network) on the per-run disposable PostgreSQL as the runtime role mth_app and validates every
// response made through `call` against docs/api/openapi.yaml. The acceptance suites only add assertions derived from the
// acceptance criteria (A12/A13/A14) and the contract; they never reach into product internals to decide a result.
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { call, type Res, type Session, type TestApi } from "../../../apps/api/test/support/harness.ts";

type FastifyInstance = TestApi["app"];

export {
  auditCount,
  auditOf,
  call,
  createBu,
  createOrg,
  createPool,
  createTransformationRow,
  createUser,
  grant,
  signIn,
  startApi,
  uniq,
  type Res,
  type Session,
  type TestApi,
} from "../../../apps/api/test/support/harness.ts";

/** Response bodies are asserted structurally against the contract; the body type is deliberately loose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;

/** A syntactically valid id that exists nowhere (UUIDv4 is still a valid `format: uuid`). */
export const unknownId = (): string => randomUUID();

/** The contract's problem+json shape for an error response. */
export function expectProblem(res: Res<Loose>, status: number, type: string): void {
  expect(res.status).toBe(status);
  expect(String(res.headers["content-type"])).toContain("application/problem+json");
  expect(res.body).toMatchObject({ status, type });
  expect(typeof res.body.code).toBe("string");
  expect(typeof res.body.requestId).toBe("string");
}

/** The parts of an error response that must not differ between "forbidden" and "does not exist" (non-disclosure). */
export function disclosureShape(res: Res<Loose>): unknown {
  const b = res.body as Record<string, unknown>;
  return { status: res.status, type: b["type"], code: b["code"], title: b["title"], detail: b["detail"] };
}

/** POST /api/v1/transformations as `session` (optionally with an Idempotency-Key). */
export async function createTransformation(
  app: FastifyInstance,
  session: Session,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Res<Loose>> {
  return call(app, "POST", "/api/v1/transformations", {
    session,
    body,
    ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {}),
  });
}

/** PATCH with an explicit If-Match (or none, when `ifMatch` is null). */
export async function patchTransformation(
  app: FastifyInstance,
  session: Session,
  id: string,
  body: Record<string, unknown>,
  ifMatch: string | null,
): Promise<Res<Loose>> {
  return call(app, "PATCH", `/api/v1/transformations/${id}`, {
    session,
    body,
    ...(ifMatch !== null ? { headers: { "if-match": ifMatch } } : {}),
  });
}
