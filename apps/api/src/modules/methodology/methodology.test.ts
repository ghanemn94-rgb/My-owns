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
      // P5 slice A (T-DG5-BE-A; ADR-0039 §1-§3): the ConfigResolver port, the kind registry and the content hash.
      "configKindProvider",
      "configKindProviders",
      "contentSha256",
      "createConfigResolver",
      "loadCatalogue",
      "loadGateDefinitions",
      "loadMethodologyCatalogue",
      "registerConfigKindProvider",
      "registerMethodologyModule",
      "resolvePinnedVersion",
      "toGateDefinition",
      "toTomDimension",
    ]);
    expect(Object.isFrozen(mod.METHODOLOGY_MODULE)).toBe(true);
  });

  it("registers the P2 catalogue routes and the P5 Studio routes of BE-A, each declaring its access", async () => {
    const app = Fastify({ logger: false });
    const routes: { key: string; access: unknown }[] = [];
    app.addHook("onRoute", (r) => {
      if (r.method !== "HEAD") routes.push({ key: `${String(r.method)} ${r.url}`, access: r.config?.access });
    });
    const registration = mod.registerMethodologyModule(app, { db: {}, config: {} } as unknown as ModuleDeps);
    await app.ready();
    expect(routes.map((r) => r.key).sort()).toEqual([...registration.routes].sort());
    expect(registration).toMatchObject({ module: "methodology", status: "active", deliversIn: "P2" });
    const access = new Map(routes.map((r) => [r.key, r.access]));
    expect(access.get("PATCH /api/v1/methodology/tom-dimensions/:dimensionCode")).toEqual({
      permission: "methodology.configure",
    });
    expect(access.get("GET /api/v1/transformations/:transformationId/methodology")).toEqual({
      permission: "transformation.read",
    });
    // P5 slice A (p5-work-split §A.1, §A.2): the eight BE-A and seven BE-B operations; the other slice A route files are
    // stubs until filled.
    const read = { permission: "methodology.read" };
    const configure = { permission: "methodology.configure" };
    const publish = { permission: "methodology.publish" };
    const studio = [...access].filter(([k]) => k.includes("methodology-versions") || k.includes("config-pins"));
    expect(Object.fromEntries(studio)).toEqual({
      "GET /api/v1/admin/methodology-versions": read,
      "POST /api/v1/admin/methodology-versions": configure,
      "GET /api/v1/admin/methodology-versions/:versionId": read,
      "PATCH /api/v1/admin/methodology-versions/:versionId": configure,
      "POST /api/v1/admin/methodology-versions/:versionId/discard": configure,
      "GET /api/v1/admin/methodology-versions/:versionId/elements": read,
      "GET /api/v1/transformations/:transformationId/config-pins": read,
      "GET /api/v1/transformations/:transformationId/config-pins/history": read,
      // T-DG5-BE-B (p5-work-split §A.2): element edits, diff, affected records, check runs, compatibility, preview.
      "PUT /api/v1/admin/methodology-versions/:versionId/elements/:elementType/:stableKey": configure,
      "POST /api/v1/admin/methodology-versions/:versionId/elements/:elementType/:stableKey/remove": configure,
      "GET /api/v1/admin/methodology-versions/:versionId/diff": read,
      "GET /api/v1/admin/methodology-versions/:versionId/affected-records": read,
      "GET /api/v1/admin/methodology-versions/:versionId/check-runs": read,
      "POST /api/v1/admin/methodology-versions/:versionId/compatibility-checks": publish,
      "POST /api/v1/admin/methodology-versions/:versionId/preview": publish,
    });
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
