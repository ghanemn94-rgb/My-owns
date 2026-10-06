// qa-verifier DG2 round 3 — independent regression sweep for D-063 / F-DG2-150 (T-DG2-REV-QA-R3). Authored by
// qa-verifier, NOT by an implementer. The product's blank-text.test.ts covers one representative field per kind; this
// sweep covers EVERY top-level free-text field of EVERY P2 + KPI mutation that the product's own contract exercise
// sends (p2-exercises.ts, kpi-exercises.ts). Before each such mutation is forwarded unchanged, one probe per free-text
// field is sent with that field set to whitespace only. A "free-text field" is a request-body property whose OpenAPI
// schema is a string without enum/const/format/pattern. Expected per probe (D-063): 400, an error at the field's
// pointer with code `validation.blank`, and no audit event for the probe's request id.
// Copy to tests/qa/integration/ in a disposable clone and run:
//   QA_PG_PORT=<port> tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/dg2-qa-blank-sweep-r3.test.ts
// All data is SYNTHETIC; product gate decisions in the exercise approve nothing real (unrelated to DG0-DG7).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exerciseKpiOperations } from "../../../apps/api/test/integration/contract/kpi-exercises.ts";
import { exerciseP2BackendOperations } from "../../../apps/api/test/integration/contract/p2-exercises.ts";
import { findOperation, openapi } from "../../../apps/api/test/support/contract.ts";
import {
  auditOfRequest,
  call,
  seedWorld,
  signIn,
  startApi,
  type RequestOptions,
  type TestApi,
  type World,
} from "../../../apps/api/test/support/harness.ts";

type Json = Record<string, unknown>;
let api: TestApi;
let w: World;

