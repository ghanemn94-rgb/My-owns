// Branding web seams (T-DG5-FE-G; slice I: ADR-0049 §8; REQ-S15-004, REQ-S01-002): the request paths of the six
// branding operations and the DG1 token read (operationId in the comment), their query keys under ["p5", "feg",
// "branding", …], the read hooks, and the render-time theme.
// Shapes are the @mth/shared mirrors (branding.ts, BE-R). Branding is configuration, not a business approval: an
// approval reference only records the admin's own brand approval, and #0078FF stays provisional until one is recorded.
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type {
  Branding,
  BrandingContrastReport,
  BrandingSettings,
  BrandingTokens,
  BrandingVersion,
  BrandingVersionPage,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { SHELL_READ } from "../../app/shell-read.ts";
import { shouldRetry } from "../../api/queries.ts";

export type { Branding, BrandingContrastReport, BrandingSettings, BrandingTokens, BrandingVersion };

/** The `--mth-*` custom property of a token (the @mth/design-tokens naming rule: dots become dashes). */
export const cssVarName = (token: string): string => `--mth-${token.replace(/\./g, "-")}`;

const v1 = "/api/v1";
export const brandingPaths = {
  current: `${v1}/branding`, // getBranding
  logo: `${v1}/branding/logo`, // getBrandingLogo
  tokens: `${v1}/branding/tokens`, // getBrandingTokens (DG1)
  settings: `${v1}/admin/branding`, // getBrandingSettings, putBrandingSettings
  versions: `${v1}/admin/branding/versions`, // listBrandingVersions
  version: (n: number) => `${v1}/admin/branding/versions/${n}`, // getBrandingVersion
  // T-DG6-FE-F (ADR-0061 §5): the contrast report of a published version.
  contrast: (n: number) => `${v1}/admin/branding/versions/${n}/contrast`, // getBrandingVersionContrast
};

export const brandingKeys = {
  all: ["p5", "feg", "branding"] as const,
  current: ["p5", "feg", "branding", "current"] as const,
  tokens: ["p5", "feg", "branding", "tokens"] as const,
  settings: ["p5", "feg", "branding", "settings"] as const,
  versions: (cursor: string | null) => ["p5", "feg", "branding", "versions", cursor ?? ""] as const,
  contrast: (n: number) => ["p5", "feg", "branding", "contrast", n] as const,
};

/** The current published branding, read at render time (version 0 = the shipped defaults). */
export function useBranding() {
  return useQuery({
    queryKey: brandingKeys.current,
    ...SHELL_READ,
    queryFn: () => api.get<Branding>(brandingPaths.current),
    retry: shouldRetry,
  });
}

export function useBrandingTokens() {
  return useQuery({
    queryKey: brandingKeys.tokens,
    ...SHELL_READ,
    queryFn: () => api.get<BrandingTokens>(brandingPaths.tokens),
    retry: shouldRetry,
  });
}

export function useBrandingSettings(enabled = true) {
  return useQuery({
    queryKey: brandingKeys.settings,
    queryFn: () => api.get<BrandingSettings>(brandingPaths.settings),
    enabled,
    retry: shouldRetry,
  });
}

export function useBrandingVersions(cursor: string | null, enabled = true) {
  return useQuery({
    queryKey: brandingKeys.versions(cursor),
    queryFn: () => api.get<BrandingVersionPage>(brandingPaths.versions, { limit: 20, ...(cursor ? { cursor } : {}) }),
    enabled,
    retry: shouldRetry,
  });
}

/**
 * The contrast report of a published branding version (T-DG6-FE-F; ADR-0061 §5; getBrandingVersionContrast):
 * `recorded` = stored at publish (every pair passes, a database rule); `not_recorded` = a version published before the
 * P6 contrast rule, evaluated now, whose `failingCount` may be above 0. Null version = nothing to read.
 */
export function useBrandingContrast(versionNo: number | null) {
  return useQuery({
    queryKey: brandingKeys.contrast(versionNo ?? 0),
    queryFn: () => api.get<BrandingContrastReport>(brandingPaths.contrast(versionNo ?? 0)),
    enabled: versionNo !== null && versionNo >= 1,
    retry: shouldRetry,
  });
}

/**
 * The colour tokens the shell re-themes at render time: the two branding colours and the shades derived from them,
 * including the navigation background derived from brand.primary (T-DG5-FE-G2; D-163, REQ-S15-004).
 */
export const THEMED_TOKENS = [
  "brand.primary",
  "brand.deep",
  "action.primary",
  "action.primary-hover",
  "nav.background",
] as const;

/**
 * Applies the current token set (GET /branding/tokens, which merges the current branding version's colours and
 * re-derives the accessible action shades by the ADR-0009 §3 rule) to the document as `--mth-*` custom properties, so a
 * published colour changes every screen without a rebuild or redeploy. Until the read answers, the bundled defaults
 * stay; on a failure they stay too (never a guessed colour).
 */
export function useBrandingTheme(): void {
  const tokens = useBrandingTokens();
  const data = tokens.data;
  useEffect(() => {
    if (!data || !Array.isArray(data.tokens)) return;
    const root = document.documentElement;
    const set: string[] = [];
    for (const name of THEMED_TOKENS) {
      const token = data.tokens.find((t) => t.name === name);
      if (token && /^#[0-9A-Fa-f]{6}$/.test(token.value)) {
        root.style.setProperty(cssVarName(name), token.value);
        set.push(name);
      }
    }
    return () => {
      for (const name of set) root.style.removeProperty(cssVarName(name));
    };
  }, [data]);
}

// ------------------------------------------------------------------------------------------------ contrast (WCAG 2.x)
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** The WCAG contrast ratio of two #RRGGBB colours (1–21), for the screen's preview check only. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export const HEX_COLOUR = /^#[0-9A-F]{6}$/;
