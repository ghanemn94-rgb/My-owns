// Unit tests of the HTTP plumbing: cursors bound to filters, If-Match parsing, request IDs, problem bodies,
// canonical JSON (Idempotency-Key request hashing) and zod error mapping.
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { canonicalJson, decodeCursor, encodeCursor, filterHash, paginate } from "./cursor.ts";
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
