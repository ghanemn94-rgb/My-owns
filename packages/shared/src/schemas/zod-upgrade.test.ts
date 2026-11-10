// T-DG6-DO-A2 (D-199): the zod 4.1.12 -> 4.6.7 upgrade changed two behaviours this code base relies on. These tests pin
// that the schemas keep their DG5 results:
//  1. an object key declared `z.unknown()` is required since 4.6 (a missing key is `invalid_type`, expected
//     `nonoptional`); 4.1 accepted it. The diff pairs `{ from, to }` (a field added has no `from`; JSON drops an
//     `undefined`) are declared `.optional()` so an absent side is still accepted;
//  2. a string's `min`/`max` count Unicode code points since 4.6 (4.1: UTF-16 units). `trimmedText` measures its
//     "min already failed" guard the same way (covered in schemas.test.ts, "name and reason: one blank rule").
// Synthetic values only.
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { auditEvent } from "./audit.ts";

const EVENT = {
  id: "0190b000-0000-7000-8000-000000000001",
  seq: "1",
  occurredAt: "2026-10-27T03:00:00.000Z",
  action: "synthetic_record.updated",
  recordType: "synthetic_record",
  recordId: "0190b000-0000-7000-8000-000000000002",
  transformationId: null,
  actor: { type: "system", userId: null, displayName: null },
  onBehalfOfUserId: null,
  priorVersion: 1,
  newVersion: 2,
  reason: null,
  requestId: null,
};

describe("zod 4.6 upgrade: DG5 schema results are kept (T-DG6-DO-A2)", () => {
  it("the library itself: a bare z.unknown() key is required, a .optional() one is not", () => {
    expect(z.strictObject({ v: z.unknown() }).safeParse({}).success).toBe(false);
    expect(z.strictObject({ v: z.unknown().optional() }).safeParse({}).success).toBe(true);
  });

  it("an audit change with only `to` (a field added) or only `from` (a field cleared) is accepted, as at DG5", () => {
    for (const changes of [{ title: { to: "Synthetic" } }, { title: { from: "Synthetic" } }, { title: {} }, null])
      expect(auditEvent.safeParse({ ...EVENT, changes }).success, JSON.stringify(changes)).toBe(true);
    expect(auditEvent.safeParse({ ...EVENT, changes: { title: { from: 1, to: 2, extra: 3 } } }).success).toBe(false);
  });

  it("string lengths count code points: an emoji is one character for min and max", () => {
    expect(z.string().max(1).safeParse("\u{1F600}").success).toBe(true);
    expect(z.string().min(2).safeParse("\u{1F600}").success).toBe(false);
  });
});
