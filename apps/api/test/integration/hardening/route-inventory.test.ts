// REQ-S02-006 route-inventory sweep (ADR-0051 §5; T-DG6-BE-C2; owner backend-workflow-engineer).
// Acceptance (requirements.csv, first half): "each control test that bypasses the UI and calls the API with invalid or
// unauthorized input is rejected". The second half ("clearing browser storage loses no submitted business data") is
// proven by ADR-0057's server-side drafts (slice H) and QA-D's e2e; this sweep does not claim it.
//
// GENERATED from docs/api/openapi.yaml: every operation whose method is POST, PUT, PATCH or DELETE, except exactly the
// p2-pending.ts aggregate (not routed yet), devLogin (the public session bootstrap) and receiveWebhook (ADR-0056, the
// signature-authenticated receiver with its own sweep), is called directly (no UI) in four cases:
//   1. unauthenticated (no session cookie):                      401 unauthenticated;
//   2. CSRF (a session, no X-CSRF-Token):                        403 csrf;
//   3. unauthorized (a user with no assignment in the target organization, valid CSRF, a contract-valid request):
//                                                                403 forbidden or 404 not_found, never 2xx;
//   4. invalid input (an authorized session; a body without a required property, or a malformed path id):
//                                                                400 with the uniform validation body, never 2xx/500.
// Case 3 runs twice: (3a) the organization's member with no assignment at all, over every eligible operation that
// names a target record; (3b) a user of ANOTHER organization holding every catalogue role there, over every operation
// whose path names the target organization's records (the real transformation, organization, business unit or user).
// Requests are generated from the contract schemas (test/support/route-inventory.ts); the request bodies of cases 1-3
// are VALID under the operation's request schema (checked with ajv), so a refusal comes from authentication, CSRF or
// authorization, never from validation.
//
// "Nothing persisted" (ADR-0051 §5): per request, the only audit rows it wrote are `authorization.denied` failure
// records (ADR-0004); per case, the count of `audit_event` rows other than `authorization.denied` is identical before
// and after, and so is a row fingerprint (count and md5 of every row) of every table of the private scratch database
// except the session table (an authenticated request refreshes its own session's idle timer, ADR-0005) and the
// authorization.denied rows of audit_event.
// Every operation ruled out of a case is named here with its reason and the test fails if any other is skipped.
//
// A DG1-DG5 operation that fails a case is a finding for the T-DG6-BE-C2 handback, not fixed here (p6-plan R1).
// All data is SYNTHETIC. Nothing here grants a business approval; nothing reads or writes DG0-DG7.
import { migrate } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { assertContract, operations, type Operation } from "../../support/contract.ts";
import {
  auditOfRequest,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { P2_PENDING_OPERATIONS } from "../../support/p2-pending.ts";
import {
  eligibleOperations,
  invalidRequest,
  pathParameters,
  requestFor,
  SWEEP_EXCLUSIONS,
  targetsAnchor,
  UNSAFE_METHODS,
  type Anchors,
  type SweepRequest,
} from "../../support/route-inventory.ts";

type Json = Record<string, unknown>;

/**
 * Case 3 exclusions: the operations of `{ permission: "authenticated" }` routes that act on the CALLER's own data and
 * name no other record (ADR-0006 "the handler scopes the data to the caller itself"). Any signed-in user may call them
 * on themselves, so there is no foreign target to be refused. Pinned: the test fails when the derived set differs.
 */
const CALLER_SCOPED: ReadonlyMap<string, string> = new Map([
  ["logout", "ends the caller's own session (ADR-0005)"],
  ["updateMyPreferences", "the caller's own language and display preferences"],
  ["previewFormula", "a stateless formula evaluation for the caller; it persists nothing (ADR-0047)"],
]);

/**
 * DG1-DG5 operations that refuse a case's input with another status than ADR-0051 §5 names, pinned so the set only
 * shrinks. Each is still a rejection with nothing persisted; each is reported as a finding in the T-DG6-BE-C2 handback
 * (p6-plan R1: reported, not fixed here). Key: `<case>:<operationId>`; value: the status it answers and why.
 */
const REPORTED_DEVIATIONS: ReadonlyMap<
  string,
  { readonly status: number; readonly code: string; readonly why: string }
> = new Map([
  [
    "4:createTomGap",
    {
      status: 422,
      code: "t03.dimension_required",
      why:
        "the contract's TomGapCreate requires dimensionCode, but the route parses it with a lenient schema " +
        "(apps/api/src/modules/transformations/registers.ts, tomGapCreateLenient) and refuses its absence as a " +
        "business rule (422, pointer /dimensionCode) instead of the uniform 400",
    },
  ],
]);

/**
 * Case 4 exclusions: operations with no input that can violate the contract (no request body and no path parameter).
 * Pinned: the test fails when the derived set differs.
 */
const NO_INVALID_INPUT: ReadonlyMap<string, string> = new Map([
  ["logout", "no body, no parameter"],
  ["requestDemoReset", "no body, no parameter (refused outside a demo database, 409 environment.not_demo)"],
]);

/** The table whose rows an authenticated request legitimately updates: its own session's last-seen time. */
const SESSION_TABLES = new Set(["user_session"]);

let api: TestApi;
let scratch: string | null = null;
let w: World;
let transformationId: string;
let everyone: Session;
let nobody: Session;
let outsider: Session;
let anchors: Anchors;
const eligible = eligibleOperations(P2_PENDING_OPERATIONS);

/**
 * Grants every catalogue role on the organization and, when given, every business role on `transformation` too, so
 * that no route's authorization answers before its validation (case 4) or a refusal is never for lack of a role (3b).
 */
async function holdEveryRole(userId: string, organizationId: string, transformation: string | null): Promise<void> {
  const roles = await api.db.selectFrom("role").select("code").orderBy("code").execute();
  const grantor = organizationId === w.orgA.id ? w.grantor.id : w.officeB.id;
  for (const { code } of roles) {
    await grant(api.db, grantor, userId, code, { type: "organization", id: organizationId }, organizationId);
    if (transformation !== null && !code.startsWith("ADM_"))
      await grant(api.db, grantor, userId, code, { type: "transformation", id: transformation }, organizationId);
  }
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_route_inventory");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  api = await startApi({ database: scratch });
  w = await seedWorld(api.db);
  transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  // A SYNTHETIC user of org A holding every catalogue role (case 2 and case 4: authorization never answers first).
  const all = await createUser(api.db, w.orgA.id);
  await holdEveryRole(all.id, w.orgA.id, transformationId);
  everyone = await signIn(api.app, all.subject);
  // Case 3a: org A's member with no assignment. Case 3b: a user of org B holding every catalogue role in org B.
  nobody = await signIn(api.app, w.nobody.subject);
  const foreign = await createUser(api.db, w.orgB.id);
  await holdEveryRole(foreign.id, w.orgB.id, null);
  outsider = await signIn(api.app, foreign.subject);
  anchors = new Map([
    ["transformationId", transformationId],
    ["organizationId", w.orgA.id],
    ["businessUnitId", w.a1],
    ["userId", w.office.id],
  ]);
}, 300_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

/** Sends one generated request outside the per-call contract assertion; contract deviations are collected instead. */
async function send(req: SweepRequest, session: Session | null, csrf: boolean): Promise<Res<Json>> {
  return call<Json>(api.app, req.method, req.url, {
    session,
    csrf,
    headers: req.headers,
    ...(req.body === undefined ? {} : { body: req.body }),
    contract: false,
  });
}

function contractDeviation(req: SweepRequest, res: Res<Json>): string | null {
  try {
    assertContract(req.method, req.url, { statusCode: res.status, headers: res.headers, body: res.raw.body });
    return null;
  } catch (e) {
    return (e as Error).message.split("\n")[0]!.slice(0, 240);
  }
}

/** Audit rows of the request other than the ADR-0004 failed-mutation record. */
async function writtenBy(res: Res<Json>): Promise<string[]> {
  const rows = await auditOfRequest(api.db, String(res.headers["x-request-id"]));
  return rows.map((r) => r.action).filter((a) => a !== "authorization.denied");
}

async function auditRowsBesidesDenials(): Promise<number> {
  const r = await api.owner.query<{ n: string }>(
    "SELECT count(*) AS n FROM audit_event WHERE action <> 'authorization.denied'",
  );
  return Number(r.rows[0]!.n);
}

/** count and md5 of every row of every base table of the scratch database, except the session table. */
async function fingerprint(): Promise<Map<string, string>> {
  const tables = await api.owner.query<{ s: string; t: string }>(
    `SELECT table_schema AS s, table_name AS t FROM information_schema.tables
      WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY 1, 2`,
  );
  const out = new Map<string, string>();
  for (const { s, t } of tables.rows) {
    if (SESSION_TABLES.has(t)) continue;
    const q = `"${s.replace(/"/g, '""')}"."${t.replace(/"/g, '""')}"`;
    // ADR-0004: a refused call may write its authorization.denied failure record, and nothing else.
    const where = t === "audit_event" ? "WHERE x.action <> 'authorization.denied'" : "";
    const r = await api.owner.query<{ n: string; h: string | null }>(
      `SELECT count(*) AS n, md5(coalesce(string_agg(x::text, E'\\n' ORDER BY x::text), '')) AS h FROM ${q} x ${where}`,
    );
    out.set(`${s}.${t}`, `${r.rows[0]!.n}:${r.rows[0]!.h}`);
  }
  return out;
}

function changedTables(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => before.get(k) !== after.get(k)).sort();
}

