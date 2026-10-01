// workflows module suite (D-048; REQ-S16-003 / A12 "the six modules exist with separate test suites"). The module is a P1
// SCAFFOLD: it is mapped, has a public index.ts with a typed interface and a wiring hook, registers no routes, and its
// declared boundary is enforced by the same dependency-lint as architecture.test.ts. Behaviour lands in P2.
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { fileViolations, moduleFiles, moduleViolations, MODULES_DIR } from "../../architecture.testkit.ts";
import { API_MODULES, P1_MODULES, P1_SCAFFOLD_MODULES } from "../../modules.ts";
import type { ModuleDeps } from "../platform/index.ts";
import * as mod from "./index.ts";

describe("workflows module (P1 scaffold, D-048)", () => {
  it("is mapped as a P1 scaffold module with its declared dependency direction", () => {
    expect(P1_MODULES).toContain("workflows");
    expect(P1_SCAFFOLD_MODULES).toContain("workflows");
    expect([...API_MODULES.workflows.dependsOn].sort()).toEqual([
      "access",
      "audit",
      "methodology",
      "platform",
      "transformations",
    ]);
  });

  it("has a public index.ts exposing a typed interface and its wiring hook", () => {
    expect(moduleFiles("workflows")).toContain("index.ts");
    expect(Object.keys(mod).sort()).toEqual([
      "CLOSURE_GATE",
      "PRODUCT_GATES",
      "WORKFLOWS_MODULE",
      "registerWorkflowsModule",
    ]);
    expect(mod.WORKFLOWS_MODULE).toEqual({ module: "workflows", status: "scaffold", deliversIn: "P2", routes: [] });
    expect(Object.isFrozen(mod.WORKFLOWS_MODULE)).toBe(true);
  });

  it("names the product gates G1-G6 (business approvals), never the engineering gates DG0-DG7", () => {
    expect(mod.PRODUCT_GATES).toEqual(["G1", "G2", "G3", "G4", "G5", "G6"]);
    expect(mod.PRODUCT_GATES.some((g) => g.startsWith("DG"))).toBe(false);
    // Closure waits for G6; until this module delivers it, the transformations module refuses closure (F-DG1-001).
    expect(mod.CLOSURE_GATE).toBe("G6");
  });

  it("its register hook runs without error and registers no route (no mutating route in P1)", async () => {
    const app = Fastify({ logger: false });
    const routes: string[] = [];
    app.addHook("onRoute", (r) => {
      routes.push(`${String(r.method)} ${r.url}`);
    });
    // The scaffold uses no dependency yet; the hook keeps the same signature as every other module's.
    const deps = { db: {}, config: {} } as unknown as ModuleDeps;
    const registration = mod.registerWorkflowsModule(app, deps);
    await app.ready();
    expect(routes).toEqual([]);
    expect(registration).toBe(mod.WORKFLOWS_MODULE);
    await app.close();
  });

  it("its declared boundary holds, and a planted bypass or undeclared dependency would be caught", () => {
    expect(moduleViolations("workflows")).toEqual([]);
    const plant = (source: string) =>
      fileViolations("workflows", join(MODULES_DIR, "workflows", "planted.ts"), source).join("\n");
    expect(plant(`import { decide } from "../access/rules.ts";`)).toContain("only access/index.ts is public");
    expect(plant(`import { REPORTING_MODULE } from "../reporting/index.ts";`)).toContain(
      "module workflows may not import module reporting",
    );
  });
});
