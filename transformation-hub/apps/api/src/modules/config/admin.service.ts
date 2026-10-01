import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { schema } from '@hub/db';
import { clearanceAllows, diffTemplates, notFound, ruleViolation, type Classification, type ProjectTemplateDefinition, type TemplateKind } from '@hub/domain';
import { APP_CONFIG, type AppConfig } from '../../platform/config';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import type { RequestContext } from '../../platform/context';
import { iso } from './config.support';

/** Host name of a configured URL (never its credentials, path or query). */
const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/**
 * Administration, read-only (Reports & Administration — screen 16b, REQ-UX-020): the template versions of the organization
 * with how many projects are pinned to each, the diff between two versions of a template, and the deployment settings as
 * running. Settings are shown honestly and WITHOUT secrets: credentials (database URL, cookie / OIDC / S3 secrets) are never
 * returned — only whether each part is configured and the host names it talks to.
 */
@Injectable()
export class ConfigAdminService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async templates(ctx: RequestContext) {
    this.policy.assertOrg(ctx, 'config.template.read');
    const tx = this.db.tx();
    const rows = await tx
      .select({ v: schema.projectTemplateVersion, t: schema.projectTemplate })
      .from(schema.projectTemplateVersion)
      .innerJoin(schema.projectTemplate, eq(schema.projectTemplate.id, schema.projectTemplateVersion.templateId))
      .orderBy(asc(schema.projectTemplate.key), desc(schema.projectTemplateVersion.versionNo));
    // Pinned projects per version, counted only over the projects the caller may see (scope and clearance — a project
    // classified above the reader's clearance is not counted, as on Portfolio Home).
    const { rows: projects } = await this.db.query<{ id: string; version_id: string; classification: Classification }>(`select id, template_version_id as version_id, classification::text as classification from project`);
    const byVersion = new Map<string, number>();
    for (const p of projects) {
      if (!ctx.principal.projects.has(p.id) || !clearanceAllows(ctx.principal.clearance, p.classification)) continue;
      byVersion.set(p.version_id, (byVersion.get(p.version_id) ?? 0) + 1);
    }
    const out = new Map<string, { templateId: string; key: string; kind: TemplateKind; name: string; nameAr: string | null; versions: unknown[] }>();
    for (const { v, t } of rows) {
      const d = v.definition as unknown as ProjectTemplateDefinition;
      const item = out.get(t.id) ?? { templateId: t.id, key: t.key, kind: t.kind as TemplateKind, name: t.name, nameAr: d.name?.ar || null, versions: [] };
      item.versions.push({
        id: v.id,
        versionNo: v.versionNo,
        status: v.status,
        publishedAt: iso(v.publishedAt),
        counts: { gates: d.gates?.length ?? 0, workstreams: d.workstreams?.length ?? 0, activities: d.wbs?.length ?? 0, kpis: d.kpis?.length ?? 0 },
        projects: byVersion.get(v.id) ?? 0,
      });
      out.set(t.id, item);
    }
    return { items: [...out.values()] as never };
  }

  async diff(ctx: RequestContext, versionId: string, fromId: string) {
    this.policy.assertOrg(ctx, 'config.template.read');
    const [to] = await this.db.tx().select().from(schema.projectTemplateVersion).where(eq(schema.projectTemplateVersion.id, versionId));
    const [from] = await this.db.tx().select().from(schema.projectTemplateVersion).where(eq(schema.projectTemplateVersion.id, fromId));
    if (!to || !from) throw notFound();
    if (to.templateId !== from.templateId) throw ruleViolation('config.template_diff.other_template', 'Both versions must belong to the same template');
    const [t] = await this.db.tx().select({ key: schema.projectTemplate.key }).from(schema.projectTemplate).where(eq(schema.projectTemplate.id, to.templateId));
    return {
      templateKey: t!.key,
      fromVersionNo: from.versionNo,
      toVersionNo: to.versionNo,
      diff: diffTemplates(from.definition as unknown as ProjectTemplateDefinition, to.definition as unknown as ProjectTemplateDefinition),
    };
  }

  deploymentSettings(ctx: RequestContext) {
    this.policy.assertOrg(ctx, 'admin.org_settings.manage');
    const c = this.config;
    return {
      appName: c.appName,
      nodeEnv: c.nodeEnv,
      mode: c.demoMode ? ('demo' as const) : ('standard' as const),
      privateMode: c.privateMode,
      egressAllowlist: c.egressAllowlist.map((h) => hostOf(h.includes('://') ? h : `https://${h}`) ?? h),
      identity: {
        oidcConfigured: !!c.oidc.issuer && !!c.oidc.clientId && !!c.oidc.redirectUri,
        oidcIssuerHost: hostOf(c.oidc.issuer),
        linkByEmail: c.oidc.linkByEmail,
        demoLogin: c.demoMode,
        cookieSecure: c.cookieSecure,
        sessionIdleMinutes: c.sessionIdleMinutes,
        sessionAbsoluteHours: c.sessionAbsoluteHours,
      },
      storage: {
        driver: c.storage.driver,
        s3: c.storage.s3
          ? { endpointHost: hostOf(c.storage.s3.endpoint) ?? '', bucket: c.storage.s3.bucket, region: c.storage.s3.region, sse: c.storage.s3.sse, kmsKeyConfigured: !!c.storage.s3.kmsKeyId }
          : null,
        maxUploadMb: Math.round(c.storage.maxUploadBytes / (1024 * 1024)),
        allowUnscannedFiles: c.storage.allowUnscanned,
      },
      ai: {
        mockProviderAllowed: c.ai.allowMock,
        openAiCompatibleEndpointHost: hostOf(process.env.HUB_AI_OPENAI_BASE_URL),
        anthropicGatewayHost: hostOf(process.env.HUB_AI_ANTHROPIC_GATEWAY_URL),
      },
      rateLimits: { perMinute: c.rateLimits.perMinute, mutationsPerMinute: c.rateLimits.mutationsPerMinute, publicPerMinute: c.rateLimits.publicPerMinute },
      warnings: c.warnings,
    };
  }
}

