import { Controller } from '@nestjs/common';
import { newcoRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { LegalEntitiesService } from './legal-entities.service';
import { RegulatoryService } from './regulatory.service';

/** Thin controller: routes are declared in packages/contracts/src/newco.ts. */
@Controller()
export class NewcoController {
  constructor(
    private readonly entities: LegalEntitiesService,
    private readonly regulatory: RegulatoryService,
  ) {}

  @ApiRoute(R.listLegalEntities)
  listLegalEntities(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listLegalEntities>) {
    return this.entities.list(ctx, i.params.projectId);
  }

  @ApiRoute(R.getLegalEntity)
  getLegalEntity(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getLegalEntity>) {
    return this.entities.get(ctx, i.params.projectId, i.params.entityId);
  }

  @ApiRoute(R.createLegalEntity)
  createLegalEntity(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createLegalEntity>) {
    return this.entities.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.linkLegalEntity)
  linkLegalEntity(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.linkLegalEntity>) {
    return this.entities.link(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateLegalEntity)
  updateLegalEntity(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateLegalEntity>) {
    return this.entities.update(ctx, i.params.projectId, i.params.entityId, i.body);
  }

  @ApiRoute(R.recordIncorporation)
  recordIncorporation(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordIncorporation>) {
    return this.entities.recordIncorporation(ctx, i.params.projectId, i.params.entityId, i.body);
  }

  @ApiRoute(R.verifyIncorporation)
  verifyIncorporation(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.verifyIncorporation>) {
    return this.entities.verifyIncorporation(ctx, i.params.projectId, i.params.entityId, i.body);
  }

  @ApiRoute(R.setupNewcoStatus)
  setupNewcoStatus(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.setupNewcoStatus>) {
    return this.entities.setupNewcoStatus(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.listRequirements)
  listRequirements(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listRequirements>) {
    return this.regulatory.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getRequirement)
  getRequirement(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getRequirement>) {
    return this.regulatory.get(ctx, i.params.projectId, i.params.requirementId);
  }

  @ApiRoute(R.createRequirement)
  createRequirement(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createRequirement>) {
    return this.regulatory.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateRequirement)
  updateRequirement(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateRequirement>) {
    return this.regulatory.update(ctx, i.params.projectId, i.params.requirementId, i.body);
  }

  @ApiRoute(R.assessApplicability)
  assessApplicability(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.assessApplicability>) {
    return this.regulatory.assessApplicability(ctx, i.params.projectId, i.params.requirementId, i.body);
  }

  @ApiRoute(R.requirementProgress)
  requirementProgress(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.requirementProgress>) {
    return this.regulatory.progress(ctx, i.params.projectId, i.params.requirementId, i.body);
  }

  @ApiRoute(R.recordRequirementOutcome)
  recordRequirementOutcome(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordRequirementOutcome>) {
    return this.regulatory.recordOutcome(ctx, i.params.projectId, i.params.requirementId, i.body);
  }

  @ApiRoute(R.conditionsSatisfied)
  conditionsSatisfied(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.conditionsSatisfied>) {
    return this.regulatory.conditionsSatisfied(ctx, i.params.projectId, i.params.requirementId, i.body);
  }
}
