import { Controller } from '@nestjs/common';
import { planningRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { WbsService } from './wbs.service';
import { ScheduleService } from './schedule.service';
import { ChangeControlService } from './change-control.service';
import { RaidService } from './raid.service';
import { HealthService } from './health.service';
import { MyWorkService } from './my-work.service';

type C = RequestContext;

/** Tasks, milestones, deliverables, owners and RACI. Thin: validation happens in the contract guard, rules in services. */
@Controller()
export class PlanningWbsController {
  constructor(private readonly svc: WbsService) {}

  @ApiRoute(R.listTasks) listTasks(@Ctx() c: C, @Input() i: RouteInput<typeof R.listTasks>) { return this.svc.listTasks(c, i.params.projectId, i.query); }
  @ApiRoute(R.getTask) getTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.getTask>) { return this.svc.getTask(c, i.params.projectId, i.params.taskId); }
  @ApiRoute(R.createTask) createTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.createTask>) { return this.svc.createTask(c, i.params.projectId, i.body); }
  @ApiRoute(R.updateTask) updateTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.updateTask>) { return this.svc.updateTask(c, i.params.projectId, i.params.taskId, i.body); }
  @ApiRoute(R.activateTask) activateTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.activateTask>) { return this.svc.activateTask(c, i.params.projectId, i.params.taskId, i.body); }
  @ApiRoute(R.activateWorkstreamTasks) activateWs(@Ctx() c: C, @Input() i: RouteInput<typeof R.activateWorkstreamTasks>) { return this.svc.activateWorkstreamTasks(c, i.params.projectId, i.params.workstreamId, i.body.note); }
  @ApiRoute(R.startTask) startTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.startTask>) { return this.svc.startTask(c, i.params.projectId, i.params.taskId, i.body); }
  @ApiRoute(R.blockTask) blockTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.blockTask>) { return this.svc.blockTask(c, i.params.projectId, i.params.taskId, i.body); }
  @ApiRoute(R.unblockTask) unblockTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.unblockTask>) { return this.svc.unblockTask(c, i.params.projectId, i.params.taskId, i.body); }
  @ApiRoute(R.submitTaskForAcceptance) submitTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.submitTaskForAcceptance>) { return this.svc.submitTaskForAcceptance(c, i.params.projectId, i.params.taskId, i.body); }
  @ApiRoute(R.acceptTask) acceptTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.acceptTask>) { return this.svc.acceptTask(c, i.params.projectId, i.params.taskId, i.body); }
  @ApiRoute(R.rejectTaskAcceptance) rejectTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.rejectTaskAcceptance>) { return this.svc.rejectTaskAcceptance(c, i.params.projectId, i.params.taskId, i.body); }
  @ApiRoute(R.completeTask) completeTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.completeTask>) { return this.svc.completeTask(c, i.params.projectId, i.params.taskId, i.body); }
  @ApiRoute(R.cancelTask) cancelTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.cancelTask>) { return this.svc.cancelTask(c, i.params.projectId, i.params.taskId, i.body); }
  @ApiRoute(R.reopenTask) reopenTask(@Ctx() c: C, @Input() i: RouteInput<typeof R.reopenTask>) { return this.svc.reopenTask(c, i.params.projectId, i.params.taskId, i.body); }
  @ApiRoute(R.updateTaskProgress) progress(@Ctx() c: C, @Input() i: RouteInput<typeof R.updateTaskProgress>) { return this.svc.updateTaskProgress(c, i.params.projectId, i.params.taskId, i.body); }
  @ApiRoute(R.assignTaskOwner) taskOwner(@Ctx() c: C, @Input() i: RouteInput<typeof R.assignTaskOwner>) { return this.svc.assignOwner(c, i.params.projectId, 'task', i.params.taskId, i.body); }

  @ApiRoute(R.listRaci) listRaci(@Ctx() c: C, @Input() i: RouteInput<typeof R.listRaci>) { return this.svc.listRaci(c, i.params.projectId, i.query); }
  @ApiRoute(R.addRaci) addRaci(@Ctx() c: C, @Input() i: RouteInput<typeof R.addRaci>) { return this.svc.addRaci(c, i.params.projectId, i.body); }
  @ApiRoute(R.removeRaci) removeRaci(@Ctx() c: C, @Input() i: RouteInput<typeof R.removeRaci>) { return this.svc.removeRaci(c, i.params.projectId, i.params.raciId, i.body.reason); }
  @ApiRoute(R.responsibility) responsibility(@Ctx() c: C, @Input() i: RouteInput<typeof R.responsibility>) { return this.svc.responsibility(c, i.params.projectId); }

  @ApiRoute(R.listMilestones) listMilestones(@Ctx() c: C, @Input() i: RouteInput<typeof R.listMilestones>) { return this.svc.listMilestones(c, i.params.projectId, i.query); }
  @ApiRoute(R.getMilestone) getMilestone(@Ctx() c: C, @Input() i: RouteInput<typeof R.getMilestone>) { return this.svc.getMilestone(c, i.params.projectId, i.params.milestoneId); }
  @ApiRoute(R.createMilestone) createMilestone(@Ctx() c: C, @Input() i: RouteInput<typeof R.createMilestone>) { return this.svc.createMilestone(c, i.params.projectId, i.body); }
  @ApiRoute(R.updateMilestone) updateMilestone(@Ctx() c: C, @Input() i: RouteInput<typeof R.updateMilestone>) { return this.svc.updateMilestone(c, i.params.projectId, i.params.milestoneId, i.body); }
  @ApiRoute(R.flagMilestoneAtRisk) msFlag(@Ctx() c: C, @Input() i: RouteInput<typeof R.flagMilestoneAtRisk>) { return this.svc.milestoneCommand(c, i.params.projectId, i.params.milestoneId, 'flag_at_risk', i.body); }
  @ApiRoute(R.clearMilestoneRisk) msClear(@Ctx() c: C, @Input() i: RouteInput<typeof R.clearMilestoneRisk>) { return this.svc.milestoneCommand(c, i.params.projectId, i.params.milestoneId, 'clear_risk', i.body); }
  @ApiRoute(R.reportMilestoneAchieved) msReport(@Ctx() c: C, @Input() i: RouteInput<typeof R.reportMilestoneAchieved>) { return this.svc.milestoneCommand(c, i.params.projectId, i.params.milestoneId, 'report_achieved', i.body); }
  @ApiRoute(R.verifyMilestoneAchieved) msVerify(@Ctx() c: C, @Input() i: RouteInput<typeof R.verifyMilestoneAchieved>) { return this.svc.milestoneCommand(c, i.params.projectId, i.params.milestoneId, 'verify_achieved', i.body); }
  @ApiRoute(R.rejectMilestoneEvidence) msReject(@Ctx() c: C, @Input() i: RouteInput<typeof R.rejectMilestoneEvidence>) { return this.svc.milestoneCommand(c, i.params.projectId, i.params.milestoneId, 'reject_evidence', i.body); }
  @ApiRoute(R.markMilestoneMissed) msMissed(@Ctx() c: C, @Input() i: RouteInput<typeof R.markMilestoneMissed>) { return this.svc.milestoneCommand(c, i.params.projectId, i.params.milestoneId, 'mark_missed', i.body); }
  @ApiRoute(R.cancelMilestone) msCancel(@Ctx() c: C, @Input() i: RouteInput<typeof R.cancelMilestone>) { return this.svc.milestoneCommand(c, i.params.projectId, i.params.milestoneId, 'cancel', i.body); }
  @ApiRoute(R.assignMilestoneOwner) msOwner(@Ctx() c: C, @Input() i: RouteInput<typeof R.assignMilestoneOwner>) { return this.svc.assignOwner(c, i.params.projectId, 'milestone', i.params.milestoneId, i.body); }

  @ApiRoute(R.listDeliverables) listDeliverables(@Ctx() c: C, @Input() i: RouteInput<typeof R.listDeliverables>) { return this.svc.listDeliverables(c, i.params.projectId, i.query); }
  // Declared before :deliverableId routes so the literal path wins.
  @ApiRoute(R.approveDeliverableWeights) approveWeights(@Ctx() c: C, @Input() i: RouteInput<typeof R.approveDeliverableWeights>) { return this.svc.approveDeliverableWeights(c, i.params.projectId, i.body); }
  @ApiRoute(R.getDeliverable) getDeliverable(@Ctx() c: C, @Input() i: RouteInput<typeof R.getDeliverable>) { return this.svc.getDeliverable(c, i.params.projectId, i.params.deliverableId); }
  @ApiRoute(R.createDeliverable) createDeliverable(@Ctx() c: C, @Input() i: RouteInput<typeof R.createDeliverable>) { return this.svc.createDeliverable(c, i.params.projectId, i.body); }
  @ApiRoute(R.updateDeliverable) updateDeliverable(@Ctx() c: C, @Input() i: RouteInput<typeof R.updateDeliverable>) { return this.svc.updateDeliverable(c, i.params.projectId, i.params.deliverableId, i.body); }
  @ApiRoute(R.startDeliverable) dStart(@Ctx() c: C, @Input() i: RouteInput<typeof R.startDeliverable>) { return this.svc.deliverableCommand(c, i.params.projectId, i.params.deliverableId, 'start', i.body); }
  @ApiRoute(R.submitDeliverable) dSubmit(@Ctx() c: C, @Input() i: RouteInput<typeof R.submitDeliverable>) { return this.svc.deliverableCommand(c, i.params.projectId, i.params.deliverableId, 'submit', i.body); }
  @ApiRoute(R.acceptDeliverable) dAccept(@Ctx() c: C, @Input() i: RouteInput<typeof R.acceptDeliverable>) { return this.svc.deliverableCommand(c, i.params.projectId, i.params.deliverableId, 'accept', i.body); }
  @ApiRoute(R.rejectDeliverable) dReject(@Ctx() c: C, @Input() i: RouteInput<typeof R.rejectDeliverable>) { return this.svc.deliverableCommand(c, i.params.projectId, i.params.deliverableId, 'reject', i.body); }
  @ApiRoute(R.cancelDeliverable) dCancel(@Ctx() c: C, @Input() i: RouteInput<typeof R.cancelDeliverable>) { return this.svc.deliverableCommand(c, i.params.projectId, i.params.deliverableId, 'cancel', i.body); }
  @ApiRoute(R.reopenDeliverable) dReopen(@Ctx() c: C, @Input() i: RouteInput<typeof R.reopenDeliverable>) { return this.svc.deliverableCommand(c, i.params.projectId, i.params.deliverableId, 'reopen', i.body); }
  @ApiRoute(R.assignDeliverableOwner) dOwner(@Ctx() c: C, @Input() i: RouteInput<typeof R.assignDeliverableOwner>) { return this.svc.assignOwner(c, i.params.projectId, 'deliverable', i.params.deliverableId, i.body); }
}

