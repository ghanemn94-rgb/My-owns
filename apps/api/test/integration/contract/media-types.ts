// Contract cases for request media types (F-DG2-320, T-DG2-BE14): every operation accepts only the request media types
// its contract declares.
//  1. structural: every routed operation's `config.consumes` equals the media types of its declared `requestBody`
//     (application/json for 86 operations, application/octet-stream for uploadEvidenceContent). An operation that
//     declares no request body keeps the default application/json set, so its empty-body behaviour is unchanged (no
//     Content-Type and no body reaches the handler; an empty JSON body is the existing 400 validation.json);
//  2. live: every operation whose method carries a body (POST/PUT/PATCH/DELETE) answers each undeclared media type -
//     text/plain, the other parser's type, form, XML, and a body with no Content-Type - with the declared 400
//     `validation.content_type`, and the request writes nothing (no audit row);
//  3. live: GET operations never read a body (Fastify parses none), so a Content-Type there is never refused.
// All requests go through the validating client: an undeclared status fails the test.
import { expect } from "vitest";
import { openapi, type Operation } from "../../support/contract.ts";
import {
  auditOfRequest,
  call,
  createTransformationRow,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { P2_PENDING_OPERATIONS } from "../../support/p2-pending.ts";

type Json = Record<string, unknown>;

export const BODY_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_CONSUMES = ["application/json"];
/** Media types no operation declares, plus the two the API has parsers for (each refused where undeclared). */
const CANDIDATE_MEDIA_TYPES = [
  "text/plain",
  "text/plain; charset=utf-8",
  "application/json",
  "application/octet-stream",
  "application/x-www-form-urlencoded",
  "application/xml",
  "multipart/form-data; boundary=x",
  "application/merge-patch+json",
] as const;

const toOpenApi = (url: string) => url.replace(/:([A-Za-z]+)/g, "{$1}");

function deref(node: Json): Json {
  const ref = node["$ref"];
  if (typeof ref !== "string") return node;
  let cur: unknown = openapi;
  for (const part of ref.replace(/^#\//, "").split("/")) cur = (cur as Json)[part];
  return deref(cur as Json);
}

/** The request media types an operation declares; null when it declares no request body. */
export function declaredRequestMediaTypes(op: Operation): string[] | null {
  const item = (openapi["paths"] as Json)[op.path] as Json;
  const rb = (item[op.method.toLowerCase()] as Json)["requestBody"] as Json | undefined;
  if (!rb) return null;
  return Object.keys(deref(rb)["content"] as Json).sort();
}

export interface RouteConsumesInfo {
  readonly method: string;
  readonly url: string;
  readonly consumes: readonly string[];
}

/** Operations whose route accepts a media-type set different from the contract's (expected: none). */
export function consumesDrift(operations: readonly Operation[], routes: readonly RouteConsumesInfo[]): string[] {
  const drift: string[] = [];
  for (const op of operations.filter((o) => !P2_PENDING_OPERATIONS.has(o.operationId))) {
    const route = routes.find((r) => r.method === op.method && toOpenApi(r.url) === op.path);
    if (!route) {
      drift.push(`${op.operationId}: no route`);
      continue;
    }
    const expected = declaredRequestMediaTypes(op) ?? DEFAULT_CONSUMES;
    const actual = [...route.consumes].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      drift.push(`${op.operationId}: route ${JSON.stringify(actual)} != contract ${JSON.stringify(expected)}`);
  }
  return drift;
}

function wellFormed(name: string, transformationId: string): string {
  if (name === "transformationId") return transformationId;
  if (name === "gateCode") return "G1";
  if (name === "dimensionCode") return "strategy";
  if (name === "submissionNo" || name === "versionNo") return "1";
  return crypto.randomUUID();
}

type Problem = { code: string; errors: { pointer: string; code: string }[] };

/**
 * Live sweep: each body-carrying operation, sent every media type it does not declare (and a body with no
 * Content-Type), answers the declared 400 validation.content_type and writes nothing. Returns the operation IDs checked.
 */
export async function exerciseUndeclaredMediaTypes(
  ctx: { api: TestApi; world: World; session: Session },
  operations: readonly Operation[],
): Promise<{ bodyOperations: string[]; getOperations: string[]; requests: number }> {
  const { api, world, session } = ctx;
  const transformationId = await createTransformationRow(api.db, world.orgA.id, world.a1, world.office.id);
  const bodyOperations: string[] = [];
  const getOperations: string[] = [];
  let requests = 0;
  for (const op of operations.filter((o) => !P2_PENDING_OPERATIONS.has(o.operationId))) {
    const url = op.path.replace(/\{([A-Za-z]+)\}/g, (_, n: string) => wellFormed(n, transformationId));
    if (!BODY_METHODS.has(op.method)) {
      // GET: no body is ever read, so the media type is irrelevant and never refused.
      const res = await call<Problem>(api.app, op.method, url, {
        session,
        headers: { "content-type": "text/plain" },
      });
      requests += 1;
      const codes = res.status === 400 ? res.body.errors.map((e) => e.code) : [];
      expect(codes, op.operationId).not.toContain("validation.content_type");
      getOperations.push(op.operationId);
      continue;
    }
    const declared = declaredRequestMediaTypes(op) ?? DEFAULT_CONSUMES;
    const expectedDetail = `Send the request body as ${declared.join(" or ")}.`;
    const undeclared: Array<string | null> = [
      ...CANDIDATE_MEDIA_TYPES.filter((t) => !declared.includes(t.split(";")[0]!)),
      null, // a body with no Content-Type
    ];
    for (const contentType of undeclared) {
      const res = await call<Problem>(api.app, op.method, url, {
        session,
        headers: { ...(contentType === null ? {} : { "content-type": contentType }), "if-match": '"1"' },
        body: Buffer.from('{"probe":"x"}'),
      });
      requests += 1;
      expect([op.operationId, String(contentType), res.status], JSON.stringify(res.body)).toEqual([
        op.operationId,
        String(contentType),
        400,
      ]);
      expect(res.body.errors, `${op.operationId} ${String(contentType)}`).toEqual([
        { pointer: "", code: "validation.content_type", message: expectedDetail },
      ]);
      expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([]);
    }
    bodyOperations.push(op.operationId);
  }
  return { bodyOperations, getOperations, requests };
}
