#!/usr/bin/env node
// deploy/scripts/drill/allowance.mjs: builds the `mth-recheck-allowance/4` file of the drill's D9 mode-2 recheck from
// the journey's journal (ADR-0064 A1.9 with Amendment 2 §A2.6, Amendment 3 §A3.4 and Amendment 4 §A4.5; p7-work-split
// §B.6 DO-D2, §B.7 DO-D3, §B.8 DO-D4, §B.9 DO-D7; tests T-B15, T-B17; T-DG7-DO-D2 to T-DG7-DO-D4, T-DG7-DO-D7).
//
//   node deploy/scripts/drill/allowance.mjs --journal <journal.json> --out <allowance.json>
//        --reasons-out <allowance-reasons.json> [--database-url <target>] [--app-user-signin <measurement.json>]
//
// The eight keys of `/4` (A2.6, A3.4, A4.5):
// - `actors`: the target's app_user ids of the journalled sign-ins, resolved on the target by (issuer, subject)
//   (--database-url, through psql). Never "whatever is new" on the target: that would make D9 prove nothing.
// - `tables`: the journalled keys (from API responses and sign-ins) of every table that is not in `audited`. A sign-in
//   lists its `user_identity` key as changed, and its `app_user` key as changed only when T-B16's measurement
//   (--app-user-signin, `{ "appUserChangedBySignIn": true }`) says a sign-in changes `app_user`.
// - `audited`: the tables of D8_TOUCHED_AUDITED, each with `mustInclude` set to the journalled keys of that table.
// - `children`: D8_TOUCHED_CHILDREN (child, parent, fkey).
// - `counters`: D8_TOUCHED_COUNTERS, names from RECHECK_COUNTER_TABLES (A3.3); a counter table appears only there.
// - `lineage`: D8_TOUCHED_LINEAGE, names from RECHECK_LINEAGE_TABLES (A4.2), each with `mustInclude.added` set to the
//   journalled keys of that table (e.g. the KPI evaluations the API returned). A lineage table appears only there:
//   its journalled keys never go to `tables`, and a journalled `changed` key of it is refused (lineage is append-only).
// - `operational`: the minimum the run needs (OPERATIONAL_NEEDED, each with its reason), restricted to
//   RECHECK_OPERATIONAL_TABLES; a never-operational table is never listed there, whatever the input.
// D8_TOUCHED_AUDITED, D8_TOUCHED_CHILDREN, D8_TOUCHED_COUNTERS and D8_TOUCHED_LINEAGE are MEASURED by T-B17
// (deploy/scripts/tests/transfer-drill.test.mjs): it runs D8's write chain on a fresh seed-demo installation (shipped
// demo data, no fixture grant) and checks that the changed tables, minus `tables`, the operational list and
// user_identity, are exactly their union (on the full A3.6 chain C0-C6). Each table has its reason in allowance-reasons.json.
// The constants of the recheck come ONLY from packages/db/src/transfer/recheck.ts; a failing import is an error
// (exit 2), never a fallback. Duplicate keys are merged; a key both added and changed is listed as added only.
// Exit codes (p7-work-split §2 rule 4): 0 written, 1 a journal entry is invalid, 2 BLOCKED (usage, unreadable input or
// recheck.ts not importable), 3 BLOCKED (psql missing for a journal with sign-ins). Every value is SYNTHETIC; this
// approves nothing (no G1-G6, Finance or IT approval, and no DG gate).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RECHECK = join(REPO, "packages/db/src/transfer/recheck.ts");

/**
 * MEASURED BY T-B17 ON THE FULL ADR-0064 A3.6 CHAIN C0-C6 ON SHIPPED DEMO DATA (T-DG7-DO-D7 run 1,
 * docs/delivery/handbacks/DG7/T-DG7-DO-D7-evidence/t-b17-measurement.json): a fresh migrate + seed-demo (current period
 * open, no fixture grant), sign-in, createTransformation, the RAID item, the remedies, submitGate, decideGate
 * (deferred) and a 30 s worker wait. complete=true. Run 4 (t-b17-run4/) adds D9's report export (exportq, exportwait),
 * which T-B11 run 2 showed is part of the drill's writes: report_snapshot and its two children.
 *
 * The audited tables D8's write chain (journey.mjs --steps writes,approve) changes, measured by T-B17; each with its
 * reason. Every one has an enabled `<t>_audit_required` trigger and the primary key (id) (A2.6 rule 3).
 */
