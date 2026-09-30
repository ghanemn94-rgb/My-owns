import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceSupport } from './finance.support';
import { SnapshotsService } from './snapshots.service';
import { BudgetService } from './budget.service';
import { ReconciliationsService } from './reconciliations.service';
import { ModelsService } from './models.service';
import { BenefitsService } from './benefits.service';
import { KpisService } from './kpis.service';
import { FinanceSummaryService } from './summary.service';

const providers = [FinanceSupport, SnapshotsService, BudgetService, ReconciliationsService, ModelsService, BenefitsService, KpisService, FinanceSummaryService];

/**
 * Financial snapshots, budget, separation costs, intercompany reconciliation, business plan / valuation references,
 * benefits and KPIs (spec §7.5). Owner: see docs/architecture/module-guide.md (file ownership table). Exports the
 * services so reporting / imports / AI retrieval reuse the same scoped reads and the model-output import command.
 */
@Module({ controllers: [FinanceController], providers, exports: providers })
export class FinanceModule {}
