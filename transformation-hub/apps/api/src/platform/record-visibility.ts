import { sql, type SQL } from 'drizzle-orm';
import { financeDomainClearance } from '@hub/domain';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { PolicyService } from './policy.service';
import type { RequestContext } from './context';

/**
 * Record-level visibility in SQL (SEC-P1-03, SEC-P1R-02, SEC-P1R-04): "may the caller see the record of type T with id X?",
 * expressed as an EXISTS predicate so that lists AND counts can apply it inside the query.
 *
 * Each rule mirrors the owning module's own read rule:
 *  - records with their own `classification` / `room_id` columns use them;
 *  - records that INHERIT visibility resolve it through their parent (meeting / agenda item / membership / authority matrix
 *    → committee; action item → its decision, when linked; escalation → its decision, when raised about one; source claim
 *    → source record; document version → document; evidence link → its document AND its target);
 *  - polymorphic records (evidence link, AI proposal, approval request, waiver, RAG override) resolve their target;
 *  - with `reach: true`, workstream-structured records also apply the workstream reach of the module's read permission
 *    (ARCH-14), exactly like the module's list does with `policy.reachSql`.
 * Types without a rule have no record-level visibility attribute (the type-level permission is the whole rule).
 */
export interface RecordVisibilityOptions {
  /** Apply the workstream reach of the record type's read permission (callers that are not audit readers). */
  reach: boolean;
  /**
   * Type-level read permission for polymorphic targets: when given, a target whose type needs a permission the caller does
   * not hold in the project is invisible (e.g. evidence on a JV closing condition for a caller without `jv.deal.read`).
   */
  readPermission?: (type: string) => string | undefined;
}

/** A security domain whose roles may carry a higher clearance for that domain's records (access-matrix §2.3). */
type Domain = 'finance';
type Vis = (cols: { classification?: string; room?: string }, domain?: Domain) => SQL;
interface Env {
  vis: Vis;
  reach: (permission: string, workstreamExpr: string) => SQL;
  /** Visibility of a polymorphic (type, id) pair referenced from alias columns (depth-limited). */
  target: (typeExpr: string, idExpr: string, depth: number) => SQL;
  /** The caller holds the type-level read permission of `type` (always true without a `readPermission` resolver). */
  permitted: (type: string) => boolean;
}
/** A rule receives a fresh table alias, the id expression and the environment; it returns an EXISTS predicate. */
type Rule = (x: string, id: SQL, e: Env, depth: number) => SQL;

const raw = (s: string) => sql.raw(s);
const TRUE = sql`true`;

/**
 * A record with its own classification / room columns and optionally a workstream (reach of `ws` permission). `wsCol: null`
 * = a table without a workstream: only a project-wide grant of `ws` reaches it. `domain`: the classification is compared
 * with the domain clearance (e.g. finance: max(user clearance, domainClearance.finance of the project roles)).
 */
function own(table: string, o: { c?: boolean; r?: boolean; ws?: string; wsCol?: string | null; domain?: Domain }): Rule {
  return (x, id, e) => {
    const vis = o.c || o.r ? e.vis({ classification: o.c ? `${x}.classification` : undefined, room: o.r ? `${x}.room_id` : undefined }, o.domain) : TRUE;
    const reach = o.ws ? e.reach(o.ws, o.wsCol === null ? 'null::uuid' : `${x}.${o.wsCol ?? 'workstream_id'}`) : TRUE;
    return sql`exists (select 1 from ${sql.identifier(table)} ${raw(x)} where ${raw(x)}.id = ${id} and ${vis} and ${reach})`;
  };
}

/** A child whose visibility is its committee's classification (meeting, agenda item, membership, authority matrix). */
function viaCommittee(table: string): Rule {
  return (x, id, e) =>
    sql`exists (select 1 from ${sql.identifier(table)} ${raw(x)} join committee ${raw(`${x}c`)} on ${raw(`${x}c`)}.id = ${raw(x)}.committee_id where ${raw(x)}.id = ${id} and ${e.vis({ classification: `${x}c.classification` })})`;
}

/** A child whose visibility is its parent's own classification (parent referenced by `fkCol`). */
function viaParent(table: string, fkCol: string, parent: string): Rule {
  return (x, id, e) =>
    sql`exists (select 1 from ${sql.identifier(table)} ${raw(x)} join ${sql.identifier(parent)} ${raw(`${x}p`)} on ${raw(`${x}p`)}.id = ${raw(x)}.${sql.identifier(fkCol)} where ${raw(x)}.id = ${id} and ${e.vis({ classification: `${x}p.classification` })})`;
}

