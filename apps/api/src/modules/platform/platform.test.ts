// Unit tests of the HTTP plumbing: cursors bound to filters, If-Match parsing, request IDs, problem bodies,
// canonical JSON (Idempotency-Key request hashing) and zod error mapping.
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { canonicalJson, decodeCursor, encodeCursor, filterHash, paginate } from "./cursor.ts";
import { mapDatabaseGuardError, pointerOfColumn } from "./db-errors.ts";
import { genReqId } from "./hooks.ts";
import { requireIfMatch } from "./http.ts";
import { requestHash } from "./idempotency.ts";
import { problems, type HttpProblem } from "./problem.ts";
import { parseBody } from "./validation.ts";

const reqWith = (ifMatch?: string) => ({ headers: ifMatch === undefined ? {} : { "if-match": ifMatch } }) as never;
const statusOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as HttpProblem).status;
  }
  return 0;
};

describe("cursor", () => {
  it("round-trips and is bound to the filter hash", () => {
    const h = filterHash({ status: ["active"], sort: "name:asc", limit: 10, cursor: "ignored" });
    expect(h).toBe(filterHash({ sort: "name:asc", status: ["active"] }));
    const c = encodeCursor(["Name", "id-1"], h);
    expect(decodeCursor(c, h, 2)).toEqual(["Name", "id-1"]);
    expect(statusOf(() => decodeCursor(c, filterHash({ sort: "name:desc" }), 2))).toBe(400);
    expect(statusOf(() => decodeCursor("%%%", h, 2))).toBe(400);
    expect(statusOf(() => decodeCursor(c, h, 3))).toBe(400);
    expect(decodeCursor(undefined, h, 2)).toBeNull();
  });

  it("paginates limit+1 rows into a page and a next cursor", () => {
    const h = filterHash({});
    expect(paginate([1, 2, 3], 2, (r) => [r], h).items).toEqual([1, 2]);
    expect(decodeCursor(paginate([1, 2, 3], 2, (r) => [r], h).nextCursor!, h, 1)).toEqual([2]);
    expect(paginate([1, 2], 2, (r) => [r], h).nextCursor).toBeNull();
  });
});

describe("If-Match", () => {
  it("428 when missing, 400 when not a strong numeric ETag, the version otherwise", () => {
    expect(statusOf(() => requireIfMatch(reqWith()))).toBe(428);
    for (const bad of ["*", 'W/"1"', "1", '"0"', '"abc"', '"99999999999"'])
      expect(statusOf(() => requireIfMatch(reqWith(bad)))).toBe(400);
    expect(requireIfMatch(reqWith('"12"'))).toBe(12);
  });
});

