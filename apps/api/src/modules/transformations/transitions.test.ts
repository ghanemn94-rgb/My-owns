// Unit test: explicit status transitions (REQ-S16-023). Everything not listed is rejected with 422.
// F-DG1-001: closure is the G6 (Sustain) business decision, which does not exist in P1, so NO status edit may close a
// transformation, even though the shared transition table lists `closed` as a later-stage target.
import { TRANSFORMATION_STATUSES, TRANSFORMATION_STATUS_TRANSITIONS } from "@mth/shared";
import { describe, expect, it } from "vitest";
import { GOVERNED_TARGET_STATUSES, isAllowedTransition } from "./routes.ts";

describe("isAllowedTransition", () => {
  it("allows exactly draft->active, active->on_hold, on_hold->active (plus no-op)", () => {
    const allowed: string[] = [];
    for (const from of TRANSFORMATION_STATUSES) {
      for (const to of TRANSFORMATION_STATUSES)
        if (from !== to && isAllowedTransition(from, to)) allowed.push(`${from}->${to}`);
    }
    expect(allowed.sort()).toEqual(["active->on_hold", "draft->active", "on_hold->active"]);
    expect(TRANSFORMATION_STATUS_TRANSITIONS.closed).toEqual([]);
    for (const s of TRANSFORMATION_STATUSES) expect(isAllowedTransition(s, s)).toBe(true);
  });

  it("refuses every client-driven close in P1 (closure is governed by the G6 business approval) - F-DG1-001", () => {
    expect([...GOVERNED_TARGET_STATUSES]).toEqual(["closed"]);
    for (const from of TRANSFORMATION_STATUSES.filter((s) => s !== "closed"))
      expect(isAllowedTransition(from, "closed"), `${from}->closed`).toBe(false);
  });
});