/** A polymorphic record: visible when its (type, id) target is visible. */
function viaTarget(table: string, typeCol: string, idCol: string): Rule {
  return (x, id, e, depth) =>
    sql`exists (select 1 from ${sql.identifier(table)} ${raw(x)} where ${raw(x)}.id = ${id} and ${e.target(`${x}.${typeCol}`, `${x}.${idCol}`, depth + 1)})`;
}

const PLAN = 'planning.plan.read';
const CARVEOUT = 'carveout.register.read';
const READINESS = 'readiness.register.read';
const FIN = 'finance.record.read';

/** Every entity type that carries a record-level visibility rule (activity feed types and evidence target types). */
const RULES: Record<string, Rule> = {
  // own classification / room
  agreement: own('agreement', { c: true }),
  // finance records: finance-domain clearance and the reach of finance.record.read, exactly like FinanceSupport.visibleSql
  budget_line: own('budget_line', { c: true, ws: FIN, domain: 'finance' }),
  financial_snapshot: own('financial_snapshot', { c: true, ws: FIN, domain: 'finance' }),
  financial_model: own('financial_model', { c: true, ws: FIN, wsCol: null, domain: 'finance' }),
  financial_model_version: own('financial_model_version', { c: true, ws: FIN, wsCol: null, domain: 'finance' }),
  intercompany_reconciliation: own('intercompany_reconciliation', { c: true, ws: FIN, wsCol: null, domain: 'finance' }),
  benefit: own('benefit', { c: true, ws: FIN, domain: 'finance' }),
  kpi: own('kpi', { c: true, ws: FIN, wsCol: null, domain: 'finance' }),
  committee: own('committee', { c: true }),
  consent: own('consent', { c: true }),
  deal_scenario: own('deal_scenario', { c: true }),
  decision: own('decision', { c: true }),
  diligence_finding: own('diligence_finding', { c: true, r: true }), // room derived from its DD request (ARCH-22)
  diligence_request: own('diligence_request', { c: true, r: true }),
  document: own('document', { c: true, r: true }),
  negotiation_issue: own('negotiation_issue', { c: true }),
  partner: own('partner', { c: true }),
  partner_room: own('partner_room', { c: true }),
  perimeter_item: own('perimeter_item', { c: true, ws: CARVEOUT }),
  transfer: own('perimeter_item', { c: true, ws: CARVEOUT }), // evidence target: transfer status lives on the perimeter item
  regulatory_requirement: own('regulatory_requirement', { c: true }),
  report_snapshot: own('report_snapshot', { c: true }),
  room_grant: own('room_grant', { r: true }),
  room_disclosure: own('room_disclosure', { r: true }),
  room_access_event: own('room_access_event', { r: true }),
  partner_proposal: own('partner_proposal', { c: true }),
  source_record: own('source_record', { c: true }),
  tsa_service: own('tsa_service', { c: true, ws: READINESS }),
  // workstream-structured records (reach only)
  workstream: own('workstream', { ws: PLAN, wsCol: 'id' }),
  task: own('task', { ws: PLAN }),
  milestone: own('milestone', { ws: PLAN }),
  deliverable: own('deliverable', { ws: PLAN }),
  risk: own('risk', { ws: PLAN }),
  issue: own('issue', { ws: PLAN }),
  assumption: own('assumption', { ws: PLAN }),
  raid_dependency: own('raid_dependency', { ws: PLAN }),
  status_update: own('status_update', { ws: PLAN }),
  readiness_check: own('readiness_check', { ws: READINESS }),
  cutover_plan: own('cutover_plan', { ws: READINESS }),
  // inherited from a parent record
  meeting: viaCommittee('meeting'),
  agenda_item: viaCommittee('agenda_item'),
  committee_membership: viaCommittee('committee_membership'),
  authority_matrix_version: viaCommittee('authority_matrix_version'),
  action_item: (x, id, e) =>
    sql`exists (select 1 from action_item ${raw(x)} left join decision ${raw(`${x}d`)} on ${raw(`${x}d`)}.id = ${raw(x)}.decision_id where ${raw(x)}.id = ${id} and (${raw(x)}.decision_id is null or ${e.vis({ classification: `${x}d.classification` })}))`,
  escalation: (x, id, e) =>
    sql`exists (select 1 from escalation ${raw(x)} left join decision ${raw(`${x}d`)} on ${raw(x)}.source_type = 'decision' and ${raw(`${x}d`)}.id = ${raw(x)}.source_id where ${raw(x)}.id = ${id} and (${raw(x)}.source_type <> 'decision' or ${e.vis({ classification: `${x}d.classification` })}))`,
  // partner children inherit the partner's classification; scenario versions their scenario's
  partner_conflict: viaParent('partner_conflict', 'partner_id', 'partner'),
  partner_contact: viaParent('partner_contact', 'partner_id', 'partner'),
  partner_assessment_entry: viaParent('partner_assessment_entry', 'partner_id', 'partner'),
  deal_scenario_version: viaParent('deal_scenario_version', 'scenario_id', 'deal_scenario'),
  source_claim: (x, id, e) =>
    sql`exists (select 1 from source_claim ${raw(x)} join source_record ${raw(`${x}s`)} on ${raw(`${x}s`)}.id = ${raw(x)}.source_id where ${raw(x)}.id = ${id} and ${e.vis({ classification: `${x}s.classification` })})`,
  document_version: (x, id, e) =>
    sql`exists (select 1 from document_version ${raw(x)} join document ${raw(`${x}d`)} on ${raw(`${x}d`)}.id = ${raw(x)}.document_id where ${raw(x)}.id = ${id} and ${e.vis({ classification: `${x}d.classification`, room: `${x}.room_id` })})`,
  // an evidence link: its own (document-derived) room, its document, and its target
  evidence_link: (x, id, e, depth) =>
    sql`exists (select 1 from evidence_link ${raw(x)} left join document ${raw(`${x}d`)} on ${raw(`${x}d`)}.id = ${raw(x)}.document_id
      where ${raw(x)}.id = ${id} and ${e.vis({ room: `${x}.room_id` })}
        and (${raw(x)}.document_id is null or ${e.vis({ classification: `${x}d.classification`, room: `${x}d.room_id` })})
        and ${e.target(`${x}.target_type`, `${x}.target_id`, depth + 1)})`,
  // a non-schedule prerequisite (DOM-P2-18): visible when its successor task / milestone (workstream reach) AND its
  // predecessor are — a decision / agreement by classification, an approval request / evidence link by their own rules
  // (both polymorphic, so they are resolved directly rather than through `target`); a gate definition has no record rule
  record_dependency: (x, id, e, depth) => {
    // SEC-P2-01: each predecessor needs its type-level read permission (decision → governance.decision.read, agreement →
    // carveout.register.read, gate → gates.gate.read) on top of its own record rule — never classification alone.
    const pred = (t: string) => (e.permitted(t) ? RULES[t]!(`${x}q`, raw(`${x}.predecessor_id`), e, depth + 1) : sql`false`);
    const gate = e.permitted('gate_definition') ? TRUE : sql`false`;
    return sql`exists (select 1 from record_dependency ${raw(x)} where ${raw(x)}.id = ${id}
      and ${e.target(`${x}.successor_type::text`, `${x}.successor_id`, depth + 1)}
      and (case ${raw(x)}.predecessor_type when 'decision' then ${pred('decision')} when 'agreement' then ${pred('agreement')}
        when 'approval_request' then ${pred('approval_request')} when 'evidence_link' then ${pred('evidence_link')}
        when 'gate' then ${gate} else false end))`;
  },
  // polymorphic records: visible when their target is
  ai_proposal: viaTarget('ai_proposal', 'target_type', 'target_id'),
  approval_request: viaTarget('approval_request', 'subject_type', 'subject_id'),
  waiver: viaTarget('waiver', 'target_type', 'target_id'),
  rag_override: viaTarget('rag_override', 'entity_type', 'entity_id'),
};

