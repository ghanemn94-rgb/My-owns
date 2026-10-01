/**
 * Generates docs/architecture/data-dictionary.md and docs/architecture/erd.md from the LIVE database schema
 * (information_schema + pg_catalog), so documentation cannot drift from the migrations.
 * Usage: DATABASE_MIGRATION_URL=... pnpm --filter @hub/db docs
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const MODULES: Record<string, string[]> = {
  'Identity & access': ['organization', 'app_user', 'session', 'org_role_assignment', 'role_policy', 'project_membership'],
  'Portfolio & configuration': [
    'portfolio', 'program', 'project_template', 'project_template_version', 'project', 'project_template_migration',
    'legal_entity', 'project_entity', 'site', 'workstream', 'calendar_holiday', 'program_closure',
  ],
  Planning: [
    'task', 'milestone', 'deliverable', 'dependency', 'cross_project_dependency', 'raci_assignment', 'baseline_version',
    'change_request', 'risk', 'issue', 'assumption', 'raid_dependency', 'status_update', 'rag_override', 'record_dependency',
  ],
  Governance: [
    'committee', 'committee_membership', 'authority_matrix_version', 'meeting', 'agenda_item', 'attendance', 'recusal',
    'decision', 'vote', 'action_item', 'escalation', 'approval_request', 'approval_record', 'conflict_declaration', 'decision_use',
  ],
  Gates: ['gate_definition', 'gate_criterion', 'gate_assessment', 'criterion_assessment', 'waiver', 'status_dimension'],
  'Carve-out, NewCo, readiness & TSA': [
    'perimeter_item', 'transfer_record', 'agreement', 'consent', 'regulatory_requirement', 'tsa_service', 'readiness_check',
    'readiness_test_run', 'cutover_plan', 'agreement_version', 'perimeter_version', 'perimeter_category_review',
    'perimeter_impact_assessment', 'cutover_decision_record', 'operating_model_definition', 'tsa_extension_terms',
  ],
  Finance: [
    'financial_snapshot', 'budget_line', 'financial_model', 'financial_model_version', 'benefit', 'kpi', 'kpi_observation',
    'intercompany_reconciliation',
  ],
  'JV & diligence': [
    'partner', 'partner_room', 'room_grant', 'deal_scenario', 'negotiation_issue', 'diligence_request', 'diligence_finding',
    'closing', 'closing_condition', 'closing_deliverable', 'funds_flow_item', 'post_close_obligation', 'partner_criteria_set',
    'partner_assessment_entry', 'partner_conflict', 'partner_contact', 'partner_proposal', 'deal_scenario_version',
    'room_disclosure', 'room_access_event',
  ],
  'Documents & sources': ['document', 'document_version', 'evidence_link', 'source_record', 'source_claim', 'document_chunk'],
  'Reporting & imports': ['report_snapshot', 'report_export', 'bi_access_grant', 'import_batch', 'import_sheet', 'import_row', 'import_output'],
  'Platform, jobs & audit': [
    'notification', 'integration_connection', 'integration_execution_log', 'webhook_delivery', 'outbox_event', 'job', 'scheduled_job',
    'delivery_record', 'audit_event', 'record_version', 'audit_checkpoint',
  ],
  'AI runtime': ['ai_project_settings', 'ai_run', 'ai_proposal', 'ai_action_approval', 'ai_derived_artifact'],
};

/** Spec §14 entity names → tables (for the coverage table). */
const SPEC_ENTITIES: Record<string, string> = {
  Organization: 'organization', Portfolio: 'portfolio', Program: 'program', Project: 'project',
  ProjectTemplateVersion: 'project_template_version', ProjectMembership: 'project_membership', RolePolicy: 'role_policy',
  LegalEntity: 'legal_entity', Site: 'site', Workstream: 'workstream', Task: 'task', Milestone: 'milestone',
  Dependency: 'dependency', Deliverable: 'deliverable', EvidenceLink: 'evidence_link', BaselineVersion: 'baseline_version',
  ChangeRequest: 'change_request', Risk: 'risk', Issue: 'issue', Assumption: 'assumption', Committee: 'committee',
  CommitteeMembership: 'committee_membership', AuthorityMatrixVersion: 'authority_matrix_version', Meeting: 'meeting',
  AgendaItem: 'agenda_item', Attendance: 'attendance', Vote: 'vote', Decision: 'decision', ActionItem: 'action_item',
  GateDefinition: 'gate_definition', GateAssessment: 'gate_assessment', ApprovalRequest: 'approval_request',
  ApprovalRecord: 'approval_record', PerimeterItem: 'perimeter_item', TransferRecord: 'transfer_record',
  Agreement: 'agreement', Consent: 'consent', RegulatoryRequirement: 'regulatory_requirement', TSAService: 'tsa_service',
  ReadinessCheck: 'readiness_check', CutoverPlan: 'cutover_plan', FinancialSnapshot: 'financial_snapshot',
  BudgetLine: 'budget_line', Benefit: 'benefit', KPI: 'kpi', KPIObservation: 'kpi_observation', Partner: 'partner',
  DealScenario: 'deal_scenario', DiligenceRequest: 'diligence_request', DiligenceFinding: 'diligence_finding',
  ClosingCondition: 'closing_condition', ClosingDeliverable: 'closing_deliverable', PostCloseObligation: 'post_close_obligation',
  Document: 'document', DocumentVersion: 'document_version', SourceClaim: 'source_claim', ReportSnapshot: 'report_snapshot',
  Notification: 'notification', IntegrationConnection: 'integration_connection', AIRun: 'ai_run', AIProposal: 'ai_proposal',
  AIActionApproval: 'ai_action_approval', ScheduledJob: 'scheduled_job', AuditEvent: 'audit_event',
};

