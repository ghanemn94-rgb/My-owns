// Unit test of GET /api/v1/branding/tokens (REQ-S15-002 / A20) without a database, and (T-DG5-BE-R; ADR-0049 §8, §11)
// the pure parts of versioned branding: the token merge with the ADR-0009 §3 derivation, the §11 rules, the logo
// decoding, the zod mirrors against the contract, and the database-constraint mapping. The expected values are the seven
// seeded §15 tokens copied from the master prompt (M0293–M0299) as an independent oracle; the server injects the real
// @mth/design-tokens source. The response is checked against both the shared zod mirror and the OpenAPI schema.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { branding, brandingSettings, brandingTokens, brandingVersion } from "@mth/shared/schemas";
import { Ajv2020 } from "ajv/dist/2020.js";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { mapDatabaseGuardError, registerPlatformHooks } from "../platform/index.ts";
import {
  brandingSettingsPutBody,
  checkBrandingRules,
  decodeLogo,
  registerBrandingRoutes,
  toBrandingTokens,
  type BrandingTokenSource,
} from "./branding.ts";
import { DEFAULT_PRODUCT_NAME_AR, DEFAULT_PRODUCT_NAME_EN, defaultBranding } from "./branding-port.ts";

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
    // 429: every operation declares the global rate limiter's answer (ADR-0007 §5b, T-DG2-ARCH-03; the old contract
    // listed only 200/400/401 here).
    expect(Object.keys(op.responses).sort()).toEqual(["200", "400", "401", "429"]);
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

// ------------------------------------------------------------------------------------------------ T-DG5-BE-R
// The derived-token specs of the single token source (read as data: a module test imports no package outside the
// ADR-0002 allow-list); the derivation itself is a recording stand-in for @mth/design-tokens' deriveDarkerShade
// (its real values are asserted in the integration test test/integration/branding/branding.test.ts).
const tokensJson = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../../../packages/design-tokens/src/tokens.json", import.meta.url)),
    "utf8",
  ),
) as { derived: Record<string, unknown> };
const derivationCalls: [string, readonly string[], number][] = [];
const deriveDarkerShade = (base: string, against: readonly string[], target: number): string => {
  derivationCalls.push([base, against, target]);
  if (base === "#0078FF") return target === 4.5 ? "#006DE9" : "#0055B6";
  return target === 4.5 ? "#7A0A1C" : "#5A0714";
};
const withDerivation = (): BrandingTokenSource => ({
  ...seededSource(),
  derived: tokensJson.derived,
  deriveDarkerShade,
});
const v0 = defaultBranding({ primaryColour: "#0078FF", secondaryColour: "#003B73" });

describe("toBrandingTokens with a branding version (REQ-S15-004; ADR-0049 §8)", () => {
  it("version 0 re-derives exactly the tokens.json shades of #0078FF, every token provisional", () => {
    const t = toBrandingTokens(withDerivation(), v0);
    const byName = new Map(t.tokens.map((x) => [x.name, x]));
    expect(t.tokens.slice(0, 7)).toEqual(
      SEEDED.map(([name, value, purpose]) => ({ name, value, purpose, provisional: true })),
    );
    expect(byName.get("action.primary")?.value).toBe("#006DE9");
    expect(byName.get("action.primary-hover")?.value).toBe("#0055B6");
    expect(t.provenance).toBe("provisional");
    expect(contractValid(t), ajv.errorsText(contractValid.errors)).toBe(true);
  });

  it("a new primary colour replaces brand.primary and changes the derived action shade; secondary is brand.deep", () => {
    const t = toBrandingTokens(withDerivation(), {
      primaryColour: "#C8102E",
      secondaryColour: "#222222",
      coloursProvisional: false,
    });
    const byName = new Map(t.tokens.map((x) => [x.name, x]));
    expect(byName.get("brand.primary")?.value).toBe("#C8102E");
    expect(byName.get("brand.deep")?.value).toBe("#222222");
    // The rule of tokens.json, applied to the version's colour: >= 4.5:1 against surface.card and surface.page.
    expect(derivationCalls).toContainEqual(["#C8102E", ["#FFFFFF", "#F5F8FC"], 4.5]);
    expect(derivationCalls).toContainEqual(["#C8102E", ["#FFFFFF"], 7]);
    expect(byName.get("action.primary")?.value).toBe("#7A0A1C");
    expect(byName.get("action.primary-hover")?.value).toBe("#5A0714");
    // Approved colours never make the set official while the other shipped tokens are provisional.
    expect(t.provenance).toBe("provisional");
  });

  it("without the derivation (the DG1 source) the shape is the seven seeds only", () => {
    expect(toBrandingTokens(seededSource(), v0).tokens).toHaveLength(7);
  });
});