/** Types that reference other records polymorphically (never used as a target of another polymorphic record). */
const POLYMORPHIC = new Set(['evidence_link', 'ai_proposal', 'approval_request', 'waiver', 'rag_override']);

export class RecordVisibility {
  /** Entity types with a record-level rule. */
  static readonly TYPES: readonly string[] = Object.keys(RULES);

  constructor(
    private readonly policy: PolicyService,
    private readonly ctx: RequestContext,
    private readonly projectId: string,
    private readonly opts: RecordVisibilityOptions,
  ) {}

  static hasRule(type: string): boolean {
    return Object.prototype.hasOwnProperty.call(RULES, type);
  }

  private env(): Env {
    return {
      vis: (cols, domain) =>
        this.policy.visibilitySql(domain ? this.domainCtx(domain) : this.ctx, this.projectId, {
          classification: cols.classification ? (raw(cols.classification) as unknown as PgColumn) : undefined,
          room: cols.room ? (raw(cols.room) as unknown as PgColumn) : undefined,
        }),
      reach: (permission, wsExpr) => (this.opts.reach ? this.policy.reachSql(this.ctx, permission, this.projectId, raw(wsExpr)) : TRUE),
      target: (typeExpr, idExpr, depth) => this.targetSql(raw(typeExpr), raw(idExpr), depth),
      permitted: (type) => this.permitted(type),
    };
  }