interface CaseResult {
  readonly swept: number;
  readonly statuses: Record<string, number>;
  readonly wrong: string[];
  readonly persisted: string[];
  readonly deviations: string[];
  /** Pinned REPORTED_DEVIATIONS this case reproduced exactly. */
  readonly reported: string[];
}

/**
 * Runs one case over `ops`: builds each request, sends it, and checks `expectRefusal` plus "nothing persisted" per
 * request. Returns the tallies; the caller asserts them and the case-level fingerprint.
 */
async function sweep(
  caseKey: string,
  ops: readonly Operation[],
  build: (op: Operation) => SweepRequest,
  session: Session | null,
  csrf: boolean,
  expectRefusal: (res: Res<Json>) => boolean,
): Promise<CaseResult> {
  const statuses: Record<string, number> = {};
  const wrong: string[] = [];
  const persisted: string[] = [];
  const deviations: string[] = [];
  const reported: string[] = [];
  for (const op of ops) {
    const req = build(op);
    const res = await send(req, session, csrf);
    statuses[res.status] = (statuses[res.status] ?? 0) + 1;
    const pinned = REPORTED_DEVIATIONS.get(`${caseKey}:${op.operationId}`);
    if (pinned !== undefined && res.status === pinned.status && res.body["code"] === pinned.code)
      reported.push(`${caseKey}:${op.operationId}`);
    else if (!expectRefusal(res))
      wrong.push(
        `${op.operationId} (${req.method} ${req.url}): ${res.status} ${JSON.stringify(res.body).slice(0, 700)}`,
      );
    const written = await writtenBy(res);
    if (written.length > 0) persisted.push(`${op.operationId}: ${written.join(", ")}`);
    const deviation = contractDeviation(req, res);
    if (deviation !== null) deviations.push(deviation);
  }
  return { swept: ops.length, statuses, wrong, persisted, deviations, reported };
}

