// methodology module suite (p2-work-split §2; ADR-0002, ADR-0014, ADR-0016 §2). Unit level: the module is mapped with
// its declared dependency direction, its public interface and wiring hook register exactly the two contract routes,
// each declaring access, and its boundary holds. Behaviour against PostgreSQL: test/integration/methodology.test.ts.
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
import { API_MODULES, P2_MODULES } from "../../modules.ts";
import type { ModuleDeps } from "../platform/index.ts";
import * as mod from "./index.ts";

describe("methodology module (P2)", () => {
  it("is a P2 module that depends only on platform, audit and access", () => {
    expect(P2_MODULES).toContain("methodology");
    expect([...API_MODULES.methodology.dependsOn].sort()).toEqual(["access", "audit", "platform"]);
  });

  it("has a public index.ts exposing its wiring hook and catalogue reader", () => {
    expect(moduleFiles("methodology")).toContain("index.ts");
    expect(Object.keys(mod).sort()).toEqual([
      "METHODOLOGY_MODULE",
      "loadGateDefinitions",
      "loadMethodologyCatalogue",
      "registerMethodologyModule",
      "toGateDefinition",
      "toTomDimension",
    ]);
    expect(Object.isFrozen(mod.METHODOLOGY_MODULE)).toBe(true);
  });

  it("registers exactly the catalogue read and the TOM-dimension label edit, each declaring its access", async () => {
    const app = Fastify({ logger: false });
    const routes: { key: string; access: unknown }[] = [];
    app.addHook("onRoute", (r) => {
      if (r.method !== "HEAD") routes.push({ key: `${String(r.method)} ${r.url}`, access: r.config?.access });
    });
    const registration = mod.registerMethodologyModule(app, { db: {}, config: {} } as unknown as ModuleDeps);
    await app.ready();
    expect(routes.map((r) => r.key).sort()).toEqual([...registration.routes].sort());
    expect(registration).toMatchObject({ module: "methodology", status: "active", deliversIn: "P2" });
    expect(routes.find((r) => r.key.startsWith("PATCH"))?.access).toEqual({ permission: "methodology.configure" });
    expect(routes.find((r) => r.key.startsWith("GET"))?.access).toEqual({ permission: "transformation.read" });
    await app.close();
  });

  it(
    "its declared boundary holds, and an undeclared dependency would be caught",
    () => {
      expect(moduleViolations("methodology")).toEqual([]);
      const plant = (source: string) =>
        fileViolations("methodology", join(MODULES_DIR, "methodology", "planted.ts"), source).join("\n");
      expect(plant(`import { PRODUCT_GATES } from "../workflows/index.ts";`)).toContain(
        "module methodology may not import module workflows",
      );
    },
    AST_TEST_TIMEOUT_MS,
  ); // F-DG2-143: AST walk of the module sources gets explicit headroom.
});