  /** The caller with the clearance of a security domain (finance: FinanceSupport.fx — project-wide roles only). */
  private domainCtx(domain: Domain): RequestContext {
    const p = this.ctx.principal;
    const scope = p.kind === 'service' ? undefined : p.projects.get(this.projectId);
    if (!scope || domain !== 'finance') return this.ctx;
    const clearance = financeDomainClearance(p.clearance, scope.roles);
    return clearance === p.clearance ? this.ctx : { ...this.ctx, principal: { ...p, clearance } };
  }

  /** The record `type`/`id` is visible (TRUE for a type without a record-level rule). */
  exists(type: string, id: SQL | PgColumn, depth = 0): SQL {
    // SEC-P2-01: with a `readPermission` resolver the type-level read permission applies to direct checks too.
    if (!this.permitted(type)) return sql`false`;
    const rule = RULES[type];
    if (!rule) return TRUE;
    return rule(`rv${depth}`, sql`${id}`, this.env(), depth);
  }

  /**
   * Visibility of a (type, id) pair for EVERY type, as one `CASE type WHEN 'T' THEN <rule for T> … ELSE true END`
   * (activity feed rows). Only the matching branch runs per row — a primary-key probe — instead of one hashed sub-plan per
   * type over whole tables (45 `type <> T OR EXISTS …` clauses took ~38 s on the test data; the CASE form is linear).
   */
  caseSql(typeCol: SQL | PgColumn, idCol: SQL | PgColumn, types: readonly string[] = RecordVisibility.TYPES): SQL {
    const branches = types.filter((t) => RULES[t]).map((t) => sql` when ${t} then ${this.exists(t, idCol)}`);
    if (!branches.length) return TRUE;
    return sql`(case ${typeCol}${sql.join(branches, sql``)} else true end)`;
  }

  /**
   * The polymorphic (type, id) pair is visible. Types with a rule: the rule, and only when the caller holds the type's read
   * permission (`readPermission`). Types without a rule: visible unless the caller lacks their read permission. A null
   * type (no target) is visible. One CASE, so only the target's own branch is evaluated.
   */
  targetSql(typeCol: SQL | PgColumn, idCol: SQL | PgColumn, depth = 0): SQL {
    if (depth > 2) return sql`false`; // defensive: polymorphic chains are never deeper than one level
    const branches: SQL[] = [];
    for (const t of Object.keys(RULES)) {
      if (POLYMORPHIC.has(t)) branches.push(sql` when ${t} then false`); // never a target of another polymorphic record
      else branches.push(sql` when ${t} then ${this.permitted(t) ? this.exists(t, idCol, depth) : sql`false`}`);
    }
    for (const t of UNRULED_TARGET_TYPES) if (!this.permitted(t)) branches.push(sql` when ${t} then false`);
    return sql`(case ${typeCol}${sql.join(branches, sql``)} else true end)`;
  }

  /** Type-level read permission of a target type (always true when no `readPermission` resolver was given). */
  private permitted(type: string): boolean {
    const perm = this.opts.readPermission?.(type);
    return !perm || this.policy.canInProject(this.ctx, perm, this.projectId);
  }
}

/** Polymorphic target types that have no record-level rule (visibility = type-level read permission only). */
const UNRULED_TARGET_TYPES = ['gate_criterion', 'closing_condition', 'legal_entity', 'post_close_obligation', 'closing_deliverable', 'project', 'gate_assessment', 'document_chunk', 'baseline_version', 'change_request', 'perimeter_version'];
