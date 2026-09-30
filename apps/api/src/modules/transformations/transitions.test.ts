// Unit test: explicit status transitions (REQ-S16-023). Everything not listed is rejected with 422.
import { TRANSFORMATION_STATUSES, TRANSFORMATION_STATUS_TRANSITIONS } from "@mth/shared";
import { describe, expect, it } from "vitest";
import { isAllowedTransition } from "./routes.ts";

describe("isAllowedTransition", () => {
  it("allows exactly draft->active, active->on_hold|closed, on_hold->active|closed (plus no-op)", () => {
    const allowed: string[] = [];
    for (const from of TRANSFORMATION_STATUSES) {
      for (const to of TRANSFORMATION_STATUSES)
        if (from !== to && isAllowedTransition(from, to)) allowed.push(`${from}->${to}`);
    }
    expect(allowed.sort()).toEqual([
      "active->closed",
      "active->on_hold",
      "draft->active",
      "on_hold->active",
      "on_hold->closed",
    ]);
    expect(TRANSFORMATION_STATUS_TRANSITIONS.closed).toEqual([]);
    for (const s of TRANSFORMATION_STATUSES) expect(isAllowedTransition(s, s)).toBe(true);
  });
});
