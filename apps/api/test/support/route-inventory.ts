// T-DG6-BE-C2 (ADR-0051 §5, REQ-S02-006): request generation from the contract schemas for the route-inventory sweep
// (test/integration/hardening/route-inventory.test.ts).
//
// Everything here is derived from docs/api/openapi.yaml, never from a hand-written list of routes:
//   - `eligibleOperations` selects the sweep's operations (POST, PUT, PATCH, DELETE) minus the ADR-0051 §5 exclusions;
//   - `exampleOf` builds a minimal instance that the contract schema ACCEPTS (required properties only, the first enum
//     value, a value matching the pattern/format/bounds), checked with ajv against the schema itself, so an
//     unauthorized call is refused by authorization and not by validation;
//   - `invalidRequest` builds the ADR-0051 §5 case-4 input: the body without one required property, or, for an
//     operation without a required body property, a malformed path id;
//   - `requestFor` assembles method, URL, headers and payload for a declared request media type.
// All data is SYNTHETIC. Nothing here grants a business approval; nothing reads or writes DG0-DG7.
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { v7 as uuidv7 } from "uuid";
import { openapi, operations, type Operation } from "./contract.ts";

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
type Json = Record<string, unknown>;

/** The unsafe methods ADR-0051 §5 sweeps. */
export const UNSAFE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * ADR-0051 §5 exclusions besides the pending aggregate, by operation id with the reason:
 *   - devLogin: the one public unsafe operation of P1 (session bootstrap, ADR-0005; checks Origin itself, AUTH_MODE=dev);
 *   - receiveWebhook: the signature-authenticated webhook receiver of ADR-0056 (public, CSRF-exempt; its own signature
 *     sweep in test/integration/integrations/).
 * The sweep also proves that these are exactly the public unsafe routes of the running server, so a new public
 * mutation cannot hide behind this list.
 */
export const SWEEP_EXCLUSIONS: ReadonlyMap<string, string> = new Map([
  ["devLogin", "public session bootstrap (ADR-0005; ADR-0051 §5)"],
  ["receiveWebhook", "signature-authenticated webhook receiver (ADR-0056; its own signature sweep)"],
]);

export function eligibleOperations(pending: ReadonlySet<string>): Operation[] {
  return operations.filter(
    (o) => UNSAFE_METHODS.has(o.method) && !pending.has(o.operationId) && !SWEEP_EXCLUSIONS.has(o.operationId),
  );
}

// ------------------------------------------------------------------------------------------------ schema access