export const D8_TOUCHED_AUDITED = {
  automation_action_result:
    "the result rows of those automation executions, explained per execution by A4.4 (T-B17 measured 16 added, audit trigger on)",
  automation_execution:
    "the automation rules the chain's domain events trigger (createTransformation, the C1 acceptances, the gate events) and the depth-2 executions of the lineage outbox rows (T-B17 measured 16 added, audit trigger on)",
  diagnostic_item: "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  forum: "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  gate_instance:
    "created by createTransformation for the new transformation (T-B17 measured, audit trigger on); D8 (b)'s submission and decision change it",
  governance_matrix: "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  phase_step: "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  report_snapshot:
    "the snapshot the worker writes for D9's queued report export when it completes (T-DG7-DO-D7 T-B17 run 4 measured 1 added, audit trigger on)",
  roadmap_wave: "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  scoring_weight_set: "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  tom_canvas_cell: "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  transformation_config_pin:
    "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  transformation_decision_right:
    "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  transformation_raci_assignment:
    "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  transformation_raci_deliverable:
    "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  work_item: "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
};

/**
 * The foreign-key children D8's write chain adds or changes, measured by T-B17: rows with no audit trigger, each
 * referencing an explained parent row through `fkey` (A2.6 rule 4); each with its reason.
 */
export const D8_TOUCHED_CHILDREN = [
  {
    name: "scoped_assignment",
    parent: "app_user",
    fkey: "scoped_assignment_user_id_fkey",
    reason: "the creator's role on the new transformation; the creator is a journalled sign-in (app_user changed)",
  },
  {
    name: "scoring_weight",
    parent: "scoring_weight_set",
    fkey: "scoring_weight_weight_set_id_fkey",
    reason: "the weights of the scoring weight set createTransformation creates",
  },
  {
    name: "gate_submission_criterion",
    parent: "gate_submission",
    fkey: "gate_submission_criterion_gate_submission_id_fkey",
    reason:
      "the criterion snapshot rows of the journalled gate submission (submitGate, C3; T-DG7-DO-D7 measured 4 added)",
  },
  {
    name: "kpi_actual_value",
    parent: "kpi_actual",
    fkey: "kpi_actual_value_actual_fkey",
    reason: "the value entries of the journalled KPI actuals (submitKpiActual, C1; T-DG7-DO-D7 measured 3 added)",
  },
  {
    name: "kpi_actual_review",
    parent: "kpi_actual",
    fkey: "kpi_actual_review_actual_fkey",
    reason: "the review rows of the journalled KPI actuals, accepted on submit (C1; T-DG7-DO-D7 measured 3 added)",
  },
  {
    name: "report_snapshot_source",
    parent: "report_snapshot",
    fkey: "report_snapshot_source_snapshot_fkey",
    reason: "the source records of D9's export snapshot (T-DG7-DO-D7 T-B17 run 4 measured 3 added)",
  },
  {
    name: "report_snapshot_version",
    parent: "report_snapshot",
    fkey: "report_snapshot_version_snapshot_fkey",
    reason: "the methodology/configuration versions of D9's export snapshot (T-DG7-DO-D7 T-B17 run 4 measured 1 added)",
  },
];

/**
 * The counter tables D8's write chain moves, measured by T-B17 (A3.3: explained only by the explained added coded rows
 * of the scope); each with its reason.
 */
export const D8_TOUCHED_COUNTERS = {
  record_code_counter:
    "the RAID code counter of the carried transformation, moved by D8's RAID item (T-B17 measured: one counter row; A3.3)",
};

/**
 * The worker's system-lineage tables (RECHECK_LINEAGE_TABLES, A4.2) D8's write chain adds, measured by T-B17; each
 * with its reason. They are explained only through their recorded link to an explained outbox row or run (A4.2-A4.4).
 */
export const D8_TOUCHED_LINEAGE = {
  calculation_run:
    "the worker's KPI recalculation runs triggered by the kpi.actual_accepted events of the C1 actuals (L1; T-DG7-DO-D7 measured 3 added)",
  corrective_signal:
    "the KPI deviation signals the corrective starter derives from kpi.deviation_evaluated outbox rows (L5; T-DG7-DO-D7 measured 3 added)",
  data_quality_finding:
    "the data-quality findings those runs record, counted by finding_count (L4; T-DG7-DO-D7 measured 3 added)",
  kpi_evaluation:
    "the evaluations of those runs, counted by evaluation_count; the ones getKpiStatus returned are in mustInclude (L2; T-DG7-DO-D7 measured 6 added)",
};

