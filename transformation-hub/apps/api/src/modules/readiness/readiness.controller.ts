import { Controller } from '@nestjs/common';
import { readinessRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { ReadinessChecksService } from './checks.service';
import { CutoverService } from './cutover.service';
import { TsaService } from './tsa.service';
import { ReadinessSummaryService } from './summary.service';

/** Day-1 readiness, cutover / go-no-go and TSA routes — thin: every rule lives in the command services. */
@Controller()
export class ReadinessController {
  constructor(
    private readonly checks: ReadinessChecksService,
    private readonly cutover: CutoverService,
    private readonly tsa: TsaService,
    private readonly summary: ReadinessSummaryService,
  ) {}

  @ApiRoute(R.getReadinessSummary)
  getSummary(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getReadinessSummary>) {
    return this.summary.get(ctx, i.params.projectId);
  }

  // ---- checks
  @ApiRoute(R.listReadinessChecks)
  listChecks(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listReadinessChecks>) {
    return this.checks.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getReadinessCheck)
  getCheck(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getReadinessCheck>) {
    return this.checks.get(ctx, i.params.projectId, i.params.checkId);
  }

  @ApiRoute(R.createReadinessCheck)
  createCheck(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createReadinessCheck>) {
    return this.checks.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.instantiateChecklist)
  instantiate(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.instantiateChecklist>) {
    return this.checks.instantiate(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateReadinessCheck)
  updateCheck(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateReadinessCheck>) {
    return this.checks.update(ctx, i.params.projectId, i.params.checkId, i.body);
  }

  @ApiRoute(R.rebindReadinessCheck)
  rebindCheck(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rebindReadinessCheck>) {
    return this.checks.rebind(ctx, i.params.projectId, i.params.checkId, i.body);
  }

  @ApiRoute(R.determineReadinessCheck)
  determine(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.determineReadinessCheck>) {
    return this.checks.determine(ctx, i.params.projectId, i.params.checkId, i.body);
  }

  @ApiRoute(R.recordReadinessTest)
  recordTest(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordReadinessTest>) {
    return this.checks.recordTest(ctx, i.params.projectId, i.params.checkId, i.body);
  }

  @ApiRoute(R.signOffReadinessCheck)
  signOff(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.signOffReadinessCheck>) {
    return this.checks.signOff(ctx, i.params.projectId, i.params.checkId, i.body);
  }

  @ApiRoute(R.reopenReadinessCheck)
  reopen(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.reopenReadinessCheck>) {
    return this.checks.reopen(ctx, i.params.projectId, i.params.checkId, i.body);
  }

  @ApiRoute(R.requestReadinessWaiver)
  requestWaiver(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.requestReadinessWaiver>) {
    return this.checks.requestWaiver(ctx, i.params.projectId, i.params.checkId, i.body);
  }

  @ApiRoute(R.listReadinessWaivers)
  listWaivers(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listReadinessWaivers>) {
    return this.checks.listWaivers(ctx, i.params.projectId, i.query.status);
  }

  @ApiRoute(R.approveReadinessWaiver)
  approveWaiver(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approveReadinessWaiver>) {
    return this.checks.approveWaiver(ctx, i.params.projectId, i.params.waiverId, i.body);
  }

  @ApiRoute(R.rejectReadinessWaiver)
  rejectWaiver(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rejectReadinessWaiver>) {
    return this.checks.rejectWaiver(ctx, i.params.projectId, i.params.waiverId, i.body);
  }

  // ---- cutover
  @ApiRoute(R.listCutoverPlans)
  listPlans(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listCutoverPlans>) {
    return this.cutover.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getCutoverPlan)
  getPlan(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getCutoverPlan>) {
    return this.cutover.get(ctx, i.params.projectId, i.params.planId);
  }

  @ApiRoute(R.createCutoverPlan)
  createPlan(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createCutoverPlan>) {
    return this.cutover.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateCutoverPlan)
  updatePlan(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateCutoverPlan>) {
    return this.cutover.update(ctx, i.params.projectId, i.params.planId, i.body);
  }

  @ApiRoute(R.recordCutoverRehearsal)
  rehearsal(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordCutoverRehearsal>) {
    return this.cutover.recordRehearsal(ctx, i.params.projectId, i.params.planId, i.body);
  }

  @ApiRoute(R.recordCommunicationsApproval)
  communications(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordCommunicationsApproval>) {
    return this.cutover.recordCommunicationsApproval(ctx, i.params.projectId, i.params.planId, i.body);
  }

  @ApiRoute(R.linkGoDecision)
  linkGoDecision(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.linkGoDecision>) {
    return this.cutover.linkGoDecision(ctx, i.params.projectId, i.params.planId, i.body);
  }

  @ApiRoute(R.submitCutoverForDecision)
  submitForDecision(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.submitCutoverForDecision>) {
    return this.cutover.submitForDecision(ctx, i.params.projectId, i.params.planId, i.body);
  }

  @ApiRoute(R.returnCutoverToPlanning)
  returnToPlanning(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.returnCutoverToPlanning>) {
    return this.cutover.returnToPlanning(ctx, i.params.projectId, i.params.planId, i.body);
  }

  @ApiRoute(R.decideGoNoGo)
  decide(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.decideGoNoGo>) {
    return this.cutover.decide(ctx, i.params.projectId, i.params.planId, i.body);
  }

  @ApiRoute(R.recordCutoverExecution)
  execution(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordCutoverExecution>) {
    return this.cutover.recordExecution(ctx, i.params.projectId, i.params.planId, i.body);
  }

  @ApiRoute(R.recordCutoverRollback)
  rollback(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordCutoverRollback>) {
    return this.cutover.recordRollback(ctx, i.params.projectId, i.params.planId, i.body);
  }

  @ApiRoute(R.acceptCutover)
  accept(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.acceptCutover>) {
    return this.cutover.accept(ctx, i.params.projectId, i.params.planId, i.body);
  }

  // ---- TSA
  @ApiRoute(R.listTsaServices)
  listTsa(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listTsaServices>) {
    return this.tsa.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getTsaService)
  getTsa(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getTsaService>) {
    return this.tsa.get(ctx, i.params.projectId, i.params.tsaServiceId);
  }

  @ApiRoute(R.createTsaService)
  createTsa(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createTsaService>) {
    return this.tsa.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateTsaService)
  updateTsa(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateTsaService>) {
    return this.tsa.update(ctx, i.params.projectId, i.params.tsaServiceId, i.body);
  }

  @ApiRoute(R.transitionTsaService)
  transitionTsa(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.transitionTsaService>) {
    return this.tsa.transitionSimple(ctx, i.params.projectId, i.params.tsaServiceId, i.body);
  }

  @ApiRoute(R.approveTsaTerms)
  approveTerms(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approveTsaTerms>) {
    return this.tsa.approveTerms(ctx, i.params.projectId, i.params.tsaServiceId, i.body);
  }

  @ApiRoute(R.acceptTsaReplacement)
  acceptReplacement(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.acceptTsaReplacement>) {
    return this.tsa.acceptReplacement(ctx, i.params.projectId, i.params.tsaServiceId, i.body);
  }

  @ApiRoute(R.reportTsaReplacementFailure)
  reportFailure(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.reportTsaReplacementFailure>) {
    return this.tsa.reportReplacementFailure(ctx, i.params.projectId, i.params.tsaServiceId, i.body);
  }

  @ApiRoute(R.requestTsaExtension)
  requestExtension(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.requestTsaExtension>) {
    return this.tsa.requestExtension(ctx, i.params.projectId, i.params.tsaServiceId, i.body);
  }

  @ApiRoute(R.recordTsaExtension)
  recordExtension(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordTsaExtension>) {
    return this.tsa.recordExtension(ctx, i.params.projectId, i.params.tsaServiceId, i.body);
  }

  @ApiRoute(R.requestTsaExitApproval)
  requestExitApproval(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.requestTsaExitApproval>) {
    return this.tsa.requestExitApproval(ctx, i.params.projectId, i.params.tsaServiceId, i.body);
  }

  @ApiRoute(R.approveTsaExit)
  approveExit(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approveTsaExit>) {
    return this.tsa.approveExit(ctx, i.params.projectId, i.params.tsaServiceId, i.body);
  }

  @ApiRoute(R.rejectTsaExit)
  rejectExit(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rejectTsaExit>) {
    return this.tsa.rejectExit(ctx, i.params.projectId, i.params.tsaServiceId, i.body);
  }
}
