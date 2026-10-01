import { Injectable } from '@nestjs/common';
import { KPI_SOURCE_PERMISSION, type KpiCalculatorKey } from '@hub/domain';
import type { KpiCatalogueEntry } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { ReportAccess } from './report-access';
import { SnapshotsService } from './snapshots.service';
import { KpiEngine, templateKpiDefinitions, visibleKpis } from './collect/kpi.collector';

/**
 * Proposed KPI catalogue (spec §11, REQ-RPT-012..014): the project's KPI definitions (instantiated from the template —
 * every attribute: definition, formula, unit, period, owner role, source, target, thresholds, direction, frequency, last
 * verified) with a value computed NOW from the records the caller may read. Nothing is stored as history; a KPI whose
 * source has no records stays a proposal with no value, and a source the caller cannot read reveals nothing.
 */
@Injectable()
export class KpiCatalogueService {
  constructor(
    private readonly access: ReportAccess,
    private readonly snapshots: SnapshotsService,
  ) {}

  async catalogue(ctx: RequestContext, projectId: string) {
    this.access.assertProjectReader(ctx, projectId, 'reports.report.generate');
    const g = await this.snapshots.gen(ctx, projectId, null);
    const defs = await visibleKpis(g);
    const ar = await templateKpiDefinitions(g);
    const engine = new KpiEngine(g);
    const items: KpiCatalogueEntry[] = [];
    for (const k of defs) {
      const v = await engine.compute(k.key);
      const tpl = ar.get(k.key);
      const state = v.access === 'restricted' ? 'restricted' : v.access === 'no_calculator' ? 'no_calculator' : v.state;
      const shown = state === 'computed';
      items.push({
        kpiId: k.id,
        key: k.key,
        name: k.name,
        nameAr: k.nameAr,
        definition: k.definition,
        definitionAr: tpl && tpl.ar && tpl.en === k.definition ? tpl.ar : null,
        formula: k.formula,
        unit: k.unit,
        period: k.period,
        ownerRole: k.ownerRole,
        source: k.source,
        target: k.target,
        thresholds: k.thresholds,
        direction: k.direction,
        frequency: k.frequency,
        lastVerifiedAt: k.lastVerifiedAt ? k.lastVerifiedAt.toISOString() : null,
        verificationStatus: k.verificationStatus,
        classification: k.classification,
        isProposal: k.verificationStatus !== 'confirmed',
        isDemo: g.project.isDemo,
        current: {
          state,
          value: shown ? v.value : null,
          numerator: shown ? v.numerator : null,
          denominator: shown ? v.denominator : null,
          notes: state === 'restricted' ? [] : v.notes,
          sourcePermission: (KPI_SOURCE_PERMISSION as Record<string, string>)[k.key as KpiCalculatorKey] ?? null,
        },
      });
    }
    return { asOfLocalDate: g.today, definitionsReadable: this.access.policy.permissionReach(ctx, 'finance.record.read', projectId).all, items };
  }
}
