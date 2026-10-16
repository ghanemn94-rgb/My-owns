// P5 contract exercises of BE-R (p5-work-split §I.3 and §2 rule 14; T-DG5-BE-R): the six versioned-branding operations,
// each with a success and every declared refusal it can reach, through the contract-validating client `mirrored`.
// The save keeps the shipped values (#0078FF, "Mobily Transformation Hub"), because the shared contract world's other
// checks read the tokens and the product name; every value is SYNTHETIC. Branding is configuration, not a business
// approval: nothing here approves anything, and nothing touches the engineering delivery gates.
import { crc32, deflateSync } from "node:zlib";
import { branding, brandingSettings, brandingTokens, brandingVersion, brandingVersionPage } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_BE_R: Readonly<Record<string, z.ZodType>> = {
  getBranding: branding,
  getBrandingSettings: brandingSettings,
  putBrandingSettings: brandingSettings,
  listBrandingVersions: brandingVersionPage,
  getBrandingVersion: brandingVersion,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

/** A real 1x1 RGB PNG (synthetic), built here so no binary fixture is committed. */
function onePixelPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0, 0, 120, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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
  changeNote: "Synthetic contract exercise",
  ...over,
});

export async function exerciseP5BeROperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const tech = await signIn(api.app, w.admin.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const lead = await signIn(api.app, w.leadA1.subject);

  // getBranding: 200 (any signed-in user); 400 (undeclared parameter); 401.
  const cur = await mirrored("GET", "/api/v1/branding", { session: lead });
  expect([cur.status, (cur.body as Body).productNameEn]).toEqual([200, "Mobily Transformation Hub"]);
  expect((await mirrored("GET", "/api/v1/branding?x=1", { session: lead })).status).toBe(400);
  expect((await mirrored("GET", "/api/v1/branding")).status).toBe(401);

  // getBrandingSettings: 200 (ADM_TECH; ETag "0" before the first save); 400; 401; 403 (AUD, TL).
  const S = "/api/v1/admin/branding";
  const before = await mirrored("GET", S, { session: tech });
  expect(before.status).toBe(200);
  const head = (before.body as Body).version as number;
  expect(before.headers["etag"]).toBe(`"${head}"`);
  expect((await mirrored("GET", `${S}?x=1`, { session: tech })).status).toBe(400);
  expect((await mirrored("GET", S)).status).toBe(401);
  expect((await mirrored("GET", S, { session: auditor })).status).toBe(403);
  expect((await mirrored("GET", S, { session: lead })).status).toBe(403);

  // getBrandingLogo: 404 branding.logo_not_found (no logo); 400; 401. (The image/png 200 is in branding.test.ts.)
  const L = "/api/v1/branding/logo";
  const noLogo = await mirrored("GET", L, { session: lead });
  expect([noLogo.status, (noLogo.body as Body).code]).toEqual([404, "branding.logo_not_found"]);
  expect((await mirrored("GET", `${L}?x=1`, { session: lead })).status).toBe(400);
  expect((await mirrored("GET", L)).status).toBe(401);

  // putBrandingSettings: 428; 400 (malformed If-Match, malformed body); 401; 403 (AUD); 422; 200; 409 (stale).
  const ifm = (n: number) => ({ "if-match": `"${n}"` });
  expect((await mirrored("PUT", S, { session: tech, body: shipped() })).status).toBe(428);
  expect((await mirrored("PUT", S, { session: tech, body: shipped(), headers: { "if-match": "*" } })).status).toBe(400);
  expect(
    (await mirrored("PUT", S, { session: tech, body: { ...shipped(), extra: 1 }, headers: ifm(head) })).status,
  ).toBe(400);
  expect((await mirrored("PUT", S, { body: shipped(), headers: ifm(head) })).status).toBe(401);
  expect((await mirrored("PUT", S, { session: auditor, body: shipped(), headers: ifm(head) })).status).toBe(403);
  const refused = await mirrored("PUT", S, {
    session: tech,
    body: shipped({ primaryColour: "#0078ff" }),
    headers: ifm(head),
  });
  expect([refused.status, (refused.body as Body).code]).toEqual([422, "branding.colour_invalid"]);
  const saved = await mirrored("PUT", S, { session: tech, body: shipped(), headers: ifm(head) });
  expect([saved.status, saved.headers["etag"], (saved.body as Body).versionNo]).toEqual([
    200,
    `"${head + 1}"`,
    head + 1,
  ]);
  const stale = await mirrored("PUT", S, { session: tech, body: shipped(), headers: ifm(head) });
  expect([stale.status, (stale.body as Body).code]).toEqual([409, "version_conflict"]);

  // getBrandingLogo 200 (image/png): a logo is set, read and removed again (the shared world keeps the wordmark).
  const png = onePixelPng();
  const withLogo = await mirrored("PUT", S, {
    session: tech,
    body: shipped({
      logo: { mode: "set", pngBase64: png.toString("base64"), altEn: "Synthetic logo", altAr: "شعار تجريبي" },
    }),
    headers: ifm(head + 1),
  });
  expect(withLogo.status).toBe(200);
  const logo = await mirrored("GET", L, { session: lead });
  expect([logo.status, logo.headers["content-type"]]).toEqual([200, "image/png"]);
  expect(Buffer.from(logo.raw.rawPayload).equals(png)).toBe(true);
  const removed = await mirrored("PUT", S, {
    session: tech,
    body: shipped({ logo: { mode: "none" } }),
    headers: ifm(head + 2),
  });
  expect([removed.status, (removed.body as Body).logo]).toEqual([200, null]);
  const top = head + 3;

  // listBrandingVersions: 200; 400 (bad cursor); 401; 403.
  const V = "/api/v1/admin/branding/versions";
  const list = await mirrored("GET", `${V}?limit=1`, { session: tech });
  expect([list.status, (list.body as Body).items[0].versionNo]).toEqual([200, top]);
  expect((await mirrored("GET", `${V}?cursor=nope`, { session: tech })).status).toBe(400);
  expect((await mirrored("GET", V)).status).toBe(401);
  expect((await mirrored("GET", V, { session: auditor })).status).toBe(403);

  // getBrandingVersion: 200; 400 (versionNo 0); 401; 403; 404.
  const one = await mirrored("GET", `${V}/${head + 1}`, { session: tech });
  expect([one.status, (one.body as Body).versionNo]).toEqual([200, head + 1]);
  expect((await mirrored("GET", `${V}/${top - 1}`, { session: tech })).body.logo).toMatchObject({
    altEn: "Synthetic logo",
  });
  expect((await mirrored("GET", `${V}/0`, { session: tech })).status).toBe(400);
  expect((await mirrored("GET", `${V}/1`)).status).toBe(401);
  expect((await mirrored("GET", `${V}/1`, { session: auditor })).status).toBe(403);
  expect((await mirrored("GET", `${V}/${head + 1000}`, { session: tech })).status).toBe(404);

  // getBrandingTokens (DG1) still answers its shape after a save, with the derived shades appended.
  const tokens = await mirrored("GET", "/api/v1/branding/tokens", { session: lead });
  expect(brandingTokens.safeParse(tokens.body).success).toBe(true);
  expect((tokens.body as Body).provenance).toBe("provisional");
}
