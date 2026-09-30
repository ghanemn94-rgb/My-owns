import { Controller } from '@nestjs/common';
import { financeRoutes as R, RouteInput } from '@hub/contracts';
import { ApiRoute, Ctx, Input } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { SnapshotsService } from './snapshots.service';
import { BudgetService } from './budget.service';
import { ReconciliationsService } from './reconciliations.service';
import { ModelsService } from './models.service';
import { BenefitsService } from './benefits.service';
import { KpisService } from './kpis.service';
import { FinanceSummaryService } from './summary.service';

/** Finance & value routes — thin: every rule lives in the command services and packages/domain (finance.ts, money.ts). */
@Controller()
export class FinanceController {
  constructor(
    private readonly snapshots: SnapshotsService,
    private readonly budget: BudgetService,
    private readonly recon: ReconciliationsService,
    private readonly models: ModelsService,
    private readonly benefits: BenefitsService,
    private readonly kpis: KpisService,
    private readonly summary: FinanceSummaryService,
  ) {}

  // ---- summary / cost view / aggregation
  @ApiRoute(R.getFinanceSummary)
  getSummary(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getFinanceSummary>) {
    return this.summary.get(ctx, i.params.projectId);
  }

  @ApiRoute(R.getSeparationCosts)
  separationCosts(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getSeparationCosts>) {
    return this.budget.separationCosts(ctx, i.params.projectId);
  }

  @ApiRoute(R.aggregateFigures)
  aggregate(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.aggregateFigures>) {
    return this.snapshots.aggregate(ctx, i.params.projectId, i.body);
  }

  // ---- snapshots
  @ApiRoute(R.listSnapshots)
  listSnapshots(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listSnapshots>) {
    return this.snapshots.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getSnapshot)
  getSnapshot(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getSnapshot>) {
    return this.snapshots.get(ctx, i.params.projectId, i.params.snapshotId);
  }

