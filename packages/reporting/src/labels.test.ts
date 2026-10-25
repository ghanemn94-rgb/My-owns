// F-DG5-140 (ADR-0049 §8 "Version 0 is the default"; REQ-S01-002, REQ-S13-009): the version-0 product name a generated
// file prints is, per language, the same text as the shell's i18n string and the API's version-0 branding. The worker
// imports no API or web code (ADR-0002), so this test reads those two sources as text and compares.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_PRODUCT_NAMES } from "./labels.ts";

const repo = (p: string) => new URL(`../../../${p}`, import.meta.url);

describe("DEFAULT_PRODUCT_NAMES (version 0)", () => {
  it("equals the shell's i18n common.brand.productName in en and ar", () => {
    for (const language of ["en", "ar"] as const) {
      const common = JSON.parse(readFileSync(repo(`apps/web/src/i18n/${language}/common.json`), "utf8")) as {
        brand: { productName: string };
      };
      expect(DEFAULT_PRODUCT_NAMES[language], language).toBe(common.brand.productName);
    }
  });

  it("equals the API's version-0 branding (GET /api/v1/branding productNameEn / productNameAr)", () => {
    const port = readFileSync(repo("apps/api/src/modules/admin/branding-port.ts"), "utf8");
    const constant = (name: string) => new RegExp(`export const ${name} = "([^"]*)";`).exec(port)?.[1];
    expect(DEFAULT_PRODUCT_NAMES.en).toBe(constant("DEFAULT_PRODUCT_NAME_EN"));
    expect(DEFAULT_PRODUCT_NAMES.ar).toBe(constant("DEFAULT_PRODUCT_NAME_AR"));
  });

  it("is «منصة موبايلي للتحوّل» in Arabic and 'Mobily Transformation Hub' in English", () => {
    expect(DEFAULT_PRODUCT_NAMES).toEqual({ en: "Mobily Transformation Hub", ar: "منصة موبايلي للتحوّل" });
  });
});
