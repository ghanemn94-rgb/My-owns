import { Module } from '@nestjs/common';
import { GovernanceController } from './governance.controller';
import { GovernanceSupport } from './governance.support';
import { CommitteesService } from './committees.service';
import { MeetingsService } from './meetings.service';
import { DecisionsService } from './decisions.service';
import { ActionsService } from './actions.service';

const providers = [GovernanceSupport, CommitteesService, MeetingsService, DecisionsService, ActionsService];

/** Committees, authority matrix, meetings, agenda, decisions, votes, actions, escalations. Owner: see docs/architecture/module-guide.md (file ownership table). */
@Module({ controllers: [GovernanceController], providers, exports: providers })
export class GovernanceModule {}
