import { Controller, Headers } from '@nestjs/common';
import { integrationsRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input, RawBody } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { IntegrationsService } from './integrations.service';

@Controller()
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @ApiRoute(R.listIntegrations)
  async list(@Ctx() ctx: RequestContext) {
    return { items: await this.integrations.list(ctx, true), egressAllowlist: this.integrations.allowlist() };
  }

  @ApiRoute(R.listProjectIntegrations)
  async listForProject(@Ctx() ctx: RequestContext) {
    return { items: await this.integrations.list(ctx, false) };
  }

  @ApiRoute(R.configureIntegration)
  configure(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.configureIntegration>) {
    return this.integrations.configure(ctx, i.params.adapterKey, i.body);
  }

  @ApiRoute(R.testIntegration)
  test(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.testIntegration>) {
    return this.integrations.test(ctx, i.params.adapterKey, i.body);
  }

  @ApiRoute(R.enableIntegration)
  enable(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.enableIntegration>) {
    return this.integrations.enable(ctx, i.params.adapterKey, i.body);
  }

  @ApiRoute(R.disableIntegration)
  disable(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.disableIntegration>) {
    return this.integrations.disable(ctx, i.params.adapterKey, i.body);
  }

  @ApiRoute(R.integrationLogs)
  logs(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.integrationLogs>) {
    return this.integrations.logs(ctx, i.params.adapterKey, i.query);
  }

  @ApiRoute(R.integrationDeliveries)
  deliveries(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.integrationDeliveries>) {
    return this.integrations.deliveries(ctx, i.params.adapterKey, i.query);
  }

  @ApiRoute(R.retryDelivery)
  retry(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.retryDelivery>) {
    return this.integrations.retry(ctx, i.params.adapterKey, i.params.deliveryRowId);
  }

  @ApiRoute(R.receiveWebhook)
  receive(
    @Ctx() ctx: RequestContext,
    @Input() i: RouteInput<typeof R.receiveWebhook>,
    @RawBody() raw: Buffer,
    @Headers('x-hub-timestamp') timestamp: string | undefined,
    @Headers('x-hub-delivery-id') deliveryId: string | undefined,
    @Headers('x-hub-signature') signature: string | undefined,
  ) {
    return this.integrations.receive(ctx, i.params.adapterKey, raw, { timestamp, deliveryId, signature });
  }
}
