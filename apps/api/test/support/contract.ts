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
  if (content) {
    const media = content[mediaType];
    if (!media)
      throw new Error(
        `contract: ${op.operationId} ${res.statusCode} returned ${mediaType || "no content-type"}, declared ${Object.keys(content).join(", ")}`,
      );
    const validate = validatorFor(`${op.operationId}:${res.statusCode}:${mediaType}`, media["schema"]);
    const body = res.body === "" ? undefined : JSON.parse(res.body);
    if (!validate(body)) {
      throw new Error(
        `contract: ${op.operationId} ${res.statusCode} body violates the schema: ${ajv.errorsText(validate.errors)}\n${res.body.slice(0, 500)}`,
      );
    }
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
  return op;
}

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
  const validate = validatorFor(`${op.operationId}:request`, schema);
  if (!validate(body)) {
    throw new Error(
      `contract: ${op.operationId} accepted a request body the contract rejects: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(body).slice(0, 300)}`,
    );
  }
}

/** Validate a value against a named component schema (e.g. "Transformation"). */
export function matchesComponent(name: string, value: unknown): { ok: boolean; errors: string } {
  const v = validatorFor(`component:${name}`, { $ref: `#/components/schemas/${name}` });
  const ok = v(value) as boolean;
  return { ok, errors: ok ? "" : ajv.errorsText(v.errors) };
}