/** Dependencies, schedule-based forecasts, calendar and look-ahead. */
@Controller()
export class PlanningScheduleController {
  constructor(private readonly svc: ScheduleService) {}

  @ApiRoute(R.listDependencies) listDeps(@Ctx() c: C, @Input() i: RouteInput<typeof R.listDependencies>) { return this.svc.listDependencies(c, i.params.projectId, i.query.nodeId); }
  @ApiRoute(R.createDependency) createDep(@Ctx() c: C, @Input() i: RouteInput<typeof R.createDependency>) { return this.svc.createDependency(c, i.params.projectId, i.body); }
  @ApiRoute(R.removeDependency) removeDep(@Ctx() c: C, @Input() i: RouteInput<typeof R.removeDependency>) { return this.svc.removeDependency(c, i.params.projectId, i.params.dependencyId, i.body.reason); }
  @ApiRoute(R.getSchedule) schedule(@Ctx() c: C, @Input() i: RouteInput<typeof R.getSchedule>) { return this.svc.getSchedule(c, i.params.projectId, i.query.targetNodeId); }
  @ApiRoute(R.delayImpact) delay(@Ctx() c: C, @Input() i: RouteInput<typeof R.delayImpact>) { return this.svc.delayImpact(c, i.params.projectId, i.body); }
  @ApiRoute(R.listHolidays) holidays(@Ctx() c: C, @Input() i: RouteInput<typeof R.listHolidays>) { return this.svc.listHolidays(c, i.params.projectId); }
  @ApiRoute(R.addHoliday) addHoliday(@Ctx() c: C, @Input() i: RouteInput<typeof R.addHoliday>) { return this.svc.addHoliday(c, i.params.projectId, i.body); }
  @ApiRoute(R.removeHoliday) removeHoliday(@Ctx() c: C, @Input() i: RouteInput<typeof R.removeHoliday>) { return this.svc.removeHoliday(c, i.params.projectId, i.params.holidayId, i.body.reason); }
  @ApiRoute(R.lookAhead) lookAhead(@Ctx() c: C, @Input() i: RouteInput<typeof R.lookAhead>) { return this.svc.lookAhead(c, i.params.projectId, i.query); }
}

