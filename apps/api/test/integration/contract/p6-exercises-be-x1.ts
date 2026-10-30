// P6 contract exercises of BE-X1 (p6-work-split §2 rule 16; T-DG6-BE-X1; proposed F-DG6-QA-B-1; ADR-0051 §2, §4;
// D-196 point 1) through the contract-validating client `mirrored`. BE-X1 routes no operation; it declares the 403
// `evidence.parent_forbidden` that two existing evidence reads already answer, and proves it here against the contract:
//  - downloadEvidenceContent: 403 for an in-scope reader not admitted to a sensitive PARENT benefit, and to a sensitive
//    item itself; 200 for the benefit's owner (a named party) in the same state;
//  - getEvidence: 403 for the in-scope reader not admitted to the sensitive parent; 404 (ADR-0051 §2) when the item
//    itself is sensitive; 200 for the benefit's owner.
// The other statuses of both operations are exercised in p2-exercises.ts. Every value is SYNTHETIC; nothing here
// approves anything or touches DG0-DG7.
import { expect } from "vitest";
import type { z } from "zod";
import { call, signIn, type P6ExerciseContext } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { financialBody, seedBenefitWorld } from "../benefits/fixtures.ts";

/** No new JSON body: getEvidence's 200 is already mirrored (contract.test.ts `evidence`). */
export const P6_MIRRORS_BE_X1: Readonly<Record<string, z.ZodType>> = {};

export async function exerciseP6BeX1Operations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;
  const send = (method: string, url: string, opts?: Parameters<typeof call>[3]) => call(api.app, method, url, opts);
  const b = await seedBenefitWorld(api, w);
  const office = await signIn(api.app, w.office.subject); // TO @ org A: marks sensitivity

  // A benefit owned by BO, and a file evidence item created, owned and uploaded by TL, attached to the benefit (T14).
  const benefit = await send("POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b) });
  expect(benefit.status, JSON.stringify(benefit.body)).toBe(201);
  const ev = await send("POST", `${b.base}/evidence`, {
    session: b.s.tl,
    body: { kind: "file", title: "Synthetic contract evidence (BE-X1)", ownerUserId: b.users.tl.id },
  });
  expect(ev.status, JSON.stringify(ev.body)).toBe(201);
  const ITEM = `${b.base}/evidence/${ev.body.id}`;
  const up = await send("POST", `${ITEM}/content`, {
    session: b.s.tl,
    headers: { ...ifm(ev.body.version), "content-type": "application/octet-stream", "x-file-name": "terms.pdf" },
    body: Buffer.from("%PDF-1.4\n% synthetic contract evidence\n", "utf8"),
  });
  expect(up.status, JSON.stringify(up.body)).toBe(200);
  const attach = await send("POST", `${b.base}/form-records/T14/${benefit.body.id}/attachments`, {
    session: b.s.bo,
    body: { evidenceId: ev.body.id },
  });
  expect(attach.status, JSON.stringify(attach.body)).toBe(201);
  const mark = async (recordType: "benefit" | "evidence", recordId: string, isSensitive: boolean, version: number) => {
    const res = await send("PUT", `${b.base}/records/${recordType}/${recordId}/sensitivity`, {
      session: office,
      headers: { "if-match": `"${version}"` },
      body: { isSensitive, reason: "Synthetic contract sensitivity" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  const expectParentForbidden = (res: { status: number; body: { code?: unknown } }) =>
    expect([res.status, res.body.code]).toEqual([403, "evidence.parent_forbidden"]);

  // A sensitive PARENT: BO2 reads the transformation, is no party of the benefit (owner BO) and holds no grant.
  await mark("benefit", benefit.body.id, true, 0);
  expectParentForbidden(await m("GET", `${ITEM}/content`, { session: b.s.bo2 }));
  expectParentForbidden(await m("GET", ITEM, { session: b.s.bo2 }));
  expect((await m("GET", `${ITEM}/content`, { session: b.s.bo })).status).toBe(200);
  expect((await m("GET", ITEM, { session: b.s.bo })).status).toBe(200);
  await mark("benefit", benefit.body.id, false, 1);

  // A sensitive ITEM: the download is 403 (ADR-0051 §4 rule 2); its metadata GET keeps the §2 404.
  await mark("evidence", ev.body.id, true, 0);
  expectParentForbidden(await m("GET", `${ITEM}/content`, { session: b.s.bo2 }));
  expect((await m("GET", ITEM, { session: b.s.bo2 })).status).toBe(404);
  await mark("evidence", ev.body.id, false, 1);
  expect((await m("GET", `${ITEM}/content`, { session: b.s.bo2 })).status).toBe(200);
}
