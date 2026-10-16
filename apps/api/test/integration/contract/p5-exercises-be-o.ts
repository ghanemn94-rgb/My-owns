// P5 contract exercises of BE-O (p5-work-split §F.7 and §2 rule 14; T-DG5-BE-O): getMeetingPresentation,
// listEvidenceRegister and listEvidenceVersions, each with a success and every declared refusal it can reach, through
// the validating client. Every value is SYNTHETIC; nothing approves anything or touches the engineering gates DG0-DG7.
//
// The meeting pack read in snapshot mode is stored by `storeMeetingPack` (presentation-fixtures.ts: the row the
// generate route writes) until KBE-D2's meeting_pack assembler merges; the live mode is exercised through the
// presentation port with a stub assembler (route and contract plumbing; the REQ-S10-013 live test is pending).
// Declared but not reachable here: 429 (the rate limiter's own suite).
//
// The zod mirrors of the OpenAPI components MeetingPresentation, EvidenceRegisterPage and EvidenceVersionPage live in
// `@mth/shared/schemas` (presentation.ts, evidence-register.ts; promoted from this file by T-DG5-FE-E, D-159 e).
import {
  evidenceRegisterPage,
  evidenceVersionPage,
  meetingPresentation,
  type ReportDocument,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { setMeetingPackAssembler } from "../../../src/modules/governance/presentation.ts";
import { call, signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { businessToday, plusDays, setupMeetingWorld } from "../governance/meeting-fixtures.ts";
import { storeMeetingPack } from "../governance/presentation-fixtures.ts";

export const P5_MIRRORS_BE_O: Readonly<Record<string, z.ZodType>> = {
  getMeetingPresentation: meetingPresentation,
  listEvidenceRegister: evidenceRegisterPage,
  listEvidenceVersions: evidenceVersionPage,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5BeOOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
  const code = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];
  const x = await setupMeetingWorld(api, w);
  const today = await businessToday(api);
  const T = `/api/v1/transformations/${x.transformationId}`;
  const nobody = await signIn(api.app, w.nobody.subject);
  const officeB = await signIn(api.app, w.officeB.subject);
  const meeting = async (days: number) => {
    const res = await send("POST", `${T}/meetings`, {
      session: x.lead.session,
      body: {
        forumId: x.forums.transformation_review,
        scheduledDate: plusDays(today, days),
        startTime: "09:00",
        durationMinutes: 60,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };

  // getMeetingPresentation: 200 (snapshot; live through the port; AUD), 400, 401, 403, 404, 422.
  const a = await meeting(10);
  const b = await meeting(11);
  const packA = await storeMeetingPack(api, send, {
    transformationId: x.transformationId,
    meetingId: a,
    author: x.lead,
    sections: [],
  });
  const packB = await storeMeetingPack(api, send, {
    transformationId: x.transformationId,
    meetingId: b,
    author: x.lead,
    sections: [],
  });
  const P = (m: string, s?: string) => `${T}/meetings/${m}/presentation${s === undefined ? "" : `?snapshotId=${s}`}`;
  const snap = await mirrored("GET", P(a, packA.id), { session: x.lead.session });
  expect(snap.status).toBe(200);
  expect(snap.body).toMatchObject({ meetingId: a, mode: "snapshot", snapshotId: packA.id });
  expect((await mirrored("GET", P(a, packA.id), { session: x.auditor.session })).status).toBe(200);
  const previous = setMeetingPackAssembler(async () => ({ ...packA.document }) as ReportDocument);
  try {
    const live = await mirrored("GET", P(a), { session: x.lead.session });
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ meetingId: a, mode: "live", snapshotId: null });
  } finally {
    setMeetingPackAssembler(previous);
  }
  expect((await mirrored("GET", `${P(a)}?snapshotId=nope`, { session: x.lead.session })).status).toBe(400);
  expect((await mirrored("GET", P(a, packA.id))).status).toBe(401);
  expect((await mirrored("GET", P(a, packA.id), { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", P(a, packA.id), { session: officeB })).status).toBe(404);
  expect((await mirrored("GET", P(crypto.randomUUID()), { session: x.lead.session })).status).toBe(404);
  expect(code(await mirrored("GET", P(a, packB.id), { session: x.lead.session }))).toEqual([
    422,
    "presentation.snapshot_mismatch",
  ]);

  // listEvidenceRegister: 200 (TL; AUD), 400, 401, 403, 404.
  const e = await send("POST", `${T}/evidence`, {
    session: x.lead.session,
    body: { kind: "file", title: "Synthetic register extract", ownerUserId: x.lead.id },
  });
  expect(e.status, JSON.stringify(e.body)).toBe(201);
  const up = await send("POST", `${T}/evidence/${e.body.id}/content`, {
    session: x.lead.session,
    headers: { ...ifm(e.body.version), "content-type": "application/octet-stream", "x-file-name": "extract.csv" },
    body: Buffer.from("a,b\n1,2\n"),
  });
  expect(up.status, JSON.stringify(up.body)).toBe(200);
  const note = await send("POST", `${T}/evidence`, {
    session: x.lead.session,
    body: { kind: "note", title: "Synthetic register note", noteBody: "Synthetic", ownerUserId: x.lead.id },
  });
  expect(note.status).toBe(201);
  const R = `${T}/evidence-register`;
  const reg = await mirrored("GET", R, { session: x.lead.session });
  expect(reg.status).toBe(200);
  const items = (reg.body as Body).items as Body[];
  expect(items.find((i) => i.evidenceId === e.body.id)).toMatchObject({ currentRevision: 1 });
  expect(items.find((i) => i.evidenceId === note.body.id)).toMatchObject({ sha256: null, source: null });
  expect((await mirrored("GET", `${R}?evidenceType=document&limit=1`, { session: x.auditor.session })).status).toBe(
    200,
  );
  expect((await mirrored("GET", `${R}?reviewStatus=nope`, { session: x.lead.session })).status).toBe(400);
  expect((await mirrored("GET", R)).status).toBe(401);
  expect((await mirrored("GET", R, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", R, { session: officeB })).status).toBe(404);

  // listEvidenceVersions: 200 (a file; a note has none), 400, 401, 403, 404.
  const V = (id: string) => `${T}/evidence/${id}/versions`;
  const versions = await mirrored("GET", V(e.body.id), { session: x.auditor.session });
  expect(versions.status).toBe(200);
  expect(((versions.body as Body).items as Body[]).map((v) => v.revision)).toEqual([1]);
  expect((await mirrored("GET", V(note.body.id), { session: x.lead.session })).body).toEqual({
    items: [],
    nextCursor: null,
  });
  expect((await mirrored("GET", `${V(e.body.id)}?limit=0`, { session: x.lead.session })).status).toBe(400);
  expect((await mirrored("GET", V(e.body.id))).status).toBe(401);
  expect((await mirrored("GET", V(e.body.id), { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", V(e.body.id), { session: officeB })).status).toBe(404);
  expect((await mirrored("GET", V(crypto.randomUUID()), { session: x.lead.session })).status).toBe(404);
}