function resolve(node: unknown): Json | undefined {
  let cur = node as Json | undefined;
  while (cur && typeof cur["$ref"] === "string") {
    let next: unknown = openapi;
    for (const part of (cur["$ref"] as string).replace(/^#\//, "").split("/")) next = (next as Json)[part];
    cur = next as Json;
  }
  return cur;
}

function operationObject(op: Operation): Json {
  return ((openapi["paths"] as Json)[op.path] as Json)[op.method.toLowerCase()] as Json;
}

export interface PathParameter {
  readonly name: string;
  readonly schema: Json;
}

export function pathParameters(op: Operation): PathParameter[] {
  const item = (openapi["paths"] as Json)[op.path] as Json;
  const all = [
    ...((item["parameters"] as Json[] | undefined) ?? []),
    ...((operationObject(op)["parameters"] as Json[] | undefined) ?? []),
  ]
    .map((p) => resolve(p)!)
    .filter((p) => p["in"] === "path");
  // An operation-level parameter overrides a path-level one of the same name (OpenAPI 3.1 §4.8.12).
  const byName = new Map<string, PathParameter>();
  for (const p of all)
    byName.set(p["name"] as string, { name: p["name"] as string, schema: resolve(p["schema"]) ?? {} });
  return [...byName.values()];
}

/** The REQUIRED query parameters of the operation (a valid request sends each; e.g. `organizationId`). */
export function requiredQueryParameters(op: Operation): PathParameter[] {
  const item = (openapi["paths"] as Json)[op.path] as Json;
  return [
    ...((item["parameters"] as Json[] | undefined) ?? []),
    ...((operationObject(op)["parameters"] as Json[] | undefined) ?? []),
  ]
    .map((p) => resolve(p)!)
    .filter((p) => p["in"] === "query" && p["required"] === true)
    .map((p) => ({ name: p["name"] as string, schema: resolve(p["schema"]) ?? {} }));
}

/** The REQUIRED header parameters (e.g. `X-File-Name` of an upload or an import), lower-cased. */
export function requiredHeaderParameters(op: Operation): PathParameter[] {
  const item = (openapi["paths"] as Json)[op.path] as Json;
  return [
    ...((item["parameters"] as Json[] | undefined) ?? []),
    ...((operationObject(op)["parameters"] as Json[] | undefined) ?? []),
  ]
    .map((p) => resolve(p)!)
    .filter((p) => p["in"] === "header" && p["required"] === true)
    .map((p) => ({ name: (p["name"] as string).toLowerCase(), schema: resolve(p["schema"]) ?? {} }));
}

/** The declared request media types of the operation (empty for a body-less operation). */
export function requestMediaTypes(op: Operation): string[] {
  const rb = resolve(operationObject(op)["requestBody"]);
  return Object.keys((rb?.["content"] as Json | undefined) ?? {});
}

export function requestBodySchema(op: Operation): Json | undefined {
  const rb = resolve(operationObject(op)["requestBody"]);
  const media = ((rb?.["content"] as Json | undefined) ?? {})["application/json"] as Json | undefined;
  return media === undefined ? undefined : (media["schema"] as Json | undefined);
}

export function requestBodyRequired(op: Operation): boolean {
  return resolve(operationObject(op)["requestBody"])?.["required"] === true;
}

// ------------------------------------------------------------------------------------------------ validation

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

const compiled = new WeakMap<object, ReturnType<typeof ajv.compile>>();
/** Whether `value` is valid under the (contract) schema `schema`. */
export function accepts(schema: Json, value: unknown): boolean {
  let v = compiled.get(schema);
  if (!v) {
    v = ajv.compile(rewriteRefs(schema) as Json);
    compiled.set(schema, v);
  }
  return v(value) as boolean;
}

/** The ajv error text for `value` under `schema` ("" when valid), for failure messages. */
export function explain(schema: Json, value: unknown): string {
  return accepts(schema, value) ? "" : ajv.errorsText(compiled.get(schema)!.errors);
}

// ------------------------------------------------------------------------------------------------ example generation

/** Values for named properties and path parameters: the sweep's real target records (filled by the test). */
export type Anchors = ReadonlyMap<string, string>;

/** Strings tried, in order, for a `pattern` the generator cannot otherwise satisfy (each checked with ajv). */
const PATTERN_CANDIDATES = [
  "abc",
  "abc_def",
  "a1",
  "ABC",
  "A1",
  "G1",
  "g1.abc",
  "q1",
  "q01",
  "T01",
  "abc.def",
  "1",
  "1.00",
  "0.5",
  "diagnose",
  "diagnose.abc",
  "2026-11-01",
  "2026-11",
  "2026-Q4",
  "#0078FF",
  "SAR",
  "en",
  "Asia/Riyadh",
  "+966500000000",
  "a".repeat(32),
  "A".repeat(43),
  "abc-def",
  "09:00",
  "09:00:00",
  "https://example.invalid/synthetic",
  "x",
];

function stringFor(schema: Json, name: string | undefined, anchors: Anchors): string {
  const format = schema["format"] as string | undefined;
  if (name !== undefined && anchors.has(name) && accepts(schema, anchors.get(name))) return anchors.get(name)!;
  if (format === "uuid") return uuidv7();
  if (format === "date") return "2026-11-01";
  if (format === "date-time") return "2026-11-01T09:00:00.000Z";
  if (format === "email") return "synthetic@example.invalid";
  if (format === "uri" || format === "url") return "https://example.invalid/synthetic";
  if (format === "uri-reference") return "/synthetic";
  // The contract's own example, when it has one the schema accepts.
  for (const example of (schema["examples"] as unknown[] | undefined) ?? [])
    if (typeof example === "string" && accepts(schema, example)) return example;
  const min = (schema["minLength"] as number | undefined) ?? 1;
  const max = (schema["maxLength"] as number | undefined) ?? Math.max(min, 16);
  if (schema["pattern"] !== undefined) {
    for (const c of PATTERN_CANDIDATES) if (accepts(schema, c)) return c;
    for (const c of PATTERN_CANDIDATES) {
      const padded = c.padEnd(min, c.slice(-1));
      if (accepts(schema, padded)) return padded;
    }
  }
  const text = "Synthetic".padEnd(min, "x").slice(0, Math.max(min, Math.min(max, 9)));
  return text;
}

function numberFor(schema: Json, integer: boolean): number {
  const lo =
    (schema["minimum"] as number | undefined) ??
    ((schema["exclusiveMinimum"] as number | undefined) ?? 0) + (schema["exclusiveMinimum"] !== undefined ? 1 : 0);
  const hi = (schema["maximum"] as number | undefined) ?? Number.MAX_SAFE_INTEGER;
  const v = Math.min(Math.max(lo, 1), hi);
  return integer ? Math.ceil(v) : v;
}

/**
 * A minimal instance that `schema` accepts, or `undefined` when none was found. `name` is the property (or path
 * parameter) name the value is for, used to place the sweep's anchors (e.g. `transformationId`).
 */
export function exampleOf(node: unknown, anchors: Anchors, name?: string, depth = 0): unknown {
  const schema = resolve(node);
  if (!schema || depth > 12) return undefined;
  if ("const" in schema) return schema["const"];
  if (Array.isArray(schema["enum"])) {
    const values = schema["enum"] as unknown[];
    return values.find((v) => v !== null) ?? values[0];
  }
  if (Array.isArray(schema["allOf"])) {
    const parts = (schema["allOf"] as unknown[]).map((p) => exampleOf(p, anchors, name, depth + 1));
    if (parts.every((p) => p !== null && typeof p === "object" && !Array.isArray(p))) {
      const merged = Object.assign({}, ...parts) as Json;
      const own = { ...schema };
      delete own["allOf"];
      const rest = Object.keys(own).some((k) => ["properties", "required"].includes(k))
        ? exampleOf(own, anchors, name, depth + 1)
        : {};
      const candidate = { ...merged, ...(rest as Json) };
      if (accepts(schema, candidate)) return candidate;
    }
    for (const p of parts) if (p !== undefined && accepts(schema, p)) return p;
  }
  for (const key of ["oneOf", "anyOf"]) {
    if (!Array.isArray(schema[key])) continue;
    for (const alternative of schema[key] as unknown[]) {
      // A branch narrows its parent: required lists and properties are combined, the branch wins elsewhere.
      const branch = resolve(alternative)!;
      const merged: Json = { ...schema, ...branch };
      merged["required"] = [
        ...new Set([
          ...((schema["required"] as string[] | undefined) ?? []),
          ...((branch["required"] as string[] | undefined) ?? []),
        ]),
      ];
      merged["properties"] = {
        ...((schema["properties"] as Json | undefined) ?? {}),
        ...((branch["properties"] as Json | undefined) ?? {}),
      };
      delete merged[key];
      const candidate = exampleOf(merged, anchors, name, depth + 1);
      if (candidate !== undefined && accepts(schema, candidate)) return candidate;
    }
    if (accepts(schema, null)) return null;
  }
  const types = [schema["type"]].flat().filter((t) => t !== undefined && t !== "null") as string[];
  const type = types[0] ?? (schema["properties"] !== undefined ? "object" : undefined);
  switch (type) {
    case "object": {
      const out: Json = {};
      const props = (schema["properties"] as Json | undefined) ?? {};
      for (const key of (schema["required"] as string[] | undefined) ?? []) {
        const v = exampleOf(props[key] ?? {}, anchors, key, depth + 1);
        if (v === undefined) return undefined;
        out[key] = v;
      }
      const minProps = (schema["minProperties"] as number | undefined) ?? 0;
      for (const key of Object.keys(props)) {
        if (Object.keys(out).length >= minProps) break;
        if (key in out) continue;
        const v = exampleOf(props[key], anchors, key, depth + 1);
        if (v !== undefined) out[key] = v;
      }
      // A free-form map (additionalProperties) with minProperties: synthetic keys.
      const extra = schema["additionalProperties"];
      for (let i = 0; Object.keys(out).length < minProps && extra !== false && i < minProps; i++) {
        const v = exampleOf(
          extra === true || extra === undefined ? { type: "string" } : extra,
          anchors,
          undefined,
          depth + 1,
        );
        if (v === undefined) return undefined;
        out[`synthetic_${i + 1}`] = v;
      }
      return out;
    }
    case "array": {
      const n = (schema["minItems"] as number | undefined) ?? 0;
      const items: unknown[] = [];
      for (let i = 0; i < n; i++) {
        const v = exampleOf(schema["items"] ?? {}, anchors, name, depth + 1);
        if (v === undefined) return undefined;
        items.push(v);
      }
      return items;
    }
    case "string":
      return stringFor(schema, name, anchors);
    case "integer":
      return numberFor(schema, true);
    case "number":
      return numberFor(schema, false);
    case "boolean":
      return false;
    default:
      return name !== undefined && anchors.has(name) ? anchors.get(name) : "Synthetic";
  }
}

/** A valid value for a path parameter (an anchor where the test has one, e.g. the real transformation id). */
export function pathValue(p: PathParameter, anchors: Anchors): string {
  if (anchors.has(p.name) && accepts(p.schema, anchors.get(p.name))) return anchors.get(p.name)!;
  const v = exampleOf(p.schema, new Map(), p.name);
  if (v === undefined || !accepts(p.schema, v))
    throw new Error(`route-inventory: no valid value for parameter ${p.name}: ${JSON.stringify(p.schema)}`);
  return String(v);
}

/** The path parameters that are ids (format uuid), the ones case 4 can malform. */
export function uuidParameters(op: Operation): PathParameter[] {
  return pathParameters(op).filter((p) => p.schema["format"] === "uuid");
}

/** Whether the operation names its target record explicitly by an anchored path parameter. */
export function targetsAnchor(op: Operation, anchors: Anchors): boolean {
  return pathParameters(op).some((p) => anchors.has(p.name));
}

// ------------------------------------------------------------------------------------------------ requests

export interface SweepRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  /** The payload: a JSON value, raw bytes, or undefined (no body). */
  readonly body: unknown;
  /** The request media type sent ("" for none). */
  readonly mediaType: string;
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The bytes sent for a non-JSON declared media type (never parsed before authorization). */
function rawBody(mediaType: string): Buffer {
  if (mediaType === "text/csv") return Buffer.from("name\nSynthetic\n", "utf8");
  if (mediaType === XLSX) return Buffer.from("PK\u0003\u0004synthetic", "latin1");
  return Buffer.from("synthetic", "utf8");
}

/** The media type the sweep sends: application/json when declared, else the first declared one. */
export function sweepMediaType(op: Operation): string {
  const types = requestMediaTypes(op);
  return types.includes("application/json") ? "application/json" : (types[0] ?? "");
}

function headersFor(op: Operation, mediaType: string): Record<string, string> {
  const headers: Record<string, string> = { "if-match": '"1"' };
  if (mediaType !== "" && mediaType !== "application/json") headers["content-type"] = mediaType;
  for (const h of requiredHeaderParameters(op)) {
    if (h.name === "if-match") continue;
    headers[h.name] =
      h.name === "x-file-name"
        ? mediaType === "text/csv"
          ? "synthetic.csv"
          : "synthetic.txt"
        : pathValue(h, new Map());
  }
  if (op.operationId === "uploadEvidenceContent") headers["x-file-name"] = "synthetic.txt";
  return headers;
}

/** The value case 4 puts in a path parameter: no contract path schema (uuid, pattern, enum, integer) accepts it. */
export const MALFORMED_PATH_VALUE = "not-a-valid-id!";

function urlOf(op: Operation, anchors: Anchors, malform?: string): string {
  const values = new Map(
    pathParameters(op).map((p) => [p.name, p.name === malform ? MALFORMED_PATH_VALUE : pathValue(p, anchors)]),
  );
  const path = op.path.replace(/\{([A-Za-z]+)\}/g, (_m, n: string) => {
    const v = values.get(n);
    if (v === undefined) throw new Error(`route-inventory: ${op.operationId} declares no path parameter {${n}}`);
    return encodeURIComponent(v);
  });
  const query = requiredQueryParameters(op).map((p) => `${p.name}=${encodeURIComponent(pathValue(p, anchors))}`);
  return query.length === 0 ? path : `${path}?${query.join("&")}`;
}

/** A contract-valid request (valid path parameters and a body the request schema accepts). */
export function requestFor(op: Operation, anchors: Anchors): SweepRequest & { readonly bodyValid: boolean } {
  const mediaType = sweepMediaType(op);
  const schema = requestBodySchema(op);
  let body: unknown = undefined;
  let bodyValid = true;
  if (mediaType === "application/json") {
    const example = schema === undefined ? {} : exampleOf(schema, anchors);
    bodyValid = example !== undefined && (schema === undefined || accepts(schema, example));
    body = example ?? {};
  } else if (mediaType !== "") {
    body = rawBody(mediaType);
  }
  return { method: op.method, url: urlOf(op, anchors), headers: headersFor(op, mediaType), body, mediaType, bodyValid };
}

export type InvalidKind =
  | "missing-required-property"
  | "malformed-path-id"
  | "malformed-path-parameter"
  | "body-not-an-object";

/**
 * ADR-0051 §5 case 4: an input that violates the contract schema. A malformed path id when the operation addresses a
 * record by an id (or a code) that is not one of the sweep's real records (see below); else the body without its first required
 * property when the JSON body schema has one; otherwise a malformed path id (a uuid parameter), else a malformed coded path
 * parameter (a pattern, enum or integer the value violates); otherwise (a JSON body with no required property and no
 * path parameter) a JSON array where the schema declares an object. `null` when the operation has no input that can be
 * made invalid (no body and no id parameter).
 */
export function invalidRequest(
  op: Operation,
  anchors: Anchors,
): (SweepRequest & { readonly kind: InvalidKind; readonly detail: string }) | null {
  const valid = requestFor(op, anchors);
  const schema = resolve(requestBodySchema(op));
  const required = (schema?.["required"] as string[] | undefined) ?? [];
  // A path id that is not one of the sweep's real records names a record that does not exist; a route that loads its
  // record before it reads the body then answers 404, which is correct. So such an operation gets the malformed id.
  // The same holds for a coded path parameter (a gate code, a record type): the generated code names nothing real.
  const randomIds = uuidParameters(op).filter((p) => !anchors.has(p.name));
  if (randomIds.length > 0) {
    const name = randomIds[randomIds.length - 1]!.name;
    return { ...valid, url: urlOf(op, anchors, name), kind: "malformed-path-id", detail: `{${name}}` };
  }
  const randomCodes = pathParameters(op).filter(
    (p) => !anchors.has(p.name) && !accepts(p.schema, MALFORMED_PATH_VALUE),
  );
  if (randomCodes.length > 0) {
    const name = randomCodes[randomCodes.length - 1]!.name;
    return { ...valid, url: urlOf(op, anchors, name), kind: "malformed-path-parameter", detail: `{${name}}` };
  }
  if (
    valid.mediaType === "application/json" &&
    required.length > 0 &&
    valid.body !== null &&
    typeof valid.body === "object"
  ) {
    const key = required[0]!;
    const body = { ...(valid.body as Json) };
    delete body[key];
    if (!accepts(requestBodySchema(op)!, body))
      return { ...valid, body, kind: "missing-required-property", detail: `/${key}` };
  }
  const ids = uuidParameters(op);
  if (ids.length > 0) {
    const name = ids[ids.length - 1]!.name;
    return { ...valid, url: urlOf(op, anchors, name), kind: "malformed-path-id", detail: `{${name}}` };
  }
  const codes = pathParameters(op).filter((p) => !accepts(p.schema, MALFORMED_PATH_VALUE));
  if (codes.length > 0) {
    const name = codes[codes.length - 1]!.name;
    return { ...valid, url: urlOf(op, anchors, name), kind: "malformed-path-parameter", detail: `{${name}}` };
  }
  if (valid.mediaType === "application/json" && schema !== undefined && !accepts(requestBodySchema(op)!, [1])) {
    return { ...valid, body: [1], kind: "body-not-an-object", detail: "body [1]" };
  }
  return null;
}
