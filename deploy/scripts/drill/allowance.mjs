#!/usr/bin/env node
// deploy/scripts/drill/allowance.mjs: builds the `mth-recheck-allowance/1` file of the drill's D9 mode-2 recheck from
// the journey's journal (ADR-0064 A1.9; p7-work-split §B.6 DO-D2; test T-B15; T-DG7-DO-D2).
//
//   node deploy/scripts/drill/allowance.mjs --journal <journal.json> --out <allowance.json>
//        --reasons-out <allowance-reasons.json> [--database-url <target>] [--app-user-signin <measurement.json>]
//
// - Keys come ONLY from the journal, which the journey fills from API responses and sign-ins. This tool never lists
//   "whatever is new" on the target: that would make D9 prove nothing.
// - `user_identity` journal entries carry (issuer, subject) of a user who signed in; they are resolved to the
//   identity's primary key on the target by (issuer, subject) (--database-url, through psql) and listed as `changed`
//   (a sign-in updates the identity). Their `app_user` keys are listed as `changed` only when T-B16's measurement
//   (--app-user-signin, `{ "appUserChangedBySignIn": true }`) says a sign-in changes `app_user`.
// - `operational` is the minimum the run needs (OPERATIONAL_NEEDED below, each with its reason), restricted to
//   RECHECK_OPERATIONAL_TABLES. A table of RECHECK_NEVER_OPERATIONAL is never listed there, whatever the input.
// - Duplicate keys are merged; a key both added and changed is listed as added only (the package has no such row).
// The constants are read from packages/db/src/transfer/recheck.ts when that module exists (T-DG7-BE-R1); until then
// the literal lists of ADR-0064 A1.9 are used, and the report says which source was used.
// Exit codes (p7-work-split §2 rule 4): 0 written, 1 a journal entry is invalid, 2 BLOCKED (usage or unreadable
// input), 3 BLOCKED (psql missing for a journal with sign-ins). Every value is SYNTHETIC; this approves nothing.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RECHECK = join(REPO, "packages/db/src/transfer/recheck.ts");

/** ADR-0064 A1.9, "The initial RECHECK_OPERATIONAL_TABLES". */
export const A19_OPERATIONAL = [
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
/** ADR-0064 A1.9 rule 6, the named tables (the 17 financial tables of T-C17 are added from recheck.ts when present). */
export const A19_NEVER_OPERATIONAL = [
  "audit_event",
  "app_user",
  "user_identity",
  "scoped_assignment",
  "delegation",
  "gate_decision",
  "approval",
  "approval_decision",
];
const neverByRule = (t) => t.startsWith("decision");

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

/** The constants: recheck.ts when it exists (BE-R1), else ADR-0064 A1.9's literal lists. */
export async function constants() {
  if (existsSync(RECHECK)) {
    try {
      const m = await import(pathToFileURL(RECHECK).href);
      if (m.RECHECK_OPERATIONAL_TABLES && m.RECHECK_NEVER_OPERATIONAL)
        return {
          source: "packages/db/src/transfer/recheck.ts",
          operational: new Set(m.RECHECK_OPERATIONAL_TABLES),
          never: new Set([...m.RECHECK_NEVER_OPERATIONAL, ...A19_NEVER_OPERATIONAL]),
          parseAllowance: m.parseAllowance ?? null,
        };
    } catch {
      /* fall through: the literal lists */
    }
  }
  return {
    source: "ADR-0064 A1.9 literal lists (packages/db/src/transfer/recheck.ts not present)",
    operational: new Set(A19_OPERATIONAL),
    never: new Set(A19_NEVER_OPERATIONAL),
    parseAllowance: null,
  };
}

const TABLE = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Builds the allowance from journal entries.
 * @param entries [{ table, key: string[], op: "added"|"changed"|"signin", via }]
 * @param opts { identity(issuer, subject) -> { id, userId } | null, appUserChangedBySignIn: boolean, constants }
 */
export function buildAllowance(entries, { identity, appUserChangedBySignIn = false, constants: k }) {
  const tables = new Map();
  const errors = [];
  const put = (name, key, op) => {
    const t = tables.get(name) ?? { name, added: new Map(), changed: new Map() };
    const id = JSON.stringify(key);
    if (op === "added") {
      t.added.set(id, key);
      t.changed.delete(id);
    } else if (!t.added.has(id)) t.changed.set(id, key);
    tables.set(name, t);
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
  const operational = Object.keys(OPERATIONAL_NEEDED).filter(
    (t) => k.operational.has(t) && !k.never.has(t) && !neverByRule(t) && !tables.has(t),
  );
  const sortKeys = (m) => [...m.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const allowance = {
    schemaVersion: "mth-recheck-allowance/1",
    tables: [...tables.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ name: t.name, added: sortKeys(t.added), changed: sortKeys(t.changed) })),
    operational,
  };
  const reasons = {
    schemaVersion: "mth-recheck-allowance-reasons/1",
    constantsSource: k.source,
    appUserChangedBySignIn,
    operational: operational.map((t) => ({ table: t, reason: OPERATIONAL_NEEDED[t] })),
    tables: allowance.tables.map((t) => ({
      table: t.name,
      added: t.added.length,
      changed: t.changed.length,
      reason: "keys from the journey's API responses and sign-ins (journal.json); never read from the target",
    })),
    note: "SYNTHETIC drill data. The allowance proves only that exactly these keys changed (ADR-0064 A1.11 residual 3).",
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
  const k = await constants();
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
  writeFileSync(v.out, JSON.stringify(built.allowance, null, 2) + "\n");
  writeFileSync(v["reasons-out"], JSON.stringify(built.reasons, null, 2) + "\n");
  console.log(
    `allowance: ${built.allowance.tables.length} tables with exact keys, ${built.allowance.operational.length} operational; constants from ${k.source}`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
