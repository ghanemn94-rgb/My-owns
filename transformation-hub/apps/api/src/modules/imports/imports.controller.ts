import { Controller, Headers } from '@nestjs/common';
import { importsRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input, RawBody } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { ImportsService } from './imports.service';

@Controller()
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  // `policy` is declared before `:batchId` so "/imports/policy" is never read as an id.
  @ApiRoute(R.importPolicy)
  policy() {
    return this.imports.policyInfo();
  }

  @ApiRoute(R.listImports)
  list(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listImports>) {
    return this.imports.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.uploadImport)
  upload(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.uploadImport>, @RawBody() bytes: Buffer, @Headers('x-filename') filename: string | undefined) {
    return this.imports.upload(ctx, i.params.projectId, { bytes, filename, query: i.query });
  }

  @ApiRoute(R.getImport)
  get(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getImport>) {
    return this.imports.get(ctx, i.params.projectId, i.params.batchId);
  }

  @ApiRoute(R.listImportRows)
  rows(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listImportRows>) {
    return this.imports.rows(ctx, i.params.projectId, i.params.batchId, i.query);
  }

  @ApiRoute(R.mapImport)
  map(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.mapImport>) {
    return this.imports.map(ctx, i.params.projectId, i.params.batchId, i.body);
  }

  @ApiRoute(R.submitImport)
  submit(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.submitImport>) {
    return this.imports.submit(ctx, i.params.projectId, i.params.batchId, i.body);
  }

  @ApiRoute(R.approveImport)
  approve(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approveImport>) {
    return this.imports.approve(ctx, i.params.projectId, i.params.batchId, i.body);
  }

  @ApiRoute(R.rejectImport)
  reject(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rejectImport>) {
    return this.imports.reject(ctx, i.params.projectId, i.params.batchId, i.body);
  }

  @ApiRoute(R.cancelImport)
  cancel(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.cancelImport>) {
    return this.imports.cancel(ctx, i.params.projectId, i.params.batchId, i.body);
  }

  @ApiRoute(R.rollbackImport)
  rollback(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rollbackImport>) {
    return this.imports.rollback(ctx, i.params.projectId, i.params.batchId, i.body);
  }
}