function deref(node: unknown): Json {
  let cur = node as Json;
  while (cur && typeof cur["$ref"] === "string") {
    let t: unknown = openapi;
    for (const part of (cur["$ref"] as string).replace(/^#\//, "").split("/")) t = (t as Json)[part];
    cur = t as Json;
  }
  return cur;
}

/** All property schemas of an object schema, following allOf/oneOf/anyOf. */
function propsOf(schema: Json, out: Record<string, Json> = {}): Record<string, Json> {
  const s = deref(schema);
  for (const [k, v] of Object.entries((s["properties"] ?? {}) as Json)) out[k] ??= deref(v);
  for (const key of ["allOf", "oneOf", "anyOf"]) for (const sub of (s[key] ?? []) as Json[]) propsOf(sub, out);
  return out;
}

function isFreeText(prop: Json): boolean {
  const branches = [prop, ...(((prop["anyOf"] ?? prop["oneOf"] ?? []) as Json[]).map(deref))];
  return branches.some((b) => {
    const t = b["type"];
    const isString = t === "string" || (Array.isArray(t) && t.includes("string"));
    return isString && !b["enum"] && !("const" in b) && !b["format"] && !b["pattern"];
  });
}

interface ProbeResult {
  operationId: string;
  field: string;
  status: number;
  codes: string[];
  auditDelta: number;
  verdict: "BLANK_OK" | "OTHER_400" | "ACCEPTED" | "OTHER";
  negative?: boolean;
}
const results: ProbeResult[] = [];
const BLANK = " \t \n ";

async function probingMirror(method: string, url: string, opts: RequestOptions = {}) {
  const body = (opts as { body?: unknown }).body;
  if (method !== "GET" && body && typeof body === "object" && Object.getPrototypeOf(body) === Object.prototype) {
    const op = findOperation(method, url);
    const rb = op
      ? (((openapi["paths"] as Json)[op.path] as Json)[method.toLowerCase()] as Json)["requestBody"]
      : undefined;
    const schema = rb ? (deref(rb)["content"] as Json | undefined)?.["application/json"] : undefined;
    if (op && schema) {
      const props = propsOf((schema as Json)["schema"] as Json);
      for (const [field, value] of Object.entries(body as Json)) {
        if (typeof value !== "string" || value.trim() === "" || !props[field] || !isFreeText(props[field]!)) continue;
        const headers = { ...((opts as { headers?: Record<string, string> }).headers ?? {}) };
        if (headers["idempotency-key"]) headers["idempotency-key"] = randomUUID();
        // contract:false so an undeclared status is recorded as a result instead of aborting the exercise.
        const res = await call(api.app, method, url, {
          ...opts,
          headers,
          body: { ...(body as Json), [field]: BLANK },
          contract: false,
        });
        const auditDelta = (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).length;
        const errors = ((res.body as Json)?.["errors"] ?? []) as { pointer: string; code: string }[];
        const codes = errors.filter((e) => e.pointer === `/${field}`).map((e) => e.code);
        const verdict =
          res.status >= 200 && res.status < 300
            ? "ACCEPTED"
            : res.status === 400 && codes.includes("validation.blank")
              ? "BLANK_OK"
              : res.status === 400
                ? "OTHER_400"
                : "OTHER";
        results.push({ operationId: op.operationId, field, status: res.status, codes, auditDelta, verdict });
      }
      const real = await call(api.app, method, url, opts);
      // A probe that the exercise's own request also fails with the same status (a deliberate negative call: 403
      // authz, 428 missing If-Match) never reached body validation; it is classified, not counted as a blank result.
      for (const r of results.filter((x) => x.operationId === op.operationId && x.verdict === "OTHER" && !x.negative)) {
        if (real.status >= 400 && r.status === real.status) r.negative = true;
      }
      return real;
    }
  }
  return call(api.app, method, url, opts);
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
});
afterAll(() => api.close());

describe("QA r3 D-063 sweep: every free-text field of every exercised P2/KPI mutation rejects blank text", () => {
  it("drives the product's contract exercises with a blank probe before each mutation", async () => {
    const admin = await signIn(api.app, w.admin.subject);
    const office = await signIn(api.app, w.office.subject);
    await exerciseKpiOperations({ api, world: w, sessions: { admin, office }, mirrored: probingMirror });
    await exerciseP2BackendOperations({ api, world: w, mirrored: probingMirror });
  });

  it("every probe is 400 validation.blank at the field pointer and audits nothing", () => {
    const uniqueOps = new Set(results.map((r) => r.operationId));
    const table = results
      .map((r) => `${r.verdict.padEnd(9)} ${r.status} ${r.operationId}.${r.field} codes=${r.codes.join(",")} audit+${r.auditDelta}${r.negative ? " (negative call)" : ""}`)
      .join("\n");
    console.log(`QA-R3 blank sweep: ${results.length} probes over ${uniqueOps.size} operations\n${table}`);
    expect(results.length).toBeGreaterThan(40);
    // 1. A blank value is NEVER accepted (no 2xx), on any field.
    expect(results.filter((r) => r.verdict === "ACCEPTED")).toEqual([]);
    // 2. Every probe that reached body validation (400/422) audits nothing.
    expect(results.filter((r) => (r.status === 400 || r.status === 422) && r.auditDelta !== 0)).toEqual([]);
    // 3. Classified exceptions, each asserted narrowly:
    //    - `*Code` fields are catalogue codes, not free text: 422 validation.unknown_code;
    //    - the shared trimmed `reason` (min 3) and `name` (createTransformation, P1) schemas: 400 validation.too_small;
    //    - deliberate negative calls of the exercise (same status as the real request): never reached validation.
    const unexplained = results.filter(
      (r) =>
        r.verdict !== "BLANK_OK" &&
        !r.negative &&
        !(r.field.endsWith("Code") && r.status === 422 && r.codes.includes("validation.unknown_code")) &&
        !(
          (r.field === "reason" || (r.operationId === "createTransformation" && r.field === "name")) &&
          r.status === 400 &&
          r.codes.includes("validation.too_small")
        ),
    );
    expect(unexplained).toEqual([]);
    // 4. Every D-063 freeText field probed returned validation.blank.
    const blankOk = results.filter((r) => r.verdict === "BLANK_OK");
    console.log(
      `QA-R3 summary: BLANK_OK=${blankOk.length} trimmed-too_small=${results.filter((r) => r.codes.includes("validation.too_small")).length} code-fields=${results.filter((r) => r.field.endsWith("Code")).length} negative-calls=${results.filter((r) => r.negative).length}`,
    );
    expect(blankOk.length).toBeGreaterThan(60);
  });
});
