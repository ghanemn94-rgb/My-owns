// REQ-S16-027 response validation of every operation (ADR-0052 §7; T-DG6-BE-F; owner backend-workflow-engineer).
// Acceptance (requirements.csv): "contract tests validate responses against the OpenAPI document; invalid input returns
// the uniform 400 body; an unauthorized call returns 403".
//
// How it works. The validating client (`call` in support/harness.ts -> `assertContract` in support/contract.ts) checks
// every response a test produces: the status is declared for the matched operation, the body matches the declared schema
// for the returned media type, the media type is a declared one, every error body is also a `Problem` whose `status`
// equals the response status, and declared ETag/Location headers are present. Each response that passed is appended to
// `validatedResponses` as (operationId, status, media type, problem type/code/pointers, nextCursor present).
// Vitest isolates module state per test FILE, so a ledger cannot be read across files deterministically. This file
// therefore runs the contract suite itself: the import below registers every describe/it of contract.test.ts here, in
// order, against this file's own API and seeded world (the per-run disposable database; every exercise creates its own
// synthetic records). The checks in the last describe run after the whole suite and read the ledger it filled.
// Responses deliberately taken OUTSIDE the contract: one per operation, the bucket-spending first call of the
// rate-limit sweep (platform-statuses.ts, `contract: false`); its second call, the 429, is validated. No other call in
// the contract suite skips validation.
// All data is SYNTHETIC. Nothing here grants a business approval; nothing reads or writes DG0-DG7.
import "./contract.test.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptedRequestBodies,
  openapi,
  operations,
  validatedResponses,
  type Operation,
} from "../../support/contract.ts";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { P2_PENDING_OPERATIONS } from "../../support/p2-pending.ts";

type Json = Record<string, unknown>;