/** Wraps a case with the ADR-0051 §5 case-level "nothing persisted" assertion. */
async function withNothingPersisted(label: string, run: () => Promise<CaseResult>): Promise<CaseResult> {
  const auditBefore = await auditRowsBesidesDenials();
  const before = await fingerprint();
  const result = await run();
  const after = await fingerprint();
  const auditAfter = await auditRowsBesidesDenials();
  console.info(
    `[route-inventory] case ${label}: ${result.swept} eligible operations swept; statuses ${JSON.stringify(result.statuses)}; ` +
      `audit rows besides authorization.denied ${auditBefore} -> ${auditAfter}; tables fingerprinted ${before.size}, changed ${changedTables(before, after).length} (${changedTables(before, after).join(", ") || "none"})`,
  );
  expect(result.wrong, `case ${label}: operations not refused as ADR-0051 §5 requires`).toEqual([]);
  expect(result.persisted, `case ${label}: a rejected call wrote an audit event`).toEqual([]);
  expect(auditAfter, `case ${label}: audit rows besides authorization.denied`).toBe(auditBefore);
  expect(changedTables(before, after), `case ${label}: tables whose rows changed`).toEqual([]);
  expect(result.deviations, `case ${label}: responses outside the contract`).toEqual([]);
  // A pinned deviation that no longer reproduces must leave the pin (the set only shrinks).
  const key = label.split(" ")[0]!;
  const pinnedHere = [...REPORTED_DEVIATIONS.keys()].filter((k) => k.startsWith(`${key}:`)).sort();
  expect(result.reported.sort(), `case ${label}: pinned REPORTED_DEVIATIONS reproduced`).toEqual(pinnedHere);
  if (pinnedHere.length > 0)
    console.info(`[route-inventory] case ${label}: reported deviations (handback findings): ${pinnedHere.join(", ")}`);
  return result;
}

const isProblem = (res: Res<Json>, status: number, type: string, code?: string) =>
  res.status === status &&
  String(res.headers["content-type"] ?? "").startsWith("application/problem+json") &&
  res.body["type"] === type &&
  (code === undefined || res.body["code"] === code);

