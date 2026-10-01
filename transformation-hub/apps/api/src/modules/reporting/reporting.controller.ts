import { Controller } from '@nestjs/common';
import { reportingRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { SnapshotsService } from './snapshots.service';
import { KpiCatalogueService } from './kpi-catalogue.service';

@Controller()
export class ReportingController {
  constructor(
    private readonly snapshots: SnapshotsService,
    private readonly kpis: KpiCatalogueService,
  ) {}

  @ApiRoute(R.generateReport)
  generate(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.generateReport>) {
    return this.snapshots.generate(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.listReportSnapshots)
  list(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listReportSnapshots>) {
    return this.snapshots.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getReportSnapshot)
  get(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getReportSnapshot>) {
    return this.snapshots.get(ctx, i.params.projectId, i.params.snapshotId);
  }

  @ApiRoute(R.diffReportSnapshot)
  diff(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.diffReportSnapshot>) {
    return this.snapshots.diff(ctx, i.params.projectId, i.params.snapshotId, i.query.against);
  }

  @ApiRoute(R.getKpiCatalogue)
  kpiCatalogue(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getKpiCatalogue>) {
    return this.kpis.catalogue(ctx, i.params.projectId);
  }
}
