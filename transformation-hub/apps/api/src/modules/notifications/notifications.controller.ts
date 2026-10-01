import { Controller } from '@nestjs/common';
import { notificationsRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { NotificationsService } from './notifications.service';

@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // Fixed paths are declared before `:notificationId` routes.
  @ApiRoute(R.unreadCount)
  unread(@Ctx() ctx: RequestContext) {
    return this.notifications.unreadCount(ctx);
  }

  @ApiRoute(R.markAllRead)
  readAll(@Ctx() ctx: RequestContext) {
    return this.notifications.markAllRead(ctx);
  }

  @ApiRoute(R.listMyNotifications)
  list(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listMyNotifications>) {
    return this.notifications.list(ctx, i.query);
  }

  @ApiRoute(R.markRead)
  read(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.markRead>) {
    return this.notifications.markRead(ctx, i.params.notificationId);
  }

  @ApiRoute(R.myChannels)
  channels(@Ctx() ctx: RequestContext) {
    return this.notifications.channels(ctx);
  }
}
