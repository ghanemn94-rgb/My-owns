// P5 slice F (T-DG5-FE-E, promoted from apps/api/test/integration/contract/p5-exercises-be-o.ts of T-DG5-BE-O; D-159 e;
// ADR-0045 §7; REQ-S10-013): the mirror of the OpenAPI schema MeetingPresentation. The presentation of a meeting is the
// `meeting_pack` document, read-only: live (assembled now, `snapshotId` null) or the stored content of one of the
// meeting's pack snapshots. There is no separately editable copy.
import { z } from "zod";
import { reportDocument } from "./report.ts";

export const MEETING_PRESENTATION_MODES = ["live", "snapshot"] as const;
export type MeetingPresentationMode = (typeof MEETING_PRESENTATION_MODES)[number];

/** OpenAPI `MeetingPresentation`. */
export const meetingPresentation = z.strictObject({
  meetingId: z.uuid(),
  mode: z.enum(MEETING_PRESENTATION_MODES),
  snapshotId: z.uuid().nullable(),
  document: reportDocument,
});
export type MeetingPresentation = z.infer<typeof meetingPresentation>;