async function main() {
  const url = process.env.DATABASE_MIGRATION_URL ?? 'postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_dev';
  const pool = new Pool({ connectionString: url });
  const cols = await pool.query<{
    table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null;
  }>(`select table_name, column_name, data_type, udt_name, is_nullable, column_default
      from information_schema.columns where table_schema='public' order by table_name, ordinal_position`);
  const fks = await pool.query<{ table_name: string; name: string; cols: string; ref_table: string; ref_cols: string }>(`
    select c.conrelid::regclass::text as table_name, c.conname as name,
      (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum) as cols,
      c.confrelid::regclass::text as ref_table,
      (select string_agg(a.attname, ',' order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum) as ref_cols
    from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace order by 1, 2`);
  const rls = await pool.query<{ tablename: string; rowsecurity: boolean }>(`select tablename, rowsecurity from pg_tables where schemaname='public'`);
  const policies = await pool.query<{ tablename: string; policyname: string }>(`select tablename, policyname from pg_policies where schemaname='public'`);
  const enums = await pool.query<{ typname: string; labels: string }>(`
    select t.typname, string_agg(e.enumlabel, ', ' order by e.enumsortorder) labels
    from pg_type t join pg_enum e on e.enumtypid=t.oid group by t.typname order by t.typname`);
  const triggers = await pool.query<{ table_name: string; trigger_name: string }>(`
    select event_object_table table_name, trigger_name from information_schema.triggers where trigger_schema='public' group by 1, 2 order by 1`);
  await pool.end();

  const byTable = new Map<string, typeof cols.rows>();
  for (const c of cols.rows) (byTable.get(c.table_name) ?? byTable.set(c.table_name, []).get(c.table_name)!).push(c);
  const rlsMap = new Map(rls.rows.map((r) => [r.tablename, r.rowsecurity]));
  const polMap = new Map<string, string[]>();
  for (const p of policies.rows) (polMap.get(p.tablename) ?? polMap.set(p.tablename, []).get(p.tablename)!).push(p.policyname);
  const trgMap = new Map<string, string[]>();
  for (const t of triggers.rows) (trgMap.get(t.table_name) ?? trgMap.set(t.table_name, []).get(t.table_name)!).push(t.trigger_name);
  const fkMap = new Map<string, typeof fks.rows>();
  for (const f of fks.rows) (fkMap.get(f.table_name) ?? fkMap.set(f.table_name, []).get(f.table_name)!).push(f);

  const typeOf = (c: (typeof cols.rows)[number]) => (c.data_type === 'USER-DEFINED' ? `enum ${c.udt_name}` : c.data_type === 'ARRAY' ? `${c.udt_name}` : c.data_type);
  const assigned = new Set(Object.values(MODULES).flat());
  const unassigned = [...byTable.keys()].filter((t) => !assigned.has(t));
  if (unassigned.length) MODULES['Other'] = unassigned;

  let dd = `# Data dictionary\n\n> Generated from the live PostgreSQL schema by \`packages/db/src/cli/data-dictionary.ts\` — do not edit by hand.\n> Tables: ${byTable.size}. RLS enabled: ${[...rlsMap.values()].filter(Boolean).length}.\n\n`;
  dd += `## Spec §14 entity coverage\n\n| Spec entity | Table | Present |\n|---|---|---|\n`;
  for (const [e, t] of Object.entries(SPEC_ENTITIES)) dd += `| ${e} | \`${t}\` | ${byTable.has(t) ? 'yes' : '**MISSING**'} |\n`;
  dd += `\n## Enumerations\n\n| Enum | Values |\n|---|---|\n`;
  for (const e of enums.rows) dd += `| \`${e.typname}\` | ${e.labels} |\n`;
  for (const [mod, tables] of Object.entries(MODULES)) {
    dd += `\n## ${mod}\n`;
    for (const t of tables) {
      const cs = byTable.get(t);
      if (!cs) continue;
      dd += `\n### \`${t}\`\n\nRLS: ${rlsMap.get(t) ? `enabled (${(polMap.get(t) ?? []).join(', ')})` : '**not enabled** (infrastructure table — see ADR-0004)'}`;
      if (trgMap.get(t)) dd += ` · Triggers: ${trgMap.get(t)!.join(', ')}`;
      dd += `\n\n| Column | Type | Null | Default |\n|---|---|---|---|\n`;
      for (const c of cs) dd += `| \`${c.column_name}\` | ${typeOf(c)} | ${c.is_nullable === 'YES' ? 'yes' : 'no'} | ${c.column_default ? `\`${c.column_default.replace(/\|/g, '\\|').slice(0, 60)}\`` : ''} |\n`;
      const f = fkMap.get(t);
      if (f?.length) {
        dd += `\nForeign keys:\n\n`;
        for (const k of f) dd += `- \`${k.name}\`: (${k.cols}) → \`${k.ref_table}\`(${k.ref_cols})${k.cols.startsWith('project_id,') ? ' — composite project-scoped FK' : ''}\n`;
      }
    }
  }

  let erd = `# Entity-relationship diagrams\n\n> Generated from the live schema. One diagram per module; relationships shown are real foreign keys\n> (composite \`(project_id, x)\` keys are drawn once). Polymorphic links (evidence_link, approval_request,\n> audit_event, record_version, source_claim targets) are enforced in services, not by FKs.\n`;
  for (const [mod, tables] of Object.entries(MODULES)) {
    const set = new Set(tables.filter((t) => byTable.has(t)));
    if (set.size === 0) continue;
    erd += `\n## ${mod}\n\n\`\`\`mermaid\nerDiagram\n`;
    for (const t of set) {
      erd += `  ${t} {\n`;
      for (const c of byTable.get(t)!.slice(0, 14)) erd += `    ${(c.udt_name || 'text').replace(/[^a-z0-9_]/gi, '_')} ${c.column_name}\n`;
      if (byTable.get(t)!.length > 14) erd += `    more more_columns\n`;
      erd += `  }\n`;
    }
    const seen = new Set<string>();
    for (const t of set) {
      for (const k of fkMap.get(t) ?? []) {
        if (k.ref_table === 'project' || k.ref_table === 'organization') continue;
        const key = `${t}-${k.ref_table}-${k.cols}`;
        if (seen.has(key)) continue;
        seen.add(key);
        erd += `  ${k.ref_table} ||--o{ ${t} : "${k.cols.replace('project_id,', '')}"\n`;
      }
    }
    erd += `\`\`\`\n`;
  }
  const out = join(__dirname, '..', '..', '..', '..', 'docs', 'architecture');
  writeFileSync(join(out, 'data-dictionary.md'), dd);
  writeFileSync(join(out, 'erd.md'), erd);
  console.log(`wrote data-dictionary.md (${byTable.size} tables) and erd.md`);
  const missing = Object.entries(SPEC_ENTITIES).filter(([, t]) => !byTable.has(t));
  if (missing.length) {
    console.error('MISSING spec entities:', missing.map(([e]) => e).join(', '));
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
