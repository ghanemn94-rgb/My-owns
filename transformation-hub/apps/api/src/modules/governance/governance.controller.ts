import { Controller } from '@nestjs/common';
import { governanceRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { CommitteesService } from './committees.service';
import { MeetingsService } from './meetings.service';
import { DecisionsService } from './decisions.service';
import { ActionsService } from './actions.service';

type I<T> = RouteInput<T>;

/** Thin HTTP layer: every handler is bound to a contract route; the services apply policy, rules, audit and outbox. */
@Controller()
export class GovernanceController {
  constructor(
    private readonly committees: CommitteesService,
    private readonly meetings: MeetingsService,
    private readonly decisions: DecisionsService,
    private readonly actions: ActionsService,
  ) {}

  // ---- Committees ------------------------------------------------------------------------------------------
  @ApiRoute(R.listCommittees)
  listCommittees(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listCommittees>) {
    return this.committees.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getCommittee)
  getCommittee(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getCommittee>) {
    return this.committees.get(ctx, i.params.projectId, i.params.committeeId);
  }

  @ApiRoute(R.createCommittee)
  createCommittee(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createCommittee>) {
    return this.committees.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateCharter)
  updateCharter(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.updateCharter>) {
    return this.committees.updateCharter(ctx, i.params.projectId, i.params.committeeId, i.body);
  }

  @ApiRoute(R.listCharterVersions)
  listCharterVersions(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listCharterVersions>) {
    return this.committees.charterVersions(ctx, i.params.projectId, i.params.committeeId);
  }

  @ApiRoute(R.approveCharter)
  approveCharter(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.approveCharter>) {
    return this.committees.approveCharter(ctx, i.params.projectId, i.params.committeeId, i.body);
  }

  @ApiRoute(R.activateCommittee)
  activateCommittee(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.activateCommittee>) {
    return this.committees.activate(ctx, i.params.projectId, i.params.committeeId, i.body);
  }

  @ApiRoute(R.addMembership)
  addMembership(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.addMembership>) {
    return this.committees.addMembership(ctx, i.params.projectId, i.params.committeeId, i.body);
  }

  @ApiRoute(R.endMembership)
  endMembership(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.endMembership>) {
    return this.committees.endMembership(ctx, i.params.projectId, i.params.committeeId, i.params.membershipId, i.body);
  }

  // ---- Authority matrix ------------------------------------------------------------------------------------
  @ApiRoute(R.listAuthorityMatrixVersions)
  listAuthorityMatrixVersions(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listAuthorityMatrixVersions>) {
    return this.committees.listMatrices(ctx, i.params.projectId, i.params.committeeId);
  }

  @ApiRoute(R.createAuthorityMatrixVersion)
  createAuthorityMatrixVersion(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createAuthorityMatrixVersion>) {
    return this.committees.createMatrix(ctx, i.params.projectId, i.params.committeeId, i.body);
  }

  @ApiRoute(R.approveAuthorityMatrixVersion)
  approveAuthorityMatrixVersion(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.approveAuthorityMatrixVersion>) {
    return this.committees.approveMatrix(ctx, i.params.projectId, i.params.committeeId, i.params.versionId, i.body);
  }

  @ApiRoute(R.verifyAuthorityMatrixApproval)
  verifyAuthorityMatrixApproval(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.verifyAuthorityMatrixApproval>) {
    return this.committees.verifyMatrixApproval(ctx, i.params.projectId, i.params.committeeId, i.params.versionId, i.body);
  }

  // ---- Meetings --------------------------------------------------------------------------------------------
  @ApiRoute(R.listMeetings)
  listMeetings(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listMeetings>) {
    return this.meetings.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getMeeting)
  getMeeting(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getMeeting>) {
    return this.meetings.get(ctx, i.params.projectId, i.params.meetingId);
  }

  @ApiRoute(R.createMeeting)
  createMeeting(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createMeeting>) {
    return this.meetings.create(ctx, i.params.projectId, i.params.committeeId, i.body);
  }

  @ApiRoute(R.publishAgenda)
  publishAgenda(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.publishAgenda>) {
    return this.meetings.command(ctx, i.params.projectId, i.params.meetingId, 'publish_agenda', i.body);
  }

  @ApiRoute(R.startSession)
  startSession(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.startSession>) {
    return this.meetings.command(ctx, i.params.projectId, i.params.meetingId, 'start_session', i.body);
  }

  @ApiRoute(R.closeSession)
  closeSession(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.closeSession>) {
    return this.meetings.command(ctx, i.params.projectId, i.params.meetingId, 'close_session', i.body);
  }

  @ApiRoute(R.cancelMeeting)
  cancelMeeting(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.cancelMeeting>) {
    return this.meetings.command(ctx, i.params.projectId, i.params.meetingId, 'cancel', i.body);
  }

  @ApiRoute(R.recordAttendance)
  recordAttendance(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.recordAttendance>) {
    return this.meetings.recordAttendance(ctx, i.params.projectId, i.params.meetingId, i.body);
  }

  @ApiRoute(R.declareConflict)
  declareConflict(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.declareConflict>) {
    return this.meetings.declareConflict(ctx, i.params.projectId, i.params.meetingId, i.body);
  }

  @ApiRoute(R.quorumCheck)
  quorumCheck(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.quorumCheck>) {
    return this.meetings.quorumCheck(ctx, i.params.projectId, i.params.meetingId, i.body);
  }

  @ApiRoute(R.draftMinutes)
  draftMinutes(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.draftMinutes>) {
    return this.meetings.draftMinutes(ctx, i.params.projectId, i.params.meetingId, i.body);
  }

  @ApiRoute(R.approveMinutes)
  approveMinutes(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.approveMinutes>) {
    return this.meetings.approveMinutes(ctx, i.params.projectId, i.params.meetingId, i.body);
  }

  @ApiRoute(R.freezePack)
  freezePack(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.freezePack>) {
    return this.meetings.freezePack(ctx, i.params.projectId, i.params.meetingId, i.body);
  }

  @ApiRoute(R.listPacks)
  listPacks(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listPacks>) {
    return this.meetings.listPacks(ctx, i.params.projectId, i.params.meetingId);
  }

  @ApiRoute(R.getPack)
  getPack(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getPack>) {
    return this.meetings.getPack(ctx, i.params.projectId, i.params.meetingId, i.params.packId);
  }

  // ---- Agenda requests -------------------------------------------------------------------------------------
  @ApiRoute(R.listAgendaRequests)
  listAgendaRequests(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listAgendaRequests>) {
    return this.meetings.listAgenda(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.createAgendaRequest)
  createAgendaRequest(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createAgendaRequest>) {
    return this.meetings.createAgendaRequest(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.screenAgendaRequest)
  screenAgendaRequest(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.screenAgendaRequest>) {
    return this.meetings.screenAgendaRequest(ctx, i.params.projectId, i.params.agendaItemId, i.body);
  }

  // ---- Decisions -------------------------------------------------------------------------------------------
  @ApiRoute(R.listDecisions)
  listDecisions(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listDecisions>) {
    return this.decisions.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getDecision)
  getDecision(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getDecision>) {
    return this.decisions.get(ctx, i.params.projectId, i.params.decisionId);
  }

  @ApiRoute(R.createDecision)
  createDecision(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createDecision>) {
    return this.decisions.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateDecision)
  updateDecision(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.updateDecision>) {
    return this.decisions.update(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.submitDecision)
  submitDecision(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.submitDecision>) {
    return this.decisions.submit(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.startReview)
  startReview(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.startReview>) {
    return this.decisions.startReview(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.returnToDraft)
  returnToDraft(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.returnToDraft>) {
    return this.decisions.returnToDraft(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.declareRecusal)
  declareRecusal(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.declareRecusal>) {
    return this.decisions.declareRecusal(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.listVotes)
  listVotes(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listVotes>) {
    return this.decisions.listVotes(ctx, i.params.projectId, i.params.decisionId);
  }

  @ApiRoute(R.castVote)
  castVote(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.castVote>) {
    return this.decisions.castVote(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.initiateCirculation)
  initiateCirculation(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.initiateCirculation>) {
    return this.decisions.initiateCirculation(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.recordOutcome)
  recordOutcome(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.recordOutcome>) {
    return this.decisions.recordOutcome(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.recordExternalApproval)
  recordExternalApproval(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.recordExternalApproval>) {
    return this.decisions.recordExternalApproval(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.deferDecision)
  deferDecision(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.deferDecision>) {
    return this.decisions.defer(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.resumeDecision)
  resumeDecision(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.resumeDecision>) {
    return this.decisions.resume(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.supersedeDecision)
  supersedeDecision(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.supersedeDecision>) {
    return this.decisions.supersede(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.startImplementation)
  startImplementation(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.startImplementation>) {
    return this.decisions.startImplementation(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  @ApiRoute(R.verifyImplementation)
  verifyImplementation(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.verifyImplementation>) {
    return this.decisions.verifyImplementation(ctx, i.params.projectId, i.params.decisionId, i.body);
  }

  // ---- Actions ---------------------------------------------------------------------------------------------
  @ApiRoute(R.listActions)
  listActions(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listActions>) {
    return this.actions.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getAction)
  getAction(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getAction>) {
    return this.actions.get(ctx, i.params.projectId, i.params.actionId);
  }

  @ApiRoute(R.createAction)
  createAction(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createAction>) {
    return this.actions.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateAction)
  updateAction(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.updateAction>) {
    return this.actions.update(ctx, i.params.projectId, i.params.actionId, i.body);
  }

  @ApiRoute(R.startAction)
  startAction(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.startAction>) {
    return this.actions.start(ctx, i.params.projectId, i.params.actionId, i.body);
  }

  @ApiRoute(R.reportActionDone)
  reportActionDone(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.reportActionDone>) {
    return this.actions.reportDone(ctx, i.params.projectId, i.params.actionId, i.body);
  }

  @ApiRoute(R.verifyActionClosure)
  verifyActionClosure(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.verifyActionClosure>) {
    return this.actions.verifyClosure(ctx, i.params.projectId, i.params.actionId, i.body);
  }

  @ApiRoute(R.rejectActionClosure)
  rejectActionClosure(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.rejectActionClosure>) {
    return this.actions.rejectClosure(ctx, i.params.projectId, i.params.actionId, i.body);
  }

  @ApiRoute(R.cancelAction)
  cancelAction(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.cancelAction>) {
    return this.actions.cancel(ctx, i.params.projectId, i.params.actionId, i.body);
  }

  // ---- Escalations -----------------------------------------------------------------------------------------
  @ApiRoute(R.listEscalations)
  listEscalations(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listEscalations>) {
    return this.actions.listEscalations(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getEscalation)
  getEscalation(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getEscalation>) {
    return this.actions.getEscalation(ctx, i.params.projectId, i.params.escalationId);
  }

  @ApiRoute(R.raiseEscalation)
  raiseEscalation(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.raiseEscalation>) {
    return this.actions.raise(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.resolveEscalation)
  resolveEscalation(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.resolveEscalation>) {
    return this.actions.resolve(ctx, i.params.projectId, i.params.escalationId, i.body);
  }
}
