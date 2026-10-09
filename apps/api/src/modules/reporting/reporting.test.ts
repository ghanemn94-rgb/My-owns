// reporting module suite (D-048; REQ-S16-003 / A12 "the six modules exist with separate test suites"). The module is a P1
// SCAFFOLD: it is mapped, has a public index.ts with a typed interface and a wiring hook, registers no routes, and its
// declared boundary is enforced by the same dependency-lint as architecture.test.ts. Behaviour lands in P5.
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  AST_TEST_TIMEOUT_MS,
  fileViolations,
  moduleFiles,
  moduleViolations,
  MODULES_DIR,
} from "../../architecture.testkit.ts";
import { API_MODULES, P1_MODULES, P1_SCAFFOLD_MODULES } from "../../modules.ts";
import type { ModuleDeps } from "../platform/index.ts";
import * as mod from "./index.ts";

describe("reporting module (P1 scaffold, D-048)", () => {
  it("is mapped as a P1 scaffold module with its declared dependency direction", () => {
    expect(P1_MODULES).toContain("reporting");
    expect(P1_SCAFFOLD_MODULES).toContain("reporting");
    // P4 (T-DG4-BE-A; p4-plan §5.1 BE-M, KBE-G): read-only views over every P4 engine; never workflows.
    expect([...API_MODULES.reporting.dependsOn].sort()).toEqual([
      "access",
      "adoption",
      "audit",
      "benefits",
      "governance",
      "kpi",
      "platform",
      "portfolio",
      "raid",
      "sustainment",
      "tasks",
      "transformations",
    ]);
    expect(API_MODULES.reporting.dependsOn as readonly string[]).not.toContain("workflows");
  });

  it("has a public index.ts exposing a typed interface and its wiring hook", () => {
    expect(moduleFiles("reporting")).toContain("index.ts");
    expect(Object.keys(mod).sort()).toEqual(["REPORTING_MODULE", "registerReportingModule"]);
    expect(mod.REPORTING_MODULE).toEqual({ module: "reporting", status: "scaffold", deliversIn: "P5", routes: [] });
    expect(Object.isFrozen(mod.REPORTING_MODULE)).toBe(true);
  });

  it("its register hook registers the routes of its P4 route files and reports them (T-DG4-KBE-G)", async () => {
    // P1 asserted a route-free scaffold; from P4 (KBE-G dashboards, BE-M traceability) the hook registers the route
    // files' routes and reports the module "active" while any exists (the sustainment/benefits pattern).
    const app = Fastify({ logger: false });
    const routes: string[] = [];
    app.addHook("onRoute", (r) => {
      routes.push(`${String(r.method)} ${r.url}`);
    });
    const deps = { db: {}, config: {} } as unknown as ModuleDeps;
    const registration = mod.registerReportingModule(app, deps);
    await app.ready();
    expect(registration.module).toBe("reporting");
    expect(registration.status).toBe(registration.routes.length > 0 ? "active" : "scaffold");
    for (const r of registration.routes) expect(routes.map((x) => x.replace(/^GET,HEAD /, "GET "))).toContain(r);
    await app.close();
  });

  it(
    "its declared boundary holds, and a planted bypass or undeclared dependency would be caught",
    () => {
      expect(moduleViolations("reporting")).toEqual([]);
      const plant = (source: string) =>
        fileViolations("reporting", join(MODULES_DIR, "reporting", "planted.ts"), source).join("\n");
      expect(plant("const k = await import(`../kpi/${'index'}.ts`);")).toContain("computed import() specifier");
      expect(plant(`import { PRODUCT_GATES } from "../workflows/index.ts";`)).toContain(
        "module reporting may not import module workflows",
      );
    },
    AST_TEST_TIMEOUT_MS,
  ); // F-DG2-143: AST walk of the module sources gets explicit headroom.
});