describe("request IDs", () => {
  it("accepts ^[A-Za-z0-9._-]{1,128}$ and generates a UUIDv7 otherwise", () => {
    expect(genReqId({ headers: { "x-request-id": "abc.DEF_1-2" } })).toBe("abc.DEF_1-2");
    for (const bad of ["", "has space", "x".repeat(129), "semi;colon"]) {
      expect(genReqId({ headers: { "x-request-id": bad } })).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});

describe("problems", () => {
  it("render RFC 9457 bodies with code and requestId, currentVersion on 409", () => {
    expect(problems.versionConflict(4).toBody("r-1")).toMatchObject({
      type: "urn:mth:problem:version-conflict",
      status: 409,
      code: "version_conflict",
      currentVersion: 4,
      requestId: "r-1",
    });
    expect(problems.notFound().toBody("r-2")).toEqual({
      type: "urn:mth:problem:not-found",
      title: "Not found",
      status: 404,
      code: "not_found",
      requestId: "r-2",
    });
  });

  it("maps zod issues to JSON pointers and i18n codes", () => {
    const schema = z.strictObject({
      name: z.string().min(1),
      nested: z.strictObject({ tz: z.string().refine(() => false, "validation.timezone") }),
    });
    try {
      parseBody(schema, { name: "", nested: { tz: "x" }, extra: 1 });
      expect.unreachable();
    } catch (e) {
      const p = e as HttpProblem;
      expect(p.status).toBe(400);
      const byPointer = Object.fromEntries(p.errors!.map((x) => [x.pointer, x.code]));
      expect(byPointer).toMatchObject({
        "/name": "validation.too_small",
        "/nested/tz": "validation.timezone",
        "": "validation.unknown_field",
      });
    }
    expect(statusOf(() => parseBody(schema, undefined))).toBe(400);
    expect(statusOf(() => parseBody(schema, [1]))).toBe(400);
  });
});

describe("Idempotency-Key request hash", () => {
  it("ignores key order and changes with any value", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(requestHash("post", "/x", { a: 1, b: 2 })).toBe(requestHash("POST", "/x", { b: 2, a: 1 }));
    expect(requestHash("POST", "/x", { a: 1 })).not.toBe(requestHash("POST", "/x", { a: 2 }));
  });
});

describe("P2 database guard error mapping (ADR-0016 §3, ADR-0015)", () => {
  const map = (e: { code?: string; constraint?: string; table?: string; column?: string }) => {
    const p = mapDatabaseGuardError(e);
    return p === null ? null : { status: p.status, code: p.code, type: p.type, pointer: p.errors?.[0]?.pointer };
  };

  it("maps a version-step guard to 409 version-conflict", () => {
    expect(map({ code: "23514", constraint: "diagnostic_item_version_step", table: "diagnostic_item" })).toEqual({
      status: 409,
      code: "version_conflict",
      type: "urn:mth:problem:version-conflict",
      pointer: undefined,
    });
  });

  it("maps the gate SoD guard to 403 gate.submitter_cannot_decide and the staleness guard to 409", () => {
    expect(map({ code: "42501", constraint: "gate_decision_not_submitter" })).toMatchObject({
      status: 403,
      code: "gate.submitter_cannot_decide",
      type: "urn:mth:problem:forbidden",
    });
    expect(map({ code: "23514", constraint: "gate_decision_current_submission" })).toMatchObject({
      status: 409,
      code: "gate.submission_superseded",
      type: "urn:mth:problem:version-conflict",
    });
  });

  it("maps the evidence review SoD guard (0019, F-DG2-140) to 403 evidence.reviewer_is_author", () => {
    expect(map({ code: "23514", constraint: "evidence_review_separation" })).toMatchObject({
      status: 403,
      code: "evidence.reviewer_is_author",
      type: "urn:mth:problem:forbidden",
    });
  });

  it("maps template CHECK and NOT NULL violations to 422 with a field pointer", () => {
    expect(map({ code: "23514", constraint: "diagnostic_item_confidence_check", table: "diagnostic_item" })).toEqual({
      status: 422,
      code: "validation.constraint",
      type: "urn:mth:problem:validation",
      pointer: "/confidence",
    });
    expect(map({ code: "23502", table: "outcome_kpi", column: "target_date" })).toMatchObject({
      status: 422,
      code: "validation.required",
      pointer: "/targetDate",
    });
    expect(map({ code: "23502", table: "tom_gap", column: "dimension_code" })).toMatchObject({
      pointer: "/dimensionCode",
    });
    expect(map({ code: "23514", constraint: "tom_workshop_close_unresolved" })).toMatchObject({
      status: 422,
      code: "workshop.unresolved_items",
    });
    expect(map({ code: "22008" })).toMatchObject({ status: 400, code: "validation" });
  });

  it("maps audit-required, append-only and identity guards to 500 (programming errors)", () => {
    for (const e of [
      { code: "23000", constraint: "charter_audit_required" },
      { code: "23000", constraint: "charter_version_required" },
      { code: "42501" },
      { code: "23514", constraint: "outcome_identity_immutable" },
      { code: "23514", constraint: "outcome_organization_matches" },
    ])
      expect(map(e), JSON.stringify(e)).toMatchObject({ status: 500, code: "internal" });
  });

  it("leaves unrelated errors to the generic mapping", () => {
    expect(map({ code: "23505", constraint: "transformation_org_code_key" })).toBeNull();
    expect(map({ code: "FST_ERR_CTP_INVALID_JSON_BODY" })).toBeNull();
    expect(map({})).toBeNull();
    expect(pointerOfColumn("impact_kpi_definition_id")).toBe("/impactKpiDefinitionId");
  });
});