function deref(node: Json | undefined): Json | undefined {
  let cur: unknown = node;
  while (cur && typeof (cur as Json)["$ref"] === "string") {
    let next: unknown = openapi;
    for (const part of ((cur as Json)["$ref"] as string).replace(/^#\//, "").split("/")) next = (next as Json)[part];
    cur = next;
  }
  return cur as Json | undefined;
}

/** The operation's module: its first OpenAPI tag. */
function tagOf(op: Operation): string {
  const item = (openapi["paths"] as Json)[op.path] as Json;
  return (((item[op.method.toLowerCase()] as Json)["tags"] as string[] | undefined) ?? ["(untagged)"])[0]!;
}

/** Whether the operation's 200 JSON schema declares `nextCursor` as a required property (directly or via allOf). */
function pagination(op: Operation): "required" | "optional" | "none" {
  const media = (deref(op.responses["200"])?.["content"] as Json | undefined)?.["application/json"] as Json | undefined;
  const schema = deref(media?.["schema"] as Json | undefined);
  if (!schema) return "none";
  const parts = (schema["allOf"] as Json[] | undefined)?.map((s) => deref(s)!) ?? [schema];
  const props = parts.some((p) => Object.hasOwn((p["properties"] as Json | undefined) ?? {}, "nextCursor"));
  const required = parts.some((p) => ((p["required"] as string[] | undefined) ?? []).includes("nextCursor"));
  return required ? "required" : props ? "optional" : "none";
}

/** A GET that declares a required query parameter validates it first (400), before any record is read. */
function requiresQuery(op: Operation): boolean {
  const item = (openapi["paths"] as Json)[op.path] as Json;
  const params = [
    ...(((item["parameters"] as Json[] | undefined) ?? []) as Json[]),
    ...((((item[op.method.toLowerCase()] as Json)["parameters"] as Json[] | undefined) ?? []) as Json[]),
  ].map((p) => deref(p)!);
  return params.some((p) => p["in"] === "query" && p["required"] === true);
}

/** RFC 6901: the whole document ("") or a sequence of "/"-prefixed tokens with "~" escaped as ~0 or ~1. */
const JSON_POINTER = /^(\/([^~/]|~[01])*)*$/;

/**
 * List operations (operationId `list*`) whose 200 body is not cursor-paginated at HEAD, pinned so the set only shrinks.
 * Every one is a DG1-DG5 operation of another owner returning a bounded `{ items }` collection (a catalogue, the children
 * of one record, or the versions of one record), declared that way in the approved contract. ADR-0007 §4 says list
 * responses are `{ items, nextCursor }`; the deviation is reported in the T-DG6-BE-F handback for the orchestrator, not
 * changed here (p6-plan §5.1: defects in another owner's route are reported, not fixed).
 */
const UNPAGINATED_LISTS_AT_HEAD: readonly string[] = [
  "listAdoptionIndicatorTemplates",
  "listApprovalRoutes",
  "listBenefitFormulaExamples",
  "listBenefitFormulaVersions",
  "listBusinessCaseLines",
  "listConfigReviewPolicies",
  "listDecisionRightTemplates",
  "listDeliverables",
  "listDependencyTypes",
  "listFormRecordTypes",
  "listGateSubmissionCriteria",
  "listGates",
  "listGovernanceMatrices",
  "listGovernanceParties",
  "listGuidingQuestions",
  "listHealthCheckQuestions",
  "listHealthCheckSchemes",
  "listImportTemplates",
  "listInitiativeDecisionLinks",
  "listInitiativeGapLinks",
  "listInitiativeOutcomeContributions",
  "listJobOperations",
  "listKpiRestatementReissueOffers",
  "listMethodologyBlockLinks",
  "listMethodologyElements",
  "listMilestones",
  "listPermissions",
  "listPhases",
  "listReportDefinitions",
  "listReportSnapshotVersions",
  "listResourceRoles",
  "listRoadmapWaves",
  "listRoleAccountabilities",
  "listRoles",
  "listTemplateSourceLinks",
  "listTomWorkshopParticipants",
  "listTransformationConfigPins",
  "listWeightSets",
];

/**
 * Modules with a business-permission route where neither sweep nor the contract suite produced a refusal at HEAD,
 * pinned (sorted) so the set only shrinks; each is listed in the T-DG6-BE-F handback with its reason.
 */
const MODULES_WITHOUT_A_REACHED_REFUSAL: readonly string[] = [];

describe("REQ-S16-027: every operation's responses validated against the contract (ADR-0052 §7)", () => {
  let api: TestApi;
  let w: World;
  let nobody: Session;
  let transformationId: string;
  /** Modules (OpenAPI tags) where an unauthorized call was refused: 403 forbidden, or 404 on a readable-scope miss. */
  const refusedTags = new Set<string>();
  const live = () => operations.filter((o) => !P2_PENDING_OPERATIONS.has(o.operationId));

  beforeAll(async () => {
    api = await startApi();
    w = await seedWorld(api.db);
    nobody = await signIn(api.app, w.nobody.subject);
    transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  });
  afterAll(async () => {
    await api.close();
  });

  it("every operation outside the pending aggregate returned at least one validated response in the contract suite", () => {
    const byOperation = new Map<string, Set<number>>();
    for (const r of validatedResponses) {
      const seen = byOperation.get(r.operationId) ?? new Set<number>();
      seen.add(r.status);
      byOperation.set(r.operationId, seen);
    }
    const missing = live()
      .filter((o) => !byOperation.has(o.operationId))
      .map((o) => o.operationId);
    const pairs = [...byOperation.values()].reduce((n, s) => n + s.size, 0);
    console.info(
      `[response-validation] ${validatedResponses.length} validated responses; ${byOperation.size} of ${live().length} live operations (${P2_PENDING_OPERATIONS.size} pending excluded); ${pairs} distinct (operationId, status) pairs; operations without a validated response: ${missing.length}`,
    );
    expect(missing).toEqual([]);
    // A pending operation has no route, so it can have no validated response.
    expect([...P2_PENDING_OPERATIONS].filter((id) => byOperation.has(id))).toEqual([]);
    // The suite is not trivially small: every live operation has a success (contract.test.ts) plus the refusal sweeps.
    expect(validatedResponses.length).toBeGreaterThan(live().length * 3);
  });

  it("every validated error response is application/problem+json and a Problem; every 400 is the uniform validation body", () => {
    const errors = validatedResponses.filter((r) => r.status >= 400);
    // The one declared non-problem error body: getReadiness 503 answers its Readiness JSON (ADR-0007 503 "not ready").
    const notProblemJson = errors.filter(
      (r) => r.mediaType !== "application/problem+json" && !(r.operationId === "getReadiness" && r.status === 503),
    );
    expect(notProblemJson.map((r) => `${r.operationId} ${r.status} ${r.mediaType}`)).toEqual([]);
    const badRequests = errors.filter((r) => r.status === 400);
    const notUniform = badRequests.filter(
      (r) =>
        r.problemType !== "urn:mth:problem:validation" ||
        !r.problemCode ||
        r.errorPointers === null ||
        r.errorPointers.length === 0 ||
        r.errorPointers.some((p) => p === undefined || !JSON_POINTER.test(p)),
    );
    expect([
      ...new Set(notUniform.map((r) => `${r.operationId}: ${r.problemType} ${r.problemCode} ${r.errorPointers}`)),
    ]).toEqual([]);
    console.info(
      `[response-validation] ${errors.length} validated error responses; ${badRequests.length} validated 400 responses, all uniform validation bodies`,
    );
  });

  it("invalid input returns the uniform 400 body in every module (a validated 400 per OpenAPI tag)", () => {
    const tagsWith400 = new Set(
      validatedResponses
        .filter((r) => r.status === 400 && r.problemType === "urn:mth:problem:validation")
        .map((r) => tagOf(operations.find((o) => o.operationId === r.operationId)!)),
    );
    const tags = [...new Set(live().map(tagOf))].sort();
    expect(tags.filter((t) => !tagsWith400.has(t))).toEqual([]);
    console.info(
      `[response-validation] modules (OpenAPI tags) with a validated uniform 400: ${tagsWith400.size}/${tags.length}`,
    );
  });

  it("an explicit invalid body per module: 400 urn:mth:problem:validation with JSON-pointer errors", async () => {
    // A SYNTHETIC user holding every catalogue role (business roles on the transformation, ADM_* on the organization),
    // so the sample reaches each route's validation whatever its authorization order. It approves nothing.
    const everyone = await createUser(api.db, w.orgA.id);
    const roles = await api.db.selectFrom("role").select("code").execute();
    for (const { code } of roles) {
      const scope = code.startsWith("ADM_")
        ? { type: "organization" as const, id: w.orgA.id }
        : { type: "transformation" as const, id: transformationId };
      await grant(api.db, w.grantor.id, everyone.id, code, scope, w.orgA.id);
    }
    const office = await signIn(api.app, everyone.subject);
    // Body-carrying JSON operations addressed only by {transformationId} (or nothing), grouped by tag. The body is a JSON
    // array, never an object, which every JSON body validator refuses (parseBody: validation.body_required at ""). A
    // route that authorizes before it validates may answer the TO 403 first; the next operation of the tag is tried.
    const candidates = new Map<string, Operation[]>();
    for (const o of live()) {
      if (o.method === "GET" || o.operationId === "devLogin" || o.operationId === "receiveWebhook") continue;
      const names = [...o.path.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]);
      if (!names.every((n) => n === "transformationId")) continue;
      const item = (openapi["paths"] as Json)[o.path] as Json;
      const rb = deref((item[o.method.toLowerCase()] as Json)["requestBody"] as Json | undefined);
      if (!(rb?.["content"] as Json | undefined)?.["application/json"]) continue;
      candidates.set(tagOf(o), [...(candidates.get(tagOf(o)) ?? []), o]);
    }
    const sampled: string[] = [];
    const refusedFirst: string[] = [];
    const without400: string[] = [];
    for (const [tag, ops] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
      let found = false;
      for (const o of ops) {
        const url = o.path.replace("{transformationId}", transformationId);
        const res = await call(api.app, o.method, url, { session: office, body: [1], headers: { "if-match": '"1"' } });
        if (res.status !== 400) {
          // Never a success: an array body is invalid for every operation.
          expect(res.status, `${o.operationId} ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(400);
          refusedFirst.push(`${o.operationId} ${res.status}`);
          continue;
        }
        expect(res.body).toMatchObject({ type: "urn:mth:problem:validation", status: 400 });
        expect(typeof res.body.code).toBe("string");
        expect(res.body.errors.length, o.operationId).toBeGreaterThan(0);
        for (const e of res.body.errors) expect(e.pointer, o.operationId).toMatch(JSON_POINTER);
        sampled.push(`${tag}:${o.operationId}`);
        found = true;
        break;
      }
      if (!found) without400.push(tag);
    }
    console.info(
      `[response-validation] explicit invalid-body: modules without a 400: ${without400.join(", ") || "none"}`,
    );
    console.info(
      `[response-validation] explicit invalid-body samples: ${sampled.length} modules with a uniform 400 (${sampled.join(", ")}); refused before validation (authorization first): ${refusedFirst.join(", ") || "none"}`,
    );
    expect(without400).toEqual([]);
    expect(sampled.length).toBeGreaterThanOrEqual(40);
  });

  it("an unauthorized call returns 403 (or the ADR-0006 404 for an unreadable record): every transformation read by a user without an assignment", async () => {
    // Every GET of a transformation's parts addressed by {transformationId} alone, by an authenticated user of the same
    // organization with no role assignment: never a success, and the refusal is 403 forbidden or 404 not_found.
    const reads = live().filter(
      (o) =>
        o.method === "GET" &&
        [...o.path.matchAll(/\{([A-Za-z]+)\}/g)].every((m) => m[1] === "transformationId") &&
        o.path.includes("{transformationId}") &&
        !requiresQuery(o),
    );
    const outcomes = new Map<number, number>();
    const wrong: string[] = [];
    for (const o of reads) {
      const res = await call(api.app, "GET", o.path.replace("{transformationId}", transformationId), {
        session: nobody,
      });
      outcomes.set(res.status, (outcomes.get(res.status) ?? 0) + 1);
      const ok =
        (res.status === 403 && res.body.type === "urn:mth:problem:forbidden") ||
        (res.status === 404 && res.body.type === "urn:mth:problem:not-found");
      if (!ok) wrong.push(`${o.operationId} ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
      // The transformation exists, so a 404 here is the ADR-0006 non-disclosure of an unreadable record.
      else refusedTags.add(tagOf(o));
    }
    console.info(
      `[response-validation] unauthorized transformation reads: ${reads.length} operations; statuses ${JSON.stringify(Object.fromEntries(outcomes))}`,
    );
    expect(wrong).toEqual([]);
    expect(reads.length).toBeGreaterThanOrEqual(120);
  });

  it("an unauthorized call returns 403: the auditor (AUD, read-only) is refused every write that needs a business permission", async () => {
    // Every body-carrying operation, as the organization's auditor, with the first JSON body the server accepted for it
    // in the contract suite above (so the route's validation passes and its authorization answers), or an empty JSON
    // object where the suite recorded none. Path parameters:
    // {transformationId} a real transformation the auditor reads; any other a well-formed random id or a seeded code
    // (platform-statuses.ts uses the same values). A write whose route needs a business permission is never a success.
    const auditor = await signIn(api.app, w.auditor.subject);
    const fill = (name: string): string =>
      name === "transformationId"
        ? transformationId
        : name === "organizationId"
          ? w.orgA.id
          : name === "gateCode"
            ? "G1"
            : name === "dimensionCode"
              ? "strategy"
              : name === "submissionNo" || name === "versionNo"
                ? "1"
                : name === "jobCode"
                  ? "approval.escalation_scan"
                  : name === "matrixKind"
                    ? "raci"
                    : crypto.randomUUID();
    const toOpenApi = (url: string) => url.replace(/:([A-Za-z]+)/g, "{$1}");
    const accessOf = (o: Operation) =>
      api.routes.find((r) => r.method === o.method && toOpenApi(r.url) === o.path)?.access as Json | undefined;
    const writes = live().filter(
      (o) =>
        o.method !== "GET" &&
        o.operationId !== "receiveWebhook" &&
        typeof accessOf(o)?.["permission"] === "string" &&
        accessOf(o)!["permission"] !== "authenticated",
    );
    const succeeded: string[] = [];
    const forbiddenTags = new Set<string>();
    const outcomes = new Map<number, number>();
    for (const o of writes) {
      const url = o.path.replace(/\{([A-Za-z]+)\}/g, (_, n: string) => fill(n));
      const media = ((deref(((openapi["paths"] as Json)[o.path] as Json)[o.method.toLowerCase()] as Json)?.[
        "requestBody"
      ] as Json | undefined) ?? {})["content"] as Json | undefined;
      const binary = media !== undefined && !("application/json" in media);
      const res = await call(api.app, o.method, url, {
        session: auditor,
        headers: { "if-match": '"1"', ...(binary ? { "content-type": "application/octet-stream" } : {}) },
        ...(media === undefined ? {} : { body: binary ? "x" : (acceptedRequestBodies.get(o.operationId) ?? {}) }),
      });
      outcomes.set(res.status, (outcomes.get(res.status) ?? 0) + 1);
      if (res.status < 400) succeeded.push(`${o.operationId} ${res.status}`);
      if (res.status === 403 && res.body.type === "urn:mth:problem:forbidden") forbiddenTags.add(tagOf(o));
    }
    for (const t of forbiddenTags) refusedTags.add(t);
    console.info(
      `[response-validation] auditor write sweep: ${writes.length} permissioned writes; statuses ${JSON.stringify(Object.fromEntries([...outcomes].sort(([x], [y]) => x - y)))}; modules with a 403 forbidden: ${forbiddenTags.size}`,
    );
    expect(succeeded).toEqual([]);
    expect(writes.length).toBeGreaterThanOrEqual(400);
  });

  it("an unauthorized call is refused in every module with a business-permission route (the two sweeps and the suite)", () => {
    // A validated 403 forbidden anywhere in the contract suite counts too.
    for (const r of validatedResponses) {
      if (r.status === 403 && r.problemType === "urn:mth:problem:forbidden") {
        refusedTags.add(tagOf(operations.find((o) => o.operationId === r.operationId)!));
      }
    }
    const toOpenApi = (url: string) => url.replace(/:([A-Za-z]+)/g, "{$1}");
    const permissioned = (o: Operation) => {
      const access = api.routes.find((r) => r.method === o.method && toOpenApi(r.url) === o.path)?.access as
        | Json
        | undefined;
      return typeof access?.["permission"] === "string" && access["permission"] !== "authenticated";
    };
    const modules = [...new Set(live().filter(permissioned).map(tagOf))].sort();
    const uncovered = modules.filter((t) => !refusedTags.has(t));
    console.info(
      `[response-validation] modules with a business-permission route: ${modules.length}; refused an unauthorized call: ${modules.length - uncovered.length}; not reached: ${uncovered.join(", ") || "none"}`,
    );
    expect(uncovered).toEqual(MODULES_WITHOUT_A_REACHED_REFUSAL);
  });

  it("pagination: every list operation declares nextCursor, and every validated list success carries it", () => {
    // Static over the whole contract (pending operations included), so routing a pending list never touches the pin.
    const lists = operations.filter((o) => o.method === "GET" && o.operationId.startsWith("list"));
    const unpaginated = lists.filter((o) => pagination(o) !== "required").map((o) => o.operationId);
    // Pinned (see UNPAGINATED_LISTS_AT_HEAD): a new unpaginated list fails here, a fixed one must leave the pin.
    expect(unpaginated.sort()).toEqual([...UNPAGINATED_LISTS_AT_HEAD].sort());
    const paginated = new Set(lists.filter((o) => pagination(o) === "required").map((o) => o.operationId));
    const successes = validatedResponses.filter((r) => paginated.has(r.operationId) && r.status === 200);
    expect(successes.filter((r) => r.hasNextCursor !== true).map((r) => r.operationId)).toEqual([]);
    const listsWithoutSuccess = [...paginated].filter(
      (id) => !P2_PENDING_OPERATIONS.has(id) && !successes.some((r) => r.operationId === id),
    );
    expect(listsWithoutSuccess).toEqual([]);
    console.info(
      `[response-validation] list operations: ${lists.length}; cursor-paginated ${paginated.size} (${successes.length} validated 200s, all with nextCursor); unpaginated, pinned and reported: ${unpaginated.length}`,
    );
  });
});