/** Baselines and change requests. */
@Controller()
export class PlanningChangeController {
  constructor(private readonly svc: ChangeControlService) {}

  @ApiRoute(R.listBaselines) listBaselines(@Ctx() c: C, @Input() i: RouteInput<typeof R.listBaselines>) { return this.svc.listBaselines(c, i.params.projectId); }
  // Declared before :baselineId so the literal path wins.
  @ApiRoute(R.currentBaseline) current(@Ctx() c: C, @Input() i: RouteInput<typeof R.currentBaseline>) { return this.svc.currentBaseline(c, i.params.projectId); }
  @ApiRoute(R.getBaseline) getBaseline(@Ctx() c: C, @Input() i: RouteInput<typeof R.getBaseline>) { return this.svc.getBaseline(c, i.params.projectId, i.params.baselineId); }
  @ApiRoute(R.proposeBaseline) propose(@Ctx() c: C, @Input() i: RouteInput<typeof R.proposeBaseline>) { return this.svc.proposeBaseline(c, i.params.projectId, i.body); }
  @ApiRoute(R.approveBaseline) approve(@Ctx() c: C, @Input() i: RouteInput<typeof R.approveBaseline>) { return this.svc.approveBaseline(c, i.params.projectId, i.params.baselineId, i.body); }
  @ApiRoute(R.rejectBaseline) reject(@Ctx() c: C, @Input() i: RouteInput<typeof R.rejectBaseline>) { return this.svc.rejectBaseline(c, i.params.projectId, i.params.baselineId, i.body); }

