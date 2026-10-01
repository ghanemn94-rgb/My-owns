import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@hub/db';
import { notFound, ragThresholdsInForce, RAG_THRESHOLD_CHANGE_ACTION, type ProjectTemplateDefinition, type RagThresholds, type RagThresholdsRef } from '@hub/domain';
import { DbService } from '../../platform/db.service';

export type ApprovalRequestRow = typeof schema.approvalRequest.$inferSelect;

/** Payload of a RAG threshold change request (bound to the approval by its hash). */
export interface RagThresholdPayload {
  versionNo: number;
  thresholds: RagThresholds;
  basedOn: { ref: RagThresholdsRef; thresholds: RagThresholds };
  reason: string;
}

/**
 * The RAG thresholds in force for a project (REQ-PLN-019): the latest APPROVED project version, else the pinned template
 * version's proposed default — with the reference that every calculated RAG names. Published for the planning
 * measurement (health), which reads it inside the caller's request transaction; it authorizes nothing itself (the
 * caller has authorized the read of the project's health).
 */
@Injectable()
export class RagThresholdsReader {
  constructor(private readonly db: DbService) {}

  async inForce(projectId: string): Promise<{ thresholds: RagThresholds; ref: RagThresholdsRef; approvedRequest: ApprovalRequestRow | null }> {
    const tx = this.db.tx();
    const [pin] = await tx
      .select({ def: schema.projectTemplateVersion.definition, versionNo: schema.projectTemplateVersion.versionNo })
      .from(schema.project)
      .innerJoin(schema.projectTemplateVersion, eq(schema.projectTemplateVersion.id, schema.project.templateVersionId))
      .where(eq(schema.project.id, projectId));
    if (!pin) throw notFound();
    const [approved] = await tx
      .select()
      .from(schema.approvalRequest)
      .where(
        and(
          eq(schema.approvalRequest.projectId, projectId),
          eq(schema.approvalRequest.action, RAG_THRESHOLD_CHANGE_ACTION),
          eq(schema.approvalRequest.subjectType, 'project'),
          eq(schema.approvalRequest.subjectId, projectId),
          eq(schema.approvalRequest.status, 'approved'),
        ),
      )
      .orderBy(desc(schema.approvalRequest.subjectVersion))
      .limit(1);
    const payload = approved ? (approved.payload as unknown as RagThresholdPayload) : null;
    const r = ragThresholdsInForce(pin.def as unknown as ProjectTemplateDefinition, pin.versionNo, payload ? { versionNo: payload.versionNo, thresholds: payload.thresholds } : null);
    return { ...r, approvedRequest: approved ?? null };
  }
}