/**
 * ADR-0064 A4.5: a `/4` allowance with corrective_signal in `lineage` must list corrective_case in `audited` (a
 * signal's case is NULL or an explained corrective_case row). This is a structural requirement of the parser, not a
 * measurement: T-B17 measured no corrective_case change, so it is added by buildAllowance only when that rule needs it,
 * and T-B17 asserts it stays unchanged. An audited listing explains only rows with audit events by the journalled actors.
 */
export const A45_REQUIRED_AUDITED = {
  corrective_case:
    "required by ADR-0064 A4.5 because corrective_signal is in lineage; T-DG7-DO-D7 measured no corrective_case change",
};

/** The operational tables the drill needs, each with its reason (allowance-reasons.json). */
export const OPERATIONAL_NEEDED = {
  job_run: "the worker records a run of every scheduled and queued job after the target starts (D7, D9)",
  outbox_event: "the gate submission and decision of D8 (b) publish domain events through the outbox",
  processed_message: "the worker marks each outbox message it consumes",
  inbox_notification: "the D8 (b) gate submission notifies its approver; the recipients are not chosen by the drill",
  notification_delivery: "the worker records the delivery attempts of those notifications",
  export_job: "D9 queues one report export before the restart (job check)",
  export_job_progress: "the worker records that export's progress",
};

/** The recheck's constants and parser, from packages/db/src/transfer/recheck.ts only (no fallback). */
export async function constants() {
  let m;
  try {
    m = await import(pathToFileURL(RECHECK).href);
  } catch (e) {
    throw Object.assign(new Error(`cannot import packages/db/src/transfer/recheck.ts: ${e.message}`), { code: 2 });
  }
  for (const k of [
    "ALLOWANCE_SCHEMA_VERSION",
    "RECHECK_OPERATIONAL_TABLES",
    "RECHECK_NEVER_OPERATIONAL",
    "RECHECK_COUNTER_TABLES",
    "RECHECK_LINEAGE_TABLES",
    "isNeverOperational",
    "parseAllowance",
  ])
    if (!m[k]) throw Object.assign(new Error(`packages/db/src/transfer/recheck.ts does not export ${k}`), { code: 2 });
  return {
    source: "packages/db/src/transfer/recheck.ts",
    schemaVersion: m.ALLOWANCE_SCHEMA_VERSION,
    operational: new Set(m.RECHECK_OPERATIONAL_TABLES),
    counters: new Set(Object.keys(m.RECHECK_COUNTER_TABLES)),
    lineage: new Set(Object.keys(m.RECHECK_LINEAGE_TABLES)),
    isNever: m.isNeverOperational,
    parseAllowance: m.parseAllowance,
  };
}

const TABLE = /^[a-z][a-z0-9_]{0,62}$/;
const keyText = (k) => JSON.stringify(k);
const sortKeys = (m) => [...m.values()].sort((a, b) => keyText(a).localeCompare(keyText(b)));

/**
 * Builds the allowance from journal entries.
 * @param entries [{ table, key: string[], op: "added"|"changed"|"signin", via }]
 * @param opts { identity(issuer, subject) -> { id, userId } | null, appUserChangedBySignIn: boolean, constants,
 *               audited?: Record<string, string>, children?: { name, parent, fkey, reason }[],
 *               counters?: Record<string, string>, lineage?: Record<string, string> }
 */