const JSON_POINTER = /^(\/([^~/]|~[01])*)*$/;

describe("REQ-S02-006: the route-inventory sweep over every mutating operation of the contract (ADR-0051 §5)", () => {
  it("the inventory: eligible = every unsafe operation minus the pending aggregate and the two named exclusions", () => {
    const unsafe = eligibleOperations(new Set()).length + SWEEP_EXCLUSIONS.size;
    const pendingUnsafe = [...P2_PENDING_OPERATIONS].filter((id) =>
      eligibleOperations(new Set()).some((o) => o.operationId === id),
    );
    console.info(
      `[route-inventory] contract unsafe operations ${unsafe}; pending (not routed) ${pendingUnsafe.length} (${pendingUnsafe.join(", ") || "none"}); ` +
        `excluded ${[...SWEEP_EXCLUSIONS.keys()].join(", ")}; eligible ${eligible.length}`,
    );
    expect(eligible.length).toBe(unsafe - SWEEP_EXCLUSIONS.size - pendingUnsafe.length);
    expect(eligible.length).toBeGreaterThanOrEqual(450);
    // Every eligible operation is routed on the running server (none is silently missing from the sweep).
    const toOpenApi = (url: string) => url.replace(/:([A-Za-z]+)/g, "{$1}");
    const routed = new Set(api.routes.map((r) => `${r.method} ${toOpenApi(r.url)}`));
    expect(eligible.filter((o) => !routed.has(`${o.method} ${o.path}`)).map((o) => o.operationId)).toEqual([]);
  });

  it("the exclusions are exactly the public unsafe routes of the running server", () => {
    // A route declared { public: true } skips authentication and CSRF; the only unsafe ones must be the two exclusions.
    const toOpenApi = (url: string) => url.replace(/:([A-Za-z]+)/g, "{$1}");
    const publicUnsafe = api.routes
      .filter((r) => UNSAFE_METHODS.has(r.method) && (r.access as Json | undefined)?.["public"] === true)
      .map((r) => {
        const path = toOpenApi(r.url);
        return operations.find((o) => o.method === r.method && o.path === path)?.operationId ?? `${r.method} ${path}`;
      })
      .sort();
    expect(publicUnsafe).toEqual([...SWEEP_EXCLUSIONS.keys()].sort());
  });

  it("every case-3 and case-4 exclusion is derived, pinned and named", () => {
    const toOpenApi = (url: string) => url.replace(/:([A-Za-z]+)/g, "{$1}");
    const accessOf = (o: Operation) =>
      api.routes.find((r) => r.method === o.method && toOpenApi(r.url) === o.path)?.access as Json | undefined;
    const callerScoped = eligible
      .filter((o) => accessOf(o)?.["permission"] === "authenticated" && pathParameters(o).length === 0)
      .map((o) => o.operationId)
      .sort();
    expect(callerScoped).toEqual([...CALLER_SCOPED.keys()].sort());
    const noInvalid = eligible
      .filter((o) => invalidRequest(o, anchors) === null)
      .map((o) => o.operationId)
      .sort();
    expect(noInvalid).toEqual([...NO_INVALID_INPUT.keys()].sort());
    // The generated requests of cases 1-3 are valid under the contract's request schema.
    const invalidBodies = eligible.filter((o) => !requestFor(o, anchors).bodyValid).map((o) => o.operationId);
    expect(invalidBodies).toEqual([]);
  });

  it("case 1, unauthenticated (no session cookie): 401 unauthenticated, nothing persisted", async () => {
    await withNothingPersisted("1 unauthenticated", () =>
      sweep(
        "1",
        eligible,
        (op) => requestFor(op, anchors),
        null,
        false,
        (res) => isProblem(res, 401, "urn:mth:problem:unauthenticated", "unauthenticated"),
      ),
    );
  }, 600_000);

  it("case 2, CSRF (a session without X-CSRF-Token): 403 csrf, nothing persisted", async () => {
    await withNothingPersisted("2 csrf", () =>
      sweep(
        "2",
        eligible,
        (op) => requestFor(op, anchors),
        everyone,
        false,
        (res) => isProblem(res, 403, "urn:mth:problem:csrf", "csrf"),
      ),
    );
  }, 600_000);

  const refusedForbiddenOrNotFound = (res: Res<Json>) =>
    isProblem(res, 403, "urn:mth:problem:forbidden") || isProblem(res, 404, "urn:mth:problem:not-found");

  it("case 3a, unauthorized (org A member with no assignment, valid CSRF, valid request): 403 or 404, never 2xx, nothing persisted", async () => {
    const ops = eligible.filter((o) => !CALLER_SCOPED.has(o.operationId));
    const r = await withNothingPersisted("3a unauthorized (no assignment)", () =>
      sweep("3a", ops, (op) => requestFor(op, anchors), nobody, true, refusedForbiddenOrNotFound),
    );
    const anchored = ops.filter((o) => targetsAnchor(o, anchors)).length;
    console.info(
      `[route-inventory] case 3a: ${anchored} of ${r.swept} operations address a real record of org A by path; ${CALLER_SCOPED.size} caller-scoped operations excluded (${[...CALLER_SCOPED.keys()].join(", ")})`,
    );
  }, 600_000);

  it("case 3b, unauthorized (a user of org B holding every role there) on org A's records: 403 or 404, nothing persisted", async () => {
    const ops = eligible.filter((o) => targetsAnchor(o, anchors));
    expect(ops.length).toBeGreaterThanOrEqual(300);
    await withNothingPersisted("3b unauthorized (other organization)", () =>
      sweep("3b", ops, (op) => requestFor(op, anchors), outsider, true, refusedForbiddenOrNotFound),
    );
  }, 600_000);

  it("case 4, invalid input (authorized session): 400 with the uniform validation body, never 2xx or 500, nothing persisted", async () => {
    const ops = eligible.filter((o) => !NO_INVALID_INPUT.has(o.operationId));
    const kinds: Record<string, number> = {};
    const r = await withNothingPersisted("4 invalid input", () =>
      sweep(
        "4",
        ops,
        (op) => {
          const req = invalidRequest(op, anchors)!;
          kinds[req.kind] = (kinds[req.kind] ?? 0) + 1;
          return req;
        },
        everyone,
        true,
        (res) => {
          if (!isProblem(res, 400, "urn:mth:problem:validation")) return false;
          const errors = res.body["errors"];
          return (
            typeof res.body["code"] === "string" &&
            Array.isArray(errors) &&
            errors.length > 0 &&
            errors.every(
              (e) => typeof (e as Json)["pointer"] === "string" && JSON_POINTER.test((e as Json)["pointer"] as string),
            )
          );
        },
      ),
    );
    console.info(
      `[route-inventory] case 4: ${r.swept} operations by input kind ${JSON.stringify(kinds)}; excluded (no invalid input possible): ${[...NO_INVALID_INPUT.keys()].join(", ")}`,
    );
  }, 600_000);

  it("positive control (runs last): the same generated requests, sent by an authorized user, succeed and are detected as written", async () => {
    // Proves the sweep is not vacuous: the bodies of cases 1-3 are accepted by the server's own validation, so their
    // refusals came from authentication, CSRF and authorization; and the "nothing persisted" detectors see a real write.
    // The transformation-scoped creates only (POST .../transformations/{transformationId}/<collection>), each SYNTHETIC.
    const creates = eligible.filter(
      (o) =>
        o.method === "POST" &&
        o.operationId.startsWith("create") &&
        /^\/api\/v1\/transformations\/\{transformationId\}\/[a-z-]+$/.test(o.path),
    );
    const before = await fingerprint();
    const auditBefore = await auditRowsBesidesDenials();
    const succeeded: string[] = [];
    const undetected: string[] = [];
    const statuses: Record<string, number> = {};
    for (const op of creates) {
      const req = requestFor(op, anchors);
      const res = await send(req, everyone, true);
      statuses[res.status] = (statuses[res.status] ?? 0) + 1;
      if (res.status >= 200 && res.status < 300) {
        succeeded.push(op.operationId);
        if ((await writtenBy(res)).length === 0) undetected.push(op.operationId);
      }
    }
    const changed = changedTables(before, await fingerprint());
    console.info(
      `[route-inventory] positive control: ${succeeded.length} of ${creates.length} generated transformation-scoped creates succeeded for an authorized user (statuses ${JSON.stringify(statuses)}; the others are refused by business rules on the minimal synthetic body, e.g. a referenced record that does not exist); audit rows ${auditBefore} -> ${await auditRowsBesidesDenials()}; tables changed ${changed.length}`,
    );
    expect(succeeded.length).toBeGreaterThanOrEqual(10);
    expect(undetected, "a successful create wrote no audit event").toEqual([]);
    expect(changed).toContain("public.audit_event");
    expect(changed.length).toBeGreaterThan(succeeded.length > 0 ? 1 : 0);
  }, 600_000);
});