  @ApiRoute(R.listChangeRequests) listCr(@Ctx() c: C, @Input() i: RouteInput<typeof R.listChangeRequests>) { return this.svc.listChangeRequests(c, i.params.projectId, i.query); }
  @ApiRoute(R.getChangeRequest) getCr(@Ctx() c: C, @Input() i: RouteInput<typeof R.getChangeRequest>) { return this.svc.getChangeRequest(c, i.params.projectId, i.params.changeRequestId); }
  @ApiRoute(R.createChangeRequest) createCr(@Ctx() c: C, @Input() i: RouteInput<typeof R.createChangeRequest>) { return this.svc.createChangeRequest(c, i.params.projectId, i.body); }
  @ApiRoute(R.updateChangeRequest) updateCr(@Ctx() c: C, @Input() i: RouteInput<typeof R.updateChangeRequest>) { return this.svc.updateChangeRequest(c, i.params.projectId, i.params.changeRequestId, i.body); }
  @ApiRoute(R.submitChangeRequest) submitCr(@Ctx() c: C, @Input() i: RouteInput<typeof R.submitChangeRequest>) { return this.svc.crCommand(c, i.params.projectId, i.params.changeRequestId, 'submit', i.body); }
  @ApiRoute(R.startChangeRequestReview) reviewCr(@Ctx() c: C, @Input() i: RouteInput<typeof R.startChangeRequestReview>) { return this.svc.crCommand(c, i.params.projectId, i.params.changeRequestId, 'start_review', i.body); }
  @ApiRoute(R.assessChangeRequest) assessCr(@Ctx() c: C, @Input() i: RouteInput<typeof R.assessChangeRequest>) { return this.svc.assessChangeRequest(c, i.params.projectId, i.params.changeRequestId, i.body); }
  @ApiRoute(R.approveChangeRequest) approveCr(@Ctx() c: C, @Input() i: RouteInput<typeof R.approveChangeRequest>) { return this.svc.crCommand(c, i.params.projectId, i.params.changeRequestId, 'approve', i.body); }
  @ApiRoute(R.rejectChangeRequest) rejectCr(@Ctx() c: C, @Input() i: RouteInput<typeof R.rejectChangeRequest>) { return this.svc.crCommand(c, i.params.projectId, i.params.changeRequestId, 'reject', i.body); }
  @ApiRoute(R.withdrawChangeRequest) withdrawCr(@Ctx() c: C, @Input() i: RouteInput<typeof R.withdrawChangeRequest>) { return this.svc.crCommand(c, i.params.projectId, i.params.changeRequestId, 'withdraw', i.body); }
  @ApiRoute(R.implementChangeRequest) implementCr(@Ctx() c: C, @Input() i: RouteInput<typeof R.implementChangeRequest>) { return this.svc.crCommand(c, i.params.projectId, i.params.changeRequestId, 'mark_implemented', i.body); }
}

