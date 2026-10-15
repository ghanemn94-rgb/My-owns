// P5 contract exercises of BE-Q2 (p5-work-split §I.2 and §2 rule 14; T-DG5-BE-Q2): the four reader operations it routes
// (search, provenance, element profiles, guiding questions), each with a success and every declared refusal it can
// reach, through the validating client. These are session reads: 403 is declared by the contract but no session caller
// reaches it (an unreadable transformation is 404, never disclosed). Every value is synthetic; nothing here is a
// business approval, and nothing touches DG0-DG7.
import { expect } from "vitest";
import type { z } from "zod";
import {
  guidingQuestionList,
  methodologyElementProfileList,
} from "../../../src/modules/methodology/element-profiles.ts";
import { methodologyProvenance } from "../../../src/modules/methodology/provenance.ts";
import { methodologySearchPage } from "../../../src/modules/methodology/search.ts";
import { createTransformationRow, signIn, type P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_BE_Q2: Readonly<Record<string, z.ZodType>> = {
  searchMethodology: methodologySearchPage,
  getMethodologyProvenance: methodologyProvenance,
  listMethodologyElements: methodologyElementProfileList,
  listGuidingQuestions: guidingQuestionList,
};

const fieldCodeOf = (r: { status: number; body: unknown }) => [
  r.status,
  (r.body as { errors?: { code?: string }[] }).errors?.[0]?.code,
];

export async function exerciseP5BeQ2Operations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const reader = await signIn(api.app, w.office.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const tx = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const missing = crypto.randomUUID();
  const M = "/api/v1/methodology";

  // searchMethodology: 200 (en, ar, phase filter, pinned, a second page); 400 validation.search_query; 400 (unknown
  // parameter, bad cursor); 404 (unreadable or unknown transformation).
  const first = await mirrored("GET", `${M}/search?q=value%20pools&lang=en&limit=1`, { session: nobody });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(first.body.items).toHaveLength(1);
  expect(first.body.nextCursor).not.toBeNull();
  const second = await mirrored("GET", `${M}/search?q=value%20pools&lang=en&limit=1&cursor=${first.body.nextCursor}`, {
    session: nobody,
  });
  expect(second.status).toBe(200);
  expect(second.body.items[0]?.blockRef).not.toBe(first.body.items[0].blockRef);
  const ar = await mirrored("GET", `${M}/search?q=${encodeURIComponent("المنافع")}&lang=ar`, { session: reader });
  expect(ar.status).toBe(200);
  expect(ar.body.items.length).toBeGreaterThan(0);
  expect(
    (await mirrored("GET", `${M}/search?q=gate&phase=define&transformationId=${tx}`, { session: reader })).status,
  ).toBe(200);
  expect(fieldCodeOf(await mirrored("GET", `${M}/search?q=v`, { session: reader }))).toEqual([
    400,
    "validation.search_query",
  ]);
  expect(fieldCodeOf(await mirrored("GET", `${M}/search`, { session: reader }))).toEqual([
    400,
    "validation.search_query",
  ]);
  expect((await mirrored("GET", `${M}/search?q=gate&lang=fr`, { session: reader })).status).toBe(400);
  expect(
    (await mirrored("GET", `${M}/search?q=gate&lang=ar&cursor=${first.body.nextCursor}`, { session: reader })).status,
  ).toBe(400);
  expect((await mirrored("GET", `${M}/search?q=gate&transformationId=${tx}`, { session: nobody })).status).toBe(404);
  expect((await mirrored("GET", `${M}/search?q=gate&transformationId=${missing}`, { session: reader })).status).toBe(
    404,
  );

  // getMethodologyProvenance: 200 (published; pinned); 400; 404 (unreadable transformation).
  expect((await mirrored("GET", `${M}/provenance`, { session: nobody })).status).toBe(200);
  expect((await mirrored("GET", `${M}/provenance?transformationId=${tx}`, { session: reader })).status).toBe(200);
  expect((await mirrored("GET", `${M}/provenance?foo=1`, { session: reader })).status).toBe(400);
  expect((await mirrored("GET", `${M}/provenance?transformationId=${tx}`, { session: nobody })).status).toBe(404);

  // listMethodologyElements: 200 (all; filters; pinned); 400; 404 (unreadable transformation).
  const all = await mirrored("GET", `${M}/elements`, { session: nobody });
  expect(all.status).toBe(200);
  expect(all.body.items).toHaveLength(56);
  expect(
    (
      await mirrored("GET", `${M}/elements?provenance=foundation_inspired&kind=benefit_lifecycle_step`, {
        session: nobody,
      })
    ).body.items,
  ).toHaveLength(6);
  expect((await mirrored("GET", `${M}/elements?transformationId=${tx}`, { session: reader })).status).toBe(200);
  expect((await mirrored("GET", `${M}/elements?provenance=pmi_standard`, { session: reader })).status).toBe(400);
  expect((await mirrored("GET", `${M}/elements?kind=mode`, { session: reader })).status).toBe(400);
  expect((await mirrored("GET", `${M}/elements?transformationId=${tx}`, { session: nobody })).status).toBe(404);

  // listGuidingQuestions: 200; 400 (unknown parameter).
  const questions = await mirrored("GET", `${M}/guiding-questions`, { session: nobody });
  expect(questions.status).toBe(200);
  expect(questions.body.items).toHaveLength(4);
  expect((await mirrored("GET", `${M}/guiding-questions?lang=en`, { session: nobody })).status).toBe(400);
}
