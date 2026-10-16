// Presentation mode of a meeting (ADR-0045 §7; REQ-S10-013, M0212; p5-work-split §F.7; T-DG5-BE-O):
//   GET /transformations/{id}/meetings/{meetingId}/presentation[?snapshotId=]          getMeetingPresentation
//
// Read-only. Without `snapshotId` the presentation is LIVE: the `meeting_pack` document assembled at request time
// from the meeting's agenda items, their linked decision briefs and executive asks and its actions, by the same
// assembler that generates the printable pack, so a linked decision changed before cut-off appears changed. With
// `snapshotId` it is the stored content of that snapshot, which must be a `meeting_pack` snapshot of this meeting
// (else 422 presentation.snapshot_mismatch): an issued pack stays the snapshot whatever changes later. There is no
// separately editable copy (M0212); nothing here writes.
//
// Module boundary (modules.ts): reporting depends on governance, so governance cannot import the reporting
// assembler. The live document comes through a port the composition root wires (`setMeetingPackAssembler`, the
// setWorkflowsReadPort precedent). Until it is wired, or while the `meeting_pack` assembler has not merged (KBE-D2),
// the live mode answers 404, as getLiveReport does for an output without an assembler. The snapshot mode reads
// `report_snapshot` directly and needs no port.
//
// Authorization (ADR-0045 §7, §9): transformation.read in the meeting's transformation (the DG4 meeting read rule).
// A caller who holds transformation.read nowhere gets 403 (REQ-S13-010/S10-013 "a reader without
// transformation.read -> 403"); a caller who holds it, but not in this transformation, gets 404 (no existence leak).
import type { Db } from "@mth/db";
import { type ReportDocument } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { holdsAnywhere, principalOf, requireTransformationRead } from "../access/index.ts";
import { parse, parseQuery, problems, type ModuleDeps } from "../platform/index.ts";

const PRESENTATION = "/api/v1/transformations/:transformationId/meetings/:meetingId/presentation";
const params = z.strictObject({ transformationId: z.uuid(), meetingId: z.uuid() });
const query = z.strictObject({ snapshotId: z.uuid().optional() });

/** The exact ADR-0045 §11 refusal. */
export const presentationRefusals = {
  snapshotMismatch: () =>
    problems.businessRule("presentation.snapshot_mismatch", "This snapshot is not a pack of this meeting."),
};

/**
 * Assembles the live `meeting_pack` document of a meeting (the reporting assembler, ADR-0045 §1, §7). Returns null
 * when no `meeting_pack` assembler exists yet. It throws the reporting refusals unchanged.
 */
export type MeetingPackAssembler = (
  db: Db,
  input: { readonly transformationId: string; readonly meetingId: string },
) => Promise<ReportDocument | null>;

let meetingPackAssembler: MeetingPackAssembler | null = null;

/** Wired once by the composition root (server.ts). Returns the previous assembler, so a test can restore it. */
export function setMeetingPackAssembler(assembler: MeetingPackAssembler | null): MeetingPackAssembler | null {
  const previous = meetingPackAssembler;
  meetingPackAssembler = assembler;
  return previous;
}

export interface MeetingPresentation {
  readonly meetingId: string;
  readonly mode: "live" | "snapshot";
  readonly snapshotId: string | null;
  readonly document: ReportDocument;
}

/** The presentation of a meeting already known to be readable by the caller (route below; unit-tested through it). */
export async function readMeetingPresentation(
  db: Db,
  transformationId: string,
  meetingId: string,
  snapshotId: string | undefined,
): Promise<MeetingPresentation> {
  const meeting = await db
    .selectFrom("meeting")
    .select("id")
    .where("id", "=", meetingId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (meeting === undefined) throw problems.notFound();
  if (snapshotId !== undefined) {
    const s = await db
      .selectFrom("report_snapshot")
      .select(["id", "definition_code", "subject_type", "subject_id", "content"])
      .where("id", "=", snapshotId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    // A snapshot of another transformation is not visible here: 404, never a hint that it exists.
    if (s === undefined) throw problems.notFound();
    if (s.definition_code !== "meeting_pack" || s.subject_type !== "meeting" || s.subject_id !== meetingId)
      throw presentationRefusals.snapshotMismatch();
    return { meetingId, mode: "snapshot", snapshotId: s.id, document: s.content as ReportDocument };
  }
  const document =
    meetingPackAssembler === null ? null : await meetingPackAssembler(db, { transformationId, meetingId });
  if (document === null) throw problems.notFound();
  return { meetingId, mode: "live", snapshotId: null, document };
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerPresentationRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(PRESENTATION, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId, meetingId } = parse(params, request.params, "params");
    const { snapshotId } = parseQuery(query, request.query);
    const principal = principalOf(request);
    if (!holdsAnywhere(principal, "transformation.read")) throw problems.forbidden();
    await requireTransformationRead(db, principal, transformationId);
    return readMeetingPresentation(db, transformationId, meetingId, snapshotId);
  });
  return [`GET ${PRESENTATION}`];
}
