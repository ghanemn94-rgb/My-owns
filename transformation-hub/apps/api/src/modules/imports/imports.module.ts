import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { PlanningModule } from '../planning/planning.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportPlanner } from './import-planner';
import { ImportApplier } from './import-apply';

/**
 * Excel / CSV / document import wizard and the safe file pipeline (spec §17). Uses the documents module's safe upload
 * path and object-storage port, and the planning module's change-control entry point for governed records (REQ-INT-015).
 * Owner: integration-reporting-engineer.
 */
@Module({
  imports: [DocumentsModule, PlanningModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportPlanner, ImportApplier],
  exports: [ImportsService],
})
export class ImportsModule {}
