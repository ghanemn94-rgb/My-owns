// Fixtures for the presentation-mode tests and contract exercises (backend-workflow-engineer, T-DG5-BE-O; ADR-0045 §7).
// All data is SYNTHETIC. Until KBE-D2's `meeting_pack` assembler merges, no meeting pack can be generated through the
// API, so `storeMeetingPack` writes the row the generate route would write: it first generates a real `charter`
// snapshot through the API (the assembler, methodology pin and as-of of this transformation), then stores a
// `meeting_pack` snapshot of the meeting with that context, the given sections and its canonical SHA-256, with its
// `report_snapshot.generate` audit event in the same transaction (like an API write; the 0080 guards apply). Issuing
// it afterwards goes through the real issue route. Nothing here approves anything; a pack issue is not a business
// approval, and nothing touches the engineering gates DG0-DG7.
import { insertAuditEvent } from "@mth/db";
import type { ReportDocument, ReportSection } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import { reportContentSha256 } from "../../../src/modules/reporting/reports/snapshots.ts";
import type { RequestOptions, Res, Session, TestApi } from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Send = (method: string, url: string, opts?: RequestOptions) => Promise<Res<any>>;

/** A text section quoting a decision (record ref + user-authored text), as a meeting pack lists a linked decision. */
export function decisionSection(decision: { id: string; version: number }, title: string): ReportSection {
  return {
    key: "decisions",
    titleKey: "report.meeting_pack.decisions",
    sources: [{ recordType: "decision", recordId: decision.id, recordVersion: decision.version }],
    kind: "text",
    text: { type: "text", value: title, authored: "user", validation: "not_applicable", reason: null },
  } as ReportSection;
}

/** Stores a generated `meeting_pack` snapshot of `meetingId` (see the file header) and returns its id and version. */
export async function storeMeetingPack(
  api: TestApi,
  send: Send,
  input: {
    readonly transformationId: string;
    readonly meetingId: string;
    readonly author: { readonly id: string; readonly session: Session };
    readonly sections: readonly ReportSection[];
  },
): Promise<{ id: string; version: number; document: ReportDocument }> {
  const T = `/api/v1/transformations/${input.transformationId}`;
  const charter = await send("POST", `${T}/reports/charter/generate`, { session: input.author.session, body: {} });
  expect(charter.status, JSON.stringify(charter.body).slice(0, 400)).toBe(201);
  const base = await api.db
    .selectFrom("report_snapshot")
    .selectAll()
    .where("id", "=", charter.body.id as string)
    .executeTakeFirstOrThrow();
  const baseDoc = base.content as ReportDocument;
  const document: ReportDocument = {
    ...baseDoc,
    definitionCode: "meeting_pack",
    subject: { type: "meeting", id: input.meetingId, code: null, label: "Synthetic meeting" },
    approvalState: "not_applicable",
    sections: [...input.sections],
  };
  const { sha256 } = reportContentSha256(document);
  const id = uuidv7();
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("report_snapshot")
      .values({
        id,
        organization_id: base.organization_id,
        transformation_id: base.transformation_id,
        definition_code: "meeting_pack",
        subject_type: "meeting",
        subject_id: input.meetingId,
        reporting_period_id: null,
        period_label: null,
        period_start: null,
        period_end: null,
        parameters: JSON.stringify({}),
        as_of: base.as_of,
        content_schema_version: base.content_schema_version,
        content: JSON.stringify(document),
        content_sha256: sha256,
        methodology_version_id: base.methodology_version_id,
        approval_state: "not_applicable",
        provisional_value_count: 0,
        unknown_value_count: 0,
        series_id: id,
        reissue_of_id: null,
        reissue_reason: null,
        created_by: input.author.id,
        updated_by: input.author.id,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: input.author.id, requestId: "test:be-o-meeting-pack", source: "api" },
      {
        action: "report_snapshot.generate",
        recordType: "report_snapshot",
        recordId: id,
        organizationId: base.organization_id,
        transformationId: base.transformation_id,
        newVersion: 1,
      },
    );
  });
  return { id, version: 1, document };
}
