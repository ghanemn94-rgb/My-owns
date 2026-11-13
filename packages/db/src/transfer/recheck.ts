// The recheck of an imported target (ADR-0064 Amendment 1 §A1.5, §A1.9 with Amendment 2 §A2.3, §A2.6; p7-work-split
// §C.12, §C.13; T-DG7-BE-R2): `mth-db reconcile-migration --operator <name> [--attachments-report <file>]
// [--after-use --from <dir> --allow <file>] [--report <file>]`, owner role, under the session lock 730403.
//
//   mode 1 (default; run_kind `recheck`): every exported table except audit_event and user_identity equals the import
//          run's expectation (count and digest); audit_event is checked by checkAuditTrail (the reconstructed carried
//          trail of A2.3 against the manifest's digest, the baseline as recorded at L2, every `P` entry a baseline row,
//          the ranges not interleaved, both triggers on; later rows are additions, always allowed and counted by
//          action); user_identity equals the expectation once every `rebound` identity_rebind_event is reversed; the
//          attachments come from the A1.8 report (never 0 checked for a package that lists attachments).
//   mode 2 (`--after-use`; run_kind `recheck_after_use`): the package is re-checked and compared ROW BY ROW by primary
//          key; the allowance file `mth-recheck-allowance/2` (A2.6) says which differences are allowed: `tables` (exact
//          keys), `audited` (each added or changed row explained by an audit event of a listed actor after the
//          baseline, at the row's version), `children` (each added or changed row a foreign-key child of an explained
//          parent row) and `operational` (counted). Every other table must be unchanged. No row may be missing.
//
// It changes no business row; it appends one migration_reconciliation run with its child rows and its
// migration.reconciled event. audit_event is only read. Nothing here approves anything (no G1-G6, Finance or IT
// approval) and nothing reads or writes DG0-DG7.
import { readFile } from "node:fs/promises";
import { sql } from "kysely";
import type { DbOrTx, Tx } from "../pool.ts";
import { decodeStrictUtf8 } from "./manifest.ts";
import { confinedPath } from "./export.ts";
import { buildPlan, type TransferPlan, type TransferPlanTable } from "./plan.ts";
import { encodeCarriedAudit, type AuditAlreadyPresent } from "./reconcile.ts";
import { digestOfLines, encodedRows, type EncodedRow } from "./table-digest.ts";
import { encodeLine } from "./export.ts";

// ------------------------------------------------------------------------------------------------ the constants

/**
 * A1.9: the tables whose differences mode 2 counts without explaining them. It may shrink by measurement; it never
 * grows without the architect.
 */
export const RECHECK_OPERATIONAL_TABLES: readonly string[] = [
  "job_schedule",
  "job_run",
  "outbox_event",
  "processed_message",
  "operational_failure",
  "operational_exception",
  "operational_exception_event",
  "inbox_notification",
  "notification_delivery",
  "notification_digest",
  "export_job",
  "export_job_progress",
];

/** The 17 financial tables of T-C17 (tests/integration/transfer/financial-parity.test.ts FINANCIAL_TABLES). */
export const RECHECK_FINANCIAL_TABLES: readonly string[] = [
  "benefit",
  "benefit_allocation",
  "benefit_plan_value",
  "benefit_scenario",
  "benefit_scenario_value",
  "benefit_formula",
  "benefit_formula_version",
  "benefit_formula_variable",
  "benefit_calculation",
  "benefit_measurement",
  "benefit_measurement_input",
  "finance_validation",
  "calculation_run",
  "kpi_version",
  "kpi_rag_threshold",
  "kpi_actual_value",
  "kpi_evaluation",
];

/** A1.9 rule 6: never operational (plus every table whose name starts with `decision`; see isNeverOperational). */
export const RECHECK_NEVER_OPERATIONAL: readonly string[] = [
  "audit_event",
  "app_user",
  "user_identity",
  "scoped_assignment",
  "delegation",
  "gate_decision",
  "approval",
  "approval_decision",
  ...RECHECK_FINANCIAL_TABLES,
];

