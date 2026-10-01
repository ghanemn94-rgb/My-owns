import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { notFound, type Classification, type ProjectTemplateDefinition, type TemplateKind } from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { Clock } from '../../platform/clock';
import { RecordVersionService } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';

export type ProjectRow = typeof schema.project.$inferSelect;

/** The project with its pinned template version (definition included). */
export interface PinnedProject {
  p: ProjectRow;
  templateId: string;
  templateKey: string;
  templateKind: TemplateKind;
  templateName: string;
  versionNo: number;
  def: ProjectTemplateDefinition;
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Shared plumbing of the configuration module. Every command: load in project (404 outside scope or above the caller's
 * clearance) → policy (RBAC + ABAC) → domain rule (`@hub/domain` config.ts) → versioned write → audit, in the request
 * transaction.
 */
@Injectable()
export class ConfigSupport {
  constructor(
    readonly db: DbService,
    readonly policy: PolicyService,
    readonly audit: AuditService,
    readonly outbox: OutboxService,
    readonly clock: Clock,
    readonly versions: RecordVersionService,
  ) {}

  /** The project and its pinned template version; `lock` takes the project row lock (commands that change it). */
  async pinned(projectId: string, opts: { lock?: boolean } = {}): Promise<PinnedProject> {
    if (opts.lock) await this.db.query('select 1 from project where id = $1 for update', [projectId]);
    const [r] = await this.db
      .tx()
      .select({ p: schema.project, t: schema.projectTemplate, v: schema.projectTemplateVersion })
      .from(schema.project)
      .innerJoin(schema.projectTemplateVersion, eq(schema.projectTemplateVersion.id, schema.project.templateVersionId))
      .innerJoin(schema.projectTemplate, eq(schema.projectTemplate.id, schema.projectTemplateVersion.templateId))
      .where(eq(schema.project.id, projectId));
    if (!r) throw notFound();
    return {
      p: r.p,
      templateId: r.t.id,
      templateKey: r.t.key,
      templateKind: r.t.kind as TemplateKind,
      templateName: r.t.name,
      versionNo: r.v.versionNo,
      def: r.v.definition as unknown as ProjectTemplateDefinition,
    };
  }

  /** Project visibility (classification) for a project-scoped permission: 404 when the caller may not see the project. */
  assertProject(ctx: RequestContext, permission: string, p: ProjectRow, extra: { requesterUserId?: string | null; withinAuthority?: boolean } = {}) {
    this.policy.assert(ctx, permission, { projectId: p.id, classification: p.classification as Classification, ...extra });
  }

  can(ctx: RequestContext, permission: string, p: ProjectRow): boolean {
    return this.policy.can(ctx, permission, { projectId: p.id, classification: p.classification as Classification });
  }

  async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map();
    const rows = await this.db.tx().select({ id: schema.appUser.id, name: schema.appUser.displayName }).from(schema.appUser).where(inArray(schema.appUser.id, list));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Transaction-scoped advisory lock (one writer of a project's configuration item at a time). */
  async lock(key: string, projectId: string) {
    await this.db.tx().execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${key}:${projectId}`}, 0))`);
  }
}