export function buildAllowance(
  entries,
  {
    identity,
    appUserChangedBySignIn = false,
    constants: k,
    audited = D8_TOUCHED_AUDITED,
    children = D8_TOUCHED_CHILDREN,
    counters = D8_TOUCHED_COUNTERS,
    lineage = D8_TOUCHED_LINEAGE,
  },
) {
  const keyed = new Map();
  const actors = new Set();
  const errors = [];
  const put = (name, key, op) => {
    const t = keyed.get(name) ?? { name, added: new Map(), changed: new Map() };
    const id = keyText(key);
    if (op === "added") {
      t.added.set(id, key);
      t.changed.delete(id);
    } else if (!t.added.has(id)) t.changed.set(id, key);
    keyed.set(name, t);
  };
  for (const [i, e] of entries.entries()) {
    if (!e || typeof e.table !== "string" || !TABLE.test(e.table)) {
      errors.push(`entry ${i}: invalid table`);
      continue;
    }
    if (!Array.isArray(e.key) || e.key.length === 0 || e.key.some((x) => typeof x !== "string" || x === "")) {
      errors.push(`entry ${i} (${e.table}): invalid key`);
      continue;
    }
    if (e.table === "audit_event") {
      errors.push(`entry ${i}: audit_event may not appear in an allowance (A1.9 rule 1)`);
      continue;
    }
    if (e.op === "signin") {
      if (e.table !== "user_identity" || e.key.length !== 2) {
        errors.push(`entry ${i}: a sign-in entry is user_identity [issuer, subject]`);
        continue;
      }
      const found = identity(e.key[0], e.key[1]);
      if (!found) {
        errors.push(`entry ${i}: no identity (${e.key[0]}, ${e.key[1]}) on the target`);
        continue;
      }
      actors.add(found.userId);
      put("user_identity", [found.id], "changed");
      if (appUserChangedBySignIn) put("app_user", [found.userId], "changed");
      continue;
    }
    if (e.op !== "added" && e.op !== "changed") {
      errors.push(`entry ${i} (${e.table}): op ${e.op} is not added, changed or signin`);
      continue;
    }
    put(e.table, e.key, e.op);
  }
  if (Object.hasOwn(lineage, "corrective_signal") && !Object.hasOwn(audited, "corrective_case"))
    audited = { ...audited, ...A45_REQUIRED_AUDITED };
  const auditedNames = Object.keys(audited).sort();
  const childNames = new Set(children.map((c) => c.name));
  for (const c of children)
    if (keyed.has(c.name)) errors.push(`${c.name} is a D8 child table but the journal names its keys`);
  const counterNames = Object.keys(counters).sort();
  for (const c of counterNames) {
    if (!k.counters.has(c)) errors.push(`counter table ${c} is not in RECHECK_COUNTER_TABLES`);
    if (keyed.has(c) || childNames.has(c) || auditedNames.includes(c))
      errors.push(`${c} is a D8 counter table and may appear only in counters`);
  }
  for (const name of keyed.keys())
    if (k.counters.has(name) && !counterNames.includes(name))
      errors.push(`${name} is a counter table (RECHECK_COUNTER_TABLES): the journal may not name its keys`);
  const lineageNames = Object.keys(lineage).sort();
  for (const l of lineageNames) {
    if (!k.lineage.has(l)) errors.push(`lineage table ${l} is not in RECHECK_LINEAGE_TABLES`);
    if (childNames.has(l) || auditedNames.includes(l) || counterNames.includes(l))
      errors.push(`${l} is a D8 lineage table and may appear only in lineage`);
    if (keyed.get(l)?.changed.size > 0)
      errors.push(`${l} is a lineage table (append-only, A4.2): the journal may not name a changed key`);
  }
  for (const name of keyed.keys())
    if (k.lineage.has(name) && !lineageNames.includes(name))
      errors.push(`${name} is a lineage table (RECHECK_LINEAGE_TABLES) missing from D8_TOUCHED_LINEAGE`);
  const tables = [...keyed.values()]
    .filter((t) => !auditedNames.includes(t.name) && !k.lineage.has(t.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ name: t.name, added: sortKeys(t.added), changed: sortKeys(t.changed) }));
  const listed = new Set([
    ...tables.map((t) => t.name),
    ...auditedNames,
    ...childNames,
    ...counterNames,
    ...lineageNames,
  ]);
  const operational = Object.keys(OPERATIONAL_NEEDED).filter(
    (t) => k.operational.has(t) && !k.isNever(t) && !listed.has(t),
  );
  const allowance = {
    schemaVersion: k.schemaVersion,
    actors: [...actors].sort(),
    tables,
    audited: auditedNames.map((name) => {
      const j = keyed.get(name);
      return {
        name,
        mustInclude: { added: j ? sortKeys(j.added) : [], changed: j ? sortKeys(j.changed) : [] },
      };
    }),
    children: children.map(({ name, parent, fkey }) => ({ name, parent, fkey })),
    counters: counterNames,
    lineage: lineageNames.map((name) => ({
      name,
      mustInclude: { added: keyed.get(name) ? sortKeys(keyed.get(name).added) : [] },
    })),
    operational,
  };
  const reasons = {
    schemaVersion: "mth-recheck-allowance-reasons/4",
    constantsSource: k.source,
    appUserChangedBySignIn,
    actors: {
      count: allowance.actors.length,
      reason: "the app_user ids of the journalled sign-ins, resolved on the target by (issuer, subject)",
    },
    operational: operational.map((t) => ({ table: t, reason: OPERATIONAL_NEEDED[t] })),
    tables: tables.map((t) => ({
      table: t.name,
      added: t.added.length,
      changed: t.changed.length,
      reason: "keys from the journey's API responses and sign-ins (journal.json); never read from the target",
    })),
    audited: allowance.audited.map((a) => ({
      table: a.name,
      mustIncludeAdded: a.mustInclude.added.length,
      mustIncludeChanged: a.mustInclude.changed.length,
      reason: audited[a.name],
    })),
    children: children.map((c) => ({ table: c.name, parent: c.parent, fkey: c.fkey, reason: c.reason })),
    counters: counterNames.map((c) => ({ table: c, reason: counters[c] })),
    lineage: allowance.lineage.map((l) => ({
      table: l.name,
      mustIncludeAdded: l.mustInclude.added.length,
      reason: lineage[l.name],
    })),
    note: "SYNTHETIC drill data. The allowance proves only that exactly these keys changed, or rows audited as changed by these actors, or their foreign-key children, or counter steps issued to explained coded rows, or worker lineage rows linked to an explained outbox row or run (ADR-0064 A1.11 residual 3, A2.6, A3.3, A4.2).",
  };
  return { allowance, reasons, errors };
}

