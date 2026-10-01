import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * In-app notifications produced by the worker from outbox events (REQ-PLT-008), re-authorised at delivery and at read time
 * (REQ-INT-012); e-mail / Teams are connector-backed channels that stay Not configured. Owner: integration-reporting-engineer.
 */
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
