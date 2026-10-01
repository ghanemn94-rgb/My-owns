import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { aclFingerprintInput } from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import type { RequestContext } from '../../platform/context';
import { newId, sha256Hex } from '../../platform/ids';
import { AiKnowledgeService } from './ai-knowledge.service';

export type SourceRef = { type: string; id: string; version?: number };

/**
 * Derived AI artefacts (briefing summaries, executed drafts) — spec §12.1 "prevent leakage through caches/summaries;
 * changes/deletions/revoked access invalidate derived memory". Every artefact is keyed by the ACL fingerprint of the
 * principal it was produced for; it is served only when (a) not invalidated, (b) the reader's CURRENT fingerprint is
 * identical and (c) every source is still visible to the reader. Events invalidate proactively.
 */
@Injectable()
export class AiArtifactsService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly knowledge: AiKnowledgeService,
  ) {}

  fingerprint(ctx: RequestContext, projectId: string): string {
    const scope = ctx.principal.projects.get(projectId);
    const roles = scope ? [...scope.roles, ...scope.workstreamRoles.map((w) => `${w.role}@${w.workstreamId}`), ...scope.roomRoles.map((r) => `${r.role}@${r.roomId}`)] : [];
    const rooms = scope ? [...scope.roomIds] : [];
    return sha256Hex(aclFingerprintInput({ userId: ctx.principal.userId ?? ctx.principal.serviceIdentity ?? 'service', clearance: ctx.principal.clearance, roomIds: rooms, roles }));
  }

  async store(ctx: RequestContext, projectId: string, kind: string, sourceRefs: SourceRef[], content: Record<string, unknown>) {
    const [row] = await this.db
      .tx()
      .insert(schema.aiDerivedArtifact)
      .values({ id: newId(), orgId: ctx.principal.orgId, projectId, kind, aclFingerprint: this.fingerprint(ctx, projectId), sourceRefs, content, createdBy: ctx.principal.userId })
      .returning({ id: schema.aiDerivedArtifact.id });
    return row!.id;
  }

  async listMine(ctx: RequestContext, projectId: string) {
    await this.knowledge.assertProjectVisible(ctx, projectId); // QA-P5-03: 404 when the project is not visible
    this.policy.assert(ctx, 'ai.assistant.use', { projectId });
    const fp = this.fingerprint(ctx, projectId);
    const rows = await this.db
      .tx()
      .select()
      .from(schema.aiDerivedArtifact)
      .where(and(eq(schema.aiDerivedArtifact.projectId, projectId), eq(schema.aiDerivedArtifact.createdBy, ctx.principal.userId!), isNull(schema.aiDerivedArtifact.invalidatedAt), eq(schema.aiDerivedArtifact.aclFingerprint, fp)))
      .orderBy(desc(schema.aiDerivedArtifact.createdAt))
      .limit(50);
    const visible = await this.knowledge.visibleCitationKeys(ctx, projectId, rows.flatMap((r) => r.sourceRefs));
    return {
      items: rows
        .filter((r) => r.sourceRefs.every((s) => visible.has(`${s.type}:${s.id}`)))
        .map((r) => ({ id: r.id, kind: r.kind, sourceRefs: r.sourceRefs.map((s) => ({ type: s.type, id: s.id, ...(s.version !== undefined ? { version: s.version } : {}) })), content: r.content, createdAt: r.createdAt.toISOString() })),
    };
  }

  /**
   * Event-driven invalidation (runs in the worker under a service principal; maintenance only):
   *  - permission.changed on a user → that user's artefacts; on anything else (document, room, project) → all artefacts
   *    of the project that cite it, or all of the project when the scope is unclear (conservative);
   *  - document.changed → artefacts citing the document;
   *  - evidence.changed → artefacts citing the evidence target or the document.
   */
  async invalidateForEvent(projectId: string, eventType: string, aggregateType: string | null, aggregateId: string | null, payload: Record<string, unknown>): Promise<number> {
    const tx = this.db.tx();
    const reason = `${eventType}${aggregateType ? `:${aggregateType}` : ''}`;
    const cites = (type: string, id: string) => sql`${schema.aiDerivedArtifact.sourceRefs} @> ${JSON.stringify([{ type, id }])}::jsonb`;
    const base = and(eq(schema.aiDerivedArtifact.projectId, projectId), isNull(schema.aiDerivedArtifact.invalidatedAt));
    let where;
    if (eventType === 'permission.changed') {
      if (aggregateType === 'app_user' && aggregateId) where = and(base, eq(schema.aiDerivedArtifact.createdBy, aggregateId));
      else if (aggregateType === 'document' && aggregateId) where = and(base, cites('document', aggregateId));
      else where = base;
    } else if (eventType === 'document.changed') {
      const doc = (payload['documentId'] as string | undefined) ?? aggregateId;
      where = doc ? and(base, cites('document', doc)) : base;
    } else if (eventType === 'evidence.changed') {
      const tt = payload['targetType'] as string | undefined;
      const tid = payload['targetId'] as string | undefined;
      const doc = payload['documentId'] as string | undefined;
      const parts = [tt && tid ? cites(tt, tid) : null, doc ? cites('document', doc) : null].filter((x): x is NonNullable<typeof x> => !!x);
      where = parts.length ? and(base, sql`(${sql.join(parts, sql` or `)})`) : base;
    } else return 0;
    const r = await tx.update(schema.aiDerivedArtifact).set({ invalidatedAt: new Date(), invalidatedReason: reason }).where(where).returning({ id: schema.aiDerivedArtifact.id });
    return r.length;
  }
}
