import { Controller } from '@nestjs/common';
import { portfolioRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { PortfolioService } from './portfolio.service';

@Controller()
export class PortfolioController {
  constructor(private readonly svc: PortfolioService) {}

  @ApiRoute(R.listProjects)
  listProjects(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listProjects>) {
    return this.svc.listProjects(ctx, i.query);
  }

  @ApiRoute(R.getProject)
  getProject(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getProject>) {
    return this.svc.getProject(ctx, i.params.projectId);
  }

  @ApiRoute(R.createProject)
  createProject(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createProject>) {
    return this.svc.createProject(ctx, i.body);
  }

  @ApiRoute(R.updateProject)
  updateProject(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateProject>) {
    return this.svc.updateProject(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.listTemplates)
  listTemplates() {
    return this.svc.listTemplates();
  }

  @ApiRoute(R.listPrograms)
  listPrograms() {
    return this.svc.listPrograms();
  }

  @ApiRoute(R.directory)
  directory(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.directory>) {
    return this.svc.directory(ctx, i.query.q);
  }

  @ApiRoute(R.listMembers)
  listMembers(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listMembers>) {
    return this.svc.listMembers(ctx, i.params.projectId);
  }

  @ApiRoute(R.grantMembership)
  grantMembership(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.grantMembership>) {
    return this.svc.grantMembership(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.revokeMembership)
  async revokeMembership(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.revokeMembership>) {
    await this.svc.revokeMembership(ctx, i.params.projectId, i.params.membershipId, i.body.reason);
    return { ok: true as const };
  }

  @ApiRoute(R.listWorkstreams)
  listWorkstreams(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listWorkstreams>) {
    return this.svc.listWorkstreams(ctx, i.params.projectId);
  }

  @ApiRoute(R.assignWorkstreamLead)
  assignWorkstreamLead(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.assignWorkstreamLead>) {
    return this.svc.assignWorkstreamLead(ctx, i.params.projectId, i.params.workstreamId, i.body.userId, i.body.expectedVersion);
  }

  @ApiRoute(R.auditTrail)
  activity(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.auditTrail>) {
    return this.svc.activity(ctx, i.params.projectId, i.query);
  }
}
