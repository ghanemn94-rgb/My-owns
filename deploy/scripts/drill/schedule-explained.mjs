#!/usr/bin/env node
// deploy/scripts/drill/schedule-explained.mjs: the drill-side second stage of D9 (ADR-0064 Amendment 5, D-278;
// T-DG7-DO-D9, F-DG7-971). The D9 mode 2 recheck (`reconcile.mjs --after-use`) runs unchanged. When it exits 4 and the
// ONLY rows it could not explain are added `automation_execution` rows and their `automation_action_result` rows, each
// of them is tested on the target, read only, against the A5.2 match rule:
//   S1 added; S2 no initiating user (run_as service); S3 a `schedule` trigger; S4 key `<code>:YYYY-MM-DDTHH:MM`;
//   S5 one enabled job_schedule row <code>; S6 the key minute names a slot of that row's cron in that row's timezone
//   (s = M, or s = M - 60 s); S7 W0 - 60 s < s <= W1; S8 W0 <= created_at <= W1; S9 its own worker service event with
//   no user and a `job:` request id; at most one execution per (code, slot); S' its action results, each added, with a
//   worker event in R(x), and the A4.4 structure.
// Nothing else is explained: any other line of the recheck output makes the rule not applicable (Gate 0), and D9 FAILs.
// The stage never writes: its one transaction is READ ONLY (default_transaction_read_only = on), so no job is paused,
// disabled or rescheduled and job_schedule is never written.
//
//   node deploy/scripts/drill/schedule-explained.mjs --database-url <target superuser url> --reconcile <reconcile-d9.txt>
//        --recheck-exit <c> --package <package dir> --window-start <W0 ISO> --window-end <W1 ISO>
//        --out <schedule-explained-d9.json> [--psql <psql binary>]
//
// Exit 0: the recheck matched (exit 0; the file is still written with applicable false), or every unexplained row is
// schedule-explained (D9 PASS). Exit 1: D9 FAIL (not applicable, or a key fails). Exit 2: BLOCKED (usage, unreadable
// input, psql failure). Every value is SYNTHETIC drill data; this approves nothing (no G1-G6, Finance or IT approval,
// and no DG gate).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { UNEXPLAINED_LINE } from "./unexplained-tables.mjs";

