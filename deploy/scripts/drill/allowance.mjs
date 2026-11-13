#!/usr/bin/env node
// deploy/scripts/drill/allowance.mjs: builds the `mth-recheck-allowance/2` file of the drill's D9 mode-2 recheck from
// the journey's journal (ADR-0064 A1.9 with Amendment 2 §A2.6; p7-work-split §B.6 DO-D2, §B.7 DO-D3; tests T-B15,
// T-B17; T-DG7-DO-D2, T-DG7-DO-D3).
//
//   node deploy/scripts/drill/allowance.mjs --journal <journal.json> --out <allowance.json>
//        --reasons-out <allowance-reasons.json> [--database-url <target>] [--app-user-signin <measurement.json>]
//
// The six keys of `/2` (A2.6):
// - `actors`: the target's app_user ids of the journalled sign-ins, resolved on the target by (issuer, subject)
//   (--database-url, through psql). Never "whatever is new" on the target: that would make D9 prove nothing.
// - `tables`: the journalled keys (from API responses and sign-ins) of every table that is not in `audited`. A sign-in
//   lists its `user_identity` key as changed, and its `app_user` key as changed only when T-B16's measurement
//   (--app-user-signin, `{ "appUserChangedBySignIn": true }`) says a sign-in changes `app_user`.
// - `audited`: the tables of D8_TOUCHED_AUDITED, each with `mustInclude` set to the journalled keys of that table.
// - `children`: D8_TOUCHED_CHILDREN (child, parent, fkey).
// - `operational`: the minimum the run needs (OPERATIONAL_NEEDED, each with its reason), restricted to
//   RECHECK_OPERATIONAL_TABLES; a never-operational table is never listed there, whatever the input.
// D8_TOUCHED_AUDITED and D8_TOUCHED_CHILDREN are MEASURED by T-B17 (deploy/scripts/tests/transfer-drill.test.mjs): it
// runs D8's write chain on a fixture installation and checks that the changed tables, minus `tables`, the operational
// list and user_identity, are exactly their union. Each table has its reason in allowance-reasons.json.
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
 * MEASURED BY T-B17 ON A PARTIAL CHAIN (T-DG7-DO-D3 run 9, docs/delivery/handbacks/DG7/T-DG7-DO-D3-evidence/
 * t-b17-measurement.json): sign-in, createTransformation, the RAID item and the KPI value ran; the gate submission was
 * refused on the seed-demo data (G5's mandatory criteria incomplete), so the tables the submission and the decision
 * change are NOT yet measured, and T-B17 fails until the chain runs to the end.
 *
 * The audited tables D8's write chain (journey.mjs --steps writes,approve) changes, measured by T-B17; each with its
 * reason. Every one has an enabled `<t>_audit_required` trigger and the primary key (id) (A2.6 rule 3).
 */
export const D8_TOUCHED_AUDITED = {
  automation_action_result: "the result row of that automation run (T-B17 measured, audit trigger on)",
  automation_execution:
    "the automation rule that createTransformation triggers runs once for the new transformation (T-B17 measured, audit trigger on)",
  diagnostic_item: "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  forum: "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  gate_instance:
    "created by createTransformation for the new transformation (T-B17 measured, audit trigger on); D8 (b)'s submission and decision change it",
  governance_matrix: "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
  phase_step: "created by createTransformation for the new transformation (T-B17 measured, audit trigger on)",
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
    name: "kpi_actual_value",
    parent: "kpi_actual",
    fkey: "kpi_actual_value_actual_fkey",
    reason: "the KPI value version D8 (b) adds to its journalled kpi_actual; the API presents it by valueNo, not by id",
  },
  {
    name: "record_code_counter",
    parent: "transformation",
    fkey: "record_code_counter_transformation_id_fkey",
    reason: "the record code counter createTransformation starts for the new transformation",
  },
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
];

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
  for (const k of ["RECHECK_OPERATIONAL_TABLES", "RECHECK_NEVER_OPERATIONAL", "isNeverOperational", "parseAllowance"])
    if (!m[k]) throw Object.assign(new Error(`packages/db/src/transfer/recheck.ts does not export ${k}`), { code: 2 });
  return {
    source: "packages/db/src/transfer/recheck.ts",
    schemaVersion: m.ALLOWANCE_SCHEMA_VERSION,
    operational: new Set(m.RECHECK_OPERATIONAL_TABLES),
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
 *               audited?: Record<string, string>, children?: { name, parent, fkey, reason }[] }
 */
export function buildAllowance(
  entries,
  {
    identity,
    appUserChangedBySignIn = false,
    constants: k,
    audited = D8_TOUCHED_AUDITED,
    children = D8_TOUCHED_CHILDREN,
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
  const auditedNames = Object.keys(audited).sort();
  const childNames = new Set(children.map((c) => c.name));
  for (const c of children)
    if (keyed.has(c.name)) errors.push(`${c.name} is a D8 child table but the journal names its keys`);
  const tables = [...keyed.values()]
    .filter((t) => !auditedNames.includes(t.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ name: t.name, added: sortKeys(t.added), changed: sortKeys(t.changed) }));
  const listed = new Set([...tables.map((t) => t.name), ...auditedNames, ...childNames]);
  const operational = Object.keys(OPERATIONAL_NEEDED).filter(
    (t) => k.operational.has(t) && !k.isNever(t) && !listed.has(t),
  );
  const allowance = {
    schemaVersion: "mth-recheck-allowance/2",
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
    operational,
  };
  const reasons = {
    schemaVersion: "mth-recheck-allowance-reasons/2",
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
    note: "SYNTHETIC drill data. The allowance proves only that exactly these keys changed, or rows audited as changed by these actors, or their foreign-key children (ADR-0064 A1.11 residual 3, A2.6).",
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
    `allowance: ${built.allowance.actors.length} actors, ${built.allowance.tables.length} tables with exact keys, ${built.allowance.audited.length} audited, ${built.allowance.children.length} children, ${built.allowance.operational.length} operational; constants from ${k.source}`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
