import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  CLAIM_TARGET_FIELDS,
  IMPORT_COMPARED_FIELDS,
  IMPORT_TARGET_FIELDS,
  checkImportRow,
  diffFields,
  governedReason,
  normalizeKey,
  rowIsBlank,
  serverMessage,
  type ImportCell,
  type ImportRowAction,
  type ImportTarget,
  type ImportValue,
  type ServerMessage,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import type { RequestContext } from '../../platform/context';
import { sha256Hex } from '../../platform/ids';

export interface PlanRow {
  rowNo: number;
  raw: Record<string, ImportCell | null>;
  values: Record<string, ImportValue>;
  action: ImportRowAction;
  errors: ServerMessage[];
  warnings: ServerMessage[];
  notes: ServerMessage[];
  formulaFields: string[];
  matchType: string | null;
  matchId: string | null;
  matchCode: string | null;
  governedReason: string | null;
  diff: { field: string; from: ImportValue; to: ImportValue }[];
  duplicateOfRow: number | null;
  /** Resolved references used when the row is applied (never shown). */
  refs: { workstreamId?: string | null; targetType?: string | null; targetId?: string | null };
}

/** Column letters for headerless columns (A, B, …, AA). */
export function columnLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Header strings of a row: trimmed text; empty → "Column <letter>"; repeated names get " (2)", " (3)" … */
export function headersOf(row: (ImportCell | null)[] | undefined): string[] {
  const seen = new Map<string, number>();
  return (row ?? []).map((c, i) => {
    let h = c && c.v !== null && c.v !== undefined ? String(c.v).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    if (!h) h = `Column ${columnLetter(i)}`;
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n > 1 ? `${h} (${n})` : h;
  });
}

/** The previewed row plan the approval binds to (actions, values, matches, differences). */
export function previewHash(rows: PlanRow[]): string {
  return sha256Hex(JSON.stringify(rows.map((r) => [r.rowNo, r.action, r.values, r.matchId, r.diff, r.governedReason, r.duplicateOfRow, r.refs.targetId ?? null, r.refs.workstreamId ?? null])));
}

const asText = (v: ImportValue | undefined) => (v === null || v === undefined ? null : String(v));

/**
 * Builds the preview / comparison of a batch (REQ-INT-001, REQ-SRC-009): checks every mapped row (values only), detects
 * duplicates within the file and against the register, and plans what an approval would produce — never an update of an
 * existing record (REQ-INT-015). Matching uses the VIEWER's access (the uploader, also when the approval re-plans): a record
 * the uploader cannot read is never revealed through a match; uniqueness of new codes is checked against every record.
 */
