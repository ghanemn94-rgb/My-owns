import { Module } from '@nestjs/common';
import { PlanningSupport } from './planning-support';
import { WbsService } from './wbs.service';
import { ScheduleService } from './schedule.service';
import { ChangeControlService } from './change-control.service';
import { RaidService } from './raid.service';
import { HealthService } from './health.service';
import { MyWorkService } from './my-work.service';
import { CrossProjectDependencyService } from './cross-project.service';
import { PrerequisiteService } from './prerequisites.service';
import { PlanningWbsController, PlanningScheduleController, PlanningChangeController, PlanningRaidController, PlanningHealthController, PlanningLinksController } from './planning.controller';
import { GatesModule } from '../gates/gates.module';

/**
 * WBS/tasks, milestones, deliverables, dependencies, schedule, baselines, change requests, RAID, status updates, my work.
 * Exports ChangeControlService (currentBaseline / isInApprovedBaseline / createChangeRequestFor) for other modules, and
 * ScheduleService / HealthService for reporting.
 */
@Module({
  // GatesModule: My Work asks the gates module for pending gate-level reviews (DOM-P2-16).
  imports: [GatesModule],
  controllers: [PlanningWbsController, PlanningScheduleController, PlanningChangeController, PlanningRaidController, PlanningHealthController, PlanningLinksController],
  providers: [PlanningSupport, WbsService, ScheduleService, ChangeControlService, RaidService, HealthService, MyWorkService, CrossProjectDependencyService, PrerequisiteService],
  exports: [ChangeControlService, ScheduleService, HealthService, WbsService],
})
export class PlanningModule {}