export const RULE = "ADR-0064 A5 (D-278)";
const EXEC = "automation_execution";
const RESULT = "automation_action_result";
const MINUTE = 60_000;
const KEY_RE = /^([a-z_]+\.[a-z_]+):([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_LINE = new RegExp(`^ {4}unexplained added \\["(${UUID})"\\]$`);
const ATTACH_LINE = /^transfer-attachments verify: matched: .+$/;
const INFO_LINE = /^ {2}[a-z_][a-z0-9_]*: \d+ explaining events$/;
const FINAL_LINE = /^reconcile-migration: mismatch: (\d+) tables, 0 attachments differ$/;

const iso = (ms) => new Date(ms).toISOString();

/**
 * S4: parses `<schedule code>:YYYY-MM-DDTHH:MM` (UTC minute, as starters.ts scheduleSlotKey writes it).
 * @param {string} key
 * @param {string} [triggerCode] when given, the code part must equal it
 * @returns {{code: string, minute: string, ms: number} | null}
 */
export function parseScheduleKey(key, triggerCode) {
  const m = typeof key === "string" ? KEY_RE.exec(key) : null;
  if (m === null) return null;
  const [y, mo, d, h, mi] = m.slice(2).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const t = new Date(ms);
  if (
    t.getUTCFullYear() !== y ||
    t.getUTCMonth() !== mo - 1 ||
    t.getUTCDate() !== d ||
    t.getUTCHours() !== h ||
    t.getUTCMinutes() !== mi
  )
    return null;
  if (triggerCode !== undefined && m[1] !== triggerCode) return null;
  return { code: m[1], minute: iso(ms), ms };
}

const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
];

/** One cron field as a Set of values, or null for a token outside the A5.2 grammar. */
function parseField(text, { min, max }) {
  const out = new Set();
  for (const item of text.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
    if (m === null) return null;
    let lo = min,
      hi = max;
    if (m[2] !== undefined) {
      lo = Number(m[2]);
      hi = m[3] !== undefined ? Number(m[3]) : lo;
      // `a/n` (a step without a range) is not in the grammar.
      if (m[4] !== undefined && m[3] === undefined) return null;
    }
    const step = m[4] !== undefined ? Number(m[4]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/**
 * Parses a five-field cron (A5.2 "Cron evaluation"); null for anything outside the grammar (names, L, W, #, ?, six
 * fields). Day of week 0-7 (0 and 7 Sunday); day of month and day of week are ORed when both are restricted (a field
 * that starts with `*` is unrestricted, as Vixie cron and cron-parser 4).
 */
export function parseCron(cron) {
  if (typeof cron !== "string") return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets = parts.map((p, i) => parseField(p, FIELDS[i]));
  if (sets.some((s) => s === null)) return null;
  if (sets[4].has(7)) sets[4].add(0);
  return { sets, domStar: parts[2].startsWith("*"), dowStar: parts[4].startsWith("*") };
}

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock fields of `ms` in `timezone` (Intl, hourCycle h23); null for an unknown zone. */
function wallClock(ms, timezone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    }).formatToParts(new Date(ms));
  } catch {
    return null;
  }
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    minute: Number(v.minute),
    hour: Number(v.hour),
    day: Number(v.day),
    month: Number(v.month),
    dow: WEEKDAY[v.weekday],
    second: Number(v.second),
  };
}

/**
 * Is `instant` an occurrence of `cron` in `timezone`? Seconds (and milliseconds) must be 0. An unsupported cron or an
 * unknown zone gives false, so it can only be too strict.
 * @param {string} cron
 * @param {string} timezone
 * @param {number | Date | string} instant
 */
export function cronMatches(cron, timezone, instant) {
  const ms = new Date(instant).getTime();
  if (!Number.isFinite(ms) || ms % 1000 !== 0) return false;
  const c = parseCron(cron);
  if (c === null) return false;
  const w = wallClock(ms, timezone);
  if (w === null || w.second !== 0 || w.dow === undefined) return false;
  const [mins, hours, doms, months, dows] = c.sets;
  if (!mins.has(w.minute) || !hours.has(w.hour) || !months.has(w.month)) return false;
  const domOk = doms.has(w.day);
  const dowOk = dows.has(w.dow);
  if (!c.domStar && !c.dowStar) return domOk || dowOk;
  return domOk && dowOk;
}

/**
 * S6: the slot a key minute `M` names: `M` if it is an occurrence, else `M - 60 s` if that is one, else null.
 * @returns {number | null} the slot in ms
 */
export function slotOf(cron, timezone, M) {
  const ms = new Date(M).getTime();
  if (cronMatches(cron, timezone, ms)) return ms;
  if (cronMatches(cron, timezone, ms - MINUTE)) return ms - MINUTE;
  return null;
}

/**
 * Gate 0 (A5.2): is the recheck output ONLY unexplained automation rows?
 * @param {string} text the reconcile output (reconcile-d9.txt)
 * @param {number} [exit] the recheck's exit code (4 required)
 * @returns {{applicable: boolean, reason: string | null, ux: string[], ur: string[]}}
 */