export const isNeverOperational = (t: string): boolean =>
  RECHECK_NEVER_OPERATIONAL.includes(t) || t.startsWith("decision");

export const ALLOWANCE_SCHEMA_VERSION = "mth-recheck-allowance/2";

// ------------------------------------------------------------------------------------------------ the allowance

/** A key tuple: the key columns' text output, in key order. */
export type KeyTuple = readonly string[];

export interface Allowance {
  readonly actors: readonly string[];
  readonly tables: readonly {
    readonly name: string;
    readonly added: readonly KeyTuple[];
    readonly changed: readonly KeyTuple[];
  }[];
  readonly audited: readonly {
    readonly name: string;
    readonly mustInclude: { readonly added: readonly KeyTuple[]; readonly changed: readonly KeyTuple[] };
  }[];
  readonly children: readonly { readonly name: string; readonly parent: string; readonly fkey: string }[];
  readonly operational: readonly string[];
}

/** A refused allowance file; `message` is the whole C.12 line. */
export class AllowanceRefused extends Error {
  constructor(reason: string) {
    super(`reconcile-migration: refused: invalid allowance file: ${reason}`);
    this.name = "AllowanceRefused";
  }
}

const KEYS = ["schemaVersion", "actors", "tables", "audited", "children", "operational"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME = /^[a-z][a-z0-9_]{0,62}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function tuples(v: unknown, where: string): KeyTuple[] {
  if (!Array.isArray(v)) throw new AllowanceRefused(`malformed key tuple in ${where}`);
  return v.map((t) => {
    if (!Array.isArray(t) || t.length === 0 || !t.every((x) => typeof x === "string"))
      throw new AllowanceRefused(`malformed key tuple in ${where}`);
    return t as string[];
  });
}

function tableName(v: unknown, where: string): string {
  if (typeof v !== "string" || !NAME.test(v))
    throw new AllowanceRefused(`unknown table ${JSON.stringify(v)} in ${where}`);
  return v;
}

/**
 * Structure only, no database (A1.9 rule 7 and A2.6 rule 6, the refusals that need no catalogue): strict UTF-8 JSON;
 * schema version `/2`; all six keys; the shapes; a table named twice (in any of the four lists); an operational name
 * outside the constant; audit_event or user_identity listed; actors empty while audited is not.
 */
export function parseAllowance(bytes: Uint8Array): Allowance {
  let raw: unknown;
  try {
    raw = JSON.parse(decodeStrictUtf8(bytes));
  } catch {
    throw new AllowanceRefused("not strict UTF-8 JSON");
  }
  if (!isObject(raw)) throw new AllowanceRefused("not a JSON object");
  if (raw["schemaVersion"] !== ALLOWANCE_SCHEMA_VERSION)
    throw new AllowanceRefused(`unsupported schema version '${String(raw["schemaVersion"] ?? "")}'`);
  for (const k of KEYS) if (!(k in raw)) throw new AllowanceRefused(`missing key '${k}'`);
  for (const k of Object.keys(raw))
    if (!(KEYS as readonly string[]).includes(k)) throw new AllowanceRefused(`unknown key '${k}'`);
  const { actors, tables, audited, children, operational } = raw as Record<(typeof KEYS)[number], unknown>;
  if (!Array.isArray(actors) || !actors.every((a) => typeof a === "string" && UUID.test(a)))
    throw new AllowanceRefused("actors must be an array of app_user ids");
  if (!Array.isArray(tables) || !Array.isArray(audited) || !Array.isArray(children) || !Array.isArray(operational))
    throw new AllowanceRefused("tables, audited, children and operational must be arrays");
  const seen = new Set<string>();
  const once = (t: string) => {
    if (seen.has(t)) throw new AllowanceRefused(`${t} is listed more than once`);
    seen.add(t);
  };
  const outTables = tables.map((e, i) => {
    if (!isObject(e)) throw new AllowanceRefused(`tables[${i}] is not an object`);
    const name = tableName(e["name"], "tables");
    if (name === "audit_event") throw new AllowanceRefused("audit_event may not be listed (A1.9 rule 1)");
    once(name);
    return { name, added: tuples(e["added"], name), changed: tuples(e["changed"], name) };
  });
  const outAudited = audited.map((e, i) => {
    if (!isObject(e) || !isObject(e["mustInclude"])) throw new AllowanceRefused(`audited[${i}] is not an object`);
    const name = tableName(e["name"], "audited");
    once(name);
    const m = e["mustInclude"];
    return { name, mustInclude: { added: tuples(m["added"], name), changed: tuples(m["changed"], name) } };
  });
  const outChildren = children.map((e, i) => {
    if (!isObject(e)) throw new AllowanceRefused(`children[${i}] is not an object`);
    const name = tableName(e["name"], "children");
    const parent = tableName(e["parent"], "children");
    if (typeof e["fkey"] !== "string" || !NAME.test(e["fkey"]))
      throw new AllowanceRefused(`${String(e["fkey"])} is not a foreign key from ${name} to ${parent}`);
    once(name);
    return { name, parent, fkey: e["fkey"] };
  });
  const tableSet = new Set(outTables.map((t) => t.name));
  const outOperational = operational.map((n) => {
    const name = tableName(n, "operational");
    if (tableSet.has(name)) throw new AllowanceRefused(`${name} is listed both in tables and in operational`);
    once(name);
    if (!RECHECK_OPERATIONAL_TABLES.includes(name)) throw new AllowanceRefused(`${name} is not an operational table`);
    return name;
  });
  for (const a of outAudited)
    if (a.name === "audit_event" || a.name === "user_identity")
      throw new AllowanceRefused(`audited table ${a.name} has no enabled ${a.name}_audit_required trigger`);
  for (const c of outChildren)
    if (c.name === "audit_event") throw new AllowanceRefused("audit_event may not be listed (A1.9 rule 1)");
  if (actors.length === 0 && outAudited.length > 0) throw new AllowanceRefused("actors is empty but audited is not");
  return {
    actors: actors as string[],
    tables: outTables,
    audited: outAudited,
    children: outChildren,
    operational: outOperational,
  };
}

/** The children in topological order of their parents (parents first); refuses a cycle. Pure. */
export function childrenOrder(allowance: Allowance): Allowance["children"] {
  const byName = new Map(allowance.children.map((c) => [c.name, c]));
  const done = new Set<string>();
  const out: Allowance["children"][number][] = [];
  const visit = (name: string, path: Set<string>) => {
    if (done.has(name)) return;
    if (path.has(name)) throw new AllowanceRefused(`children form a cycle at ${name}`);
    const c = byName.get(name)!;
    path.add(name);
    if (byName.has(c.parent)) visit(c.parent, path);
    path.delete(name);
    done.add(name);
    out.push(c);
  };
  for (const c of allowance.children) visit(c.name, new Set());
  return out;
}

/** The catalogue refusals of A1.9 rule 7 and A2.6 rule 6 (exit 2), in the recheck's transaction. */
export async function validateAllowance(tx: DbOrTx, allowance: Allowance, plan?: TransferPlan): Promise<void> {
  const p = plan ?? (await buildPlan(tx));
  const exported = new Map(p.tables.map((t) => [t.name, t]));
  const excluded = new Set(p.excludedTables.map((t) => t.name));
  const known = (t: string) => {
    if (excluded.has(t)) throw new AllowanceRefused(`excluded table ${t}`);
    if (!exported.has(t)) throw new AllowanceRefused(`unknown table ${t}`);
    return exported.get(t)!;
  };
  for (const t of allowance.tables) {
    const table = known(t.name);
    for (const k of [...t.added, ...t.changed])
      if (k.length !== table.primaryKey.length) throw new AllowanceRefused(`malformed key tuple in ${t.name}`);
  }
  for (const t of allowance.operational) known(t);
  if (allowance.actors.length > 0) {
    const found = new Set(
      (
        await sql<{
          id: string;
        }>`SELECT id::text AS id FROM app_user WHERE id = ANY(${[...allowance.actors]}::uuid[])`.execute(tx)
      ).rows.map((r) => r.id),
    );
    for (const a of allowance.actors) if (!found.has(a)) throw new AllowanceRefused(`unknown actor ${a}`);
  }
  const auditTrigger = async (t: string): Promise<string | null> =>
    (
      await sql<{ e: string }>`
        SELECT tgenabled AS e FROM pg_trigger
         WHERE tgrelid = to_regclass(${`public.${t}`}) AND tgname = ${`${t}_audit_required`}`.execute(tx)
    ).rows[0]?.e ?? null;
  for (const a of allowance.audited) {
    const table = known(a.name);
    const e = await auditTrigger(a.name);
    if (e === null || e === "D")
      throw new AllowanceRefused(`audited table ${a.name} has no enabled ${a.name}_audit_required trigger`);
    const idType = table.columns.find((c) => c.name === "id")?.type;
    if (table.primaryKey.join(",") !== "id" || idType !== "uuid")
      throw new AllowanceRefused(`audited table ${a.name} has a primary key other than (id)`);
    for (const k of [...a.mustInclude.added, ...a.mustInclude.changed])
      if (k.length !== 1) throw new AllowanceRefused(`malformed key tuple in ${a.name}`);
  }
  const listed = new Set([
    ...allowance.tables.map((t) => t.name),
    ...allowance.audited.map((t) => t.name),
    ...allowance.children.map((t) => t.name),
  ]);
  for (const c of allowance.children) {
    known(c.name);
    known(c.parent);
    if ((await auditTrigger(c.name)) !== null)
      throw new AllowanceRefused(`child table ${c.name} has an _audit_required trigger; list it under audited`);
    const fk = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM pg_constraint
       WHERE contype = 'f' AND conname = ${c.fkey} AND conrelid = to_regclass(${`public.${c.name}`})
         AND confrelid = to_regclass(${`public.${c.parent}`})`.execute(tx);
    if (fk.rows[0]?.n !== "1")
      throw new AllowanceRefused(`${c.fkey} is not a foreign key from ${c.name} to ${c.parent}`);
    if (!listed.has(c.parent))
      throw new AllowanceRefused(`parent ${c.parent} of ${c.name} is not listed in tables, audited or children`);
  }
  childrenOrder(allowance);
}

// ------------------------------------------------------------------------------------------------ the comparison

export interface RowComparison {
  /** Live rows by key: added, changed (keys) and the live encoded row. */
  readonly added: readonly EncodedRow[];
  readonly changed: readonly EncodedRow[];
  /** Keys present in the package and not on the target. */
  readonly missing: readonly string[];
  readonly unchanged: number;
}

/** The key of a package line: the JSON text of its primary-key tuple, as encodedRows gives it. */
function packageKey(line: string, table: TransferPlanTable): string {
  const row = JSON.parse(line) as Record<string, unknown>;
  return JSON.stringify(table.primaryKey.map((c) => (row[c] ?? null) as string | null));
}

/** The package's lines of `table` (the export's encoder output), by key. */
export async function packageLines(dir: string, file: string, table: TransferPlanTable): Promise<Map<string, string>> {
  const text = await readFile(confinedPath(dir, file), "utf8");
  const out = new Map<string, string>();
  for (const l of text.split("\n")) if (l !== "") out.set(packageKey(l, table), l);
  return out;
}

/** Row by row by primary key: each live row against the package row, both encoded by §2.3. */
export async function compareRows(
  tx: DbOrTx,
  table: TransferPlanTable,
  pkg: ReadonlyMap<string, string>,
  plan: TransferPlan,
  liveRows?: readonly EncodedRow[],
): Promise<RowComparison> {
  const live = liveRows ?? (await encodedRows(tx, table, plan.rewrittenColumns)).rows;
  const added: EncodedRow[] = [];
  const changed: EncodedRow[] = [];
  const seen = new Set<string>();
  let unchanged = 0;
  for (const r of live) {
    seen.add(r.key);
    const p = pkg.get(r.key);
    if (p === undefined) added.push(r);
    else if (p !== r.line) changed.push(r);
    else unchanged += 1;
  }
  const missing = [...pkg.keys()].filter((k) => !seen.has(k)).sort();
  return { added, changed, missing, unchanged };
}

// ------------------------------------------------------------------------------------------------ user_identity

/**
 * A1.9: the live user_identity rows with every `rebound` identity_rebind_event reversed (issuer and subject set back
 * to the old pair). Returns the reversed rows, the number of rebound identities, and the rebound identities whose
 * live pair differs from the event's new pair (unexplained).
 */
export async function reverseRebinds(
  tx: DbOrTx,
  plan: TransferPlan,
): Promise<{ rows: EncodedRow[]; rebound: number; unexplained: string[] }> {
  const table = plan.tables.find((t) => t.name === "user_identity")!;
  const enc = await encodedRows(tx, table, plan.rewrittenColumns);
  const col = (n: string) => enc.kinds.findIndex((k) => k.name === n);
  const [iUser, iIssuer, iSubject] = [col("user_id"), col("issuer"), col("subject")];
  const events = (
    await sql<{ user_id: string; old_issuer: string; old_subject: string; new_issuer: string; new_subject: string }>`
      SELECT user_id::text AS user_id, old_issuer, old_subject, new_issuer, new_subject FROM identity_rebind_event
       WHERE action = 'rebound' ORDER BY applied_at, id`.execute(tx)
  ).rows;
  const rows = [...enc.rows];
  const unexplained: string[] = [];
  for (const e of events) {
    const at = rows.findIndex(
      (r) =>
        r.values[iUser] === e.user_id && r.values[iIssuer] === e.new_issuer && r.values[iSubject] === e.new_subject,
    );
    if (at < 0) {
      unexplained.push(e.user_id);
      continue;
    }
    const values = [...rows[at]!.values];
    values[iIssuer] = e.old_issuer;
    values[iSubject] = e.old_subject;
    rows[at] = { key: rows[at]!.key, values, line: encodeLine(enc.kinds, values) };
  }
  return { rows, rebound: events.length, unexplained };
}

// ------------------------------------------------------------------------------------------------ audit_event

export interface ImportRecord {
  readonly id: string;
  readonly carriedRows: bigint;
  readonly carriedSeqMax: bigint;
  readonly baselineRows: bigint;
  readonly baselineSeqMin: bigint | null;
  readonly baselineSeqMax: bigint | null;
  readonly baselineDigest: string;
  readonly alreadyPresentRows: bigint;
}

export interface AuditTrailCheck {
  readonly ok: boolean;
  /** Lines for the report (the A2.7 reconstruction line among them). */
  readonly problems: readonly string[];
  readonly reconstructedRows: number;
  readonly reconstructedDigest: string;
  readonly baselineKept: boolean;
  readonly presentOk: boolean;
  readonly present: readonly AuditAlreadyPresent[];
  /** Rows after the baseline, by action. */
  readonly additions: ReadonlyMap<string, bigint>;
  readonly additionsTotal: bigint;
}

/** P from the latest migration.imported event of the import (A2.3), cross-checked by the caller. */
export async function presentFromTrail(tx: DbOrTx, importId: string): Promise<AuditAlreadyPresent[] | null> {
  const r = await sql<{ p: { to?: { entries?: AuditAlreadyPresent[] } } | null }>`
    SELECT changes -> 'auditAlreadyPresent' AS p FROM audit_event
     WHERE action = 'migration.imported' AND record_type = 'migration_import' AND record_id = ${importId}::uuid
     ORDER BY seq DESC LIMIT 1`.execute(tx);
  const entries = r.rows[0]?.p?.to?.entries;
  return Array.isArray(entries) ? entries : null;
}

/**
 * A1.5 with A2.3: the carried trail reconstructed and compared with the manifest's count and digest, `P` cross-checked
 * with migration_import, every P entry a baseline row (sorted, unique), the baseline as recorded at L2, the ranges not
 * interleaved; the rows after the baseline are additions, counted by action. Read-only.
 */
export async function checkAuditTrail(
  tx: DbOrTx,
  imp: ImportRecord,
  expected: { readonly rowCount: string; readonly contentDigest: string },
  plan: TransferPlan,
  measureBaseline: (
    tx: DbOrTx,
    m: bigint,
    max: bigint | null,
  ) => Promise<{ rows: bigint; seqMin: bigint | null; seqMax: bigint | null; digest: string }>,
): Promise<AuditTrailCheck> {
  const problems: string[] = [];
  const present = (await presentFromTrail(tx, imp.id)) ?? [];
  let presentOk = BigInt(present.length) === imp.alreadyPresentRows;
  if (!presentOk)
    problems.push(
      `  audit_event: migration.imported lists ${present.length} already-present events, migration_import records ${imp.alreadyPresentRows}`,
    );
  const ids = present.map((e) => e.id);
  if (ids.some((id, i) => !UUID.test(id) || (i > 0 && ids[i - 1]! >= id))) {
    presentOk = false;
    problems.push("  audit_event: the already-present entries are not sorted by id and unique");
  }
  if (present.length > 0 && presentOk) {
    const lo = imp.baselineSeqMin ?? 0n;
    const hi = imp.baselineSeqMax ?? -1n;
    const r = await sql<{ n: string }>`${sql.raw(
      `SELECT count(*)::text AS n FROM audit_event WHERE id = ANY('{${ids.join(",")}}'::uuid[]) ` +
        `AND seq BETWEEN ${lo.toString()} AND ${hi.toString()} AND source = 'migration' AND actor_type = 'system' ` +
        "AND actor_user_id IS NULL AND on_behalf_of_user_id IS NULL AND organization_id IS NULL AND transformation_id IS NULL",
    )}`.execute(tx);
    if (r.rows[0]?.n !== String(present.length)) {
      presentOk = false;
      problems.push("  audit_event: an already-present entry does not name a migration baseline event");
    }
  }
  const rec = await encodeCarriedAudit(tx, imp.carriedSeqMax, present, plan);
  const reconstructedOk = String(rec.rowCount) === expected.rowCount && rec.contentDigest === expected.contentDigest;
  if (!reconstructedOk)
    problems.push(
      `  audit_event: the reconstructed carried trail does not match the manifest (${rec.rowCount} rows, digest ${rec.contentDigest})`,
    );
  const b = await measureBaseline(tx, imp.carriedSeqMax, imp.baselineSeqMax);
  const baselineKept =
    b.rows === imp.baselineRows &&
    b.seqMin === imp.baselineSeqMin &&
    b.seqMax === imp.baselineSeqMax &&
    b.digest === imp.baselineDigest;
  if (!baselineKept) problems.push("  audit_event: the target's migration baseline differs from the import's record");
  const carriedMax = (
    await sql<{
      m: string | null;
    }>`SELECT max(seq)::text AS m FROM audit_event WHERE seq <= ${imp.carriedSeqMax.toString()}::bigint`.execute(tx)
  ).rows[0]?.m;
  const after = imp.baselineSeqMax ?? imp.carriedSeqMax;
  const interleaved =
    (carriedMax !== null && carriedMax !== undefined && BigInt(carriedMax) > imp.carriedSeqMax) ||
    (imp.baselineSeqMin !== null && imp.baselineSeqMin <= imp.carriedSeqMax);
  if (interleaved) problems.push("  audit_event: the carried, baseline and later ranges interleave");
  const adds = await sql<{ action: string; n: string }>`
    SELECT action, count(*)::text AS n FROM audit_event WHERE seq > ${after.toString()}::bigint
     GROUP BY action ORDER BY action COLLATE "C"`.execute(tx);
  const additions = new Map(adds.rows.map((r) => [r.action, BigInt(r.n)]));
  const additionsTotal = [...additions.values()].reduce((a, n) => a + n, 0n);
  return {
    ok: presentOk && reconstructedOk && baselineKept && !interleaved,
    problems,
    reconstructedRows: rec.rowCount,
    reconstructedDigest: rec.contentDigest,
    baselineKept,
    presentOk,
    present,
    additions,
    additionsTotal,
  };
}

// ------------------------------------------------------------------------------------------------ explanations

/**
 * A2.6 rule 3: each added or changed row of an audited table must have an explaining event (after the baseline, source
 * api or worker, by or on behalf of a listed actor, record_type = t, record_id = row id, new_version = row version when
 * the table has one). Returns the unexplained rows and the number of explaining events.
 */
export async function explainAudited(
  tx: DbOrTx,
  table: TransferPlanTable,
  rows: { readonly added: readonly EncodedRow[]; readonly changed: readonly EncodedRow[] },
  actors: readonly string[],
  baselineSeqMax: bigint,
): Promise<{ unexplainedAdded: EncodedRow[]; unexplainedChanged: EncodedRow[]; events: number }> {
  const versionAt = table.columns.findIndex((c) => c.name === "version");
  const idAt = table.columns.findIndex((c) => c.name === "id");
  const ev = await sql<{ record_id: string; new_version: number | null }>`
    SELECT record_id::text AS record_id, new_version FROM audit_event
     WHERE seq > ${baselineSeqMax.toString()}::bigint AND source IN ('api', 'worker') AND record_type = ${table.name}
       AND (actor_user_id = ANY(${[...actors]}::uuid[]) OR on_behalf_of_user_id = ANY(${[...actors]}::uuid[]))`.execute(
    tx,
  );
  const explaining = new Set(ev.rows.map((e) => `${e.record_id}|${versionAt < 0 ? "" : String(e.new_version)}`));
  const explained = (r: EncodedRow) =>
    explaining.has(`${r.values[idAt] ?? ""}|${versionAt < 0 ? "" : String(r.values[versionAt] ?? "null")}`);
  return {
    unexplainedAdded: rows.added.filter((r) => !explained(r)),
    unexplainedChanged: rows.changed.filter((r) => !explained(r)),
    events: ev.rows.length,
  };
}

/**
 * A2.6 rule 4: each added or changed row of a child table must reference, through the columns of `fkey`, a row of
 * `parent` in that parent's explained added or changed set. `parentRows` holds the explained parent rows.
 */
export async function explainChildren(
  tx: DbOrTx,
  child: TransferPlanTable,
  parent: TransferPlanTable,
  fkey: string,
  rows: { readonly added: readonly EncodedRow[]; readonly changed: readonly EncodedRow[] },
  parentRows: readonly EncodedRow[],
): Promise<{ unexplainedAdded: EncodedRow[]; unexplainedChanged: EncodedRow[] }> {
  const fk = (
    await sql<{ cols: string[]; refs: string[] }>`
      SELECT array(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(n, o)
                     JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n ORDER BY k.o) AS cols,
             array(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(n, o)
                     JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n ORDER BY k.o) AS refs
        FROM pg_constraint con WHERE con.contype = 'f' AND con.conname = ${fkey}
         AND con.conrelid = to_regclass(${`public.${child.name}`})`.execute(tx)
  ).rows[0]!;
  const at = (t: TransferPlanTable, c: string) => t.columns.findIndex((x) => x.name === c);
  const parentKeys = new Set(
    parentRows.map((r) => JSON.stringify(fk.refs.map((c) => r.values[at(parent, c)] ?? null))),
  );
  const ok = (r: EncodedRow) => {
    const vals = fk.cols.map((c) => r.values[at(child, c)] ?? null);
    return !vals.some((v) => v === null) && parentKeys.has(JSON.stringify(vals));
  };
  return {
    unexplainedAdded: rows.added.filter((r) => !ok(r)),
    unexplainedChanged: rows.changed.filter((r) => !ok(r)),
  };
}

/** The digest of encoded rows kept in encodedRows' primary-key order (a reversal never changes the key). */
export const digestOfRows = (rows: readonly EncodedRow[]): string => digestOfLines(rows.map((r) => r.line));

export type { Tx };
