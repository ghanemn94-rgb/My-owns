// Unit test of GET /api/v1/branding/tokens (REQ-S15-002 / A20) without a database. The expected values are the seven
// seeded §15 tokens copied from the master prompt (M0293–M0299) as an independent oracle; the server injects the real
// @mth/design-tokens source. The response is checked against both the shared zod mirror and the OpenAPI schema.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brandingTokens } from "@mth/shared/schemas";
import { Ajv2020 } from "ajv/dist/2020.js";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { registerPlatformHooks } from "../platform/index.ts";
import { registerBrandingRoutes, toBrandingTokens, type BrandingTokenSource } from "./branding.ts";

const SEEDED: ReadonlyArray<readonly [string, string, string]> = [
  ["brand.primary", "#0078FF", "Primary accents and selected elements"],
  ["brand.deep", "#003B73", "Stronger blue surfaces and text where suitable"],
  ["surface.page", "#F5F8FC", "Page background"],
  ["surface.card", "#FFFFFF", "Content surfaces"],
  ["text.primary", "#142438", "Main text"],
  ["text.secondary", "#526174", "Secondary text"],
  ["border.default", "#DCE5EF", "Dividers and field boundaries"],
];

const seededSource = (provisional = true): BrandingTokenSource => ({
  tokensAreProvisional: provisional,
  colorTokens: Object.fromEntries(SEEDED.map(([n, value, purpose]) => [n, { value, purpose, provisional }])),
});

const openapi = parseYaml(
  readFileSync(fileURLToPath(new URL("../../../../../docs/api/openapi.yaml", import.meta.url)), "utf8"),
) as { components: { schemas: Record<string, unknown> }; paths: Record<string, Record<string, unknown>> };
const ajv = new Ajv2020({ strict: false, allErrors: true });
const contractValid = ajv.compile(openapi.components.schemas["BrandingTokens"] as object);

async function appWith(source: BrandingTokenSource) {
  const app = Fastify({ logger: false });
  const routes: { url: string; method: string; access: unknown }[] = [];
  app.addHook("onRoute", (r) => {
    routes.push({ url: r.url, method: String(r.method), access: r.config?.access });
  });
  registerPlatformHooks(app);
  registerBrandingRoutes(app, source);
  await app.ready();
  return { app, routes };
}

describe("GET /api/v1/branding/tokens (REQ-S15-002)", () => {
  it("returns the seven seeded tokens with their values and provenance=provisional, valid against the contract", async () => {
    const { app } = await appWith(seededSource());
    const res = await app.inject({ method: "GET", url: "/api/v1/branding/tokens" });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provenance).toBe("provisional");
    expect(body.tokens).toEqual(SEEDED.map(([name, value, purpose]) => ({ name, value, purpose, provisional: true })));
    expect(brandingTokens.safeParse(body).success).toBe(true);
    expect(contractValid(body), ajv.errorsText(contractValid.errors)).toBe(true);
    // No response claims official Mobily brand compliance.
    expect(res.body).not.toMatch(/official|compliant|certified/i);
  });

  it("declares authenticated-only access, matching the contract operation (401 declared)", async () => {
    const { app, routes } = await appWith(seededSource());
    await app.close();
    expect(routes.find((r) => r.url === "/api/v1/branding/tokens" && r.method === "GET")?.access).toEqual({
      permission: "authenticated",
    });
    const op = openapi.paths["/api/v1/branding/tokens"]?.["get"] as { operationId: string; responses: object };
    expect(op.operationId).toBe("getBrandingTokens");
    // 400: every operation that validates input declares it (ADR-0007 §5a, T-DG2-ARCH-02; U+0000 in the query string).
    expect(Object.keys(op.responses).sort()).toEqual(["200", "400", "401"]);
  });

  it("never reports official provenance while the set or any single token is provisional", () => {
    expect(toBrandingTokens(seededSource(true)).provenance).toBe("provisional");
    const mixed = seededSource(false);
    const colorTokens = {
      ...mixed.colorTokens,
      "brand.primary": { ...mixed.colorTokens["brand.primary"]!, provisional: true },
    };
    expect(toBrandingTokens({ tokensAreProvisional: false, colorTokens }).provenance).toBe("provisional");
    expect(toBrandingTokens(seededSource(false)).provenance).toBe("official");
  });

  it("the zod mirror rejects shapes the contract rejects", () => {
    const ok = { provenance: "provisional", tokens: [{ name: "brand.primary", value: "#0078FF", provisional: true }] };
    expect(brandingTokens.safeParse(ok).success).toBe(true);
    expect(contractValid(ok)).toBe(true);
    for (const bad of [
      { ...ok, provenance: "verified" },
      { ...ok, extra: 1 },
      { provenance: "provisional", tokens: [{ name: "x", value: "#000000" }] },
      { provenance: "provisional", tokens: [{ name: "x", value: "#000000", provisional: true, extra: 1 }] },
    ]) {
      expect(brandingTokens.safeParse(bad).success).toBe(false);
      expect(contractValid(bad)).toBe(false);
    }
  });
});