/** RAID register. Literal create/update paths are declared before the generic `:kind` routes. */
@Controller()
export class PlanningRaidController {
  constructor(private readonly svc: RaidService) {}

  @ApiRoute(R.createRisk) createRisk(@Ctx() c: C, @Input() i: RouteInput<typeof R.createRisk>) { return this.svc.createRisk(c, i.params.projectId, i.body); }
  @ApiRoute(R.createIssue) createIssue(@Ctx() c: C, @Input() i: RouteInput<typeof R.createIssue>) { return this.svc.createIssue(c, i.params.projectId, i.body); }
  @ApiRoute(R.createAssumption) createAssumption(@Ctx() c: C, @Input() i: RouteInput<typeof R.createAssumption>) { return this.svc.createAssumption(c, i.params.projectId, i.body); }
  @ApiRoute(R.createRaidDependency) createDependency(@Ctx() c: C, @Input() i: RouteInput<typeof R.createRaidDependency>) { return this.svc.createDependency(c, i.params.projectId, i.body); }
  @ApiRoute(R.updateRisk) updateRisk(@Ctx() c: C, @Input() i: RouteInput<typeof R.updateRisk>) { return this.svc.updateRisk(c, i.params.projectId, i.params.itemId, i.body); }
  @ApiRoute(R.updateIssue) updateIssue(@Ctx() c: C, @Input() i: RouteInput<typeof R.updateIssue>) { return this.svc.updateIssue(c, i.params.projectId, i.params.itemId, i.body); }
  @ApiRoute(R.updateAssumption) updateAssumption(@Ctx() c: C, @Input() i: RouteInput<typeof R.updateAssumption>) { return this.svc.updateAssumption(c, i.params.projectId, i.params.itemId, i.body); }
  @ApiRoute(R.updateRaidDependency) updateDependency(@Ctx() c: C, @Input() i: RouteInput<typeof R.updateRaidDependency>) { return this.svc.updateDependency(c, i.params.projectId, i.params.itemId, i.body); }
  @ApiRoute(R.raiseIssueFromRisk) raise(@Ctx() c: C, @Input() i: RouteInput<typeof R.raiseIssueFromRisk>) { return this.svc.raiseIssueFromRisk(c, i.params.projectId, i.params.itemId, i.body); }
  @ApiRoute(R.listRaid) list(@Ctx() c: C, @Input() i: RouteInput<typeof R.listRaid>) { return this.svc.list(c, i.params.projectId, i.params.kind, i.query); }
  @ApiRoute(R.getRaid) get(@Ctx() c: C, @Input() i: RouteInput<typeof R.getRaid>) { return this.svc.get(c, i.params.projectId, i.params.kind, i.params.itemId); }
  @ApiRoute(R.monitorRaid) monitor(@Ctx() c: C, @Input() i: RouteInput<typeof R.monitorRaid>) { return this.svc.command(c, i.params.projectId, i.params.kind, i.params.itemId, 'monitor', i.body); }
  @ApiRoute(R.escalateRaid) escalate(@Ctx() c: C, @Input() i: RouteInput<typeof R.escalateRaid>) { return this.svc.command(c, i.params.projectId, i.params.kind, i.params.itemId, 'escalate', i.body); }
  @ApiRoute(R.mitigateRaid) mitigate(@Ctx() c: C, @Input() i: RouteInput<typeof R.mitigateRaid>) { return this.svc.command(c, i.params.projectId, i.params.kind, i.params.itemId, 'mitigate', i.body); }
  @ApiRoute(R.closeRaid) close(@Ctx() c: C, @Input() i: RouteInput<typeof R.closeRaid>) { return this.svc.command(c, i.params.projectId, i.params.kind, i.params.itemId, 'close', i.body); }
  @ApiRoute(R.cancelRaid) cancel(@Ctx() c: C, @Input() i: RouteInput<typeof R.cancelRaid>) { return this.svc.command(c, i.params.projectId, i.params.kind, i.params.itemId, 'cancel', i.body); }
  @ApiRoute(R.reopenRaid) reopen(@Ctx() c: C, @Input() i: RouteInput<typeof R.reopenRaid>) { return this.svc.command(c, i.params.projectId, i.params.kind, i.params.itemId, 'reopen', i.body); }
  @ApiRoute(R.assignRaidOwner) owner(@Ctx() c: C, @Input() i: RouteInput<typeof R.assignRaidOwner>) { return this.svc.assignOwner(c, i.params.projectId, i.params.kind, i.params.itemId, i.body); }
}