export function gate0(text, exit = 4) {
  const no = (reason) => ({ applicable: false, reason, ux: [], ur: [] });
  if (exit !== 4) return no(`recheck exit ${exit}`);
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const keys = { [EXEC]: [], [RESULT]: [] };
  const tables = [];
  let current = null;
  let final = null;
  for (const line of lines) {
    const cut = line.length > 160 ? line.slice(0, 160) : line;
    if (final !== null) return no(`line not allowed: ${cut}`);
    if (ATTACH_LINE.test(line)) {
      current = null;
      continue;
    }
    if (INFO_LINE.test(line)) {
      current = null;
      continue;
    }
    const t = UNEXPLAINED_LINE.exec(line);
    if (t !== null) {
      const [, table, , , missing, basis] = t;
      if (table !== EXEC && table !== RESULT) return no(`table ${table} is not ${EXEC} or ${RESULT}`);
      if (basis !== "audit_explained" || missing !== "0" || tables.includes(table))
        return no(`line not allowed: ${cut}`);
      tables.push(table);
      current = table;
      continue;
    }
    const k = KEY_LINE.exec(line);
    if (k !== null) {
      if (current === null) return no(`line not allowed: ${cut}`);
      keys[current].push(k[1]);
      continue;
    }
    const f = FINAL_LINE.exec(line);
    if (f !== null) {
      final = Number(f[1]);
      continue;
    }
    return no(`line not allowed: ${cut}`);
  }
  if (final === null) return no("line not allowed: (no final reconcile-migration line)");
  if (final !== tables.length) return no(`line not allowed: reconcile-migration: mismatch: ${final} tables`);
  for (const table of [EXEC, RESULT])
    if (keys[table].length >= 20) return no(`key list may be truncated (${table}: 20 keys)`);
  if (keys[EXEC].length < 1) return no(`no unexplained ${EXEC} key`);
  return { applicable: true, reason: null, ux: keys[EXEC], ur: keys[RESULT] };
}

const msOf = (ts) => new Date(ts).getTime();

/**
 * A5.2 rules S, uniqueness and S' on rows read from the target.
 * @param {object} p
 * @param {object} p.rows `{ ux, ur, executions: {[id]: row}, peers: row[], packageExecutionIds, packageResultIds,
 *   triggers: {[code]: kind}, schedules: row[], results: row[], events: row[] }`
 * @param {{start: string, end: string}} p.window W0 and W1 (ISO, target clock)
 * @param {string | number | bigint} p.baseline B (events with seq > B count)
 * @returns {{executions: object[], failures: {table: string, key: string, reason: string}[]}}
 */
