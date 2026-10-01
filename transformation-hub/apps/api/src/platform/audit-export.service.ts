import { Inject, Injectable, Logger } from '@nestjs/common';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs';
import { connect as tcpConnect } from 'node:net';
import { createSocket } from 'node:dgram';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { APP_CONFIG, AppConfig } from './config';
import { DbService } from './db.service';

/**
 * Audit export to an INDEPENDENT log repository (REQ-DAT-007, ADR-0014): the worker job `platform.audit.export` ships
 * each organization's audit hash chain, in chain order, to a destination outside the database, so that the audit
 * history survives a database compromise and a later `hub_audit_verify` can be compared with an external anchor.
 *
 * - Minimised records (C-11): ids, action, outcome, chain links and SHA-256 digests of reason / before / after — never
 *   the content (`hub_audit_export` in post-migrate.sql).
 * - Adapters: `file` — append-only JSON Lines segments under HUB_AUDIT_EXPORT_DIR/<org>/ (a volume collected by the
 *   platform's log agent or a WORM store), each batch fsync'ed before the cursor moves; `syslog` — RFC 5424 to a local
 *   relay / approved collector over TCP (octet-counting framing, RFC 6587) or UDP. Nothing else is ever contacted.
 * - Resumes from its checkpoint without gaps: the cursor (last exported chain position and hash) is stored on the
 *   export schedule row (`scheduled_job.payload`) and advanced only after the destination accepted the batch. A crash
 *   between the two is detected on the next run (file adapter: the segment's last line is ahead of the cursor and
 *   matches the database) and nothing is written twice. Syslog is at-least-once: the collector de-duplicates on
 *   (org, chainPos).
 * - Divergence (e.g. after a restore from backup, the database chain is BEHIND the destination or differs from it):
 *   the existing segment is never rewritten; a new segment starts with an `export.segment` marker naming the reason, so
 *   the rows exported after the backup point remain as independent evidence for the reconciliation (backup-restore.md).
 */
export interface AuditExportRow {
  chain_pos: string | number;
  id: string;
  created_at: Date;
  project_id: string | null;
  actor_user_id: string | null;
  actor_kind: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  outcome: string;
  correlation_id: string | null;
  ip: string | null;
  prev_hash: string;
  hash: string;
  reason_sha256: string | null;
  before_sha256: string | null;
  after_sha256: string | null;
}

export interface ExportCursor {
  exportedChainPos: number;
  exportedHash: string | null;
  segment?: string;
}

export interface AuditExportResult {
  target: 'off' | 'file' | 'syslog';
  exported: number;
  fromChainPos: number;
  toChainPos: number;
  segment?: string;
  notes: string[];
}

export const AUDIT_EXPORT_KIND = 'platform.audit.export';
const SEGMENT_MAX_BYTES = 64 * 1024 * 1024;

export function exportLine(orgId: string, r: AuditExportRow) {
  return {
    type: 'audit',
    org: orgId,
    chainPos: Number(r.chain_pos),
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    projectId: r.project_id,
    actorUserId: r.actor_user_id,
    actorKind: r.actor_kind,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    outcome: r.outcome,
    correlationId: r.correlation_id,
    ip: r.ip,
    prevHash: r.prev_hash,
    hash: r.hash,
    reasonSha256: r.reason_sha256,
    beforeSha256: r.before_sha256,
    afterSha256: r.after_sha256,
  };
}