  @ApiRoute(R.createSnapshot)
  createSnapshot(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createSnapshot>) {
    return this.snapshots.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.importSnapshots)
  importSnapshots(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.importSnapshots>) {
    return this.snapshots.importRows(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateSnapshot)
  updateSnapshot(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateSnapshot>) {
    return this.snapshots.update(ctx, i.params.projectId, i.params.snapshotId, i.body);
  }

  @ApiRoute(R.validateSnapshot)
  validateSnapshot(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.validateSnapshot>) {
    return this.snapshots.validate(ctx, i.params.projectId, i.params.snapshotId, i.body);
  }

  @ApiRoute(R.approveSnapshot)
  approveSnapshot(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approveSnapshot>) {
    return this.snapshots.approve(ctx, i.params.projectId, i.params.snapshotId, i.body);
  }

  @ApiRoute(R.rejectSnapshot)
  rejectSnapshot(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rejectSnapshot>) {
    return this.snapshots.reject(ctx, i.params.projectId, i.params.snapshotId, i.body);
  }

  @ApiRoute(R.reopenSnapshot)
  reopenSnapshot(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.reopenSnapshot>) {
    return this.snapshots.reopen(ctx, i.params.projectId, i.params.snapshotId, i.body);
  }

  @ApiRoute(R.createSnapshotReconciliation)
  createSnapshotReconciliation(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createSnapshotReconciliation>) {
    return this.recon.createForSnapshot(ctx, i.params.projectId, i.params.snapshotId, i.body);
  }

  // ---- budget lines
  @ApiRoute(R.listBudgetLines)
  listBudgetLines(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listBudgetLines>) {
    return this.budget.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getBudgetLine)
  getBudgetLine(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getBudgetLine>) {
    return this.budget.get(ctx, i.params.projectId, i.params.budgetLineId);
  }

  @ApiRoute(R.createBudgetLine)
  createBudgetLine(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createBudgetLine>) {
    return this.budget.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateBudgetLine)
  updateBudgetLine(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateBudgetLine>) {
    return this.budget.update(ctx, i.params.projectId, i.params.budgetLineId, i.body);
  }

  @ApiRoute(R.recordBudgetActuals)
  recordActuals(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordBudgetActuals>) {
    return this.budget.recordActuals(ctx, i.params.projectId, i.params.budgetLineId, i.body);
  }

  @ApiRoute(R.recordBudgetApproval)
  recordBudgetApproval(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordBudgetApproval>) {
    return this.budget.recordApproval(ctx, i.params.projectId, i.params.budgetLineId, i.body);
  }

  // ---- intercompany reconciliation
  @ApiRoute(R.listReconciliations)
  listReconciliations(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listReconciliations>) {
    return this.recon.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getReconciliation)
  getReconciliation(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getReconciliation>) {
    return this.recon.get(ctx, i.params.projectId, i.params.reconciliationId);
  }

  @ApiRoute(R.createReconciliation)
  createReconciliation(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createReconciliation>) {
    return this.recon.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateReconciliation)
  updateReconciliation(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateReconciliation>) {
    return this.recon.update(ctx, i.params.projectId, i.params.reconciliationId, i.body);
  }

  @ApiRoute(R.reconcile)
  reconcile(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.reconcile>) {
    return this.recon.reconcile(ctx, i.params.projectId, i.params.reconciliationId, i.body);
  }

  @ApiRoute(R.disputeReconciliation)
  dispute(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.disputeReconciliation>) {
    return this.recon.dispute(ctx, i.params.projectId, i.params.reconciliationId, i.body);
  }

  @ApiRoute(R.reopenReconciliation)
  reopenReconciliation(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.reopenReconciliation>) {
    return this.recon.reopen(ctx, i.params.projectId, i.params.reconciliationId, i.body);
  }

  // ---- business plans / valuation
  @ApiRoute(R.listModels)
  listModels(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listModels>) {
    return this.models.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getModel)
  getModel(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getModel>) {
    return this.models.get(ctx, i.params.projectId, i.params.modelId);
  }

  @ApiRoute(R.createModel)
  createModel(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createModel>) {
    return this.models.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateModel)
  updateModel(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateModel>) {
    return this.models.update(ctx, i.params.projectId, i.params.modelId, i.body);
  }

  @ApiRoute(R.createModelVersion)
  createModelVersion(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createModelVersion>) {
    return this.models.createVersion(ctx, i.params.projectId, i.params.modelId, i.body, false);
  }

  @ApiRoute(R.importModelVersion)
  importModelVersion(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.importModelVersion>) {
    return this.models.createVersion(ctx, i.params.projectId, i.params.modelId, i.body, true);
  }

  @ApiRoute(R.getModelVersion)
  getModelVersion(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getModelVersion>) {
    return this.models.getVersion(ctx, i.params.projectId, i.params.modelId, i.params.versionId);
  }

  @ApiRoute(R.checkModelVersion)
  checkModelVersion(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.checkModelVersion>) {
    return this.models.check(ctx, i.params.projectId, i.params.modelId, i.params.versionId, i.body);
  }

  @ApiRoute(R.validateModelVersion)
  validateModelVersion(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.validateModelVersion>) {
    return this.models.validate(ctx, i.params.projectId, i.params.modelId, i.params.versionId, i.body);
  }

  @ApiRoute(R.approveModelValues)
  approveModelValues(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approveModelValues>) {
    return this.models.approveValues(ctx, i.params.projectId, i.params.modelId, i.params.versionId, i.body);
  }

  @ApiRoute(R.rejectModelVersion)
  rejectModelVersion(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rejectModelVersion>) {
    return this.models.reject(ctx, i.params.projectId, i.params.modelId, i.params.versionId, i.body);
  }

  // ---- benefits
  @ApiRoute(R.listBenefits)
  listBenefits(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listBenefits>) {
    return this.benefits.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getBenefit)
  getBenefit(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getBenefit>) {
    return this.benefits.get(ctx, i.params.projectId, i.params.benefitId);
  }

  @ApiRoute(R.createBenefit)
  createBenefit(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createBenefit>) {
    return this.benefits.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.updateBenefit)
  updateBenefit(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateBenefit>) {
    return this.benefits.update(ctx, i.params.projectId, i.params.benefitId, i.body);
  }

  @ApiRoute(R.approveBenefit)
  approveBenefit(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.approveBenefit>) {
    return this.benefits.approve(ctx, i.params.projectId, i.params.benefitId, i.body);
  }

  @ApiRoute(R.startBenefitTracking)
  startTracking(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.startBenefitTracking>) {
    return this.benefits.startTracking(ctx, i.params.projectId, i.params.benefitId, i.body);
  }

  @ApiRoute(R.recordBenefitRealization)
  recordRealization(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordBenefitRealization>) {
    return this.benefits.recordRealization(ctx, i.params.projectId, i.params.benefitId, i.body);
  }

  @ApiRoute(R.verifyBenefit)
  verifyBenefit(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.verifyBenefit>) {
    return this.benefits.verify(ctx, i.params.projectId, i.params.benefitId, i.body);
  }

  @ApiRoute(R.rejectBenefitRealization)
  rejectRealization(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.rejectBenefitRealization>) {
    return this.benefits.rejectRealization(ctx, i.params.projectId, i.params.benefitId, i.body);
  }

  @ApiRoute(R.reviseBenefitDefinition)
  reviseBenefitDefinition(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.reviseBenefitDefinition>) {
    return this.benefits.reviseDefinition(ctx, i.params.projectId, i.params.benefitId, i.body);
  }

  @ApiRoute(R.cancelBenefit)
  cancelBenefit(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.cancelBenefit>) {
    return this.benefits.cancel(ctx, i.params.projectId, i.params.benefitId, i.body);
  }

  // ---- KPIs
  @ApiRoute(R.listKpis)
  listKpis(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listKpis>) {
    return this.kpis.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.getKpi)
  getKpi(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getKpi>) {
    return this.kpis.get(ctx, i.params.projectId, i.params.kpiId);
  }

  @ApiRoute(R.createKpi)
  createKpi(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createKpi>) {
    return this.kpis.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.recordKpiObservation)
  observe(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordKpiObservation>) {
    return this.kpis.observe(ctx, i.params.projectId, i.params.kpiId, i.body);
  }
}