export function explain({ rows, window, baseline }) {
  const W0 = msOf(window.start),
    W1 = msOf(window.end);
  const B = BigInt(baseline ?? 0);
  const failures = [];
  const fail = (table, key, reason) => failures.push({ table, key, reason });
  const inPkgX = new Set(rows.packageExecutionIds ?? []);
  const inPkgR = new Set(rows.packageResultIds ?? []);
  const events = (rows.events ?? []).filter((e) => BigInt(e.seq) > B);
  const schedules = rows.schedules ?? [];
  const resultsOf = (xid) => (rows.results ?? []).filter((r) => r.automation_execution_id === xid);

  // Slots of every schedule execution near the window (uniqueness counts all of them, not only U_x).
  const slotKey = (row) => {
    const k = parseScheduleKey(row.trigger_key, row.trigger_code);
    if (k === null) return null;
    const sch = schedules.filter((s) => s.code === k.code && s.enabled === true);
    if (sch.length !== 1) return null;
    const s = slotOf(sch[0].cron, sch[0].timezone, k.ms);
    return s === null ? null : `${k.code}@${s}`;
  };
  const slotCount = new Map();
  const counted = new Set();
  for (const row of [...(rows.peers ?? []), ...Object.values(rows.executions ?? {})]) {
    if (!row || counted.has(row.id)) continue;
    counted.add(row.id);
    const sk = slotKey(row);
    if (sk !== null) slotCount.set(sk, (slotCount.get(sk) ?? 0) + 1);
  }

  const explained = new Map(); // id -> { row, slot, sch, R }
  for (const id of rows.ux ?? []) {
    const x = rows.executions?.[id];
    const why = (() => {
      if (!x || inPkgX.has(id)) return "not added";
      if (x.initiating_user_id !== null || x.run_as !== "service") return "has an initiating user";
      if (rows.triggers?.[x.trigger_code] !== "schedule") return `trigger ${x.trigger_code} is not a schedule trigger`;
      const k = parseScheduleKey(x.trigger_key, x.trigger_code);
      if (k === null) return `trigger_key '${x.trigger_key}' is not '${x.trigger_code}:YYYY-MM-DDTHH:MM'`;
      const sch = schedules.filter((s) => s.code === k.code && s.enabled === true);
      if (sch.length !== 1) return `no enabled job_schedule row ${k.code}`;
      const { cron, timezone } = sch[0];
      const s = slotOf(cron, timezone, k.ms);
      if (s === null) return `key minute ${k.minute} names no slot of '${cron}' ${timezone}`;
      if (!(s > W0 - MINUTE && s <= W1))
        return `slot ${iso(s)} is outside the window (${iso(W0 - MINUTE)}, ${iso(W1)}]`;
      const c = msOf(x.created_at);
      if (!(c >= W0 && c <= W1)) return `created ${x.created_at} outside the window`;
      const own = events.filter(
        (e) =>
          e.record_type === EXEC &&
          e.record_id === id &&
          e.source === "worker" &&
          e.actor_type === "service" &&
          e.actor_user_id === null &&
          e.on_behalf_of_user_id === null &&
          typeof e.request_id === "string" &&
          /^job:.+$/.test(e.request_id),
      );
      if (own.length === 0 || !own.some((e) => Number(e.new_version) === Number(x.version)))
        return "no service audit event without a user";
      const n = slotCount.get(`${k.code}@${s}`) ?? 0;
      if (n !== 1) return `slot ${iso(s)} of ${k.code} has ${n} executions`;
      explained.set(id, { row: x, slot: s, sch: sch[0], R: new Set(own.map((e) => e.request_id)) });
      return null;
    })();
    if (why !== null) fail(EXEC, id, why);
  }

  // A4.4 structure per explained execution; a failure un-explains it.
  for (const [id, e] of [...explained]) {
    const x = e.row;
    const all = resultsOf(id);
    const why = (() => {
      const late = all.find((r) => Number(r.attempt_no) > Number(x.attempt_no));
      if (late) return `result attempt ${late.attempt_no} is after the execution's attempt ${x.attempt_no}`;
      const byAttempt = new Map();
      for (const r of all.filter((r) => !inPkgR.has(r.id))) {
        const a = Number(r.attempt_no);
        byAttempt.set(a, [...(byAttempt.get(a) ?? []), Number(r.ordinal)]);
      }
      for (const [a, ords] of [...byAttempt].sort((p, q) => p[0] - q[0])) {
        const sorted = [...ords].sort((p, q) => p - q);
        if (!sorted.every((o, i) => o === i + 1))
          return `attempt ${a} ordinals ${sorted.join(",")} (expected 1..${sorted.length})`;
      }
      if (/^starter\./.test(x.rule_code ?? "") && x.status !== "running") {
        const cur = all.filter((r) => Number(r.attempt_no) === Number(x.attempt_no));
        if (cur.length !== 1 || Number(cur[0].ordinal) !== 1 || cur[0].action_type !== "starter_handler")
          return `attempt ${x.attempt_no} ordinals ${cur.map((r) => r.ordinal).join(",")} (expected 1..1, starter_handler)`;
      }
      const ur = new Set(rows.ur ?? []);
      const stray = all.find((r) => !inPkgR.has(r.id) && !ur.has(r.id));
      if (stray) return `result ${stray.id} is added but not in the recheck's unexplained list`;
      return null;
    })();
    if (why !== null) {
      fail(EXEC, id, why);
      explained.delete(id);
    }
  }

  // S': the action results.
  const resultIds = new Map(); // execution id -> result ids
  for (const id of rows.ur ?? []) {
    const r = (rows.results ?? []).find((q) => q.id === id);
    const why = (() => {
      if (!r || inPkgR.has(id)) return "not added";
      const e = explained.get(r.automation_execution_id);
      if (!e) return `execution ${r.automation_execution_id} is not schedule-explained`;
      const ok = events.some(
        (ev) =>
          ev.record_type === RESULT &&
          ev.record_id === id &&
          ev.source === "worker" &&
          ev.actor_type === "service" &&
          e.R.has(ev.request_id),
      );
      if (!ok) return "no worker audit event of the execution's job";
      return null;
    })();
    if (why !== null) fail(RESULT, id, why);
    else resultIds.set(r.automation_execution_id, [...(resultIds.get(r.automation_execution_id) ?? []), id]);
  }

  const executions = [...explained]
    .map(([id, e]) => {
      const ars = [...(resultIds.get(id) ?? [])].sort();
      const ev = events
        .filter(
          (v) =>
            (v.record_type === EXEC && v.record_id === id) || (v.record_type === RESULT && ars.includes(v.record_id)),
        )
        .sort((p, q) => (BigInt(p.seq) < BigInt(q.seq) ? -1 : BigInt(p.seq) > BigInt(q.seq) ? 1 : 0))
        .map((v) => ({
          id: v.id,
          seq: String(v.seq),
          recordType: v.record_type,
          recordId: v.record_id,
          requestId: v.request_id,
        }));
      return {
        executionId: id,
        triggerCode: e.row.trigger_code,
        triggerKey: e.row.trigger_key,
        slot: iso(e.slot),
        scheduleCode: e.sch.code,
        cron: e.sch.cron,
        timezone: e.sch.timezone,
        status: e.row.status,
        // Beyond the A5.5 shape: S2/S3 inputs, so the A18 harness can re-check them from the report alone.
        runAs: e.row.run_as,
        initiatingUserId: e.row.initiating_user_id,
        triggerKind: rows.triggers?.[e.row.trigger_code] ?? null,
        createdAt: new Date(msOf(e.row.created_at)).toISOString(),
        actionResultIds: ars,
        auditEvents: ev,
      };
    })
    .sort((p, q) => (p.executionId < q.executionId ? -1 : p.executionId > q.executionId ? 1 : 0));
  return { executions, failures };
}

