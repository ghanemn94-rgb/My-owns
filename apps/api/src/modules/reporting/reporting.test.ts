// reporting module suite (D-048; REQ-S16-003 / A12 "the six modules exist with separate test suites"). The module is a P1
// SCAFFOLD: it is mapped, has a public index.ts with a typed interface and a wiring hook, registers no routes, and its
// declared boundary is enforced by the same dependency-lint as architecture.test.ts. Behaviour lands in P5.
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { fileViolations, moduleFiles, moduleViolations, MODULES_DIR } from "../../architecture.testkit.ts";
import { API_MODULES, P1_MODULES, P1_SCAFFOLD_MODULES } from "../../modules.ts";
import type { ModuleDeps } from "../platform/index.ts";
import * as mod from "./index.ts";

describe("reporting module (P1 scaffold, D-048)", () => {
  it("is mapped as a P1 scaffold module with its declared dependency direction", () => {
    expect(P1_MODULES).toContain("reporting");
    expect(P1_SCAFFOLD_MODULES).toContain("reporting");
    expect([...API_MODULES.reporting.dependsOn].sort()).toEqual([
      "access",
      "audit",
      "kpi",
      "platform",
      "transformations",
    ]);
  });

  it("has a public index.ts exposing a typed interface and its wiring hook", () => {
    expect(moduleFiles("reporting")).toContain("index.ts");
    expect(Object.keys(mod).sort()).toEqual(["REPORTING_MODULE", "registerReportingModule"]);
    expect(mod.REPORTING_MODULE).toEqual({ module: "reporting", status: "scaffold", deliversIn: "P5", routes: [] });
    expect(Object.isFrozen(mod.REPORTING_MODULE)).toBe(true);
  });

  it("its register hook runs without error and registers no route (no mutating route in P1)", async () => {
    const app = Fastify({ logger: false });
    const routes: string[] = [];
    app.addHook("onRoute", (r) => {
      routes.push(`${String(r.method)} ${r.url}`);
    });
    // The scaffold uses no dependency yet; the hook keeps the same signature as every other module's.
    const deps = { db: {}, config: {} } as unknown as ModuleDeps;
    const registration = mod.registerReportingModule(app, deps);
    await app.ready();
    expect(routes).toEqual([]);
    expect(registration).toBe(mod.REPORTING_MODULE);
    await app.close();
  });

  it("its declared boundary holds, and a planted bypass or undeclared dependency would be caught", () => {
    expect(moduleViolations("reporting")).toEqual([]);
    const plant = (source: string) =>
      fileViolations("reporting", join(MODULES_DIR, "reporting", "planted.ts"), source).join("\n");
    expect(plant("const k = await import(`../kpi/${'index'}.ts`);")).toContain("computed import() specifier");
    expect(plant(`import { PRODUCT_GATES } from "../workflows/index.ts";`)).toContain(
      "module reporting may not import module workflows",
    );
  });
});
