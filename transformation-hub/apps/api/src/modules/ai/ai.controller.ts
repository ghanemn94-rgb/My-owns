import { Controller } from '@nestjs/common';
import { aiRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { AiSettingsService } from './ai-settings.service';
import { AiRuntimeService } from './ai-runtime.service';
import { AiProposalsService } from './ai-proposals.service';
import { AiOpsService } from './ai-ops.service';
import { AiArtifactsService } from './ai-artifacts.service';

@Controller()
export class AiController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly runtime: AiRuntimeService,
    private readonly proposals: AiProposalsService,
    private readonly ops: AiOpsService,
    private readonly artifacts: AiArtifactsService,
  ) {}

  @ApiRoute(R.getSettings)
  getSettings(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getSettings>) {
    return this.settings.get(ctx, i.params.projectId);
  }

  @ApiRoute(R.updateSettings)
  updateSettings(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateSettings>) {
    return this.settings.update(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.approveAutopilot)
  approveAutopilot(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approveAutopilot>) {
    return this.settings.approveAutopilot(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.revokeAutopilot)
  revokeAutopilot(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.revokeAutopilot>) {
    return this.settings.revokeAutopilot(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.activateKillSwitch)
  activateKillSwitch(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.activateKillSwitch>) {
    return this.settings.activateKillSwitch(ctx, i.params.projectId, i.body.reason);
  }

  @ApiRoute(R.releaseKillSwitch)
  releaseKillSwitch(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.releaseKillSwitch>) {
    return this.settings.releaseKillSwitch(ctx, i.params.projectId, i.body.reason);
  }

  @ApiRoute(R.ask)
  ask(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.ask>) {
    return this.runtime.ask(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.listRuns)
  listRuns(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listRuns>) {
    return this.ops.listRuns(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getRun)
  getRun(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getRun>) {
    return this.ops.getRun(ctx, i.params.projectId, i.params.runId);
  }

  @ApiRoute(R.status)
  status(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.status>) {
    return this.ops.status(ctx, i.params.projectId);
  }

  @ApiRoute(R.costs)
  costs(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.costs>) {
    return this.ops.costs(ctx, i.params.projectId);
  }

  @ApiRoute(R.detections)
  detections(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.detections>) {
    return this.ops.detectionsFor(ctx, i.params.projectId);
  }

  @ApiRoute(R.tools)
  tools(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.tools>) {
    return this.ops.tools(ctx, i.params.projectId);
  }

  @ApiRoute(R.listProposals)
  listProposals(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listProposals>) {
    return this.proposals.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getProposal)
  getProposal(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getProposal>) {
    return this.proposals.getOne(ctx, i.params.projectId, i.params.proposalId);
  }

  @ApiRoute(R.approveProposal)
  approveProposal(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approveProposal>) {
    return this.proposals.approve(ctx, i.params.projectId, i.params.proposalId, i.body);
  }

  @ApiRoute(R.rejectProposal)
  rejectProposal(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rejectProposal>) {
    return this.proposals.reject(ctx, i.params.projectId, i.params.proposalId, i.body);
  }

  @ApiRoute(R.reviseProposal)
  reviseProposal(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.reviseProposal>) {
    return this.proposals.revise(ctx, i.params.projectId, i.params.proposalId, i.body);
  }

  @ApiRoute(R.listBriefings)
  listBriefings(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listBriefings>) {
    return this.settings.listBriefings(ctx, i.params.projectId);
  }

  @ApiRoute(R.subscribeBriefing)
  subscribeBriefing(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.subscribeBriefing>) {
    return this.settings.subscribeBriefing(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.listArtifacts)
  listArtifacts(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listArtifacts>) {
    return this.artifacts.listMine(ctx, i.params.projectId);
  }
}
