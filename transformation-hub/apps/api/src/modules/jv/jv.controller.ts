import { Controller, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { jvRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { attachmentDisposition } from '../../platform/helpers';
import { PartnersService } from './partners.service';
import { DealsService } from './deals.service';
import { RoomsService } from './rooms.service';
import { DiligenceService } from './diligence.service';
import { TransactionsService } from './transactions.service';
import { PostCloseService } from './postclose.service';

type I<T> = RouteInput<T>;

/** JV / partner / DD / signing & closing routes — thin: every rule lives in the command services. */
@Controller()
export class JvController {
  constructor(
    private readonly partners: PartnersService,
    private readonly deals: DealsService,
    private readonly rooms: RoomsService,
    private readonly dd: DiligenceService,
    private readonly tx: TransactionsService,
    private readonly post: PostCloseService,
  ) {}

  // ---- partners
  @ApiRoute(R.listPartners)
  listPartners(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listPartners>) {
    return this.partners.list(ctx, i.params.projectId, i.query);
  }
  @ApiRoute(R.getPartner)
  getPartner(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getPartner>) {
    return this.partners.get(ctx, i.params.projectId, i.params.partnerId);
  }
  @ApiRoute(R.createPartner)
  createPartner(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createPartner>) {
    return this.partners.create(ctx, i.params.projectId, i.body);
  }
  @ApiRoute(R.updatePartner)
  updatePartner(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.updatePartner>) {
    return this.partners.update(ctx, i.params.projectId, i.params.partnerId, i.body);
  }
  @ApiRoute(R.shortlistPartner)
  shortlistPartner(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.shortlistPartner>) {
    return this.partners.shortlist(ctx, i.params.projectId, i.params.partnerId, i.body);
  }
  @ApiRoute(R.requestOutreach)
  requestOutreach(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.requestOutreach>) {
    return this.partners.requestOutreach(ctx, i.params.projectId, i.params.partnerId, i.body);
  }
  @ApiRoute(R.decideOutreach)
  decideOutreach(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.decideOutreach>) {
    return this.partners.decideOutreach(ctx, i.params.projectId, i.params.partnerId, i.body);
  }
  @ApiRoute(R.submitNda)
  submitNda(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.submitNda>) {
    return this.partners.submitNda(ctx, i.params.projectId, i.params.partnerId, i.body);
  }
  @ApiRoute(R.recordNda)
  recordNda(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.recordNda>) {
    return this.partners.recordNda(ctx, i.params.projectId, i.params.partnerId, i.body);
  }
  @ApiRoute(R.advancePartner)
  advancePartner(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.advancePartner>) {
    return this.partners.advance(ctx, i.params.projectId, i.params.partnerId, i.body);
  }
  @ApiRoute(R.withdrawPartner)
  withdrawPartner(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.withdrawPartner>) {
    return this.partners.withdraw(ctx, i.params.projectId, i.params.partnerId, i.body);
  }
  @ApiRoute(R.addPartnerConflict)
  addPartnerConflict(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.addPartnerConflict>) {
    return this.partners.addConflict(ctx, i.params.projectId, i.params.partnerId, i.body);
  }
  @ApiRoute(R.addPartnerContact)
  addPartnerContact(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.addPartnerContact>) {
    return this.partners.addContact(ctx, i.params.projectId, i.params.partnerId, i.body);
  }
  @ApiRoute(R.revokePartnerContact)
  revokePartnerContact(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.revokePartnerContact>) {
    return this.partners.revokeContact(ctx, i.params.projectId, i.params.partnerId, i.params.contactId, i.body);
  }
  @ApiRoute(R.getCriteria)
  getCriteria(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getCriteria>) {
    return this.partners.getCriteria(ctx, i.params.projectId);
  }
  @ApiRoute(R.setCriteria)
  setCriteria(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.setCriteria>) {
    return this.partners.setCriteria(ctx, i.params.projectId, i.body);
  }
  @ApiRoute(R.listAssessments)
  listAssessments(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listAssessments>) {
    return this.partners.listAssessments(ctx, i.params.projectId, i.params.partnerId);
  }
  @ApiRoute(R.addAssessment)
  addAssessment(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.addAssessment>) {
    return this.partners.addAssessment(ctx, i.params.projectId, i.params.partnerId, i.body);
  }
  @ApiRoute(R.listProposals)
  listProposals(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listProposals>) {
    return this.partners.listProposals(ctx, i.params.projectId, i.params.partnerId);
  }
  @ApiRoute(R.addProposal)
  addProposal(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.addProposal>) {
    return this.partners.addProposal(ctx, i.params.projectId, i.params.partnerId, i.body);
  }
  @ApiRoute(R.comparePartners)
  comparePartners(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.comparePartners>) {
    return this.partners.compare(ctx, i.params.projectId);
  }

  // ---- deal scenarios & negotiation
  @ApiRoute(R.listScenarios)
  listScenarios(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listScenarios>) {
    return this.deals.listScenarios(ctx, i.params.projectId, i.query);
  }
  @ApiRoute(R.getScenario)
  getScenario(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getScenario>) {
    return this.deals.getScenario(ctx, i.params.projectId, i.params.scenarioId);
  }
  @ApiRoute(R.createScenario)
  createScenario(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createScenario>) {
    return this.deals.createScenario(ctx, i.params.projectId, i.body);
  }
  @ApiRoute(R.addScenarioVersion)
  addScenarioVersion(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.addScenarioVersion>) {
    return this.deals.addScenarioVersion(ctx, i.params.projectId, i.params.scenarioId, i.body);
  }
  @ApiRoute(R.listNegotiationIssues)
  listNegotiationIssues(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listNegotiationIssues>) {
    return this.deals.listIssues(ctx, i.params.projectId, i.query);
  }
  @ApiRoute(R.createNegotiationIssue)
  createNegotiationIssue(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createNegotiationIssue>) {
    return this.deals.createIssue(ctx, i.params.projectId, i.body);
  }
  @ApiRoute(R.updateNegotiationIssue)
  updateNegotiationIssue(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.updateNegotiationIssue>) {
    return this.deals.updateIssue(ctx, i.params.projectId, i.params.issueId, i.body);
  }
  @ApiRoute(R.transitionNegotiationIssue)
  transitionNegotiationIssue(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.transitionNegotiationIssue>) {
    return this.deals.transitionIssue(ctx, i.params.projectId, i.params.issueId, i.body);
  }

  // ---- rooms
  @ApiRoute(R.listRooms)
  listRooms(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listRooms>) {
    return this.rooms.list(ctx, i.params.projectId, i.query);
  }
  @ApiRoute(R.getRoom)
  getRoom(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getRoom>) {
    return this.rooms.get(ctx, i.params.projectId, i.params.roomId);
  }
  @ApiRoute(R.createRoom)
  createRoom(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createRoom>) {
    return this.rooms.create(ctx, i.params.projectId, i.body);
  }
  @ApiRoute(R.updateRoom)
  updateRoom(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.updateRoom>) {
    return this.rooms.update(ctx, i.params.projectId, i.params.roomId, i.body);
  }
  @ApiRoute(R.lockRoom)
  lockRoom(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.lockRoom>) {
    return this.rooms.setLock(ctx, i.params.projectId, i.params.roomId, i.body, true);
  }
  @ApiRoute(R.unlockRoom)
  unlockRoom(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.unlockRoom>) {
    return this.rooms.setLock(ctx, i.params.projectId, i.params.roomId, i.body, false);
  }
  @ApiRoute(R.listRoomGrants)
  listRoomGrants(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listRoomGrants>) {
    return this.rooms.listGrants(ctx, i.params.projectId, i.params.roomId);
  }
  @ApiRoute(R.grantRoomAccess)
  grantRoomAccess(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.grantRoomAccess>) {
    return this.rooms.grant(ctx, i.params.projectId, i.params.roomId, i.body);
  }
  @ApiRoute(R.revokeRoomAccess)
  revokeRoomAccess(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.revokeRoomAccess>) {
    return this.rooms.revoke(ctx, i.params.projectId, i.params.roomId, i.params.grantId, i.body);
  }
  @ApiRoute(R.getRoomIndex)
  getRoomIndex(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getRoomIndex>) {
    return this.rooms.index(ctx, i.params.projectId, i.params.roomId, i.query);
  }
  @ApiRoute(R.listDisclosures)
  listDisclosures(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listDisclosures>) {
    return this.rooms.listDisclosures(ctx, i.params.projectId, i.params.roomId, i.query);
  }
  @ApiRoute(R.requestDisclosure)
  requestDisclosure(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.requestDisclosure>) {
    return this.rooms.requestDisclosure(ctx, i.params.projectId, i.params.roomId, i.body);
  }
  @ApiRoute(R.releaseDisclosure)
  releaseDisclosure(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.releaseDisclosure>) {
    return this.rooms.decideDisclosure(ctx, i.params.projectId, i.params.roomId, i.params.disclosureId, i.body);
  }
  @ApiRoute(R.revokeDisclosure)
  revokeDisclosure(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.revokeDisclosure>) {
    return this.rooms.revokeDisclosure(ctx, i.params.projectId, i.params.roomId, i.params.disclosureId, i.body);
  }
  @ApiRoute(R.listRoomAccessLog)
  listRoomAccessLog(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listRoomAccessLog>) {
    return this.rooms.accessLog(ctx, i.params.projectId, i.params.roomId, i.query);
  }

  // ---- counterparty projection
  @ApiRoute(R.listExternalRooms)
  listExternalRooms(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listExternalRooms>) {
    return this.rooms.externalRooms(ctx, i.params.projectId);
  }
  @ApiRoute(R.listExternalDisclosures)
  listExternalDisclosures(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listExternalDisclosures>) {
    return this.rooms.externalDisclosures(ctx, i.params.projectId, i.params.roomId);
  }
  @ApiRoute(R.downloadExternalDisclosure)
  async downloadExternalDisclosure(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.downloadExternalDisclosure>, @Res({ passthrough: true }) res: Response) {
    const f = await this.rooms.openExternalDownload(ctx, i.params.projectId, i.params.roomId, i.params.disclosureId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(f.stream, { type: f.mime, length: f.size, disposition: attachmentDisposition(f.filename) });
  }
  @ApiRoute(R.listExternalDdRequests)
  listExternalDdRequests(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listExternalDdRequests>) {
    return this.dd.externalList(ctx, i.params.projectId, i.params.roomId);
  }
  @ApiRoute(R.createExternalDdRequest)
  createExternalDdRequest(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createExternalDdRequest>) {
    return this.dd.externalCreate(ctx, i.params.projectId, i.params.roomId, i.body);
  }

  // ---- DD requests & findings
  @ApiRoute(R.listDdRequests)
  listDdRequests(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listDdRequests>) {
    return this.dd.list(ctx, i.params.projectId, i.query);
  }
  @ApiRoute(R.getDdRequest)
  getDdRequest(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getDdRequest>) {
    return this.dd.get(ctx, i.params.projectId, i.params.requestId);
  }
  @ApiRoute(R.createDdRequest)
  createDdRequest(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createDdRequest>) {
    return this.dd.create(ctx, i.params.projectId, i.body);
  }
  @ApiRoute(R.assignDdRequest)
  assignDdRequest(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.assignDdRequest>) {
    return this.dd.assign(ctx, i.params.projectId, i.params.requestId, i.body);
  }
  @ApiRoute(R.draftDdAnswer)
  draftDdAnswer(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.draftDdAnswer>) {
    return this.dd.draftAnswer(ctx, i.params.projectId, i.params.requestId, i.body);
  }
  @ApiRoute(R.submitDdAnswer)
  submitDdAnswer(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.submitDdAnswer>) {
    return this.dd.submitForReview(ctx, i.params.projectId, i.params.requestId, i.body);
  }
  @ApiRoute(R.reviewDdAnswer)
  reviewDdAnswer(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.reviewDdAnswer>) {
    return this.dd.review(ctx, i.params.projectId, i.params.requestId, i.body);
  }
  @ApiRoute(R.releaseDdAnswer)
  releaseDdAnswer(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.releaseDdAnswer>) {
    return this.dd.release(ctx, i.params.projectId, i.params.requestId, i.body);
  }
  @ApiRoute(R.listFindings)
  listFindings(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listFindings>) {
    return this.dd.listFindings(ctx, i.params.projectId, i.query);
  }
  @ApiRoute(R.getFinding)
  getFinding(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getFinding>) {
    return this.dd.getFinding(ctx, i.params.projectId, i.params.findingId);
  }
  @ApiRoute(R.createFinding)
  createFinding(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createFinding>) {
    return this.dd.createFinding(ctx, i.params.projectId, i.body);
  }
  @ApiRoute(R.updateFinding)
  updateFinding(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.updateFinding>) {
    return this.dd.updateFinding(ctx, i.params.projectId, i.params.findingId, i.body);
  }
  @ApiRoute(R.transitionFinding)
  transitionFinding(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.transitionFinding>) {
    return this.dd.transitionFinding(ctx, i.params.projectId, i.params.findingId, i.body);
  }

  // ---- signing & closing
  @ApiRoute(R.listSignings)
  listSignings(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listSignings>) {
    return this.tx.listEvents(ctx, i.params.projectId, 'signing', i.query);
  }
  @ApiRoute(R.createSigning)
  createSigning(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createSigning>) {
    return this.tx.createEvent(ctx, i.params.projectId, 'signing', i.body);
  }
  @ApiRoute(R.getSigning)
  getSigning(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getSigning>) {
    return this.tx.detail(ctx, i.params.projectId, i.params.eventId, 'signing');
  }
  @ApiRoute(R.getSigningChecklist)
  getSigningChecklist(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getSigningChecklist>) {
    return this.tx.checklist(ctx, i.params.projectId, i.params.eventId, 'signing');
  }
  @ApiRoute(R.listClosings)
  listClosings(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listClosings>) {
    return this.tx.listEvents(ctx, i.params.projectId, 'closing', i.query);
  }
  @ApiRoute(R.createClosing)
  createClosing(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createClosing>) {
    return this.tx.createEvent(ctx, i.params.projectId, 'closing', i.body);
  }
  @ApiRoute(R.getClosing)
  getClosing(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getClosing>) {
    return this.tx.detail(ctx, i.params.projectId, i.params.eventId, 'closing');
  }
  @ApiRoute(R.getClosingChecklist)
  getClosingChecklist(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getClosingChecklist>) {
    return this.tx.checklist(ctx, i.params.projectId, i.params.eventId, 'closing');
  }
  @ApiRoute(R.transitionEvent)
  transitionEvent(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.transitionEvent>) {
    return this.tx.transitionEvent(ctx, i.params.projectId, i.params.eventId, i.body);
  }
  @ApiRoute(R.requestEventConfirmation)
  requestEventConfirmation(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.requestEventConfirmation>) {
    return this.tx.requestConfirmation(ctx, i.params.projectId, i.params.eventId, i.body);
  }
  @ApiRoute(R.recordSigning)
  recordSigning(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.recordSigning>) {
    return this.tx.confirm(ctx, i.params.projectId, i.params.eventId, 'signing', i.body);
  }
  @ApiRoute(R.confirmClosing)
  confirmClosing(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.confirmClosing>) {
    return this.tx.confirm(ctx, i.params.projectId, i.params.eventId, 'closing', i.body);
  }
  @ApiRoute(R.createChecklistItem)
  createChecklistItem(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createChecklistItem>) {
    return this.tx.createItem(ctx, i.params.projectId, i.body);
  }
  @ApiRoute(R.deliverChecklistItem)
  deliverChecklistItem(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.deliverChecklistItem>) {
    return this.tx.deliverItem(ctx, i.params.projectId, i.params.itemId, i.body);
  }
  @ApiRoute(R.acceptChecklistItem)
  acceptChecklistItem(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.acceptChecklistItem>) {
    return this.tx.acceptItem(ctx, i.params.projectId, i.params.itemId, i.body);
  }
  @ApiRoute(R.setChecklistItemNotRequired)
  setChecklistItemNotRequired(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.setChecklistItemNotRequired>) {
    return this.tx.itemNotRequired(ctx, i.params.projectId, i.params.itemId, i.body);
  }

  @ApiRoute(R.decideChecklistItemNotRequired)
  decideChecklistItemNotRequired(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.decideChecklistItemNotRequired>) {
    return this.tx.decideItemNotRequired(ctx, i.params.projectId, i.params.itemId, i.body);
  }

  // ---- conditions precedent
  @ApiRoute(R.listConditions)
  listConditions(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listConditions>) {
    return this.tx.listCps(ctx, i.params.projectId, i.query);
  }
  @ApiRoute(R.getCondition)
  getCondition(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getCondition>) {
    return this.tx.getCp(ctx, i.params.projectId, i.params.conditionId);
  }
  @ApiRoute(R.createCondition)
  createCondition(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createCondition>) {
    return this.tx.createCp(ctx, i.params.projectId, i.body);
  }
  @ApiRoute(R.updateCondition)
  updateCondition(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.updateCondition>) {
    return this.tx.updateCp(ctx, i.params.projectId, i.params.conditionId, i.body);
  }
  @ApiRoute(R.determineConditionWaivability)
  determineConditionWaivability(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.determineConditionWaivability>) {
    return this.tx.determineWaivability(ctx, i.params.projectId, i.params.conditionId, i.body);
  }
  @ApiRoute(R.extendConditionLongStop)
  extendConditionLongStop(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.extendConditionLongStop>) {
    return this.tx.extendLongStop(ctx, i.params.projectId, i.params.conditionId, i.body);
  }
  @ApiRoute(R.submitConditionEvidence)
  submitConditionEvidence(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.submitConditionEvidence>) {
    return this.tx.submitEvidence(ctx, i.params.projectId, i.params.conditionId, i.body);
  }
  @ApiRoute(R.verifyCondition)
  verifyCondition(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.verifyCondition>) {
    return this.tx.verify(ctx, i.params.projectId, i.params.conditionId, i.body);
  }
  @ApiRoute(R.reopenCondition)
  reopenCondition(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.reopenCondition>) {
    return this.tx.reopen(ctx, i.params.projectId, i.params.conditionId, i.body);
  }
  @ApiRoute(R.requestConditionWaiver)
  requestConditionWaiver(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.requestConditionWaiver>) {
    return this.tx.requestWaiver(ctx, i.params.projectId, i.params.conditionId, i.body);
  }
  @ApiRoute(R.approveConditionWaiver)
  approveConditionWaiver(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.approveConditionWaiver>) {
    return this.tx.approveWaiver(ctx, i.params.projectId, i.params.waiverId, i.body);
  }
  @ApiRoute(R.rejectConditionWaiver)
  rejectConditionWaiver(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.rejectConditionWaiver>) {
    return this.tx.rejectWaiver(ctx, i.params.projectId, i.params.waiverId, i.body);
  }

  // ---- funds flow
  @ApiRoute(R.listFundsFlows)
  listFundsFlows(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listFundsFlows>) {
    return this.tx.listFlows(ctx, i.params.projectId, i.params.eventId);
  }
  @ApiRoute(R.createFundsFlow)
  createFundsFlow(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createFundsFlow>) {
    return this.tx.createFlow(ctx, i.params.projectId, i.params.eventId, i.body);
  }
  @ApiRoute(R.transitionFundsFlow)
  transitionFundsFlow(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.transitionFundsFlow>) {
    return this.tx.transitionFlow(ctx, i.params.projectId, i.params.flowId, i.body);
  }

  // ---- post-close & program closure
  @ApiRoute(R.listObligations)
  listObligations(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.listObligations>) {
    return this.post.list(ctx, i.params.projectId, i.query);
  }
  @ApiRoute(R.createObligation)
  createObligation(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.createObligation>) {
    return this.post.create(ctx, i.params.projectId, i.body);
  }
  @ApiRoute(R.transitionObligation)
  transitionObligation(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.transitionObligation>) {
    return this.post.transition(ctx, i.params.projectId, i.params.obligationId, i.body);
  }
  @ApiRoute(R.verifyObligation)
  verifyObligation(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.verifyObligation>) {
    return this.post.verify(ctx, i.params.projectId, i.params.obligationId, i.body);
  }
  @ApiRoute(R.getProgramClosure)
  getProgramClosure(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.getProgramClosure>) {
    return this.post.getClosure(ctx, i.params.projectId);
  }
  @ApiRoute(R.requestProgramClosure)
  requestProgramClosure(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.requestProgramClosure>) {
    return this.post.requestClosure(ctx, i.params.projectId, i.body);
  }
  @ApiRoute(R.confirmProgramClosure)
  confirmProgramClosure(@Ctx() ctx: RequestContext, @Input() i: I<typeof R.confirmProgramClosure>) {
    return this.post.confirmClosure(ctx, i.params.projectId, i.body);
  }
}
