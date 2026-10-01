import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { ReportingController } from './reporting.controller';
import { ReportAccess } from './report-access';
import { SnapshotsService } from './snapshots.service';
import { KpiCatalogueService } from './kpi-catalogue.service';
import { ExportsService } from './exports.service';
import { ReportRenderers } from './render/renderers';
import { BiAccessService } from './bi-access.service';

/** Report snapshots, exports, KPI catalogue (spec §11, ADR-0011). Owner: integration-reporting-engineer. */
@Module({
  imports: [DocumentsModule], // object-storage port for the rendered files
  controllers: [ReportingController],
  providers: [ReportAccess, SnapshotsService, KpiCatalogueService, ExportsService, ReportRenderers, BiAccessService],
  exports: [ExportsService, SnapshotsService],
})
export class ReportingModule {}