/** The whole stage on parsed inputs: the report object and the A5.4 lines. `read(ux, ur)` returns the rows. */
export function stage({ text, exit, window, read }) {
  const win = {
    start: iso(msOf(window.start)),
    end: iso(msOf(window.end)),
    lowerBoundExclusive: iso(msOf(window.start) - MINUTE),
    clock: "target clock_timestamp()",
  };
  const base = { rule: RULE, window: win, recheckExit: exit };
  const lines = [];
  if (exit === 0) {
    const report = { ...base, applicable: false, notApplicableReason: "recheck matched", executions: [], failures: [] };
    return { pass: true, recheck: "matched", report, lines };
  }
  const g = gate0(text, exit);
  if (!g.applicable) {
    lines.push(`transfer-drill: D9: schedule rule not applicable: ${g.reason}`);
    const report = { ...base, applicable: false, notApplicableReason: g.reason, executions: [], failures: [] };
    return { pass: false, recheck: "not_matched", report, lines };
  }
  const { rows, baseline } = read(g.ux, g.ur);
  const r = explain({ rows, window, baseline });
  const pass = r.failures.length === 0;
  for (const x of r.executions) {
    if (!pass) continue;
    lines.push(
      `transfer-drill: D9: schedule-triggered execution ${x.executionId} explained (ADR-0064 A5; trigger ${x.triggerCode}, key ${x.triggerKey}, slot ${x.slot}, schedule '${x.cron}' ${x.timezone}, ${x.actionResultIds.length} action results, ${x.auditEvents.length} audit events)`,
    );
  }
  for (const f of r.failures)
    lines.push(`transfer-drill: step D9 failed: ${f.table} ${f.key} is not schedule-explained: ${f.reason}`);
  if (pass)
    lines.push(
      `transfer-drill: D9: mode 2 recheck exit 4; ${r.executions.length} schedule-triggered executions and ${r.executions.reduce((n, x) => n + x.actionResultIds.length, 0)} action results explained by ${RULE}; nothing else unexplained`,
    );
  const report = {
    ...base,
    applicable: true,
    notApplicableReason: null,
    executions: pass ? r.executions : [],
    failures: r.failures,
  };
  return { pass, recheck: pass ? "schedule_explained" : "not_matched", report, lines };
}

