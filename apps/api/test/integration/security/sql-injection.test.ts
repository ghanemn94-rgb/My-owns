// The security suite, clause "SQL injection" (T-DG6-BE-E2; ADR-0052 §11; REQ-S16-030; p6-work-split §E/F.8) against
// a real PostgreSQL. The payloads are exactly ADR-0052 §11's: `' OR 1=1 --`, `'; DROP TABLE audit_event; --` and
// `1) OR (1=1`. The control is Kysely's parameterised SQL; this test proves the behaviour:
//  - every free-text query parameter of the list and search operations, derived from the contract (a GET whose
//    operationId starts with `list` or `search`, a string parameter without enum, format or pattern; `cursor` is an
//    opaque signed token and is excluded), gets each payload: the answer is 200 (no 500), and it contains no extra
//    row: every returned item is either a row this file stored with that very text, or a row the same query returns
//    for the payload's plain words without its quotes, operators and comment marks (a full-text search may match a
//    word such as "table" legitimately; an injected `OR 1=1` would return rows matching neither);
//  - a free-text body field (the T03 `gap`) stores each payload and returns it byte-identical, and the list's text
//    filter finds that row by the payload as literal text;
//  - afterwards `audit_event` still exists and still records the writes.
// All data is SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openapi } from "../../support/contract.ts";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { setupP2World, type P2World } from "../../support/p2-fixtures.ts";

/** ADR-0052 §11: the SQL injection payload set, exactly. */
const SQLI_PAYLOADS: readonly string[] = ["' OR 1=1 --", "'; DROP TABLE audit_event; --", "1) OR (1=1"];

