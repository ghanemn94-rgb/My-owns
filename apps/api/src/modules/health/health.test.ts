// health module suite (P5; T-DG5-BE-A created the module, p5-plan §3 seam 24). The owning tasks add their behaviour
// tests here and under test/integration/health/. Until then: the module wires every route file through its hook, and
// reports "scaffold" while no route exists (a route-free module promises no behaviour).
import { readdirSync } from "node:fs";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { HEALTH_SCHEME_PROBLEMS, type HealthSchemeProblem } from "@mth/shared/calc";
import { mapDatabaseGuardError, type ModuleDeps } from "../platform/index.ts";
import { registerHealthModule } from "./index.ts";
import { HEALTH_SCHEME_REFUSALS, healthSchemeRefusal } from "./schemes.ts";

describe("health module (P5)", () => {
  it("registers through its hook and reports its registration", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerHealthModule(app, {} as ModuleDeps);
      expect(registration.module).toBe("health");
      expect(registration.deliversIn).toBe("P5");
      expect(registration.status).toBe(registration.routes.length > 0 ? "active" : "scaffold");
    } finally {
      await app.close();
    }
  });

  it("has its route files in place (1 created by T-DG5-BE-A, p5-plan §5.1)", () => {
    const files = readdirSync(new URL(".", import.meta.url)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files.length - 1).toBeGreaterThanOrEqual(1);
  });
});

// T-DG5-KBE-G (ADR-0048 §9): the three reads are registered, and every scheme refusal is the §9 code and exact text,
// from the provider and from the database guard mapping alike.
describe("health-check schemes and questions (T-DG5-KBE-G)", () => {
  it("registers the questions and the two scheme reads", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerHealthModule(app, {} as ModuleDeps);
      expect(registration.routes).toEqual([
        "GET /api/v1/health-check-questions",
        "GET /api/v1/admin/health-check-schemes",
        "GET /api/v1/admin/health-check-schemes/:schemeVersionId",
      ]);
      expect(registration.status).toBe("active");
    } finally {
      await app.close();
    }
  });

  const SECTION_9: [HealthSchemeProblem, string, string][] = [
    [
      "health_scheme_own_bands_required",
      "health_scheme.own_bands_required",
      "A scheme with partial credit or N/A needs its own interpretation bands; the four source bands cannot be reused.",
    ],
    ["health_scheme_yes_no_required", "health_scheme.yes_no_required", "A scheme keeps Yes = 1 and No = 0."],
    [
      "health_scheme_credit",
      "health_scheme.credit_invalid",
      "Partial credit is a decimal between 0 and 1; N/A has no credit.",
    ],
    [
      "health_scheme_na_needs_percent",
      "health_scheme.na_needs_percent",
      "A scheme with N/A scores as a percentage of the applicable questions.",
    ],
    [
      "health_scheme_bands_invalid",
      "health_scheme.bands_invalid",
      "Bands need one band starting at 0 and distinct starting scores within the maximum score.",
    ],
  ];

  it("every §9 scheme refusal has its exact code and English text, as 422", () => {
    for (const [problem, code, detail] of SECTION_9) {
      const p = healthSchemeRefusal(problem);
      expect([p.status, p.code, p.detail]).toEqual([422, code, detail]);
      const mapped = mapDatabaseGuardError({ code: "23514", constraint: problem });
      expect([mapped?.status, mapped?.code, mapped?.detail]).toEqual([422, code, detail]);
    }
    // The definition rule has no §9 row: its proposed code (handback) is used by both paths.
    expect(healthSchemeRefusal("health_scheme_definition").code).toBe("health_scheme.definition_invalid");
    expect(mapDatabaseGuardError({ code: "23514", constraint: "health_scheme_definition" })?.code).toBe(
      "health_scheme.definition_invalid",
    );
    expect([...HEALTH_SCHEME_REFUSALS.keys()].sort()).toEqual([...HEALTH_SCHEME_PROBLEMS].sort());
    // The element guard's two health rules map to the same codes.
    expect(mapDatabaseGuardError({ code: "23514", constraint: "methodology_element_health_credit" })?.code).toBe(
      "health_scheme.credit_invalid",
    );
    expect(mapDatabaseGuardError({ code: "23514", constraint: "methodology_element_health_band" })?.code).toBe(
      "health_scheme.bands_invalid",
    );
  });
});
