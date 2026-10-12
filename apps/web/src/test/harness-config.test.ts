// F-DG2-220: guards the unit-web harness configuration (apps/web/test/setup.ts, apps/web/vitest.config.ts). Every
// findBy*/waitFor in the unit-web project gets the raised async-utility timeout, and the per-test timeout stays above
// it with headroom, so a slow page load under parallel load isn't a flake and a wait that never resolves still fails
// with Testing Library's own message instead of a bare test timeout.
import { getConfig } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS,
  UNIT_WEB_PAGE_WARMUP_TIMEOUT_MS,
  UNIT_WEB_WARMED_PAGE_MODULES,
} from "../../test/setup.ts";
import routerSource from "../app/router.tsx?raw";

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

  it("F-DG4-148: warms every page module that router.tsx loads lazily, without changing the async-utility wait", () => {
    const lazy = [...routerSource.matchAll(/import\("(\.\.\/pages\/[^"]+)"\)/g)].map((m) => m[1]!);
    expect(lazy.length).toBeGreaterThanOrEqual(80);
    const warmed = new Set(UNIT_WEB_WARMED_PAGE_MODULES.map((path) => path.replace("../src/pages/", "../pages/")));
    expect(lazy.filter((specifier) => !warmed.has(specifier))).toEqual([]);
    expect(UNIT_WEB_WARMED_PAGE_MODULES.filter((path) => path.endsWith(".test.tsx"))).toEqual([]);
    // The warm-up has its own hook budget; the findBy*/waitFor wait stays the F-DG2-220 value.
    expect(getConfig().asyncUtilTimeout).toBe(5_000);
    expect(UNIT_WEB_PAGE_WARMUP_TIMEOUT_MS).toBeGreaterThan(UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS);
  });
});