function psqlIdentity(url) {
  return (issuer, subject) => {
    const r = spawnSync(
      "psql",
      [
        "-X",
        "-q",
        "-A",
        "-t",
        "-F",
        ",",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        `iss=${issuer}`,
        "-v",
        `sub=${subject}`,
        "-d",
        url,
      ],
      {
        input: "SELECT id, user_id FROM user_identity WHERE issuer = :'iss' AND subject = :'sub';\n",
        encoding: "utf8",
      },
    );
    if (r.error) throw Object.assign(new Error("psql not found"), { code: 3 });
    if (r.status !== 0) throw new Error(`psql: ${r.stderr.trim()}`);
    const line = r.stdout.trim();
    if (!line) return null;
    const [id, userId] = line.split(",");
    return { id, userId };
  };
}

async function main() {
  let v;
  try {
    ({ values: v } = parseArgs({
      args: process.argv.slice(2),
      options: Object.fromEntries(
        ["journal", "out", "reasons-out", "database-url", "app-user-signin"].map((k) => [k, { type: "string" }]),
      ),
      strict: true,
    }));
  } catch {
    v = {};
  }
  if (!v.journal || !v.out || !v["reasons-out"]) {
    console.error(
      "BLOCKED: usage: allowance.mjs --journal <journal.json> --out <allowance.json> --reasons-out <reasons.json> [--database-url <url>] [--app-user-signin <measurement.json>]",
    );
    process.exit(2);
  }
  let entries, appUser;
  try {
    entries = JSON.parse(readFileSync(v.journal, "utf8")).entries;
    if (!Array.isArray(entries)) throw new Error("no entries[]");
    appUser = v["app-user-signin"]
      ? JSON.parse(readFileSync(v["app-user-signin"], "utf8")).appUserChangedBySignIn === true
      : false;
  } catch (e) {
    console.error(`BLOCKED: allowance: unreadable input: ${e.message}`);
    process.exit(2);
  }
  const needsDb = entries.some((e) => e?.op === "signin");
  if (needsDb && !v["database-url"]) {
    console.error("BLOCKED: allowance: the journal has sign-ins; --database-url is needed to resolve them");
    process.exit(2);
  }
  let k;
  try {
    k = await constants();
  } catch (e) {
    console.error(`BLOCKED: allowance: ${e.message}`);
    process.exit(2);
  }
  let built;
  try {
    built = buildAllowance(entries, {
      identity: needsDb ? psqlIdentity(v["database-url"]) : () => null,
      appUserChangedBySignIn: appUser,
      constants: k,
    });
  } catch (e) {
    console.error(`BLOCKED: allowance: ${e.message}`);
    process.exit(e.code === 3 ? 3 : 2);
  }
  if (built.errors.length > 0) {
    for (const e of built.errors) console.error(`allowance: ${e}`);
    process.exit(1);
  }
  const text = JSON.stringify(built.allowance, null, 2) + "\n";
  try {
    k.parseAllowance(new TextEncoder().encode(text));
  } catch (e) {
    console.error(`allowance: the built file is refused by parseAllowance: ${e.message}`);
    process.exit(1);
  }
  writeFileSync(v.out, text);
  writeFileSync(v["reasons-out"], JSON.stringify(built.reasons, null, 2) + "\n");
  console.log(
    `allowance: ${built.allowance.actors.length} actors, ${built.allowance.tables.length} tables with exact keys, ${built.allowance.audited.length} audited, ${built.allowance.children.length} children, ${built.allowance.counters.length} counters, ${built.allowance.lineage.length} lineage, ${built.allowance.operational.length} operational; constants from ${k.source}`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
