import { Controller } from '@nestjs/common';
import { configRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { RagThresholdsService } from './rag-thresholds.service';
import { TemplateUpgradesService } from './template-upgrades.service';
import { SetupService } from './setup.service';
import { ConfigAdminService } from './admin.service';

@Controller()
export class ConfigController {
  constructor(
    private readonly rag: RagThresholdsService,
    private readonly upgrades: TemplateUpgradesService,
    private readonly setup: SetupService,
    private readonly admin: ConfigAdminService,
  ) {}

  // RAG thresholds (REQ-PLN-019)
  @ApiRoute(R.getRagThresholds)
  getRagThresholds(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getRagThresholds>) {
    return this.rag.get(ctx, i.params.projectId);
  }

  @ApiRoute(R.proposeRagThresholds)
  proposeRagThresholds(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.proposeRagThresholds>) {
    return this.rag.propose(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.approveRagThresholds)
  approveRagThresholds(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approveRagThresholds>) {
    return this.rag.approve(ctx, i.params.projectId, i.params.requestId, i.body);
  }

  @ApiRoute(R.rejectRagThresholds)
  rejectRagThresholds(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rejectRagThresholds>) {
    return this.rag.reject(ctx, i.params.projectId, i.params.requestId, i.body);
  }

  @ApiRoute(R.withdrawRagThresholds)
  withdrawRagThresholds(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.withdrawRagThresholds>) {
    return this.rag.withdraw(ctx, i.params.projectId, i.params.requestId, i.body);
  }

  // Template upgrades (REQ-ENT-009, AT-26)
  @ApiRoute(R.listTemplateUpgrades)
  listTemplateUpgrades(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listTemplateUpgrades>) {
    return this.upgrades.list(ctx, i.params.projectId);
  }

  @ApiRoute(R.previewTemplateUpgrade)
  previewTemplateUpgrade(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.previewTemplateUpgrade>) {
    return this.upgrades.preview(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.proposeTemplateUpgrade)
  proposeTemplateUpgrade(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.proposeTemplateUpgrade>) {
    return this.upgrades.propose(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.getTemplateUpgrade)
  getTemplateUpgrade(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getTemplateUpgrade>) {
    return this.upgrades.get(ctx, i.params.projectId, i.params.upgradeId);
  }

  @ApiRoute(R.approveTemplateUpgrade)
  approveTemplateUpgrade(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approveTemplateUpgrade>) {
    return this.upgrades.approve(ctx, i.params.projectId, i.params.upgradeId, i.body);
  }

  @ApiRoute(R.rejectTemplateUpgrade)
  rejectTemplateUpgrade(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rejectTemplateUpgrade>) {
    return this.upgrades.reject(ctx, i.params.projectId, i.params.upgradeId, i.body);
  }

  // Setup wizard steps 7–8 and onboarding (REQ-SET-007, -015, -016)
  @ApiRoute(R.getSetup)
  getSetup(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getSetup>) {
    return this.setup.get(ctx, i.params.projectId);
  }

  @ApiRoute(R.setupPolicies)
  setupPolicies(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.setupPolicies>) {
    return this.setup.policies(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.launch)
  launch(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.launch>) {
    return this.setup.launch(ctx, i.params.projectId, i.body);
  }

  // Administration (REQ-UX-020, REQ-ENT-009)
  @ApiRoute(R.adminTemplates)
  adminTemplates(@Ctx() ctx: RequestContext) {
    return this.admin.templates(ctx);
  }

  @ApiRoute(R.adminTemplateDiff)
  adminTemplateDiff(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.adminTemplateDiff>) {
    return this.admin.diff(ctx, i.params.versionId, i.query.from);
  }

  @ApiRoute(R.deploymentSettings)
  deploymentSettings(@Ctx() ctx: RequestContext) {
    return this.admin.deploymentSettings(ctx);
  }
}