describe("version 0 defaults and the zod mirrors (REQ-S01-002)", () => {
  it("the default is 'Mobily Transformation Hub' / the shipped Arabic name, provisional, with the text wordmark", () => {
    expect([v0.versionNo, v0.source, v0.productNameEn, v0.productNameAr, v0.logo, v0.wordmarkProvisional]).toEqual([
      0,
      "default",
      "Mobily Transformation Hub",
      "منصة موبايلي للتحوّل",
      null,
      true,
    ]);
    expect([DEFAULT_PRODUCT_NAME_EN, DEFAULT_PRODUCT_NAME_AR]).toEqual([v0.productNameEn, v0.productNameAr]);
  });

  it("each mirror accepts what its contract component accepts and rejects an extra member", () => {
    const { logoPng: _p, head: _h, ...current } = v0;
    const settings = {
      ...current,
      colourApprovalReference: null,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    };
    const version = {
      ...current,
      versionNo: 1,
      colourApprovalReference: null,
      changeNote: null,
      createdAt: "2026-10-16T07:00:00.000Z",
      createdBy: "0190a000-0000-7000-8000-000000000001",
    };
    delete (version as Record<string, unknown>)["source"];
    delete (version as Record<string, unknown>)["wordmarkProvisional"];
    const schemas = new Map(Object.entries(openapi.components.schemas));
    for (const [name, mirror, value] of [
      ["Branding", branding, current],
      ["BrandingSettings", brandingSettings, settings],
      ["BrandingVersion", brandingVersion, version],
    ] as const) {
      // The component with the contract's components beside it, so its internal $refs resolve.
      const valid = ajv.compile({ ...(schemas.get(name) as object), components: openapi.components });
      expect(mirror.safeParse(value).success, name).toBe(true);
      expect(valid(value), `${name}: ${ajv.errorsText(valid.errors)}`).toBe(true);
      expect(mirror.safeParse({ ...value, extra: 1 }).success, name).toBe(false);
      expect(valid({ ...value, extra: 1 }), name).toBe(false);
    }
  });
});

describe("the §11 rules without a database (ADR-0049 §11)", () => {
  const body = (over: Record<string, unknown> = {}) =>
    brandingSettingsPutBody.parse({
      productNameEn: "Synthetic Hub",
      productNameAr: "منصة تجريبية",
      primaryColour: "#0078FF",
      secondaryColour: "#003B73",
      fontLatin: "IBM Plex Sans",
      fontArabic: "IBM Plex Sans Arabic",
      logo: { mode: "keep" },
      ...over,
    });
  const code = (f: () => unknown) => {
    try {
      f();
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    }
  };

  it("colours, fonts and the text pairs", () => {
    expect(code(() => checkBrandingRules(body()))).toBeNull();
    expect(code(() => checkBrandingRules(body({ primaryColour: "#0078ff" })))).toBe("branding.colour_invalid");
    expect(code(() => checkBrandingRules(body({ secondaryColour: "0078FF" })))).toBe("branding.colour_invalid");
    expect(code(() => checkBrandingRules(body({ fontArabic: "Noto Sans Arabic" })))).toBe("branding.font_unavailable");
    expect(code(() => checkBrandingRules(body({ reportHeaderAr: "ترويسة" })))).toBe("branding.text_pair_required");
    expect(code(() => checkBrandingRules(body({ reportFooterEn: "Footer", reportFooterAr: "تذييل" })))).toBeNull();
  });

  it("the logo: a PNG signature within 67 B..256 KiB with both alternative texts; never SVG", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(80)]);
    const set = (bytes: Buffer, alt = true) => ({
      mode: "set" as const,
      pngBase64: bytes.toString("base64"),
      ...(alt ? { altEn: "Logo", altAr: "شعار" } : {}),
    });
    expect(decodeLogo(set(png)).sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(code(() => decodeLogo(set(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>".padEnd(90)))))).toBe(
      "branding.logo_invalid",
    );
    expect(code(() => decodeLogo(set(png.subarray(0, 40))))).toBe("branding.logo_invalid");
    expect(code(() => decodeLogo(set(Buffer.concat([png, Buffer.alloc(262_144)]))))).toBe("branding.logo_invalid");
    expect(code(() => decodeLogo(set(png, false)))).toBe("branding.logo_invalid");
    expect(code(() => decodeLogo({ ...set(png), pngBase64: "not base64!" }))).toBe("branding.logo_invalid");
  });

  it("maps the 0089 constraints to the §11 codes and exact texts", () => {
    const map = (constraint: string) => mapDatabaseGuardError({ code: "23514", constraint } as never);
    expect(map("branding_version_no_pmi_claim")?.toBody("r")).toMatchObject({
      status: 422,
      code: "branding.prohibited_claim",
      detail: "Branding text must not claim official PMI status or certification.",
    });
    expect(map("branding_version_no_engineering_gate")?.toBody("r")).toMatchObject({
      status: 422,
      code: "branding.engineering_gate_reference",
      detail: "Branding text must not name an engineering delivery gate.",
    });
    expect(map("branding_version_header_pair")?.toBody("r")).toMatchObject({ code: "branding.text_pair_required" });
    expect(map("branding_version_logo_png_check")?.toBody("r")).toMatchObject({ code: "branding.logo_invalid" });
    expect(map("branding_version_step")?.toBody("r")).toMatchObject({ status: 409, code: "version_conflict" });
    expect(map("branding_setting_version_matches")?.toBody("r")).toMatchObject({ status: 500 });
  });
});
