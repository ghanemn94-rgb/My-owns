// kpi module suite (D-048; REQ-S16-003 / A12 "the six modules exist with separate test suites"). The module is a P1
// SCAFFOLD: it is mapped, has a public index.ts with a typed interface and a wiring hook, registers no routes, and its
// declared boundary is enforced by the same dependency-lint as architecture.test.ts. Behaviour lands in P4.
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { fileViolations, moduleFiles, moduleViolations, MODULES_DIR } from "../../architecture.testkit.ts";
import { API_MODULES, P1_MODULES, P1_SCAFFOLD_MODULES } from "../../modules.ts";
import type { ModuleDeps } from "../platform/index.ts";
import * as mod from "./index.ts";

describe("kpi module (P1 scaffold, D-048)", () => {
  it("is mapped as a P1 scaffold module with its declared dependency direction", () => {
    expect(P1_MODULES).toContain("kpi");
    expect(P1_SCAFFOLD_MODULES).toContain("kpi");
    expect([...API_MODULES.kpi.dependsOn].sort()).toEqual([
      "access",
      "audit",
      "methodology",
      "platform",
      "transformations",
    ]);
  });

  it("has a public index.ts exposing a typed interface and its wiring hook", () => {
    expect(moduleFiles("kpi")).toContain("index.ts");
    expect(Object.keys(mod).sort()).toEqual(["KPI_MODULE", "VALUE_FRESHNESS", "registerKpiModule"]);
    expect(mod.KPI_MODULE).toEqual({ module: "kpi", status: "scaffold", deliversIn: "P4", routes: [] });
    expect(Object.isFrozen(mod.KPI_MODULE)).toBe(true);
  });

  it("models missing and outdated values as unknown / stale - never as zero or green", () => {
    expect(mod.VALUE_FRESHNESS).toEqual(["unknown", "stale", "current"]);
  });

  it("its register hook runs without error and registers no route (no mutating route in P1)", async () => {
    const app = Fastify({ logger: false });
    const routes: string[] = [];
    app.addHook("onRoute", (r) => {
      routes.push(`${String(r.method)} ${r.url}`);
    });
    // The scaffold uses no dependency yet; the hook keeps the same signature as every other module's.
    const deps = { db: {}, config: {} } as unknown as ModuleDeps;
    const registration = mod.registerKpiModule(app, deps);
    await app.ready();
    expect(routes).toEqual([]);
    expect(registration).toBe(mod.KPI_MODULE);
    await app.close();
  });

  it("its declared boundary holds, and a planted bypass or undeclared dependency would be caught", () => {
    expect(moduleViolations("kpi")).toEqual([]);
    const plant = (source: string) => fileViolations("kpi", join(MODULES_DIR, "kpi", "planted.ts"), source).join("\n");
    expect(plant(`const r = createRequire(import.meta.url)("../transformations/routes.ts");`)).toMatch(
      /createRequire/, // a regex: the string literal "createRequire" is itself banned in module source (F-DG1-124)
    );
    expect(plant(`import { WORKFLOWS_MODULE } from "../workflows/index.ts";`)).toContain(
      "module kpi may not import module workflows",
    );
  });
});
