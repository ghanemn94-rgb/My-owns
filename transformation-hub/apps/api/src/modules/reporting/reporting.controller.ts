import { Controller, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { reportingRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { attachmentDisposition } from '../../platform/helpers';
import { SnapshotsService } from './snapshots.service';
import { KpiCatalogueService } from './kpi-catalogue.service';
import { ExportsService } from './exports.service';
import { BiAccessService } from './bi-access.service';

@Controller()
export class ReportingController {
  constructor(
    private readonly snapshots: SnapshotsService,
    private readonly kpis: KpiCatalogueService,
    private readonly exports: ExportsService,
    private readonly bi: BiAccessService,
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

  @ApiRoute(R.requestReportExport)
  requestExport(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.requestReportExport>) {
    return this.exports.request(ctx, i.params.projectId, i.params.snapshotId, i.body);
  }

  @ApiRoute(R.listReportExports)
  listExports(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listReportExports>) {
    return this.exports.list(ctx, i.params.projectId, i.params.snapshotId, i.query);
  }

  @ApiRoute(R.getReportExport)
  getExport(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getReportExport>) {
    return this.exports.get(ctx, i.params.projectId, i.params.exportId);
  }

  @ApiRoute(R.downloadReportExport)
  async download(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.downloadReportExport>, @Res({ passthrough: true }) res: Response) {
    const f = await this.exports.download(ctx, i.params.projectId, i.params.exportId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(f.bytes, { type: f.mime, length: f.bytes.length, disposition: attachmentDisposition(f.filename) });
  }

  @ApiRoute(R.getBiAccess)
  getBiAccess(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getBiAccess>) {
    return this.bi.get(ctx, i.params.projectId);
  }

  @ApiRoute(R.grantBiAccess)
  grantBiAccess(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.grantBiAccess>) {
    return this.bi.grant(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.revokeBiAccess)
  revokeBiAccess(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.revokeBiAccess>) {
    return this.bi.revoke(ctx, i.params.projectId, i.params.grantId, i.body);
  }

  @ApiRoute(R.getKpiCatalogue)
  kpiCatalogue(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getKpiCatalogue>) {
    return this.kpis.catalogue(ctx, i.params.projectId);
  }
}