/** Last non-empty line of a file (reads backwards in 64 KiB blocks), or null. */
function lastLine(file: string): string | null {
  if (!existsSync(file)) return null;
  const size = statSync(file).size;
  if (size === 0) return null;
  const fd = openSync(file, 'r');
  try {
    let pos = size;
    let tail = '';
    while (pos > 0) {
      const len = Math.min(65536, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, pos);
      tail = buf.toString('utf8') + tail;
      const lines = tail.split('\n').filter((l) => l.trim());
      if (lines.length > 1 || pos === 0) return lines[lines.length - 1] ?? null;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

@Injectable()
export class AuditExportService {
  private readonly log = new Logger('audit-export');
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
  ) {}

  get target() {
    return this.config.auditExport.target;
  }

  private async readCursor(scheduleId: string | null): Promise<ExportCursor> {
    if (!scheduleId) return { exportedChainPos: 0, exportedHash: null };
    const r = await this.db.pool.query<{ payload: Record<string, unknown> }>('select payload from scheduled_job where id = $1', [scheduleId]);
    const p = r.rows[0]?.payload ?? {};
    return { exportedChainPos: Number(p['exportedChainPos'] ?? 0), exportedHash: (p['exportedHash'] as string | undefined) ?? null, segment: p['segment'] as string | undefined };
  }

  private async writeCursor(scheduleId: string | null, c: ExportCursor) {
    if (!scheduleId) return;
    await this.db.pool.query(`update scheduled_job set payload = payload || $2::jsonb, updated_at = now() where id = $1`, [scheduleId, JSON.stringify(c)]);
  }

  /** Rows after `after`, as the runtime role in the organization's context (SECURITY DEFINER export function). */
  private async fetch(orgId: string, after: number, limit: number): Promise<AuditExportRow[]> {
    const client = await this.db.pool.connect();
    try {
      await client.query('begin read only');
      await client.query(`select set_config('app.org_id', $1, true)`, [orgId]);
      const r = await client.query<AuditExportRow>('select * from hub_audit_export($1, $2, $3)', [orgId, after, limit]);
      await client.query('commit');
      return r.rows;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  private async hashAt(orgId: string, pos: number): Promise<string | null> {
    const rows = await this.fetch(orgId, pos - 1, 1);
    return rows[0] && Number(rows[0].chain_pos) === pos ? rows[0].hash : null;
  }

  /**
   * One export run for an organization (serialized per organization by a session advisory lock; a concurrent run
   * returns at once). `scheduleId` is the export schedule row that holds the cursor.
   */
  async run(orgId: string, scheduleId: string | null, opts: { maxBatches?: number } = {}): Promise<AuditExportResult> {
    const target = this.target;
    const empty: AuditExportResult = { target, exported: 0, fromChainPos: 0, toChainPos: 0, notes: [] };
    if (target === 'off') return { ...empty, notes: ['not configured (HUB_AUDIT_EXPORT=off)'] };
    const lockClient = await this.db.pool.connect();
    try {
      const got = await lockClient.query<{ ok: boolean }>(`select pg_try_advisory_lock(hashtextextended('hub_audit_export:' || $1, 0)) as ok`, [orgId]);
      if (!got.rows[0]?.ok) return { ...empty, notes: ['another export run holds the lock'] };
      try {
        return await this.runLocked(orgId, scheduleId, opts.maxBatches ?? 20);
      } finally {
        await lockClient.query(`select pg_advisory_unlock(hashtextextended('hub_audit_export:' || $1, 0))`, [orgId]);
      }
    } finally {
      lockClient.release();
    }
  }

  private async runLocked(orgId: string, scheduleIdIn: string | null, maxBatches: number): Promise<AuditExportResult> {
    const target = this.target;
    // The cursor lives on the organization's export schedule (created at worker start / bootstrap).
    const scheduleId =
      scheduleIdIn ??
      (await this.db.pool.query<{ id: string }>(`select id from scheduled_job where org_id = $1 and project_id is null and kind = $2 order by created_at limit 1`, [orgId, AUDIT_EXPORT_KIND])).rows[0]?.id ??
      null;
    if (!scheduleId) throw new Error(`audit export: no ${AUDIT_EXPORT_KIND} schedule for organization ${orgId} (start the worker or run the bootstrap)`);
    const cursor = await this.readCursor(scheduleId);
    const notes: string[] = [];
    const from = cursor.exportedChainPos;
    let segment: string | undefined;
    if (target === 'file') {
      segment = await this.prepareSegment(orgId, cursor, notes);
      cursor.segment = segment;
      await this.writeCursor(scheduleId, cursor);
    }
    let exported = 0;
    for (let i = 0; i < maxBatches; i++) {
      const rows = await this.fetch(orgId, cursor.exportedChainPos, this.config.auditExport.batch);
      if (!rows.length) break;
      // Gap-free by construction: rows are consecutive chain positions starting right after the cursor.
      rows.forEach((r, k) => {
        if (Number(r.chain_pos) !== cursor.exportedChainPos + 1 + k) throw new Error(`audit export: chain gap at position ${cursor.exportedChainPos + 1 + k} (got ${r.chain_pos})`);
      });
      const lines = rows.map((r) => JSON.stringify(exportLine(orgId, r)));
      if (target === 'file') this.appendFile(orgId, segment!, lines);
      else await this.sendSyslog(lines);
      const last = rows[rows.length - 1]!;
      cursor.exportedChainPos = Number(last.chain_pos);
      cursor.exportedHash = last.hash;
      await this.writeCursor(scheduleId, cursor);
      exported += rows.length;
      if (target === 'file' && statSync(this.segmentPath(orgId, segment!)).size > SEGMENT_MAX_BYTES) {
        segment = this.nextSegmentName(orgId);
        this.appendFile(orgId, segment, [JSON.stringify({ type: 'export.segment', reason: 'rotation', org: orgId, afterChainPos: cursor.exportedChainPos, at: new Date().toISOString() })]);
        cursor.segment = segment;
        await this.writeCursor(scheduleId, cursor);
      }
    }
    if (exported) this.log.log(`exported ${exported} audit row(s) of org ${orgId} to ${target} (chain ${from + 1}..${cursor.exportedChainPos})`);
    return { target, exported, fromChainPos: from, toChainPos: cursor.exportedChainPos, segment, notes };
  }

  // ------------------------------------------------------------------------------------------------------ file adapter
  private orgDir(orgId: string) {
    return join(this.config.auditExport.dir!, orgId);
  }
  private segmentPath(orgId: string, segment: string) {
    return join(this.orgDir(orgId), segment);
  }
  private nextSegmentName(orgId: string) {
    return `audit-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.jsonl`;
  }

  private appendFile(orgId: string, segment: string, lines: string[]) {
    mkdirSync(this.orgDir(orgId), { recursive: true, mode: 0o750 });
    const fd = openSync(this.segmentPath(orgId, segment), 'a', 0o640);
    try {
      writeSync(fd, lines.join('\n') + '\n');
      fsyncSync(fd); // durable before the cursor moves
    } finally {
      closeSync(fd);
    }
  }

  /**
   * Chooses the segment to append to and reconciles the cursor with what the destination already holds:
   *  - destination at the cursor → continue the segment;
   *  - destination AHEAD and its last row matches the database → a previous run wrote but did not record the cursor:
   *    move the cursor forward (nothing is written twice);
   *  - destination ahead and NOT matching the database (restore, rewrite), or BEHIND the cursor (lost data) → keep that
   *    segment untouched and start a new one with an `export.segment` marker naming the divergence.
   */
  private async prepareSegment(orgId: string, cursor: ExportCursor, notes: string[]): Promise<string> {
    const start = (reason: string, extra: Record<string, unknown> = {}) => {
      const name = this.nextSegmentName(orgId);
      this.appendFile(orgId, name, [JSON.stringify({ type: 'export.segment', reason, org: orgId, afterChainPos: cursor.exportedChainPos, previousSegment: cursor.segment ?? null, at: new Date().toISOString(), ...extra })]);
      notes.push(`new segment ${name} (${reason})`);
      return name;
    };
    if (!cursor.segment || !existsSync(this.segmentPath(orgId, cursor.segment))) return start(cursor.segment ? 'segment_missing' : 'start');
    const tail = lastLine(this.segmentPath(orgId, cursor.segment));
    let last: { type?: string; chainPos?: number; hash?: string } = {};
    try {
      last = tail ? JSON.parse(tail) : {};
    } catch {
      return start('unreadable_tail');
    }
    if (last.type !== 'audit') return cursor.segment; // only the segment marker so far
    const lastPos = Number(last.chainPos);
    if (lastPos === cursor.exportedChainPos && last.hash === cursor.exportedHash) return cursor.segment;
    if (lastPos > cursor.exportedChainPos) {
      const dbHash = await this.hashAt(orgId, lastPos);
      if (dbHash && dbHash === last.hash) {
        notes.push(`cursor advanced from ${cursor.exportedChainPos} to ${lastPos} (rows already in the destination)`);
        cursor.exportedChainPos = lastPos;
        cursor.exportedHash = last.hash ?? null;
        return cursor.segment;
      }
      return start('divergence_destination_ahead', { destinationChainPos: lastPos, destinationHash: last.hash ?? null, databaseHashAtThatPos: dbHash });
    }
    return start('divergence_destination_behind', { destinationChainPos: lastPos });
  }

  // ---------------------------------------------------------------------------------------------------- syslog adapter
  /** RFC 5424: <PRI>1 TIMESTAMP HOST APP PROCID MSGID - MSG ; facility local4 (20), severity informational (6). */
  static syslogMessage(line: string, now = new Date()): string {
    const host = (hostname() || '-').replace(/[^\x21-\x7e]/g, '').slice(0, 255) || '-';
    return `<166>1 ${now.toISOString()} ${host} transformation-hub ${process.pid} audit - ${line}`;
  }

  private async sendSyslog(lines: string[]): Promise<void> {
    const u = new URL(this.config.auditExport.syslog!);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const port = Number(u.port);
    const msgs = lines.map((l) => AuditExportService.syslogMessage(l));
    if (u.protocol === 'udp:') {
      const sock = createSocket(host.includes(':') ? 'udp6' : 'udp4');
      try {
        for (const m of msgs) await new Promise<void>((ok, ko) => sock.send(Buffer.from(m), port, host, (e) => (e ? ko(e) : ok())));
      } finally {
        sock.close();
      }
      return;
    }
    await new Promise<void>((ok, ko) => {
      const s = tcpConnect({ host, port, timeout: 10_000 }, () => {
        const framed = msgs.map((m) => `${Buffer.byteLength(m)} ${m}`).join('');
        s.end(framed);
      });
      s.on('timeout', () => s.destroy(new Error('syslog relay timeout')));
      s.on('error', ko);
      s.on('close', (hadError) => (hadError ? undefined : ok()));
    });
  }
}
