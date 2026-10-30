// Unit tests of the keyset cursor helpers (T-DG6-BE-V; ADR-0007 §4/§4a): the cursor value checks that keep a forged
// cursor from reaching SQL, and `memoryPage` (the resolved approval-route list) walking a list page by page.
import { describe, expect, it } from "vitest";
import { decodeKeysetCursor, encodeCursor, keysetHash, memoryPage, type SortKey } from "./cursor.ts";
import { HttpProblem } from "./problem.ts";

const KEYS: readonly SortKey[] = [
  { name: "forecast_date", type: "date" },
  { name: "created_at", type: "timestamptz" },
  { name: "ordinal", type: "integer", desc: true },
  { name: "id", type: "uuid" },
];
const HASH = keysetHash({ list: "unit" }, KEYS);
const ID = "01a18df6-d9c5-748e-a2ad-a655b870a17a";
const cursorOf = (k: unknown[], h = HASH) => Buffer.from(JSON.stringify({ k, h }), "utf8").toString("base64url");

function refused(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof HttpProblem && e.status === 400;
  }
}

describe("decodeKeysetCursor", () => {
  it("accepts Postgres' text forms of each key type, microseconds and 'infinity' included", () => {
    const k = ["2026-12-01", "2026-10-30 17:40:21.123456+00", "7", ID];
    expect(decodeKeysetCursor(cursorOf(k), HASH, KEYS)).toEqual(k);
    expect(decodeKeysetCursor(cursorOf(["infinity", "2026-10-30 17:40:21+00", "-1", ID]), HASH, KEYS)).not.toBeNull();
    expect(decodeKeysetCursor(undefined, HASH, KEYS)).toBeNull();
  });

  it.each([
    ["an impossible day", ["2026-02-31", "2026-10-30 17:40:21+00", "1", ID]],
    ["an impossible hour", ["2026-12-01", "2026-10-30 24:00:00+00", "1", ID]],
    ["another offset", ["2026-12-01", "2026-10-30 17:40:21+03", "1", ID]],
    ["SQL in a value", ["2026-12-01'); select 1; --", "2026-10-30 17:40:21+00", "1", ID]],
    ["a number where text is due", [20261201, "2026-10-30 17:40:21+00", "1", ID]],
    ["a non-integer", ["2026-12-01", "2026-10-30 17:40:21+00", "1.5", ID]],
    ["a non-uuid", ["2026-12-01", "2026-10-30 17:40:21+00", "1", "not-a-uuid"]],
    ["a wrong arity", ["2026-12-01", ID]],
  ])("refuses %s with 400", (_name, k) => {
    expect(refused(() => decodeKeysetCursor(cursorOf(k as unknown[]), HASH, KEYS))).toBe(true);
  });

  it("refuses a cursor of other filters or another sort (the hash), and one that is not base64url JSON", () => {
    const k = ["2026-12-01", "2026-10-30 17:40:21+00", "1", ID];
    expect(refused(() => decodeKeysetCursor(cursorOf(k, keysetHash({ list: "other" }, KEYS)), HASH, KEYS))).toBe(true);
    const reversed = KEYS.map((key) => ({ ...key, desc: key.desc !== true }));
    expect(refused(() => decodeKeysetCursor(cursorOf(k, keysetHash({ list: "unit" }, reversed)), HASH, KEYS))).toBe(
      true,
    );
    expect(refused(() => decodeKeysetCursor("%%%", HASH, KEYS))).toBe(true);
  });
});

describe("memoryPage", () => {
  const routes = ["procedure.c", "gate.g2", "procedure.a", "gate.g1", "procedure.b"].map((routeKey) => ({ routeKey }));
  const filters = { list: "approval-routes", methodologyVersionId: ID };

  it("walks the list in key order, every item once, the last page with a null cursor", () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = memoryPage(routes, (r) => [r.routeKey], { cursor, limit: 2 }, filters, "routeKey");
      seen.push(...page.items.map((r) => r.routeKey));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(["gate.g1", "gate.g2", "procedure.a", "procedure.b", "procedure.c"]);
  });

  it("refuses a cursor of another version, and a number in place of the key", () => {
    const first = memoryPage(routes, (r) => [r.routeKey], { limit: 1 }, filters, "routeKey");
    expect(first.nextCursor).not.toBeNull();
    const other = { ...filters, methodologyVersionId: "01a18df6-0000-748e-a2ad-a655b870a17a" };
    expect(
      refused(() =>
        memoryPage(routes, (r) => [r.routeKey], { cursor: first.nextCursor!, limit: 1 }, other, "routeKey"),
      ),
    ).toBe(true);
    const parsed = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString("utf8")) as { h: string };
    const numeric = encodeCursor([7], parsed.h);
    expect(
      refused(() => memoryPage(routes, (r) => [r.routeKey], { cursor: numeric, limit: 1 }, filters, "routeKey")),
    ).toBe(true);
  });
});