@Injectable()
export class ImportPlanner {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
  ) {}

  async plan(viewer: RequestContext, projectId: string, target: ImportTarget, rows: (ImportCell | null)[][], headerRow: number, mapping: Record<string, string>, headers: string[]): Promise<PlanRow[]> {
    const colOf = new Map(Object.entries(mapping).map(([field, header]) => [field, headers.indexOf(header)]));
    const prepared: PlanRow[] = [];
    for (let i = headerRow; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const cells: Record<string, ImportCell | undefined> = {};
      const raw: Record<string, ImportCell | null> = {};
      for (const f of IMPORT_TARGET_FIELDS[target]) {
        const ci = colOf.get(f.key);
        const c = ci === undefined || ci < 0 ? undefined : (r[ci] ?? undefined);
        cells[f.key] = c ?? undefined;
        if (ci !== undefined) raw[f.key] = c ?? null;
      }
      if (rowIsBlank(cells)) continue;
      const chk = checkImportRow(target, cells);
      prepared.push({
        rowNo: i + 1,
        raw,
        values: chk.values,
        action: chk.errors.length ? 'error' : 'create',
        errors: chk.errors,
        warnings: chk.warnings,
        notes: [],
        formulaFields: chk.formulaFields,
        matchType: null,
        matchId: null,
        matchCode: null,
        governedReason: null,
        diff: [],
        duplicateOfRow: null,
        refs: {},
      });
    }
    if (target === 'risk') await this.planRisks(viewer, projectId, prepared);
    else if (target === 'task') await this.planTasks(viewer, projectId, prepared);
    else if (target === 'decision') await this.planDecisions(viewer, projectId, prepared);
    else if (target === 'source_claims') await this.planClaims(viewer, projectId, prepared);
    return prepared;
  }

  /** Document imports: every extracted paragraph becomes an unverified claim for review (REQ-INT-004/005). */
  planDocument(rows: (ImportCell | null)[][]): PlanRow[] {
    const out: PlanRow[] = [];
    rows.forEach((r, i) => {
      const chk = checkImportRow('document_claims', { text: r[0] ?? undefined });
      out.push({
        rowNo: i + 1,
        raw: { text: r[0] ?? null },
        values: chk.values,
        action: chk.errors.length ? 'error' : 'create',
        errors: chk.errors,
        warnings: chk.warnings,
        notes: chk.errors.length ? [] : [serverMessage('imports.row.document_claim')],
        formulaFields: [],
        matchType: null,
        matchId: null,
        matchCode: null,
        governedReason: null,
        diff: [],
        duplicateOfRow: null,
        refs: {},
      });
    });
    return out;
  }

  // -------------------------------------------------------------------------------------------------- helpers
  private markDuplicate(rows: PlanRow[], keyOf: (r: PlanRow) => string | null, keyName: string) {
    const seen = new Map<string, number>();
    for (const r of rows) {
      if (r.action === 'error') continue;
      const k = keyOf(r);
      if (!k) continue;
      const first = seen.get(k);
      if (first !== undefined) {
        r.action = 'error';
        r.duplicateOfRow = first;
        r.errors.push(serverMessage('imports.row.duplicate_in_batch', { key: keyName, row: first }));
      } else seen.set(k, r.rowNo);
    }
  }

  private async workstreams(projectId: string) {
    const rows = await this.db.tx().select({ id: schema.workstream.id, code: schema.workstream.code }).from(schema.workstream).where(eq(schema.workstream.projectId, projectId));
    return new Map(rows.map((w) => [w.code.toLowerCase(), w.id]));
  }

  private resolveWorkstream(r: PlanRow, ws: Map<string, string>): boolean {
    const code = asText(r.values['workstream']);
    if (!code) return true;
    const id = ws.get(code.toLowerCase());
    if (!id) {
      r.action = 'error';
      r.errors.push(serverMessage('imports.row.workstream_unknown', { code }));
      return false;
    }
    r.refs.workstreamId = id;
    return true;
  }

  // -------------------------------------------------------------------------------------------------- risks
  private async planRisks(viewer: RequestContext, projectId: string, rows: PlanRow[]) {
    const R = schema.risk;
    const visible = await this.db
      .tx()
      .select({ id: R.id, code: R.code, title: R.title, description: R.description, probability: R.probability, impact: R.impact, dueDate: R.dueDate, responseStrategy: R.responseStrategy })
      .from(R)
      .where(and(eq(R.projectId, projectId), this.policy.reachSql(viewer, 'planning.plan.read', projectId, R.workstreamId)));
    const byCode = new Map(visible.map((x) => [x.code.toLowerCase(), x]));
    const byTitle = new Map(visible.map((x) => [normalizeKey(x.title), x]));
    const ws = await this.workstreams(projectId);
    this.markDuplicate(rows, (r) => (asText(r.values['code']) ? `code:${asText(r.values['code'])!.toLowerCase()}` : r.values['title'] ? `title:${normalizeKey(String(r.values['title']))}` : null), 'code / title');
    for (const r of rows) {
      if (r.action === 'error') continue;
      if (!this.resolveWorkstream(r, ws)) continue;
      const code = asText(r.values['code']);
      const match = code ? byCode.get(code.toLowerCase()) : undefined;
      if (match) {
        r.matchType = 'risk';
        r.matchId = match.id;
        r.matchCode = match.code;
        r.diff = diffFields({ title: match.title, description: match.description, probability: match.probability, impact: match.impact, dueDate: match.dueDate, responseStrategy: match.responseStrategy }, r.values, IMPORT_COMPARED_FIELDS.risk);
        if (r.diff.length === 0) {
          r.action = 'skip';
          r.notes.push(serverMessage('imports.row.unchanged', { code: match.code }));
        } else {
          r.action = 'update';
          r.notes.push(serverMessage('imports.row.update_proposed', { code: match.code, fields: r.diff.map((d) => d.field).join(', ') }));
        }
        continue;
      }
      const same = r.values['title'] ? byTitle.get(normalizeKey(String(r.values['title']))) : undefined;
      if (same) {
        // UT: duplicate row flagged with the matching record id — not imported.
        r.action = 'skip';
        r.matchType = 'risk';
        r.matchId = same.id;
        r.matchCode = same.code;
        r.notes.push(serverMessage('imports.row.possible_duplicate', { code: same.code }));
        continue;
      }
      r.action = 'create';
      r.notes.push(serverMessage('imports.row.create_risk'));
    }
  }

  // -------------------------------------------------------------------------------------------------- tasks
  private async approvedBaselineTaskIds(projectId: string): Promise<Set<string>> {
    const [b] = await this.db
      .tx()
      .select({ snapshot: schema.baselineVersion.snapshot })
      .from(schema.baselineVersion)
      .where(and(eq(schema.baselineVersion.projectId, projectId), eq(schema.baselineVersion.status, 'approved')));
    const tasks = (b?.snapshot as { tasks?: { id: string }[] } | undefined)?.tasks ?? [];
    return new Set(tasks.map((t) => t.id));
  }

  private async planTasks(viewer: RequestContext, projectId: string, rows: PlanRow[]) {
    const K = schema.task;
    const visible = await this.db
      .tx()
      .select({ id: K.id, wbsCode: K.wbsCode, title: K.title, plannedStart: K.plannedStart, plannedFinish: K.plannedFinish, durationDays: K.durationDays, description: K.description, status: K.status })
      .from(K)
      .where(and(eq(K.projectId, projectId), this.policy.reachSql(viewer, 'planning.plan.read', projectId, K.workstreamId)));
    const byCode = new Map(visible.map((x) => [x.wbsCode.toLowerCase(), x]));
    const codes = rows.map((r) => asText(r.values['wbsCode'])).filter((c): c is string => !!c);
    const taken = codes.length
      ? new Set((await this.db.tx().select({ c: K.wbsCode }).from(K).where(and(eq(K.projectId, projectId), inArray(sql`lower(${K.wbsCode})`, codes.map((c) => c.toLowerCase()))))).map((x) => x.c.toLowerCase()))
      : new Set<string>();
    const baselined = await this.approvedBaselineTaskIds(projectId);
    const ws = await this.workstreams(projectId);
    this.markDuplicate(rows, (r) => (asText(r.values['wbsCode']) ? asText(r.values['wbsCode'])!.toLowerCase() : null), 'WBS code');
    for (const r of rows) {
      if (r.action === 'error') continue;
      if (!this.resolveWorkstream(r, ws)) continue;
      const code = asText(r.values['wbsCode'])!;
      const status = asText(r.values['reportedStatus']);
      const match = byCode.get(code.toLowerCase());
      if (match) {
        r.matchType = 'task';
        r.matchId = match.id;
        r.matchCode = match.wbsCode;
        r.diff = diffFields({ title: match.title, plannedStart: match.plannedStart, plannedFinish: match.plannedFinish, durationDays: match.durationDays, description: match.description }, r.values, IMPORT_COMPARED_FIELDS.task);
        const governed = governedReason('task', { inApprovedBaseline: baselined.has(match.id) });
        r.governedReason = governed;
        if (status) r.notes.push(serverMessage('imports.row.reported_status_claim', { value: status.slice(0, 64) }));
        if (r.diff.length === 0 && !status) {
          r.action = 'skip';
          r.notes.push(serverMessage('imports.row.unchanged', { code: match.wbsCode }));
        } else if (r.diff.length && governed) {
          r.action = 'conflict';
          r.notes.push(serverMessage('imports.row.governed_change_request', { code: match.wbsCode, reason: governed }));
        } else {
          r.action = 'update';
          if (r.diff.length) r.notes.push(serverMessage('imports.row.update_proposed', { code: match.wbsCode, fields: r.diff.map((d) => d.field).join(', ') }));
        }
        continue;
      }
      if (taken.has(code.toLowerCase())) {
        // The code is used by a task the uploader cannot read: refused without revealing anything about that task.
        r.action = 'error';
        r.errors.push(serverMessage('imports.row.bad_code', { field: 'wbsCode' }));
        continue;
      }
      if (!r.refs.workstreamId) {
        r.action = 'error';
        r.errors.push(serverMessage('imports.row.workstream_required'));
        continue;
      }
      r.action = 'create';
      r.notes.push(serverMessage('imports.row.create_task'));
      if (status) r.notes.push(serverMessage('imports.row.reported_status_claim', { value: status.slice(0, 64) }));
    }
  }

  // -------------------------------------------------------------------------------------------------- decisions
  private async planDecisions(viewer: RequestContext, projectId: string, rows: PlanRow[]) {
    const D = schema.decision;
    const canRead = this.policy.canInProject(viewer, 'governance.decision.read', projectId);
    const visible = canRead
      ? await this.db
          .tx()
          .select({ id: D.id, code: D.code, title: D.title, status: D.status })
          .from(D)
          .where(and(eq(D.projectId, projectId), this.policy.visibilitySql(viewer, projectId, { classification: D.classification }), this.policy.reachSql(viewer, 'governance.decision.read', projectId, sql`null::uuid`)))
      : [];
    const byCode = new Map(visible.map((x) => [x.code.toLowerCase(), x]));
    this.markDuplicate(rows, (r) => (asText(r.values['code']) ? asText(r.values['code'])!.toLowerCase() : null), 'code');
    for (const r of rows) {
      if (r.action === 'error') continue;
      const code = asText(r.values['code'])!;
      const match = byCode.get(code.toLowerCase());
      if (!match) {
        r.action = 'error';
        r.errors.push(serverMessage('imports.row.decision_unknown', { code }));
        continue;
      }
      r.matchType = 'decision';
      r.matchId = match.id;
      r.matchCode = match.code;
      r.diff = diffFields({ title: match.title }, r.values, IMPORT_COMPARED_FIELDS.decision);
      const reported = asText(r.values['reportedStatus']);
      if (reported && normalizeKey(reported) !== normalizeKey(match.status.replace(/_/g, ' '))) r.diff.push({ field: 'status', from: match.status, to: reported });
      r.governedReason = governedReason('decision', { status: match.status });
      if (r.diff.length === 0) {
        r.action = 'skip';
        r.notes.push(serverMessage('imports.row.unchanged', { code: match.code }));
      } else {
        // REQ-INT-015: a committee decision is never changed by an import — a change request is proposed instead.
        r.action = 'conflict';
        r.notes.push(serverMessage('imports.row.governed_change_request', { code: match.code, reason: r.governedReason! }));
      }
    }
  }

  // -------------------------------------------------------------------------------------------------- source claims
  private async planClaims(viewer: RequestContext, projectId: string, rows: PlanRow[]) {
    const reach = (col: Parameters<PolicyService['reachSql']>[3]) => this.policy.reachSql(viewer, 'planning.plan.read', projectId, col);
    const canPlan = this.policy.canInProject(viewer, 'planning.plan.read', projectId);
    const lookup = async (type: string, code: string): Promise<{ id: string; current: Record<string, ImportValue> } | null> => {
      if (type === 'project') {
        const [p] = await this.db.tx().select({ id: schema.project.id, status: schema.project.status, name: schema.project.name, plannedStart: schema.project.plannedStart }).from(schema.project).where(eq(schema.project.id, projectId));
        return p ? { id: p.id, current: { status: p.status, name: p.name, plannedStart: p.plannedStart } } : null;
      }
      if (!canPlan) return null;
      const lc = code.toLowerCase();
      if (type === 'workstream') {
        const W = schema.workstream;
        const [w] = await this.db.tx().select({ id: W.id, name: W.name, objective: W.objective }).from(W).where(and(eq(W.projectId, projectId), sql`lower(${W.code}) = ${lc}`, reach(W.id)));
        return w ? { id: w.id, current: { name: w.name, objective: w.objective } } : null;
      }
      if (type === 'task') {
        const K = schema.task;
        const [t] = await this.db.tx().select({ id: K.id, status: K.status, plannedStart: K.plannedStart, plannedFinish: K.plannedFinish, actualFinish: K.actualFinish, reportedProgress: K.reportedProgress }).from(K).where(and(eq(K.projectId, projectId), sql`lower(${K.wbsCode}) = ${lc}`, reach(K.workstreamId)));
        return t ? { id: t.id, current: { status: t.status, plannedStart: t.plannedStart, plannedFinish: t.plannedFinish, actualFinish: t.actualFinish, reportedProgress: t.reportedProgress } } : null;
      }
      if (type === 'milestone') {
        const M = schema.milestone;
        const [m] = await this.db.tx().select({ id: M.id, status: M.status, plannedDate: M.plannedDate, actualDate: M.actualDate }).from(M).where(and(eq(M.projectId, projectId), sql`lower(${M.code}) = ${lc}`, reach(M.workstreamId)));
        return m ? { id: m.id, current: { status: m.status, plannedDate: m.plannedDate, actualDate: m.actualDate } } : null;
      }
      if (type === 'deliverable') {
        const X = schema.deliverable;
        const [d] = await this.db.tx().select({ id: X.id, status: X.status, dueDate: X.dueDate }).from(X).where(and(eq(X.projectId, projectId), sql`lower(${X.code}) = ${lc}`, reach(X.workstreamId)));
        return d ? { id: d.id, current: { status: d.status, dueDate: d.dueDate } } : null;
      }
      return null;
    };
    this.markDuplicate(
      rows,
      (r) => `${normalizeKey(String(r.values['subject'] ?? ''))}|${r.values['targetType'] ?? ''}|${(asText(r.values['targetCode']) ?? '').toLowerCase()}|${r.values['field'] ?? ''}`,
      'subject / record / field',
    );
    for (const r of rows) {
      if (r.action === 'error') continue;
      const type = asText(r.values['targetType']);
      const field = asText(r.values['field']);
      if (type && field) {
        const allowed = (CLAIM_TARGET_FIELDS as Record<string, readonly string[]>)[type] ?? [];
        if (!allowed.includes(field)) {
          r.action = 'error';
          r.errors.push(serverMessage('imports.row.bad_enum', { field: 'field' }));
          continue;
        }
        const code = asText(r.values['targetCode']) ?? '';
        const rec = await lookup(type, code);
        if (!rec) {
          r.action = 'error';
          r.errors.push(serverMessage('imports.row.target_unknown', { type, code }));
          continue;
        }
        r.refs.targetType = type;
        r.refs.targetId = rec.id;
        r.matchType = type;
        r.matchId = rec.id;
        r.matchCode = type === 'project' ? null : code;
        // Comparison with the current value (read-only; a claim never changes the record).
        const cur = rec.current[field] ?? null;
        const val = asText(r.values['value']);
        if (val !== null && (cur === null ? '' : String(cur)).trim() !== val.trim()) r.diff = [{ field, from: cur, to: val }];
      }
      r.action = 'create';
      r.notes.push(serverMessage('imports.row.claim'));
    }
  }
}
