import { Controller } from '@nestjs/common';
import { gatesRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { GatesService } from './gates.service';
import { StatusDimensionsService } from './status-dimensions.service';

@Controller()
export class GatesController {
  constructor(
    private readonly svc: GatesService,
    private readonly dims: StatusDimensionsService,
  ) {}

  @ApiRoute(R.listGates)
  listGates(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listGates>) {
    return this.svc.listGates(ctx, i.params.projectId);
  }

  @ApiRoute(R.getGate)
  getGate(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getGate>) {
    return this.svc.getGate(ctx, i.params.projectId, i.params.gateId);
  }

  @ApiRoute(R.startAssessment)
  startAssessment(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.startAssessment>) {
    return this.svc.startAssessment(ctx, i.params.projectId, i.params.gateId, i.body);
  }

  @ApiRoute(R.markReady)
  markReady(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.markReady>) {
    return this.svc.markReady(ctx, i.params.projectId, i.params.gateId, i.body);
  }

  @ApiRoute(R.backToAssessment)
  backToAssessment(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.backToAssessment>) {
    return this.svc.backToAssessment(ctx, i.params.projectId, i.params.gateId, i.body);
  }

  @ApiRoute(R.linkDecision)
  linkDecision(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.linkDecision>) {
    return this.svc.linkDecision(ctx, i.params.projectId, i.params.gateId, i.body);
  }

  @ApiRoute(R.decide)
  decide(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.decide>) {
    return this.svc.decide(ctx, i.params.projectId, i.params.gateId, i.body);
  }

  @ApiRoute(R.reopen)
  reopen(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.reopen>) {
    return this.svc.reopen(ctx, i.params.projectId, i.params.gateId, i.body);
  }

  @ApiRoute(R.submitEvidence)
  submitEvidence(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.submitEvidence>) {
    return this.svc.submitEvidence(ctx, i.params.projectId, i.params.gateId, i.params.criterionId, i.body);
  }

  @ApiRoute(R.reviewCriterion)
  reviewCriterion(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.reviewCriterion>) {
    return this.svc.reviewCriterion(ctx, i.params.projectId, i.params.gateId, i.params.criterionId, i.body);
  }

  @ApiRoute(R.proposeNotApplicable)
  proposeNotApplicable(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.proposeNotApplicable>) {
    return this.svc.proposeNotApplicable(ctx, i.params.projectId, i.params.gateId, i.params.criterionId, i.body);
  }

  @ApiRoute(R.determineNotApplicable)
  determineNotApplicable(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.determineNotApplicable>) {
    return this.svc.determineNotApplicable(ctx, i.params.projectId, i.params.gateId, i.params.criterionId, i.body);
  }

  @ApiRoute(R.updateCriterionNote)
  updateCriterionNote(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateCriterionNote>) {
    return this.svc.updateCriterionNote(ctx, i.params.projectId, i.params.gateId, i.params.criterionId, i.body);
  }

  @ApiRoute(R.setWaivability)
  setWaivability(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.setWaivability>) {
    return this.svc.setWaivability(ctx, i.params.projectId, i.params.gateId, i.params.criterionId, i.body);
  }

  @ApiRoute(R.requestWaiver)
  requestWaiver(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.requestWaiver>) {
    return this.svc.requestWaiver(ctx, i.params.projectId, i.params.gateId, i.params.criterionId, i.body);
  }

  @ApiRoute(R.listWaivers)
  listWaivers(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listWaivers>) {
    return this.svc.listWaivers(ctx, i.params.projectId, i.query.status);
  }

  @ApiRoute(R.approveWaiver)
  approveWaiver(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approveWaiver>) {
    return this.svc.approveWaiver(ctx, i.params.projectId, i.params.waiverId, i.body);
  }

  @ApiRoute(R.rejectWaiver)
  rejectWaiver(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rejectWaiver>) {
    return this.svc.rejectWaiver(ctx, i.params.projectId, i.params.waiverId, i.body);
  }

  @ApiRoute(R.getStatusDimensions)
  getStatusDimensions(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getStatusDimensions>) {
    return this.dims.get(ctx, i.params.projectId);
  }

  @ApiRoute(R.recomputeStatusDimensions)
  recomputeStatusDimensions(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recomputeStatusDimensions>) {
    return this.dims.recompute(ctx, i.params.projectId);
  }
}
