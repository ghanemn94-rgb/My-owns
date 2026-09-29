import { Controller } from '@nestjs/common';
import { carveoutRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { PerimeterService } from './perimeter.service';
import { TransfersService } from './transfers.service';
import { PerimeterVersionsService } from './perimeter-versions.service';
import { AgreementsService } from './agreements.service';

/** Thin controller: every route is declared in packages/contracts/src/carveout.ts; logic lives in the services. */
@Controller()
export class CarveoutController {
  constructor(
    private readonly perimeter: PerimeterService,
    private readonly transfers: TransfersService,
    private readonly versions: PerimeterVersionsService,
    private readonly agreements: AgreementsService,
  ) {}

  @ApiRoute(R.listSites)
  listSites(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listSites>) {
    return this.perimeter.listSites(ctx, i.params.projectId);
  }

  @ApiRoute(R.createSite)
  createSite(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createSite>) {
    return this.perimeter.createSite(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateSite)
  updateSite(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateSite>) {
    return this.perimeter.updateSite(ctx, i.params.projectId, i.params.siteId, i.body);
  }

  @ApiRoute(R.listPerimeterItems)
  listPerimeterItems(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listPerimeterItems>) {
    return this.perimeter.listItems(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getPerimeterItem)
  getPerimeterItem(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getPerimeterItem>) {
    return this.perimeter.getItem(ctx, i.params.projectId, i.params.itemId);
  }

  @ApiRoute(R.createPerimeterItem)
  createPerimeterItem(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createPerimeterItem>) {
    return this.perimeter.createItem(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updatePerimeterItem)
  updatePerimeterItem(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updatePerimeterItem>) {
    return this.perimeter.updateItem(ctx, i.params.projectId, i.params.itemId, i.body);
  }

  @ApiRoute(R.classifyPerimeterItem)
  classifyPerimeterItem(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.classifyPerimeterItem>) {
    return this.perimeter.classify(ctx, i.params.projectId, i.params.itemId, i.body);
  }

  @ApiRoute(R.applyPerimeterChange)
  applyPerimeterChange(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.applyPerimeterChange>) {
    return this.perimeter.applyChange(ctx, i.params.projectId, i.params.itemId, i.body);
  }

  @ApiRoute(R.assessPerimeterImpact)
  assessPerimeterImpact(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.assessPerimeterImpact>) {
    return this.perimeter.assessImpact(ctx, i.params.projectId, i.params.itemId, i.body);
  }

  @ApiRoute(R.listPerimeterImpacts)
  listPerimeterImpacts(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listPerimeterImpacts>) {
    return this.perimeter.listImpacts(ctx, i.params.projectId, i.params.itemId);
  }

  @ApiRoute(R.setTransferability)
  setTransferability(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.setTransferability>) {
    return this.perimeter.setTransferability(ctx, i.params.projectId, i.params.itemId, i.body);
  }

  @ApiRoute(R.setInterimArrangement)
  setInterimArrangement(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.setInterimArrangement>) {
    return this.perimeter.setInterimArrangement(ctx, i.params.projectId, i.params.itemId, i.body);
  }

  @ApiRoute(R.listTransfers)
  listTransfers(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listTransfers>) {
    return this.transfers.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.recordTransfer)
  recordTransfer(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordTransfer>) {
    return this.transfers.record(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.verifyTransfer)
  verifyTransfer(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.verifyTransfer>) {
    return this.transfers.verify(ctx, i.params.projectId, i.params.transferId, i.body);
  }

  @ApiRoute(R.rejectTransferEvidence)
  rejectTransferEvidence(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rejectTransferEvidence>) {
    return this.transfers.rejectEvidence(ctx, i.params.projectId, i.params.transferId, i.body);
  }

  @ApiRoute(R.reconciliation)
  reconciliation(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.reconciliation>) {
    return this.perimeter.reconciliation(ctx, i.params.projectId);
  }

  @ApiRoute(R.reviewCategory)
  reviewCategory(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.reviewCategory>) {
    return this.perimeter.reviewCategory(ctx, i.params.projectId, i.params.category, i.body);
  }

  @ApiRoute(R.day1Positions)
  day1Positions(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.day1Positions>) {
    return this.perimeter.day1Positions(ctx, i.params.projectId);
  }

  @ApiRoute(R.listPerimeterVersions)
  listPerimeterVersions(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listPerimeterVersions>) {
    return this.versions.list(ctx, i.params.projectId);
  }

  @ApiRoute(R.setupPerimeterStep)
  setupPerimeterStep(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.setupPerimeterStep>) {
    return this.versions.propose(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.approvePerimeterVersion)
  approvePerimeterVersion(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approvePerimeterVersion>) {
    return this.versions.approve(ctx, i.params.projectId, i.params.versionId, i.body);
  }

  @ApiRoute(R.rejectPerimeterVersion)
  rejectPerimeterVersion(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rejectPerimeterVersion>) {
    return this.versions.reject(ctx, i.params.projectId, i.params.versionId, i.body);
  }

  @ApiRoute(R.listAgreements)
  listAgreements(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listAgreements>) {
    return this.agreements.listAgreements(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getAgreement)
  getAgreement(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getAgreement>) {
    return this.agreements.getAgreement(ctx, i.params.projectId, i.params.agreementId);
  }

  @ApiRoute(R.createAgreement)
  createAgreement(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createAgreement>) {
    return this.agreements.createAgreement(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateAgreement)
  updateAgreement(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateAgreement>) {
    return this.agreements.updateAgreement(ctx, i.params.projectId, i.params.agreementId, i.body);
  }

  @ApiRoute(R.agreementStage)
  agreementStage(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.agreementStage>) {
    return this.agreements.stage(ctx, i.params.projectId, i.params.agreementId, i.body);
  }

  @ApiRoute(R.addAgreementVersion)
  addAgreementVersion(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.addAgreementVersion>) {
    return this.agreements.addVersion(ctx, i.params.projectId, i.params.agreementId, i.body);
  }

  @ApiRoute(R.confirmAgreementExpansion)
  confirmAgreementExpansion(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.confirmAgreementExpansion>) {
    return this.agreements.confirmExpansion(ctx, i.params.projectId, i.params.agreementId, i.body);
  }

  @ApiRoute(R.listConsents)
  listConsents(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listConsents>) {
    return this.agreements.listConsents(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.createConsent)
  createConsent(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createConsent>) {
    return this.agreements.createConsent(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateConsent)
  updateConsent(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateConsent>) {
    return this.agreements.updateConsent(ctx, i.params.projectId, i.params.consentId, i.body);
  }

  @ApiRoute(R.recordConsentResponse)
  recordConsentResponse(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordConsentResponse>) {
    return this.agreements.recordResponse(ctx, i.params.projectId, i.params.consentId, i.body);
  }
}
