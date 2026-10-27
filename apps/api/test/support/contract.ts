// Contract validator (ADR-0007 §2): every response a test produces is checked against docs/api/openapi.yaml —
// the status must be declared for the matched operation, the body must match the declared schema for its media type,
// and declared ETag/Location headers must be present and well-formed. JSON Schema 2020-12 via ajv (OpenAPI 3.1).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { parse as parseYaml } from "yaml";

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

export const OPENAPI_PATH = fileURLToPath(new URL("../../../../docs/api/openapi.yaml", import.meta.url));

type Json = Record<string, unknown>;
export interface Operation {
  readonly method: string;
  readonly path: string;
  readonly operationId: string;
  readonly responses: Record<string, Json>;
  readonly regex: RegExp;
  readonly literalSegments: number;
}

export const openapi = parseYaml(readFileSync(OPENAPI_PATH, "utf8")) as Json;

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
addFormats(ajv);
ajv.addSchema(openapi, "openapi");

function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as Json).map(([k, v]) => [
        k,
        k === "$ref" && typeof v === "string" && v.startsWith("#/") ? `openapi${v}` : rewriteRefs(v),
      ]),
    );
  }
  return node;
}

function deref(node: Json): Json {
  const ref = node["$ref"];
  if (typeof ref !== "string") return node;
  let cur: unknown = openapi;
  for (const part of ref.replace(/^#\//, "").split("/")) cur = (cur as Json)[part];
  return deref(cur as Json);
}

export const operations: Operation[] = [];
for (const [path, item] of Object.entries(openapi["paths"] as Json)) {
  for (const [method, op] of Object.entries(item as Json)) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
    const o = op as Json;
    const segments = path.split("/").filter(Boolean);
    operations.push({
      method: method.toUpperCase(),
      path,
      operationId: o["operationId"] as string,
      responses: o["responses"] as Record<string, Json>,
      regex: new RegExp(`^${path.replace(/\{[^}]+\}/g, "[^/]+")}$`),
      literalSegments: segments.filter((s) => !s.startsWith("{")).length,
    });
  }
}

export function findOperation(method: string, url: string): Operation | undefined {
  const path = url.split("?")[0]!;
  return operations
    .filter((o) => o.method === method.toUpperCase() && o.regex.test(path))
    .sort((a, b) => b.literalSegments - a.literalSegments)[0];
}

const compiled = new Map<string, ReturnType<typeof ajv.compile>>();
function validatorFor(key: string, schema: unknown) {
  let v = compiled.get(key);
  if (!v) {
    v = ajv.compile(rewriteRefs(schema) as Json);
    compiled.set(key, v);
  }
  return v;
}

export interface ContractResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string | string[] | number | undefined>;
  readonly body: string;
}

/** Operations and statuses exercised in this test file (per worker), for coverage assertions. */
export const exercised = new Map<string, Set<number>>();

/**
 * T-DG6-BE-F (ADR-0052 §7, REQ-S16-027): one entry per response that `assertContract` VALIDATED in this test file
 * (status declared, body against its schema, media type equal to the declared one, a problem body also against
 * `Problem`). `response-validation.test.ts` reads it after the contract suite to find every operation that returned no
 * validated response. Entries are appended only after every check passed; a failed check throws before it.
 */
export interface ValidatedResponse {
  readonly operationId: string;
  readonly status: number;
  /** The response media type without parameters; "" for a body-less response. */
  readonly mediaType: string;
  /** For a problem body: its `type` and `code`; otherwise null. */
  readonly problemType: string | null;
  readonly problemCode: string | null;
  /** For a problem body with `errors[]`: the pointer of each entry (undefined when an entry has none); otherwise null. */
  readonly errorPointers: readonly (string | undefined)[] | null;
  /** For a 2xx JSON object body: whether it carries the own key `nextCursor`; otherwise null. */
  readonly hasNextCursor: boolean | null;
}
export const validatedResponses: ValidatedResponse[] = [];