/** Periodic updates, RAG overrides, progress & health, My Work. */
@Controller()
export class PlanningHealthController {
  constructor(
    private readonly svc: HealthService,
    private readonly work: MyWorkService,
  ) {}

  @ApiRoute(R.listStatusUpdates) listUpdates(@Ctx() c: C, @Input() i: RouteInput<typeof R.listStatusUpdates>) { return this.svc.listStatusUpdates(c, i.params.projectId, i.query); }
  @ApiRoute(R.getStatusUpdate) getUpdate(@Ctx() c: C, @Input() i: RouteInput<typeof R.getStatusUpdate>) { return this.svc.getStatusUpdate(c, i.params.projectId, i.params.statusUpdateId); }
  @ApiRoute(R.createStatusUpdate) createUpdate(@Ctx() c: C, @Input() i: RouteInput<typeof R.createStatusUpdate>) { return this.svc.createStatusUpdate(c, i.params.projectId, i.body); }
  @ApiRoute(R.updateStatusUpdate) editUpdate(@Ctx() c: C, @Input() i: RouteInput<typeof R.updateStatusUpdate>) { return this.svc.updateStatusUpdate(c, i.params.projectId, i.params.statusUpdateId, i.body); }
  @ApiRoute(R.submitStatusUpdate) submitUpdate(@Ctx() c: C, @Input() i: RouteInput<typeof R.submitStatusUpdate>) { return this.svc.statusUpdateCommand(c, i.params.projectId, i.params.statusUpdateId, 'submit', i.body); }
  @ApiRoute(R.returnStatusUpdate) returnUpdate(@Ctx() c: C, @Input() i: RouteInput<typeof R.returnStatusUpdate>) { return this.svc.statusUpdateCommand(c, i.params.projectId, i.params.statusUpdateId, 'return', i.body); }
  @ApiRoute(R.acceptStatusUpdate) acceptUpdate(@Ctx() c: C, @Input() i: RouteInput<typeof R.acceptStatusUpdate>) { return this.svc.statusUpdateCommand(c, i.params.projectId, i.params.statusUpdateId, 'accept', i.body); }

  @ApiRoute(R.listRagOverrides) listOverrides(@Ctx() c: C, @Input() i: RouteInput<typeof R.listRagOverrides>) { return this.svc.listRagOverrides(c, i.params.projectId, i.query); }
  @ApiRoute(R.requestRagOverride) requestOverride(@Ctx() c: C, @Input() i: RouteInput<typeof R.requestRagOverride>) { return this.svc.requestRagOverride(c, i.params.projectId, i.body); }
  @ApiRoute(R.approveRagOverride) approveOverride(@Ctx() c: C, @Input() i: RouteInput<typeof R.approveRagOverride>) { return this.svc.reviewRagOverride(c, i.params.projectId, i.params.overrideId, true, i.body); }
  @ApiRoute(R.rejectRagOverride) rejectOverride(@Ctx() c: C, @Input() i: RouteInput<typeof R.rejectRagOverride>) { return this.svc.reviewRagOverride(c, i.params.projectId, i.params.overrideId, false, i.body); }

  @ApiRoute(R.progress) progress(@Ctx() c: C, @Input() i: RouteInput<typeof R.progress>) { return this.svc.progress(c, i.params.projectId); }
  @ApiRoute(R.myWork) myWork(@Ctx() c: C) { return this.work.myWork(c); }
}
