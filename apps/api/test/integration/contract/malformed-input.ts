// Contract cases for input the server refuses with 400 before any handler logic (T-DG2-ARCH-02, ADR-0007 §5a):
//  1. every GET operation with a path parameter, called with a malformed last parameter, answers 400 - declared in the
//     contract - with exactly one field error at `/params/<name>`, and the request writes nothing (no audit row);
//  2. a path id containing U+0000 is 400 `validation.invalid_character` at `/params/<name>`;
//  3. every operation (except the OIDC callback, which answers every outcome with a redirect) answers 400
//     `validation.invalid_character` for a U+0000 in the query string - the central request check runs on every route,
//     so every operation declares 400.
// All requests go through the validating client: an undeclared status fails the test (the contract stays strict).
import { expect } from "vitest";
import {
  call,
  createTransformationRow,
  auditOfRequest,
  type Res,
  type Session,
  type TestApi,
} from "../../support/harness.ts";
import { operations } from "../../support/contract.ts";
import type { World } from "../../support/harness.ts";

/** Fails every path-parameter schema: not a uuid, not lower-case (dimension codes), not an integer, not a gate code. */
export const MALFORMED = "NOT-VALID";

/** The OIDC callback validates its own query and redirects on every outcome (`config.invalidCharacters: "route"`). */
export const NO_400_OPERATIONS: ReadonlySet<string> = new Set(["completeOidcLogin"]);

interface Ctx {
  readonly api: TestApi;
  readonly world: World;
  readonly session: Session;
}

type Problem = { code: string; type: string; errors: { pointer: string; code: string }[] };

const paramNames = (path: string): string[] => [...path.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]!);

/** A well-formed value for each path parameter; the transformation is a real one the caller can read. */
function wellFormed(name: string, transformationId: string): string {
  if (name === "transformationId") return transformationId;
  if (name === "gateCode") return "G1";
  if (name === "dimensionCode") return "strategy";
  if (name === "submissionNo" || name === "versionNo") return "1";
  return crypto.randomUUID();
}

function urlFor(path: string, values: Record<string, string>): string {
  return path.replace(/\{([A-Za-z]+)\}/g, (_, name: string) => values[name]!);
}

async function expectNothingWritten(api: TestApi, res: Res) {
  expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([]);
}

/** GET operations addressed by at least one path parameter (by-id reads, plus reads of a transformation's parts). */
export function getOperationsWithPathParams() {
  return operations.filter((o) => o.method === "GET" && paramNames(o.path).length > 0);
}

export async function exerciseMalformedPathParams({ api, world, session }: Ctx): Promise<string[]> {
  const transformationId = await createTransformationRow(api.db, world.orgA.id, world.a1, world.office.id);
  const checked: string[] = [];
  for (const op of getOperationsWithPathParams()) {
    const names = paramNames(op.path);
    const last = names[names.length - 1]!;
    const values = Object.fromEntries(names.map((n) => [n, wellFormed(n, transformationId)]));
    values[last] = MALFORMED;
    const url = urlFor(op.path, values);
    const res = await call<Problem>(api.app, "GET", url, { session });
    expect([op.operationId, res.status], JSON.stringify(res.body)).toEqual([op.operationId, 400]);
    expect(res.body.type, op.operationId).toBe("urn:mth:problem:validation");
    expect(
      res.body.errors.map((e) => e.pointer),
      `${op.operationId}: the pointer names the parameter`,
    ).toEqual([`/params/${last}`]);
    await expectNothingWritten(api, res);
    checked.push(op.operationId);
  }

  // U+0000 in a path id: the central request check answers before the id is parsed.
  const nul = await call<Problem>(api.app, "GET", `/api/v1/transformations/${transformationId}/tom-gaps/abc%00def`, {
    session,
  });
  expect(nul.status, JSON.stringify(nul.body)).toBe(400);
  expect(nul.body.code).toBe("validation");
  expect(nul.body.errors).toEqual([
    expect.objectContaining({ pointer: "/params/tomGapId", code: "validation.invalid_character" }),
  ]);
  await expectNothingWritten(api, nul);
  return checked;
}

export async function exerciseInvalidCharacterQuery({ api, world, session }: Ctx): Promise<string[]> {
  const transformationId = await createTransformationRow(api.db, world.orgA.id, world.a1, world.office.id);
  const checked: string[] = [];
  for (const op of operations) {
    const values = Object.fromEntries(paramNames(op.path).map((n) => [n, wellFormed(n, transformationId)]));
    const url = `${urlFor(op.path, values)}?probe=a%00b`;
    const res = await call<Problem>(api.app, op.method, url, { session });
    if (NO_400_OPERATIONS.has(op.operationId)) {
      // The callback refuses the request with its own redirect (never a 400): declared 302, nothing signed in.
      expect([op.operationId, res.status]).toEqual([op.operationId, 302]);
      continue;
    }
    expect([op.operationId, res.status], JSON.stringify(res.body)).toEqual([op.operationId, 400]);
    expect(res.body.errors, op.operationId).toEqual([
      expect.objectContaining({ pointer: "/query/probe", code: "validation.invalid_character" }),
    ]);
    await expectNothingWritten(api, res);
    checked.push(op.operationId);
  }
  return checked;
}