let api: TestApi;
let w: World;
let p: P2World;
let admin: Session;
let journeyId: string;
/** Stored row ids by the payload text they carry (the T03 gaps and transformations this file created). */
const storedWith = new Map<string, string[]>();
const store = (payload: string, id: string) => storedWith.set(payload, [...(storedWith.get(payload) ?? []), id]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
type Json = Record<string, unknown>;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const T = () => `/api/v1/transformations/${p.transformationId}`;
const passed = new Set<string>();

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  admin = await signIn(api.app, w.admin.subject);
  // Ordinary rows, so a list an injection widened would show them.
  for (const gap of ["Synthetic ordinary gap one", "Synthetic ordinary gap two"]) {
    const r = await send("POST", `${T()}/tom-gaps`, {
      session: p.lead.session,
      body: { dimensionCode: "technology", gap },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  const j = await send("POST", `${T()}/journeys`, {
    session: p.lead.session,
    body: { name: "Synthetic onboarding journey", kind: "journey", state: "current" },
  });
  expect(j.status, JSON.stringify(j.body)).toBe(201);
  journeyId = j.body.id as string;
  const pain = await send("POST", `${T()}/journeys/${journeyId}/pain-points`, {
    session: p.lead.session,
    body: { description: "Synthetic pain point" },
  });
  expect(pain.status, JSON.stringify(pain.body)).toBe(201);
}, 120_000);
afterAll(() => api?.close());

// ------------------------------------------------------------------------------------------------ the contract set

const deref = (node: Json | undefined): Json => {
  let n: Json = node ?? {};
  while (typeof n["$ref"] === "string") {
    let cur: unknown = openapi;
    for (const part of (n["$ref"] as string).replace(/^#\//, "").split("/")) cur = (cur as Json)[part];
    n = cur as Json;
  }
  return n;
};
interface Param {
  readonly name: string;
  readonly required: boolean;
  readonly schema: Json;
}
interface ListOp {
  readonly operationId: string;
  readonly path: string;
  readonly params: readonly Param[];
  readonly freeText: readonly string[];
}
const isString = (s: Json) => s["type"] === "string" || (Array.isArray(s["type"]) && s["type"].includes("string"));
const isFreeText = (p: Param) =>
  isString(p.schema) && !p.schema["enum"] && !p.schema["format"] && !p.schema["pattern"] && p.name !== "cursor";

function listOperations(): ListOp[] {
  const out: ListOp[] = [];
  for (const [path, item] of Object.entries(openapi["paths"] as Record<string, Json>)) {
    const get = item["get"] as Json | undefined;
    const id = get?.["operationId"];
    if (typeof id !== "string" || !/^(list|search)[A-Z]/.test(id)) continue;
    const params = [...((item["parameters"] as Json[]) ?? []), ...((get!["parameters"] as Json[]) ?? [])]
      .map(deref)
      .filter((q) => q["in"] === "query")
      .map((q) => ({
        name: q["name"] as string,
        required: q["required"] === true,
        schema: deref(q["schema"] as Json),
      }));
    const freeText = params.filter(isFreeText).map((q) => q.name);
    if (freeText.length > 0) out.push({ operationId: id, path, params, freeText });
  }
  return out;
}

/** The URL of `op` with path parameters filled from this file's world and required query parameters satisfied. */
function urlOf(op: ListOp, extra: Record<string, string>): string {
  const path = op.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    if (name === "transformationId") return p.transformationId;
    if (name === "journeyId") return journeyId;
    throw new Error(`${op.operationId}: no fixture for path parameter ${name}`);
  });
  const query = new URLSearchParams();
  for (const q of op.params) {
    if (!q.required || q.name in extra) continue;
    if (q.name === "organizationId") query.set(q.name, w.orgA.id);
    else if (q.name === "transformationId") query.set(q.name, p.transformationId);
    else if (Array.isArray(q.schema["enum"])) query.set(q.name, String(q.schema["enum"][0]));
    else throw new Error(`${op.operationId}: no fixture for required query parameter ${q.name}`);
  }
  for (const [k, v] of Object.entries(extra)) query.set(k, v);
  const qs = query.toString();
  return qs === "" ? path : `${path}?${qs}`;
}

const idsOf = (body: Body): string[] =>
  ((body?.items as Body[]) ?? []).map((i) => String(i?.id ?? i?.recordId ?? i?.blockId ?? JSON.stringify(i)));
/** The payload's plain words: quotes, operators, parentheses, semicolons and comment marks removed. */
const wordsOf = (payload: string) =>
  payload
    .replace(/[^A-Za-z0-9_ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ------------------------------------------------------------------------------------------------ tests

describe("SQL injection (REQ-S16-030; ADR-0052 §11)", () => {
  it("free-text body fields store each payload as text; a served text filter matches it literally", async () => {
    for (const payload of SQLI_PAYLOADS) {
      // The T03 gap: stored and returned byte-identical.
      const created = await send("POST", `${T()}/tom-gaps`, {
        session: p.lead.session,
        body: { dimensionCode: "technology", gap: payload },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      store(payload, created.body.id as string);
      const got = await send("GET", `${T()}/tom-gaps/${created.body.id}`, { session: p.lead.session });
      expect(got.status).toBe(200);
      expect(got.body.gap).toBe(payload);
      expect(got.raw.body).toContain(JSON.stringify(payload));
      // A transformation name carrying the payload: listTransformations' `q` (a case-insensitive match on code or
      // name) treats the payload as literal text and finds exactly that transformation, not the lead's other one.
      const t = await send("POST", "/api/v1/transformations", {
        session: p.lead.session,
        body: { businessUnitId: w.a1, name: `Synthetic ${payload} transformation`, mode: "end_to_end" },
      });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      store(payload, t.body.id as string);
      expect(t.body.name).toBe(`Synthetic ${payload} transformation`);
      const found = await send("GET", `/api/v1/transformations?q=${encodeURIComponent(payload)}`, {
        session: p.lead.session,
      });
      expect(found.status).toBe(200);
      expect(idsOf(found.body)).toEqual([t.body.id]);
    }
    const all = await send("GET", "/api/v1/transformations", { session: p.lead.session });
    expect(idsOf(all.body)).toContain(p.transformationId); // the row an `OR 1=1` would have added
    passed.add("body");
  });

  it("every free-text query parameter of the list and search operations: never 500, no extra rows", async () => {
    const ops = listOperations();
    // The contract set (listed in the output) must not silently shrink to nothing.
    expect(ops.length).toBeGreaterThanOrEqual(10);
    const failures: string[] = [];
    const report: string[] = [];
    const notServed: string[] = [];
    let probes = 0;
    for (const op of ops) {
      for (const param of op.freeText) {
        // The caller: the first of lead, ADM and office for whom the operation answers 200 with a plain no-match
        // value in `param` (or, when `param` is not served yet, the first for whom it answers 400 validation).
        const token = `zq${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
        let picked: { session: Session; status: number; body: Body } | null = null;
        for (const s of [p.lead.session, admin, p.office.session]) {
          const r = await send("GET", urlOf(op, { [param]: token }), { session: s });
          if (r.status === 200) {
            picked = { session: s, status: 200, body: r.body };
            break;
          }
          if (r.status === 400 && r.body?.code === "validation" && picked === null)
            picked = { session: s, status: 400, body: r.body };
        }
        if (picked === null) {
          failures.push(`${op.operationId}?${param}: no caller in this world gets 200 for a plain value`);
          continue;
        }
        const { session } = picked;
        if (picked.status === 400) notServed.push(`${op.operationId}?${param}`);
        for (const payload of SQLI_PAYLOADS) {
          probes += 1;
          const res = await send("GET", urlOf(op, { [param]: payload }), { session });
          // The payload gets exactly the answer a plain value gets: never a 500, never a different refusal.
          if (res.status !== picked.status || (res.status === 400 && res.body?.code !== "validation")) {
            failures.push(
              `${op.operationId}?${param}=${payload}: ${res.status} ${res.body?.code} (plain: ${picked.status})`,
            );
            continue;
          }
          if (res.status !== 200) {
            report.push(`${op.operationId}?${param} "${payload}": 400 validation, like a plain value (not served yet)`);
            continue;
          }
          const words = wordsOf(payload);
          const plain = words.length >= 2 ? await send("GET", urlOf(op, { [param]: words }), { session }) : null;
          const allowed = new Set([
            ...idsOf(picked.body),
            ...(plain !== null && plain.status === 200 ? idsOf(plain.body) : []),
            ...(storedWith.get(payload) ?? []),
          ]);
          const extra = idsOf(res.body).filter((id) => !allowed.has(id));
          if (extra.length > 0)
            failures.push(`${op.operationId}?${param}=${payload}: ${extra.length} extra row(s) ${extra.slice(0, 3)}`);
          report.push(`${op.operationId}?${param} "${payload}": 200, ${idsOf(res.body).length} row(s)`);
        }
      }
    }
    expect(failures).toEqual([]);
    passed.add("query");
    console.log(`  ${report.join("\n  ")}`);
    console.log(
      `  operations: ${ops.map((o) => `${o.operationId}(${o.freeText.join(",")})`).join(", ")}; ${probes} probes`,
    );
    console.log(`  declared but not served yet (400 validation for any value): ${notServed.join(", ") || "none"}`);
  });

  it("audit_event still exists and still records writes", async () => {
    const before = await api.db
      .selectFrom("audit_event")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .execute();
    expect(before.length).toBeGreaterThan(0);
    const ids = [...storedWith.values()].flat();
    expect(ids.length).toBe(2 * SQLI_PAYLOADS.length);
    for (const id of ids) {
      const events = await api.db.selectFrom("audit_event").select("action").where("record_id", "=", id).execute();
      expect(events.map((e) => e.action).filter((a) => /^(tom_gap|transformation)\.create$/.test(a))).toHaveLength(1);
    }
    passed.add("audit");
  });

  it("clause summary", () => {
    expect([...passed].sort()).toEqual(["audit", "body", "query"]);
    console.log(
      `PASS REQ-S16-030 SQL injection: ${SQLI_PAYLOADS.length} payloads in every free-text list/search query parameter and a body field: no 500, no extra rows, stored as text`,
    );
  });
});
