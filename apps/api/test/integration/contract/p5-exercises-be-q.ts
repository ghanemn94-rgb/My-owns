// P5 contract exercises of BE-Q (p5-work-split §I.1 and §2 rule 14; T-DG5-BE-Q): the four playbook-reader operations it
// routes (blocks list and get, a block's links, a template's source links), each with a success and every declared
// refusal it can reach, through the validating client. These are session reads: 403 is declared by the contract but
// no session caller reaches it (an unreadable transformation is 404, never disclosed). Every value is synthetic;
// nothing here is a business approval, and nothing touches DG0-DG7.
import { expect } from "vitest";
import type { z } from "zod";
import { methodologyBlock, methodologyBlockPage } from "../../../src/modules/methodology/reader.ts";
import { methodologyLinkList, templateSourceLinkList } from "../../../src/modules/methodology/source-links.ts";
import { createTransformationRow, signIn, type P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_BE_Q: Readonly<Record<string, z.ZodType>> = {
  listMethodologyBlocks: methodologyBlockPage,
  getMethodologyBlock: methodologyBlock,
  listMethodologyBlockLinks: methodologyLinkList,
  listTemplateSourceLinks: templateSourceLinkList,
};

const codeOf = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];

export async function exerciseP5BeQOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const reader = await signIn(api.app, w.office.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const tx = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const missing = crypto.randomUUID();
  const B = "/api/v1/methodology/blocks";

  // listMethodologyBlocks: 200 (published; pinned; phase filter; a second page); 400; 404 (unreadable transformation).
  const first = await mirrored("GET", `${B}?limit=2`, { session: nobody });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(first.body.items.map((b: { blockRef: string }) => b.blockRef)).toEqual(["B0001", "B0002"]);
  const next = await mirrored("GET", `${B}?limit=2&cursor=${first.body.nextCursor}`, { session: nobody });
  expect(next.body.items[0].blockRef).toBe("B0003");
  expect((await mirrored("GET", `${B}?phase=diagnose&transformationId=${tx}`, { session: reader })).status).toBe(200);
  expect((await mirrored("GET", `${B}?phase=sustain`, { session: reader })).status).toBe(400);
  expect(
    (await mirrored("GET", `${B}?limit=2&phase=define&cursor=${first.body.nextCursor}`, { session: nobody })).status,
  ).toBe(400);
  expect((await mirrored("GET", `${B}?transformationId=${tx}`, { session: nobody })).status).toBe(404);
  expect((await mirrored("GET", `${B}?transformationId=${missing}`, { session: reader })).status).toBe(404);

  // getMethodologyBlock: 200; 400; 404 methodology_block.not_found; 404 (unreadable transformation).
  expect((await mirrored("GET", `${B}/B0031`, { session: nobody })).status).toBe(200);
  expect((await mirrored("GET", `${B}/B0031?transformationId=${tx}`, { session: reader })).status).toBe(200);
  expect((await mirrored("GET", `${B}/X0031`, { session: reader })).status).toBe(400);
  expect((await mirrored("GET", `${B}/B0031?foo=1`, { session: reader })).status).toBe(400);
  expect(codeOf(await mirrored("GET", `${B}/B0999`, { session: reader }))).toEqual([
    404,
    "methodology_block.not_found",
  ]);
  expect((await mirrored("GET", `${B}/B0031?transformationId=${tx}`, { session: nobody })).status).toBe(404);

  // listMethodologyBlockLinks: 200; 400; 404 methodology_block.not_found; 404 (unreadable transformation).
  expect((await mirrored("GET", `${B}/B0031/links`, { session: nobody })).status).toBe(200);
  expect((await mirrored("GET", `${B}/B0023/links?transformationId=${tx}`, { session: reader })).status).toBe(200);
  expect((await mirrored("GET", `${B}/B31/links`, { session: reader })).status).toBe(400);
  expect(codeOf(await mirrored("GET", `${B}/B0000/links`, { session: reader }))).toEqual([
    404,
    "methodology_block.not_found",
  ]);
  expect((await mirrored("GET", `${B}/B0031/links?transformationId=${tx}`, { session: nobody })).status).toBe(404);

  // listTemplateSourceLinks: 200; 400; 404 (unreadable transformation). Every T01-T16 is seeded, so
  // methodology_template.not_found is reachable only through a pattern-valid code without a catalogue row (none).
  const T = "/api/v1/methodology/templates";
  expect((await mirrored("GET", `${T}/T01/source-links`, { session: nobody })).status).toBe(200);
  expect((await mirrored("GET", `${T}/T16/source-links?transformationId=${tx}`, { session: reader })).status).toBe(200);
  expect((await mirrored("GET", `${T}/T17/source-links`, { session: reader })).status).toBe(400);
  expect((await mirrored("GET", `${T}/T01/source-links?transformationId=${tx}`, { session: nobody })).status).toBe(404);
}