/** Canonical JSON (keys sorted, recursively). */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/** The ids of a package table file (`tables/<t>.ndjson`, one JSON object per line). */
export function packageIds(pkg, table) {
  const f = join(pkg, "tables", `${table}.ndjson`);
  if (!existsSync(f)) throw new Error(`package table file ${f} not found`);
  const ids = [];
  for (const line of readFileSync(f, "utf8").split("\n")) if (line.trim()) ids.push(JSON.parse(line).id);
  return ids;
}

/** The one READ ONLY query of the stage (A5.2 inputs); returns a JSON text. */
export const READ_SQL = `
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH ux AS (SELECT unnest(:'ux'::uuid[]) AS id),
     ur AS (SELECT unnest(:'ur'::uuid[]) AS id),
     imp AS (SELECT greatest(coalesce(audit_baseline_seq_max, 0), coalesce(audit_carried_seq_max, 0)) AS b
               FROM migration_import ORDER BY imported_at DESC, id DESC LIMIT 1),
     x AS (SELECT e.id, e.trigger_code, e.trigger_key, e.initiating_user_id, e.run_as, e.status, e.attempt_no, e.version,
                  to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, r.code AS rule_code
             FROM automation_execution e JOIN automation_rule r ON r.id = e.automation_rule_id
            WHERE e.id IN (SELECT id FROM ux)),
     codes AS (SELECT DISTINCT trigger_code FROM x),
     peers AS (SELECT e.id, e.trigger_code, e.trigger_key FROM automation_execution e
                WHERE e.trigger_code IN (SELECT trigger_code FROM codes)
                  AND e.created_at >= :'w0'::timestamptz - interval '10 minutes'),
     res AS (SELECT a.id, a.automation_execution_id, a.attempt_no, a.ordinal, a.action_type FROM automation_action_result a
              WHERE a.automation_execution_id IN (SELECT id FROM ux) OR a.id IN (SELECT id FROM ur)),
     ev AS (SELECT a.id, a.seq::text AS seq, a.record_type, a.record_id, a.source, a.actor_type, a.actor_user_id,
                   a.on_behalf_of_user_id, a.request_id, a.new_version
              FROM audit_event a
             WHERE a.seq > coalesce((SELECT b FROM imp), 0)
               AND ((a.record_type = 'automation_execution' AND a.record_id IN (SELECT id FROM ux))
                 OR (a.record_type = 'automation_action_result' AND a.record_id IN (SELECT id FROM res))))
SELECT json_build_object(
  'readOnly', current_setting('transaction_read_only'),
  'baseline', (SELECT b::text FROM imp),
  'imports', (SELECT count(*) FROM migration_import),
  'executions', coalesce((SELECT json_object_agg(id, row_to_json(x)) FROM x), '{}'::json),
  'peers', coalesce((SELECT json_agg(row_to_json(peers)) FROM peers), '[]'::json),
  'triggers', coalesce((SELECT json_object_agg(t.code, t.trigger_kind) FROM automation_trigger t
                          WHERE t.code IN (SELECT trigger_code FROM x)), '{}'::json),
  'schedules', coalesce((SELECT json_agg(json_build_object('code', s.code, 'cron', s.cron, 'timezone', s.timezone,
                          'enabled', s.enabled)) FROM job_schedule s), '[]'::json),
  'results', coalesce((SELECT json_agg(row_to_json(res)) FROM res), '[]'::json),
  'events', coalesce((SELECT json_agg(row_to_json(ev)) FROM ev), '[]'::json));
ROLLBACK;
`;

