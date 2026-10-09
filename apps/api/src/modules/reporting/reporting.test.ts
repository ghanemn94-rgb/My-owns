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

  // T-DG4-BE-M (p4-work-split §J+K JK.1): the first P4 read models land in reporting, so the hook now registers the
  // slice K routes and reports the module active in P4 (reporting/index.ts). The P1 constant REPORTING_MODULE above
  // is unchanged; KBE-G/KBE-G2 extend the list below with their dashboard routes.
  it("its register hook runs without error and registers exactly the P4 slice K routes", async () => {
    const app = Fastify({ logger: false });
    const routes: string[] = [];
    app.addHook("onRoute", (r) => {
      routes.push(`${String(r.method)} ${r.url}`);
    });
    // The scaffold uses no dependency yet; the hook keeps the same signature as every other module's.
    const deps = { db: {}, config: {} } as unknown as ModuleDeps;
    const registration = mod.registerReportingModule(app, deps);
    await app.ready();
    const T = "/api/v1/transformations/:transformationId";
    const sliceK = [
      `GET ${T}/traceability`,
      `GET ${T}/trace-links`,
      `POST ${T}/trace-links`,
      `GET ${T}/trace-links/:traceLinkId`,
      `PATCH ${T}/trace-links/:traceLinkId`,
      `POST ${T}/trace-links/:traceLinkId/remove`,
      `GET ${T}/allocation-sets/:allocationTargetType/:allocationTargetId`,
      `GET ${T}/orphans`,
      "GET /api/v1/records/:recordType/:recordId/impact",
    ];
    expect(routes.filter((r) => !r.startsWith("HEAD "))).toEqual(sliceK);
    expect(registration).toMatchObject({ module: "reporting", status: "active", deliversIn: "P4", routes: sliceK });
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
