import { Module } from '@nestjs/common';
import { ReportingController } from './reporting.controller';
import { ReportAccess } from './report-access';
import { SnapshotsService } from './snapshots.service';
import { KpiCatalogueService } from './kpi-catalogue.service';

/** Report snapshots, exports, KPI catalogue (spec §11, ADR-0011). Owner: integration-reporting-engineer. */
@Module({ controllers: [ReportingController], providers: [ReportAccess, SnapshotsService, KpiCatalogueService], exports: [] })
export class ReportingModule {}
