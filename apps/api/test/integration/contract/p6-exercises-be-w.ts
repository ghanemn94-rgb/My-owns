// P6 contract exercises of BE-W (p6-work-split §I/K.1 and §2 rule 16; T-DG6-BE-W): getBrandingVersionContrast (new)
// and the contrast refusal of putBrandingSettings (extended), each with a success and every declared refusal it can
// reach, through the contract-validating client `mirrored`. The save keeps the shipped values (#0078FF, #003B73,
// "Mobily Transformation Hub"), because the shared contract world's other checks read the tokens and the product name;
// the refused save writes nothing. Every value is SYNTHETIC. Branding is configuration, not a business approval:
// nothing here approves anything, and nothing touches the engineering delivery gates. #0078FF is a provisional brand
// token, not a verified Mobily colour.
import { brandingContrastReport, brandingSettings } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P6_MIRRORS_BE_W: Readonly<Record<string, z.ZodType>> = {
  getBrandingVersionContrast: brandingContrastReport,
  putBrandingSettings: brandingSettings,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const shipped = (over: Record<string, unknown> = {}) => ({
  productNameEn: "Mobily Transformation Hub",
  productNameAr: "منصة موبايلي للتحوّل",
  primaryColour: "#0078FF",
  secondaryColour: "#003B73",
  colourApprovalReference: null,
  fontLatin: "IBM Plex Sans",
  fontArabic: "IBM Plex Sans Arabic",
  logo: { mode: "keep" },
  reportHeaderEn: null,
  reportHeaderAr: null,
  reportFooterEn: null,
  reportFooterAr: null,
  changeNote: "Synthetic contract exercise (BE-W)",
  ...over,
});

export async function exerciseP6BeWOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const tech = await signIn(api.app, w.admin.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const lead = await signIn(api.app, w.leadA1.subject);
  const S = "/api/v1/admin/branding";
  const head = async () => {
    const r = await mirrored("GET", S, { session: tech });
    expect(r.status).toBe(200);
    return (r.body as Body).version as number;
  };

  // putBrandingSettings, extended: 422 branding.contrast_insufficient with one errors item per failing pair.
  const v0 = await head();
  const refused = await mirrored("PUT", S, {
    session: tech,
    headers: { "if-match": `"${v0}"` },
    body: shipped({ primaryColour: "#FFD700" }),
  });
  expect([refused.status, (refused.body as Body).code]).toEqual([422, "branding.contrast_insufficient"]);
  expect((refused.body as Body).errors).toEqual([
    {
      pointer: "/primaryColour",
      code: "branding.contrast_pair_below_threshold",
      message: "brand.primary / surface.card | ui | 1.40:1 < 3.0:1",
    },
    {
      pointer: "/primaryColour",
      code: "branding.contrast_pair_below_threshold",
      message: "brand.primary / surface.page | large-text | 1.31:1 < 3.0:1",
    },
  ]);
  expect(await head()).toBe(v0);

  // putBrandingSettings: 200 with the shipped colours (the report is recorded with the version).
  const saved = await mirrored("PUT", S, {
    session: tech,
    headers: { "if-match": `"${v0}"` },
    body: shipped(),
  });
  expect(saved.status).toBe(200);
  const versionNo = (saved.body as Body).versionNo as number;

  // getBrandingVersionContrast: 200 recorded (ETag of the version); 400 (malformed number, undeclared parameter);
  // 401; 403 (AUD, TL); 404 (unknown version).
  const C = (n: number | string) => `${S}/versions/${n}/contrast`;
  const ok = await mirrored("GET", C(versionNo), { session: tech });
  expect([ok.status, ok.headers["etag"]]).toEqual([200, `"${versionNo}"`]);
  expect(ok.body).toMatchObject({ versionNo, status: "recorded", pairCount: 50, failingCount: 0 });
  expect((ok.body as Body).pairs).toHaveLength(50);
  expect((await mirrored("GET", C("x"), { session: tech })).status).toBe(400);
  expect((await mirrored("GET", `${C(versionNo)}?x=1`, { session: tech })).status).toBe(400);
  expect((await mirrored("GET", C(versionNo))).status).toBe(401);
  for (const s of [auditor, lead]) {
    const r = await mirrored("GET", C(versionNo), { session: s });
    expect([r.status, (r.body as Body).code]).toEqual([403, "forbidden"]);
  }
  const missing = await mirrored("GET", C(2_000_000_000), { session: tech });
  expect([missing.status, (missing.body as Body).code]).toEqual([404, "not_found"]);
}