/** Reads the A5.2 inputs from the target through psql, in one READ ONLY transaction. */
export function readTarget({ url, psql = "psql", ux, ur, w0 }) {
  const arr = (ids) => `{${ids.join(",")}}`;
  const r = spawnSync(
    psql,
    [
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      `ux=${arr(ux)}`,
      "-v",
      `ur=${arr(ur)}`,
      "-v",
      `w0=${w0}`,
      "-d",
      url,
    ],
    {
      input: READ_SQL,
      encoding: "utf8",
      env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS ?? ""} -c default_transaction_read_only=on`.trim() },
    },
  );
  if (r.error) throw Object.assign(new Error(`psql not runnable: ${r.error.message}`), { code: 2 });
  if (r.status !== 0) throw Object.assign(new Error(`psql: ${r.stderr.trim()}`), { code: 2 });
  const doc = JSON.parse(r.stdout.trim());
  if (doc.readOnly !== "on") throw Object.assign(new Error("the read transaction is not READ ONLY"), { code: 2 });
  if (doc.imports < 1) throw Object.assign(new Error("no migration_import on the target"), { code: 2 });
  return doc;
}

async function main() {
  let v;
  try {
    v = parseArgs({
      options: {
        "database-url": { type: "string" },
        reconcile: { type: "string" },
        "recheck-exit": { type: "string" },
        package: { type: "string" },
        "window-start": { type: "string" },
        "window-end": { type: "string" },
        out: { type: "string" },
        psql: { type: "string", default: "psql" },
      },
    }).values;
  } catch (e) {
    console.error(`schedule-explained: BLOCKED: ${e.message}`);
    process.exit(2);
  }
  const need = ["database-url", "reconcile", "recheck-exit", "package", "window-start", "window-end", "out"];
  const missing = need.filter((k) => v[k] === undefined);
  const exit = Number(v["recheck-exit"]);
  if (missing.length > 0 || !Number.isInteger(exit)) {
    console.error(
      `schedule-explained: BLOCKED: usage: missing ${missing.map((k) => "--" + k).join(" ") || "--recheck-exit <int>"}`,
    );
    process.exit(2);
  }
  for (const k of ["window-start", "window-end"])
    if (!Number.isFinite(msOf(v[k]))) {
      console.error(`schedule-explained: BLOCKED: --${k} ${v[k]} is not an instant`);
      process.exit(2);
    }
  if (!existsSync(v.reconcile)) {
    console.error(`schedule-explained: BLOCKED: ${v.reconcile} not found`);
    process.exit(2);
  }
  let res;
  try {
    res = stage({
      text: readFileSync(v.reconcile, "utf8"),
      exit,
      window: { start: v["window-start"], end: v["window-end"] },
      read: (ux, ur) => {
        const doc = readTarget({ url: v["database-url"], psql: v.psql, ux, ur, w0: v["window-start"] });
        return {
          baseline: doc.baseline ?? 0,
          rows: {
            ux,
            ur,
            executions: doc.executions,
            peers: doc.peers,
            packageExecutionIds: packageIds(v.package, EXEC),
            packageResultIds: packageIds(v.package, RESULT),
            triggers: doc.triggers,
            schedules: doc.schedules,
            results: doc.results,
            events: doc.events,
          },
        };
      },
    });
  } catch (e) {
    console.error(`schedule-explained: BLOCKED: ${e.message}`);
    process.exit(2);
  }
  writeFileSync(v.out, canonical(res.report) + "\n");
  for (const l of res.lines) console.log(l);
  process.exit(res.pass ? 0 : 1);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