/** Throws a descriptive error when the response breaks the contract. Returns the matched operation. */
export function assertContract(method: string, url: string, res: ContractResponse): Operation {
  const op = findOperation(method, url);
  if (!op) throw new Error(`contract: no OpenAPI operation for ${method} ${url}`);
  const declared = op.responses[String(res.statusCode)] ?? op.responses["default"];
  if (!declared) {
    throw new Error(
      `contract: ${op.operationId} does not declare status ${res.statusCode} (declared: ${Object.keys(op.responses).join(", ")}); body: ${res.body.slice(0, 300)}`,
    );
  }
  const response = deref(declared);
  const content = response["content"] as Record<string, Json> | undefined;
  const mediaType = String(res.headers["content-type"] ?? "")
    .split(";")[0]!
    .trim();
  let parsed: unknown = undefined; // T-DG6-BE-F: the validated JSON body, for the ledger below
  if (content) {
    const media = content[mediaType];
    if (!media)
      throw new Error(
        `contract: ${op.operationId} ${res.statusCode} returned ${mediaType || "no content-type"}, declared ${Object.keys(content).join(", ")}`,
      );
    const validate = validatorFor(`${op.operationId}:${res.statusCode}:${mediaType}`, media["schema"]);
    // Binary media (evidence content, application/octet-stream) is validated as the string it is, never parsed.
    const isJson = mediaType === "application/json" || mediaType.endsWith("+json");
    const body = res.body === "" ? undefined : isJson ? JSON.parse(res.body) : res.body;
    if (!validate(body)) {
      throw new Error(
        `contract: ${op.operationId} ${res.statusCode} body violates the schema: ${ajv.errorsText(validate.errors)}\n${res.body.slice(0, 500)}`,
      );
    }
    // T-DG6-BE-F (ADR-0052 §7): every problem body (application/problem+json) is a `Problem` whose `status` is the
    // response status, whatever the operation's own declaration says. A declared non-problem error body (getReadiness
    // 503: the Readiness JSON) is validated against its own schema above only.
    if (res.statusCode >= 400 && mediaType === "application/problem+json") {
      const problemCheck = validatorFor("component:Problem", { $ref: "#/components/schemas/Problem" });
      if (!problemCheck(body) || (body as Json)["status"] !== res.statusCode) {
        throw new Error(
          `contract: ${op.operationId} ${res.statusCode} error body is not a Problem with status ${res.statusCode}: ${ajv.errorsText(problemCheck.errors)}\n${res.body.slice(0, 300)}`,
        );
      }
    }
    if (isJson) parsed = body;
  } else if (res.body !== "") {
    throw new Error(
      `contract: ${op.operationId} ${res.statusCode} declares no body but returned one: ${res.body.slice(0, 200)}`,
    );
  }
  const headers = (response["headers"] ?? {}) as Record<string, Json>;
  for (const [name, h] of Object.entries(headers)) {
    const value = res.headers[name.toLowerCase()];
    if ((name === "ETag" || name === "Location") && value === undefined) {
      throw new Error(`contract: ${op.operationId} ${res.statusCode} must send header ${name}`);
    }
    if (value === undefined || name === "Set-Cookie") continue;
    const schema = deref(h)["schema"] as Json | undefined;
    if (schema) {
      const v = validatorFor(`${op.operationId}:${res.statusCode}:header:${name}`, schema);
      const typed = schema["type"] === "integer" ? Number(value) : String(value);
      if (!v(typed)) throw new Error(`contract: header ${name}=${String(value)} violates ${JSON.stringify(schema)}`);
    }
  }
  if (res.headers["x-request-id"] === undefined)
    throw new Error(`contract: ${op.operationId} response has no X-Request-Id`);
  const seen = exercised.get(op.operationId) ?? new Set<number>();
  seen.add(res.statusCode);
  exercised.set(op.operationId, seen);
  // T-DG6-BE-F (ADR-0052 §7): record (operationId, status) of the validated response.
  const object = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : null;
  const isProblem = res.statusCode >= 400 && object !== null;
  validatedResponses.push({
    operationId: op.operationId,
    status: res.statusCode,
    mediaType,
    problemType: isProblem ? String(object["type"]) : null,
    problemCode: isProblem ? String(object["code"]) : null,
    errorPointers:
      isProblem && Array.isArray(object["errors"])
        ? (object["errors"] as Json[]).map((e) => (typeof e["pointer"] === "string" ? e["pointer"] : undefined))
        : null,
    hasNextCursor:
      res.statusCode >= 200 && res.statusCode < 300 && object !== null ? Object.hasOwn(object, "nextCursor") : null,
  });
  return op;
}

/** T-DG6-BE-F: operationId -> the first JSON request body the server accepted (2xx) in this test file. */
export const acceptedRequestBodies = new Map<string, unknown>();

/**
 * Lockstep check for request schemas: a body the server ACCEPTED (2xx) must also be valid under the operation's
 * OpenAPI requestBody schema. Catches zod mirrors that are more permissive than the contract.
 */
export function assertAcceptedRequest(method: string, url: string, status: number, body: unknown): void {
  if (status < 200 || status >= 300 || body === undefined) return;
  const op = findOperation(method, url);
  if (!op) return;
  const item = (openapi["paths"] as Json)[op.path] as Json;
  const rb = (item[method.toLowerCase()] as Json)["requestBody"] as Json | undefined;
  if (!rb) return;
  const schema = ((deref(rb)["content"] as Record<string, Json>)["application/json"] ?? {})["schema"];
  // Non-JSON request bodies (application/octet-stream uploads) carry raw bytes; there is no JSON schema to apply.
  if (schema === undefined) return;
  const validate = validatorFor(`${op.operationId}:request`, schema);
  if (!validate(body)) {
    throw new Error(
      `contract: ${op.operationId} accepted a request body the contract rejects: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  // T-DG6-BE-F (ADR-0052 §7): the first contract-valid body the server accepted per operation, which the auditor sweep
  // of response-validation.test.ts replays so that a route's validation passes and its authorization answers.
  if (!acceptedRequestBodies.has(op.operationId)) acceptedRequestBodies.set(op.operationId, structuredClone(body));
}

/** Validate a value against a named component schema (e.g. "Transformation"). */
export function matchesComponent(name: string, value: unknown): { ok: boolean; errors: string } {
  const v = validatorFor(`component:${name}`, { $ref: `#/components/schemas/${name}` });
  const ok = v(value) as boolean;
  return { ok, errors: ok ? "" : ajv.errorsText(v.errors) };
}
