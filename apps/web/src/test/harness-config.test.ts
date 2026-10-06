// F-DG2-220: guards the unit-web harness configuration (apps/web/test/setup.ts, apps/web/vitest.config.ts). Every
// findBy*/waitFor in the unit-web project gets the raised async-utility timeout, and the per-test timeout stays above
// it with headroom, so a slow page load under parallel load isn't a flake and a wait that never resolves still fails
// with Testing Library's own message instead of a bare test timeout.
import { getConfig } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS } from "../../test/setup.ts";

describe("unit-web harness (F-DG2-220)", () => {
  it("raises Testing Library's async-utility timeout from the 1000 ms default", () => {
    expect(UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(getConfig().asyncUtilTimeout).toBe(UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS);
  });

  it("keeps the per-test timeout at least 2x above the async-utility timeout", ({ task }) => {
    // No explicit timeout on this test, so `task.timeout` is the project-wide `testTimeout`.
    const testTimeout = task.timeout;
    expect(testTimeout).toBeGreaterThanOrEqual(2 * UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS);
  });
});
