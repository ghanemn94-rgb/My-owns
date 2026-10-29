#!/usr/bin/env node
// The synthetic load dataset `mth_load_v1` (ADR-0058 §2; REQ-S20-029 "a documented realistic load dataset"; T-DG6-DO-E).
//
//   DATABASE_OWNER_URL=postgres://…  node deploy/load/generate.mjs [--profile default|register-1000|smoke] [--seed N]
//
// What it does, in ONE transaction on a migrated, EMPTY database (owner role, every trigger enabled):
//   1. writes the `load_dataset_marker` row FIRST, with the exact counts this profile produces. Migration 0108 accepts
//      it only in an empty database without a production or demo marker (load_dataset_marker_empty_database), so a
//      production or demo database never receives load data;
//   2. writes the organization, business units, users and their scoped assignments, the transformations (each through
//      the product's own p4_instantiate_transformation, which runs the P3 and P2 structure, plus the forms pin the API's
//      initializer writes), initiatives, KPI definitions with an active version, monthly reporting periods and the
//      KPI-period actuals (decimal-string values; statuses submitted, accepted and rejected, each with its value row
//      and, when decided, its review row);
//   3. steps initiatives and KPI definitions through version updates until audit_event holds exactly the marker's count.
// Every row is written with its audit event in the same transaction (the deferred `*_audit_required` constraints hold
// at commit). No trigger is disabled and session_replication_role is never changed.
//
// Determinism: ids are md5-derived UUIDs of (dataset, seed, kind, ordinal); every choice comes from a 32-bit mulberry32
// PRNG seeded with --seed (default 20261027, recorded in the marker); every timestamp the generator writes is derived
// from a fixed synthetic clock. Rows created inside the product's instantiation function keep that function's own
// generated ids and now() (the product path, unchanged); `datasetRowHashes` hashes the generator's own rows.
//
// SYNTHETIC and labelled: every organization, user and record name starts with "LOAD " (en) or "تجريبي " (ar); e-mails
// use the reserved example.invalid domain. Nothing is read from the demo seed (packages/db/src/demo/**) or from real
// data, and the demo seed reads nothing from here (ADR-0058 §2, D-195 seam 25). It grants no real business, Finance or
// IT approval; the figures measured on it are sandbox engineering measurements, never Mobily production capacity.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// `pg` is @mth/db's own dependency (no new dependency): resolved from that package, not from the repository root.
const requireFromDb = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const pg = requireFromDb("pg");

export const DATASET_CODE = "mth_load_v1";
export const GENERATOR_VERSION = "1.0.0";
export const DEFAULT_SEED = 20261027;
/** The issuer that names every load identity and load session (ADR-0058 §4). Never a real IdP. */
export const LOAD_ISSUER = "urn:mth:load-harness";
/** The synthetic clock every generated timestamp derives from (never the real clock). */
export const SYNTHETIC_CLOCK = "2026-09-01T06:00:00.000Z";
const REQUEST_ID = "mth-load-generate";
const STEP_TEXT = {
  initiative: "Synthetic load objective, revision ",
  kpi_definition: "Synthetic load-test KPI, revision ",
  benefit: "Synthetic load-test benefit, revision ",
};
const REASON = "Synthetic load dataset mth_load_v1 (deploy/load/generate.mjs); not real data, approves nothing";

/** The virtual-user role mix of ADR-0058 §2 (100 users), in user-number order. */
const VIRTUAL_ROLE_MIX = { default: { TL: 30, BO: 20, WL: 20, KDS: 15, FIN: 10, AUD: 5 } };

/** The other record families of ADR-0058 §2, spread over the transformations in proportion to their initiatives. */
const RECORDS_DEFAULT = Object.freeze({
  benefits: 400,
  raidEntries: 1500,
  dependencies: 500,
  decisions: 500,
  deliverables: 1000,
  evidenceNotes: 1000,
});

/**
 * The profiles. `default` is ADR-0058 §2 (the M0398 sizes); `register-1000` adds the LOAD-R1K transformation with 1,000
 * initiatives for the REQ-S15-013 register check only; `smoke` is a small profile for the determinism test and is
 * never a load-run profile.
 */
export const PROFILES = Object.freeze({
  default: Object.freeze({
    transformations: 50,
    largestInitiatives: 250,
    initiatives: 1000,
    kpisPerTransformation: 10,
    periods: 20,
    auditEvents: 100_000,
    roleMix: VIRTUAL_ROLE_MIX.default,
    namedUsers: 20,
    registerInitiatives: 0,
    records: RECORDS_DEFAULT,
  }),
  "register-1000": Object.freeze({
    transformations: 50,
    largestInitiatives: 250,
    initiatives: 1000,
    kpisPerTransformation: 10,
    periods: 20,
    auditEvents: 105_000,
    roleMix: VIRTUAL_ROLE_MIX.default,
    namedUsers: 20,
    registerInitiatives: 1000,
    records: RECORDS_DEFAULT,
  }),
  smoke: Object.freeze({
    transformations: 3,
    largestInitiatives: 12,
    initiatives: 30,
    kpisPerTransformation: 2,
    periods: 3,
    auditEvents: 2_500,
    roleMix: { TL: 3, BO: 2, WL: 2, KDS: 1, FIN: 1, AUD: 1 },
    namedUsers: 4,
    registerInitiatives: 0,
    records: { benefits: 12, raidEntries: 30, dependencies: 10, decisions: 10, deliverables: 30, evidenceNotes: 20 },
  }),
});

const PHASES = ["diagnose", "define", "design", "mobilize", "transform", "realize"];
const INITIATIVE_STATUSES = ["draft", "submitted", "ranked", "selected", "funded", "launched"];
const EN_WORDS = [
  "roaming",
  "billing",
  "network",
  "retail",
  "digital",
  "onboarding",
  "churn",
  "fibre",
  "enterprise",
  "prepaid",
  "postpaid",
  "care",
  "analytics",
  "partner",
  "procurement",
  "spectrum",
  "activation",
  "loyalty",
  "payments",
  "automation",
];
const AR_WORDS = [
  "التجوال",
  "الفوترة",
  "الشبكة",
  "التجزئة",
  "الرقمية",
  "الولاء",
  "المدفوعات",
  "الألياف",
  "الشركات",
  "الرعاية",
];
const KPI_SHAPES = [
  { unit: "count", nature: "flow", rule: "sum", polarity: "higher_is_better", label: "activations" },
  { unit: "percentage", nature: "stock", rule: "last_value", polarity: "higher_is_better", label: "%" },
  { unit: "currency", nature: "flow", rule: "sum", polarity: "higher_is_better", label: "SAR" },
  { unit: "duration", nature: "stock", rule: "last_value", polarity: "lower_is_better", label: "minutes" },
  { unit: "count", nature: "flow", rule: "sum", polarity: "lower_is_better", label: "complaints" },
];

/** mulberry32: a 32-bit seeded PRNG (ADR-0058 §2). Returns integers in [0, 2^32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** A deterministic UUID for (seed, kind, ordinal): md5 of the key, as SQL's md5(key)::uuid computes it. */
export function loadId(seed, kind, n) {
  const h = createHash("md5").update(`${DATASET_CODE}:${seed}:${kind}:${n}`, "utf8").digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const pad = (n, w) => String(n).padStart(w, "0");

/** The exact counts a profile produces (written into the marker before any other row). */
export function plannedCounts(profileName) {
  const p = PROFILES[profileName];
  if (!p) throw new Error(`unknown profile ${profileName}`);
  const virtual = Object.values(p.roleMix).reduce((s, n) => s + n, 0);
  return {
    transformations: p.transformations + (p.registerInitiatives > 0 ? 1 : 0),
    initiatives: p.initiatives + p.registerInitiatives,
    kpiActuals: p.transformations * p.kpisPerTransformation * p.periods,
    auditEvents: p.auditEvents,
    users: virtual + p.namedUsers,
  };
}

/** The initiatives per transformation: the largest first, the rest spread as evenly as possible. */
export function initiativeSpread(p) {
  const out = [p.largestInitiatives];
  const rest = p.initiatives - p.largestInitiatives;
  const others = p.transformations - 1;
  for (let i = 0; i < others; i += 1) out.push(Math.floor(rest / others) + (i < rest % others ? 1 : 0));
  return out;
}

/** Splits `total` over `weights` in proportion (largest remainder; ties to the lower index). Deterministic. */
export function proportional(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map((x) => Math.floor(x));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k += 1, left -= 1) out[order[k % order.length][1]] += 1;
  return out;
}

/** Inserts `rows` (objects with the same keys) into `table` in batches; unlisted columns keep their defaults. */
async function insertRows(client, table, rows, batch = 1000) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const list = cols.map((c) => `"${c}"`).join(", ");
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    await client.query(
      `INSERT INTO ${table} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`,
      [JSON.stringify(chunk)],
    );
  }
}

/**
 * Generates the dataset into the database at `ownerUrl` (owner role). Throws, with nothing written, when the database
 * is not an empty, unmarked one (the 0108 guard) or the environment is production or demo.
 */
export async function generate(ownerUrl, options = {}) {
  const profileName = options.profile ?? "default";
  const p = PROFILES[profileName];
  if (!p) throw new Error(`unknown profile ${profileName} (default, register-1000, smoke)`);
  const seed = options.seed ?? DEFAULT_SEED;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("--seed must be 0..4294967295");
  const started = Date.now();
  const sink = options.log ?? (() => undefined);
  /** Each progress line carries the seconds since the start (the handback reports the phases' timings). */
  const log = (line) => sink(`[${((Date.now() - started) / 1000).toFixed(1)} s] ${line}`);
  const counts = plannedCounts(profileName);
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[rnd() % arr.length];
  const id = (kind, n) => loadId(seed, kind, n);
  const clock = new Date(SYNTHETIC_CLOCK).getTime();
  const at = (days, minutes = 0) => new Date(clock + (days * 1440 + minutes) * 60_000).toISOString();

  const client = new pg.Client({ connectionString: ownerUrl, application_name: "mth-load generate" });
  await client.connect();
  try {
    await client.query("BEGIN");
    // 1. The marker first: the 0108 guard refuses it unless the database is empty and unmarked.
    await client.query(
      `INSERT INTO load_dataset_marker (dataset_code, generator_version, random_seed, transformations, initiatives,
                                        kpi_actuals, audit_events, users)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        DATASET_CODE,
        GENERATOR_VERSION,
        seed,
        counts.transformations,
        counts.initiatives,
        counts.kpiActuals,
        counts.auditEvents,
        counts.users,
      ],
    );
    const audit = [];
    let auditN = 0;
    const event = (e) => {
      auditN += 1;
      audit.push({
        id: id("audit", auditN),
        occurred_at: e.at,
        organization_id: e.org,
        transformation_id: e.transformationId ?? null,
        actor_type: e.actor ? "user" : "system",
        actor_user_id: e.actor ?? null,
        action: e.action,
        record_type: e.type,
        record_id: e.recordId,
        prior_version: e.prior ?? null,
        new_version: e.version ?? 1,
        reason: REASON,
        request_id: REQUEST_ID,
        source: "cli",
        changes: e.changes ?? null,
      });
    };
    const flushAudit = async () => {
      await insertRows(client, "audit_event", audit.splice(0));
    };

    // 2a. Organization and business units.
    const ORG = id("organization", 1);
    const t0 = at(-400);
    await insertRows(client, "organization", [
      {
        id: ORG,
        code: "LOAD-ORG",
        name_en: "LOAD Synthetic Operator",
        name_ar: "تجريبي مشغل اصطناعي",
        default_timezone: "Asia/Riyadh",
        default_currency: "SAR",
        default_locale: "en",
        created_at: t0,
        updated_at: t0,
      },
    ]);
    event({ at: t0, org: ORG, action: "organization.create", type: "organization", recordId: ORG });
    const bus = [];
    for (let b = 1; b <= 6; b += 1)
      bus.push({
        id: id("business_unit", b),
        organization_id: ORG,
        code: `LOAD-BU${b}`,
        name_en: `LOAD Business Unit ${b}`,
        name_ar: `تجريبي وحدة أعمال ${b}`,
        created_at: t0,
        updated_at: t0,
      });
    await insertRows(client, "business_unit", bus);
    for (const b of bus)
      event({ at: t0, org: ORG, action: "business_unit.create", type: "business_unit", recordId: b.id });

    // 2b. Users: the virtual users (role mix of §2) then the named owners and approvers; one load identity each.
    const users = [];
    const roleOf = new Map();
    let u = 0;
    for (const [role, n] of Object.entries(p.roleMix))
      for (let k = 0; k < n; k += 1) {
        u += 1;
        users.push({ n: u, role, virtual: true });
      }
    for (let k = 0; k < p.namedUsers; k += 1) {
      u += 1;
      users.push({ n: u, role: k === 0 ? "ADM_ACCESS" : "SP", virtual: false });
    }
    const userRows = users.map((x) => ({
      id: id("app_user", x.n),
      organization_id: ORG,
      display_name: x.n % 5 === 0 ? `تجريبي مستخدم ${pad(x.n, 3)}` : `LOAD User ${pad(x.n, 3)} (${x.role})`,
      email: `load.user.${pad(x.n, 3)}@example.invalid`,
      preferred_locale: x.n % 5 === 0 ? "ar" : "en",
      created_at: t0,
      updated_at: t0,
    }));
    for (const x of users) roleOf.set(id("app_user", x.n), x.role);
    await insertRows(client, "app_user", userRows);
    await insertRows(
      client,
      "user_identity",
      users.map((x) => ({
        id: id("user_identity", x.n),
        user_id: id("app_user", x.n),
        issuer: LOAD_ISSUER,
        subject: `load-user-${pad(x.n, 3)}`,
        created_at: t0,
      })),
    );
    for (const r of userRows) event({ at: t0, org: ORG, action: "app_user.create", type: "app_user", recordId: r.id });
    const byRole = (role) => users.filter((x) => x.role === role).map((x) => id("app_user", x.n));
    const GRANTOR = byRole("ADM_ACCESS")[0];
    const named = byRole("SP");
    const roles = new Map((await client.query("SELECT code, id FROM role")).rows.map((r) => [r.code, r.id]));

    // 2c. Transformations (codes LOAD-T01 …, plus LOAD-R1K in register-1000), each through the product's instantiation.
    const tlUsers = byRole("TL");
    const tSpecs = [];
    for (let t = 0; t < p.transformations; t += 1)
      tSpecs.push({ n: t + 1, code: `LOAD-T${pad(t + 1, 2)}`, lead: tlUsers[t % tlUsers.length] });
    if (p.registerInitiatives > 0) tSpecs.push({ n: p.transformations + 1, code: "LOAD-R1K", lead: tlUsers[0] });
    const forms = (
      await client.query(
        `SELECT id, version_no FROM methodology_version WHERE config_kind = 'form_schema' AND key = 'forms'
           AND status = 'published' ORDER BY version_no DESC LIMIT 1`,
      )
    ).rows[0];
    for (const s of tSpecs) {
      s.id = id("transformation", s.n);
      s.bu = bus[(s.n - 1) % bus.length].id;
      s.sponsor = named[(s.n - 1) % named.length];
      s.created = at(-380 + s.n);
      const word = EN_WORDS[(s.n - 1) % EN_WORDS.length];
      await insertRows(client, "transformation", [
        {
          id: s.id,
          organization_id: ORG,
          business_unit_id: s.bu,
          code: s.code,
          name:
            s.code === "LOAD-R1K"
              ? "LOAD Register 1000 (REQ-S15-013 check)"
              : `LOAD Transformation ${pad(s.n, 2)} - ${word}`,
          description: "Synthetic load-test transformation; not real data.",
          mode: "end_to_end",
          status: "active",
          current_phase: PHASES[(s.n - 1) % PHASES.length],
          sponsor_user_id: s.sponsor,
          lead_user_id: s.lead,
          timezone: "Asia/Riyadh",
          currency: "SAR",
          created_at: s.created,
          updated_at: s.created,
          created_by: s.lead,
          updated_by: s.lead,
        },
      ]);
      event({
        at: s.created,
        org: ORG,
        transformationId: s.id,
        actor: s.lead,
        action: "transformation.create",
        type: "transformation",
        recordId: s.id,
      });
      // The deferred audit check reads audit_event, so the transformation's own event is written before the structure.
      await flushAudit();
      await client.query("SELECT p4_instantiate_transformation($1::uuid, $2::uuid, $3, 'cli')", [
        s.id,
        s.lead,
        REQUEST_ID,
      ]);
      if (forms) {
        const pin = id("forms_pin", s.n);
        await insertRows(client, "transformation_config_pin", [
          {
            id: pin,
            organization_id: ORG,
            transformation_id: s.id,
            kind: "form_schema",
            methodology_version_id: forms.id,
            pinned_by: s.lead,
            pinned_at: s.created,
            created_at: s.created,
            updated_at: s.created,
            created_by: s.lead,
            updated_by: s.lead,
          },
        ]);
        event({
          at: s.created,
          org: ORG,
          transformationId: s.id,
          actor: s.lead,
          action: "transformation_config_pin.create",
          type: "transformation_config_pin",
          recordId: pin,
          changes: {
            kind: { from: null, to: "form_schema" },
            methodology_version_id: { from: null, to: forms.id },
            version_no: { from: null, to: forms.version_no },
          },
        });
      }
    }
    log(`transformations: ${tSpecs.length}`);

    // 2d. Scoped assignments: each virtual user on 1-5 transformations (a TL always on its lead transformations);
    // each named user SP on the transformations it sponsors; the access administrator at organization scope.
    const mainT = tSpecs.filter((s) => s.code !== "LOAD-R1K");
    const assigned = new Map(tSpecs.map((s) => [s.id, new Map()]));
    const assignments = [];
    const assign = (userId, role, scopeType, scopeId) => {
      const n = assignments.length + 1;
      assignments.push({
        id: id("scoped_assignment", n),
        organization_id: ORG,
        user_id: userId,
        role_id: roles.get(role),
        scope_type: scopeType,
        scope_id: scopeId,
        effective_from: t0,
        reason: "Synthetic load-test role (mth_load_v1); approves nothing real",
        granted_by: GRANTOR,
        created_at: t0,
        updated_at: t0,
        created_by: GRANTOR,
        updated_by: GRANTOR,
      });
      if (scopeType === "transformation") {
        const m = assigned.get(scopeId);
        if (!m.has(role)) m.set(role, []);
        m.get(role).push(userId);
      }
    };
    assign(GRANTOR, "ADM_ACCESS", "organization", ORG);
    for (const x of users.filter((v) => v.virtual)) {
      const uid = id("app_user", x.n);
      const chosen = new Set();
      if (x.role === "TL") for (const s of tSpecs) if (s.lead === uid) chosen.add(s.id);
      const want = 1 + (rnd() % 5);
      while (chosen.size < Math.min(want, mainT.length)) chosen.add(pick(mainT).id);
      for (const tid of [...chosen].sort()) assign(uid, x.role, "transformation", tid);
    }
    for (const s of tSpecs) assign(s.sponsor, "SP", "transformation", s.id);
    await insertRows(client, "scoped_assignment", assignments);
    for (const a of assignments)
      event({
        at: t0,
        org: ORG,
        actor: GRANTOR,
        action: "scoped_assignment.create",
        type: "scoped_assignment",
        recordId: a.id,
      });
    await flushAudit();
    log(`users: ${users.length}; assignments: ${assignments.length}`);

    // 2e. Initiatives.
    const spread = initiativeSpread(p);
    if (p.registerInitiatives > 0) spread.push(p.registerInitiatives);
    const initiatives = [];
    let ini = 0;
    tSpecs.forEach((s, ti) => {
      const wls = assigned.get(s.id).get("WL") ?? [];
      for (let k = 1; k <= spread[ti]; k += 1) {
        ini += 1;
        const status = INITIATIVE_STATUSES[rnd() % INITIATIVE_STATUSES.length];
        const arabic = rnd() % 4 === 0;
        const w1 = arabic ? pick(AR_WORDS) : pick(EN_WORDS);
        const w2 = arabic ? pick(AR_WORDS) : pick(EN_WORDS);
        const created = at(-360 + (ini % 300), ini % 1440);
        const start = at(-300 + (rnd() % 200)).slice(0, 10);
        const finish = at(-100 + (rnd() % 400)).slice(0, 10);
        initiatives.push({
          id: id("initiative", ini),
          organization_id: ORG,
          transformation_id: s.id,
          code: `INI-${pad(k, 4)}`,
          name: arabic ? `تجريبي مبادرة ${w1} ${w2} ${pad(k, 4)}` : `LOAD Initiative ${w1} ${w2} ${pad(k, 4)}`,
          executive_owner_user_id: named[rnd() % named.length],
          workstream_lead_user_id: wls.length > 0 ? wls[rnd() % wls.length] : null,
          problem_statement: `Synthetic load problem statement ${pad(ini, 5)}.`,
          objective: `Synthetic load objective ${pad(ini, 5)}.`,
          planned_start: start,
          planned_end: finish < start ? start : finish,
          status,
          launched_at: status === "launched" ? created : null,
          launched_by: status === "launched" ? s.lead : null,
          created_at: created,
          updated_at: created,
          created_by: s.lead,
          updated_by: s.lead,
        });
        event({
          at: created,
          org: ORG,
          transformationId: s.id,
          actor: s.lead,
          action: "initiative.create",
          type: "initiative",
          recordId: id("initiative", ini),
        });
      }
    });
    await insertRows(client, "initiative", initiatives);
    await flushAudit();
    log(`initiatives: ${initiatives.length}`);

    // 2f. Monthly reporting periods (organization level, open), ending at the synthetic clock's previous month.
    const periods = [];
    const end = new Date(clock);
    for (let k = p.periods; k >= 1; k -= 1) {
      const s0 = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - k, 1));
      const e0 = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - k + 1, 0));
      periods.push({
        id: id("reporting_period", periods.length + 1),
        organization_id: ORG,
        frequency: "monthly",
        period_label: s0.toISOString().slice(0, 7),
        period_start: s0.toISOString().slice(0, 10),
        period_end: e0.toISOString().slice(0, 10),
        status: "open",
        opened_at: s0.toISOString(),
        created_at: t0,
        updated_at: t0,
        created_by: GRANTOR,
        updated_by: GRANTOR,
      });
    }
    await insertRows(client, "reporting_period", periods);
    for (const r of periods)
      event({
        at: t0,
        org: ORG,
        actor: GRANTOR,
        action: "reporting_period.create",
        type: "reporting_period",
        recordId: r.id,
      });

    // 2g. KPI definitions with one active version each (inserted draft, then activated: two audit events).
    const party = (await client.query("SELECT code FROM governance_party ORDER BY code LIMIT 1")).rows[0]?.code ?? null;
    const kpis = [];
    const versions = [];
    let kn = 0;
    for (const s of mainT) {
      const kds = assigned.get(s.id).get("KDS") ?? [];
      for (let k = 1; k <= p.kpisPerTransformation; k += 1) {
        kn += 1;
        const shape = KPI_SHAPES[(kn - 1) % KPI_SHAPES.length];
        const kid = id("kpi_definition", kn);
        const owner = named[rnd() % named.length];
        const steward = kds.length > 0 ? kds[rnd() % kds.length] : s.lead;
        const created = at(-370 + (kn % 30));
        kpis.push({
          id: kid,
          organization_id: ORG,
          transformation_id: s.id,
          name: `LOAD KPI ${pad(kn, 4)} ${shape.label}`,
          description: "Synthetic load-test KPI; not real data.",
          unit_kind: shape.unit,
          unit_label: shape.label,
          currency: shape.unit === "currency" ? "SAR" : null,
          polarity: shape.polarity,
          frequency: "monthly",
          owner_user_id: owner,
          steward_user_id: steward,
          status: "active",
          created_at: created,
          updated_at: created,
          created_by: s.lead,
          updated_by: s.lead,
        });
        event({
          at: created,
          org: ORG,
          transformationId: s.id,
          actor: s.lead,
          action: "kpi_definition.create",
          type: "kpi_definition",
          recordId: kid,
        });
        versions.push({
          id: id("kpi_version", kn),
          organization_id: ORG,
          transformation_id: s.id,
          kpi_definition_id: kid,
          version_no: 1,
          status: "draft",
          measure_type: shape.polarity,
          value_nature: shape.nature,
          unit_kind: shape.unit,
          unit_label: shape.label,
          currency: shape.unit === "currency" ? "SAR" : null,
          frequency: "monthly",
          aggregation_rule: shape.rule,
          submission_route: party ? "review" : "direct_accept",
          reviewer_party_code: party,
          created_at: created,
          updated_at: created,
          created_by: s.lead,
          updated_by: s.lead,
          _owner: owner,
          _steward: steward,
          _shape: shape,
        });
      }
    }
    await insertRows(client, "kpi_definition", kpis);
    await insertRows(
      client,
      "kpi_version",
      versions.map(({ _owner, _steward, _shape, ...v }) => v),
    );
    for (const v of versions) {
      event({
        at: v.created_at,
        org: ORG,
        transformationId: v.transformation_id,
        actor: v.created_by,
        action: "kpi_version.create",
        type: "kpi_version",
        recordId: v.id,
      });
      event({
        at: v.created_at,
        org: ORG,
        transformationId: v.transformation_id,
        actor: v.created_by,
        action: "kpi_version.activate",
        type: "kpi_version",
        recordId: v.id,
        prior: 1,
        version: 2,
        changes: { status: { from: "draft", to: "active" } },
      });
    }
    await client.query(
      `UPDATE kpi_version SET status = 'active', activated_at = created_at, activated_by = created_by,
                              version = version + 1
        WHERE id = ANY($1::uuid[])`,
      [versions.map((v) => v.id)],
    );
    await flushAudit();
    log(`kpi definitions: ${kpis.length}`);

    // 2h. KPI-period actuals: every KPI x every period. Mix: accepted on the direct route, accepted after review,
    // submitted, rejected after review. Values are decimal strings (integer arithmetic; never a binary double).
    const actuals = [];
    const values = [];
    const reviews = [];
    const decisions = [];
    let an = 0;
    for (const v of versions)
      for (const r of periods) {
        an += 1;
        const aid = id("kpi_actual", an);
        const roll = rnd() % 10;
        const kind = roll < 4 ? "direct" : roll < 6 ? "accept" : roll < 9 ? "submitted" : "reject";
        const route = kind === "direct" ? "direct_accept" : "review";
        const submitted = `${r.period_end}T08:00:00.000Z`;
        const decided = `${r.period_end}T12:00:00.000Z`;
        const cents = 10_000 + (rnd() % 990_000);
        actuals.push({
          id: aid,
          organization_id: ORG,
          transformation_id: v.transformation_id,
          kpi_definition_id: v.kpi_definition_id,
          scope_kind: "transformation",
          scope_id: v.transformation_id,
          reporting_period_id: r.id,
          period_start: r.period_start,
          period_end: r.period_end,
          period_label: r.period_label,
          current_value_no: 1,
          accepted_value_no: kind === "direct" ? 1 : null,
          status: kind === "direct" ? "accepted" : "submitted",
          route,
          submitted_by: v._steward,
          submitted_at: submitted,
          decided_by: kind === "direct" ? v._steward : null,
          decided_at: kind === "direct" ? submitted : null,
          created_at: submitted,
          updated_at: submitted,
          created_by: v._steward,
          updated_by: v._steward,
        });
        values.push({
          id: id("kpi_actual_value", an),
          organization_id: ORG,
          transformation_id: v.transformation_id,
          kpi_actual_id: aid,
          value_no: 1,
          kpi_version_id: v.id,
          value: `${Math.floor(cents / 100)}.${pad(cents % 100, 2)}`,
          currency: v.currency,
          data_as_of: r.period_end,
          entered_at: submitted,
          entered_by: v._steward,
          business_date: r.period_end,
        });
        event({
          at: submitted,
          org: ORG,
          transformationId: v.transformation_id,
          actor: v._steward,
          action: kind === "direct" ? "kpi_actual.accept" : "kpi_actual.submit",
          type: "kpi_actual",
          recordId: aid,
        });
        if (kind === "submitted") continue;
        const decider = kind === "direct" ? v._steward : v._owner === v._steward ? GRANTOR : v._owner;
        reviews.push({
          id: id("kpi_actual_review", an),
          organization_id: ORG,
          transformation_id: v.transformation_id,
          kpi_actual_id: aid,
          value_no: 1,
          outcome: kind === "direct" ? "direct_accept" : kind === "accept" ? "accept" : "reject",
          reason: kind === "reject" ? "Synthetic load rejection: value outside the expected range." : null,
          decided_by: decider,
          decided_at: kind === "direct" ? submitted : decided,
          business_date: r.period_end,
        });
        if (kind !== "direct") {
          decisions.push({ id: aid, kind, decider, decided });
          event({
            at: decided,
            org: ORG,
            transformationId: v.transformation_id,
            actor: decider,
            action: kind === "accept" ? "kpi_actual.accept" : "kpi_actual.reject",
            type: "kpi_actual",
            recordId: aid,
            prior: 1,
            version: 2,
            changes: { status: { from: "submitted", to: kind === "accept" ? "accepted" : "rejected" } },
          });
        }
      }
    await insertRows(client, "kpi_actual", actuals);
    await insertRows(client, "kpi_actual_value", values);
    await insertRows(client, "kpi_actual_review", reviews);
    for (let i = 0; i < decisions.length; i += 1000) {
      const chunk = decisions.slice(i, i + 1000);
      await client.query(
        `UPDATE kpi_actual a
            SET status = CASE d.kind WHEN 'accept' THEN 'accepted' ELSE 'rejected' END,
                accepted_value_no = CASE d.kind WHEN 'accept' THEN 1 END,
                decided_by = d.decider, decided_at = d.decided, updated_at = d.decided, updated_by = d.decider,
                decision_reason = CASE d.kind WHEN 'reject' THEN 'Synthetic load rejection: value outside the expected range.' END,
                version = a.version + 1
           FROM jsonb_to_recordset($1::jsonb) AS d(id uuid, kind text, decider uuid, decided timestamptz)
          WHERE a.id = d.id`,
        [JSON.stringify(chunk)],
      );
    }
    await flushAudit();
    log(`kpi actuals: ${actuals.length}`);

    // 2i. Benefits, RAID entries, dependencies, decisions, deliverables and evidence notes (no file bytes), spread over
    // the main transformations in proportion to their initiatives (deliverables: one per initiative, in order).
    const R = p.records;
    const weights = mainT.map((s) => initiatives.filter((r) => r.transformation_id === s.id).length);
    const iniOf = new Map(mainT.map((s) => [s.id, initiatives.filter((r) => r.transformation_id === s.id)]));
    const kpiOf = new Map(mainT.map((s) => [s.id, kpis.filter((k) => k.transformation_id === s.id)]));
    const finOf = (s) => assigned.get(s.id).get("FIN") ?? [];
    const created = (n) => at(-300 + (n % 200), n % 1440);
    const records = { benefit: [], raid_entry: [], dependency: [], decision: [], deliverable: [], evidence: [] };
    const counters = [];
    const add = (table, s, row, n) => {
      const rid = id(table, n);
      const ts = created(n);
      records[table].push({
        id: rid,
        organization_id: ORG,
        transformation_id: s.id,
        ...row,
        created_at: ts,
        updated_at: ts,
        created_by: s.lead,
        updated_by: s.lead,
      });
      event({
        at: ts,
        org: ORG,
        transformationId: s.id,
        actor: s.lead,
        action: `${table}.create`,
        type: table,
        recordId: rid,
      });
    };
    const split = {
      benefit: proportional(R.benefits, weights),
      raid_entry: proportional(R.raidEntries, weights),
      dependency: proportional(R.dependencies, weights),
      decision: proportional(R.decisions, weights),
      evidence: proportional(R.evidenceNotes, weights),
    };
    const BENEFIT_KINDS = [
      { type: "revenue", cls: "revenue_uplift", line: "LOAD Revenue - service revenue" },
      { type: "cost", cls: "cash_saving", line: "LOAD Operating expense - network" },
      { type: "cx", cls: "non_financial", line: null },
      { type: "cost", cls: "avoided_cost", line: "LOAD Operating expense - care" },
    ];
    const RAID_TYPES = [
      ["risk", "R"],
      ["assumption", "A"],
      ["issue", "I"],
    ];
    const LEVELS = ["high", "medium", "low"];
    const DEPENDENCY_TYPES = ["tech", "data", "vendor", "decision", "other"];
    const n = { benefit: 0, raid_entry: 0, dependency: 0, decision: 0, deliverable: 0, evidence: 0 };
    mainT.forEach((s, ti) => {
      const inis = iniOf.get(s.id);
      const tk = kpiOf.get(s.id);
      const fins = finOf(s);
      for (let k = 1; k <= split.benefit[ti]; k += 1) {
        n.benefit += 1;
        const kind = BENEFIT_KINDS[(n.benefit - 1) % BENEFIT_KINDS.length];
        const owner = named[rnd() % named.length];
        const validator = fins.find((f) => f !== owner) ?? null;
        const cents = 1_000_000 + (rnd() % 99_000_000);
        add(
          "benefit",
          s,
          {
            code: `B${pad(k, 3)}`,
            title: `LOAD Benefit ${pad(n.benefit, 4)} ${pick(EN_WORDS)}`,
            description: "Synthetic load-test benefit; not real data.",
            benefit_type: kind.type,
            value_class: kind.cls,
            owner_user_id: owner,
            finance_validator_user_id: validator,
            finance_validation_required: true,
            financial_statement_line: kind.line,
            measurement_kpi_definition_id: kind.cls === "non_financial" ? (tk[k % tk.length]?.id ?? null) : null,
            currency: "SAR",
            planned_value: kind.cls === "non_financial" ? null : `${Math.floor(cents / 100)}.${pad(cents % 100, 2)}`,
            confidence: ["H", "M", "L"][rnd() % 3],
          },
          n.benefit,
        );
      }
      for (let k = 1; k <= split.raid_entry[ti]; k += 1) {
        n.raid_entry += 1;
        const [type, prefix] = RAID_TYPES[(k - 1) % RAID_TYPES.length];
        add(
          "raid_entry",
          s,
          {
            entry_type: type,
            code: `${prefix}-${pad(Math.ceil(k / RAID_TYPES.length), 3)}`,
            description: `LOAD ${type} ${pad(n.raid_entry, 4)}: synthetic load-test entry.`,
            impact: LEVELS[rnd() % 3],
            probability: type === "risk" ? LEVELS[rnd() % 3] : null,
            owner_user_id: named[rnd() % named.length],
            due_date: at(rnd() % 180).slice(0, 10),
            initiative_id: inis.length > 0 ? inis[rnd() % inis.length].id : null,
          },
          n.raid_entry,
        );
      }
      for (let k = 1; k <= split.dependency[ti]; k += 1) {
        n.dependency += 1;
        // From a lower to a higher initiative of the same transformation: the graph stays acyclic by construction.
        const a = rnd() % Math.max(1, inis.length - 1);
        const b = a + 1 + (rnd() % Math.max(1, Math.min(5, inis.length - 1 - a)));
        const linked = inis.length >= 2 && b < inis.length;
        add(
          "dependency",
          s,
          {
            code: `DEP-${pad(k, 3)}`,
            description: `LOAD dependency ${pad(n.dependency, 4)}: synthetic load-test dependency.`,
            from_kind: linked ? "initiative" : "external",
            from_label: linked ? null : "LOAD external supplier",
            to_kind: linked ? "initiative" : "other",
            to_label: linked ? null : "LOAD other",
            dependency_type: DEPENDENCY_TYPES[rnd() % DEPENDENCY_TYPES.length],
            from_initiative_id: linked ? inis[a].id : null,
            to_initiative_id: linked ? inis[b].id : null,
            owner_user_id: named[rnd() % named.length],
            impact: LEVELS[rnd() % 3],
            needed_by: at(rnd() % 240).slice(0, 10),
          },
          n.dependency,
        );
      }
      if (split.dependency[ti] > 0)
        counters.push({ transformation_id: s.id, prefix: "DEP", last_value: split.dependency[ti] });
      for (let k = 1; k <= split.decision[ti]; k += 1) {
        n.decision += 1;
        const decided = rnd() % 10 < 3;
        const owner = named[rnd() % named.length];
        add(
          "decision",
          s,
          {
            kind: "executive",
            code: `DEC-${pad(k, 3)}`,
            title: `LOAD Decision ${pad(n.decision, 4)} ${pick(EN_WORDS)}`,
            context: "Synthetic load-test decision; approves nothing real.",
            owner_user_id: owner,
            due_date: at(rnd() % 120).slice(0, 10),
            status: decided ? "decided" : "open",
            outcome_text: decided ? "Synthetic load-test outcome (not a real decision)." : null,
            decided_by: decided ? owner : null,
            decided_at: decided ? created(n.decision) : null,
          },
          n.decision,
        );
      }
      if (split.decision[ti] > 0)
        counters.push({ transformation_id: s.id, prefix: "DEC", last_value: split.decision[ti] });
      for (const r of inis.slice(0, R.deliverables - n.deliverable)) {
        n.deliverable += 1;
        add(
          "deliverable",
          s,
          {
            initiative_id: r.id,
            ordinal: 1,
            title: `LOAD Deliverable ${pad(n.deliverable, 4)}`,
            description: "Synthetic load-test deliverable.",
            owner_user_id: r.workstream_lead_user_id ?? s.lead,
            due_date: r.planned_end,
          },
          n.deliverable,
        );
      }
      for (let k = 1; k <= split.evidence[ti]; k += 1) {
        n.evidence += 1;
        add(
          "evidence",
          s,
          {
            kind: "note",
            title: `LOAD Evidence note ${pad(n.evidence, 4)}`,
            evidence_type: "analysis",
            owner_user_id: s.lead,
            note_body: `Synthetic load-test evidence note ${pad(n.evidence, 4)}; not real evidence.`,
          },
          n.evidence,
        );
      }
    });
    // Decisions first: dependencies may reference them (none here), and the order is fixed.
    for (const table of ["decision", "benefit", "raid_entry", "dependency", "deliverable", "evidence"])
      await insertRows(client, table, records[table]);
    await insertRows(client, "record_code_counter", counters);
    await flushAudit();
    log(
      `benefits ${n.benefit}, RAID entries ${n.raid_entry}, dependencies ${n.dependency}, decisions ${n.decision}, ` +
        `deliverables ${n.deliverable}, evidence notes ${n.evidence}`,
    );

    // 3. Version steps until audit_event holds exactly the marker's count: initiatives, KPI definitions, benefits, in
    // rounds; each step one UPDATE (version + 1) and its audit event with the prior and new version.
    // Current statistics inside this transaction (ANALYZE counts the transaction's own new rows), so the guard triggers'
    // lookups (the immediate ones below and the deferred checks at COMMIT) are planned against the tables' real sizes.
    // The COMMIT still dominates the run time: the deferred p2_audit_required compares record_type with a `name` value
    // and walks the whole audit_event_record_idx per check (measured; deploy/load/README.md "Measured here").
    await client.query("ANALYZE");
    const have = Number((await client.query("SELECT count(*) AS n FROM audit_event")).rows[0].n);
    // One event is kept for the search.reindex request of step 4 when its schedule exists.
    const runNowEvents = Number(
      (await client.query("SELECT count(*) AS n FROM job_schedule WHERE code = 'search.reindex' AND enabled")).rows[0]
        .n,
    );
    let remaining = counts.auditEvents - have - runNowEvents;
    if (remaining < 0)
      throw new Error(`profile ${profileName}: ${have} audit events before the version steps exceed the target`);
    const steppable = [
      ...initiatives.map((r) => ({ table: "initiative", field: "objective", id: r.id })),
      ...kpis.map((r) => ({ table: "kpi_definition", field: "description", id: r.id })),
      ...records.benefit.map((r) => ({ table: "benefit", field: "description", id: r.id })),
    ];
    let round = 0;
    while (remaining > 0) {
      round += 1;
      const batch = steppable.slice(0, Math.min(remaining, steppable.length));
      for (const table of ["initiative", "kpi_definition", "benefit"]) {
        const ids = batch.filter((b) => b.table === table).map((b) => b.id);
        if (ids.length === 0) continue;
        const field = steppable.find((x) => x.table === table).field;
        const ts = at(-60 + (round % 60), round);
        // The audit id is md5(dataset:seed:step:<record>:<new version>)::uuid, the same scheme as loadId.
        await client.query(
          `WITH upd AS (
             UPDATE ${table} x
                SET version = x.version + 1, ${field} = $2 || (x.version + 1), updated_at = $3::timestamptz
              WHERE x.id = ANY($1::uuid[])
          RETURNING x.id, x.organization_id, x.transformation_id, x.version, x.updated_by)
           INSERT INTO audit_event (id, occurred_at, organization_id, transformation_id, actor_type, actor_user_id,
                                    action, record_type, record_id, prior_version, new_version, reason, request_id,
                                    source, changes)
           SELECT md5($4 || ':step:' || upd.id || ':' || upd.version)::uuid, $3::timestamptz, upd.organization_id,
                  upd.transformation_id, 'user', upd.updated_by, $5, $6, upd.id, upd.version - 1, upd.version, $7,
                  $8, 'cli', jsonb_build_object($9::text, jsonb_build_object('from', $2 || (upd.version - 1), 'to', $2 || upd.version))
             FROM upd`,
          [ids, STEP_TEXT[table], ts, `${DATASET_CODE}:${seed}`, `${table}.update`, table, REASON, REQUEST_ID, field],
        );
      }
      remaining -= batch.length;
    }
    log(`version-step rounds: ${round}`);

    // 4. ADR-0058 §2: the search index is rebuilt once after generation. The generator requests search.reindex exactly
    // as the API's runJobNow does (the internal outbox event job.run_requested with its audit event, in this
    // transaction); the worker started with MTH_ENV=load dispatches it after COMMIT. Skipped (and said so) when the
    // schedule is absent or disabled.
    const reindex = (
      await client.query("SELECT id, code, queue_name, enabled FROM job_schedule WHERE code = 'search.reindex'")
    ).rows[0];
    let reindexRequested = false;
    if (reindex?.enabled === true) {
      const singletonKey = `run-now:${reindex.code}:${SYNTHETIC_CLOCK.slice(0, 16)}`;
      await insertRows(client, "outbox_event", [
        {
          id: id("outbox_event", 1),
          organization_id: ORG,
          aggregate_type: "job_schedule",
          aggregate_id: reindex.id,
          event_type: "job.run_requested",
          schema_version: 1,
          payload: { jobScheduleCode: reindex.code, queueName: reindex.queue_name, requestedBy: GRANTOR, singletonKey },
          idempotency_key: singletonKey,
        },
      ]);
      await client.query(
        `INSERT INTO audit_event (id, occurred_at, organization_id, actor_type, actor_user_id, action, record_type,
                                  record_id, reason, request_id, source, changes)
         VALUES ($1, $2, $3, 'user', $4, 'job_schedule.run_now', 'job_schedule', $5, $6, $7, 'cli', $8)`,
        [
          id("audit", 0),
          SYNTHETIC_CLOCK,
          ORG,
          GRANTOR,
          reindex.id,
          REASON,
          REQUEST_ID,
          JSON.stringify({ run_now: { from: null, to: singletonKey } }),
        ],
      );
      reindexRequested = true;
      log("search.reindex requested (job.run_requested in the outbox; the worker runs it after COMMIT)");
    } else log("search.reindex NOT requested: no enabled search.reindex schedule in this database");

    const final = Number((await client.query("SELECT count(*) AS n FROM audit_event")).rows[0].n);
    if (final !== counts.auditEvents)
      throw new Error(`audit events ${final} differ from the marker's ${counts.auditEvents}`);
    log(`audit events: ${final}`);
    await client.query("ANALYZE audit_event");
    log("committing (the deferred audit and consistency checks run now)");
    await client.query("COMMIT");
    const actual = await readCounts(client);
    return {
      profile: profileName,
      seed,
      planned: counts,
      actual,
      reindexRequested,
      seconds: (Date.now() - started) / 1000,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

/** The dataset's counts as stored (the marker's figures are checked against these). */
export async function readCounts(client) {
  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM transformation)::int AS transformations,
            (SELECT count(*) FROM initiative)::int AS initiatives,
            (SELECT count(*) FROM kpi_actual)::int AS "kpiActuals",
            (SELECT count(*) FROM audit_event)::int AS "auditEvents",
            (SELECT count(*) FROM app_user)::int AS users,
            (SELECT count(*) FROM kpi_definition)::int AS "kpiDefinitions",
            (SELECT count(*) FROM scoped_assignment)::int AS assignments,
            (SELECT count(*) FROM reporting_period)::int AS periods,
            (SELECT count(*) FROM benefit)::int AS benefits,
            (SELECT count(*) FROM raid_entry)::int AS "raidEntries",
            (SELECT count(*) FROM dependency)::int AS dependencies,
            (SELECT count(*) FROM decision)::int AS decisions,
            (SELECT count(*) FROM deliverable)::int AS deliverables,
            (SELECT count(*) FROM evidence WHERE kind = 'note')::int AS "evidenceNotes"`,
  );
  return rows[0];
}

/** The tables whose rows the generator writes with its own deterministic ids (hashed by `datasetRowHashes`). */
export const HASHED_TABLES = [
  "organization",
  "business_unit",
  "app_user",
  "user_identity",
  "scoped_assignment",
  "transformation",
  "initiative",
  "reporting_period",
  "kpi_definition",
  "kpi_version",
  "kpi_actual",
  "kpi_actual_value",
  "kpi_actual_review",
  "benefit",
  "raid_entry",
  "dependency",
  "decision",
  "deliverable",
  "evidence",
];

/**
 * SHA-256 per table over the generator's rows (every column, ordered by id), plus the generator's own audit events
 * (every column but `seq`, the identity the database assigns) and the per-action count of all audit events. The
 * marker row's `generated_at` (the real generation time) is not hashed. Two runs with one seed give identical hashes.
 */
export async function datasetRowHashes(client) {
  const out = {};
  for (const t of HASHED_TABLES) {
    const { rows } = await client.query(
      `SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(x)::text, E'\\n' ORDER BY x.id), ''), 'UTF8')), 'hex') AS h,
              count(*)::int AS n FROM ${t} x`,
    );
    out[t] = `${rows[0].n}:${rows[0].h}`;
  }
  const own = await client.query(
    `SELECT encode(sha256(convert_to(coalesce(string_agg((to_jsonb(a) - 'seq')::text, E'\\n' ORDER BY a.id), ''), 'UTF8')), 'hex') AS h,
            count(*)::int AS n FROM audit_event a WHERE a.request_id = $1 AND a.reason = $2`,
    [REQUEST_ID, REASON],
  );
  out["audit_event (generator)"] = `${own.rows[0].n}:${own.rows[0].h}`;
  const actions = await client.query(
    `SELECT encode(sha256(convert_to(string_agg(action || '=' || n, ',' ORDER BY action), 'UTF8')), 'hex') AS h,
            sum(n)::int AS n FROM (SELECT action, count(*) AS n FROM audit_event GROUP BY action) s`,
  );
  out["audit_event (per action)"] = `${actions.rows[0].n}:${actions.rows[0].h}`;
  const marker = await client.query(`SELECT to_jsonb(m) - 'generated_at' AS m FROM load_dataset_marker m`);
  out.load_dataset_marker = createHash("sha256")
    .update(JSON.stringify(marker.rows[0]?.m ?? null))
    .digest("hex");
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: { profile: { type: "string", default: "default" }, seed: { type: "string" } },
    strict: true,
  });
  const mthEnv = process.env.MTH_ENV;
  if (mthEnv === "production" || mthEnv === "demo") {
    console.error(`mth-load generate: refused: MTH_ENV=${mthEnv}; the load dataset is generated only for MTH_ENV=load`);
    return 3;
  }
  // The owner URL from the environment or, in a container, from its mounted secret file (DATABASE_OWNER_URL_FILE).
  const file = process.env.DATABASE_OWNER_URL_FILE;
  const ownerUrl = file ? readFileSync(file, "utf8").trim() : process.env.DATABASE_OWNER_URL;
  if (!ownerUrl) {
    console.error("mth-load generate: DATABASE_OWNER_URL is required (owner role of an empty, migrated database)");
    return 64;
  }
  const seed = values.seed === undefined ? DEFAULT_SEED : Number(values.seed);
  const result = await generate(ownerUrl, {
    profile: values.profile,
    seed,
    log: (l) => console.log(`mth-load generate: ${l}`),
  });
  console.log("mth-load generate: SYNTHETIC load dataset (not real data; approves nothing)");
  console.log(JSON.stringify(result, null, 2));
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    const hashes = await datasetRowHashes(c);
    for (const [t, h] of Object.entries(hashes)) console.log(`hash  ${t}\t${h}`);
  } finally {
    await c.end();
  }
  console.log(
    "mth-load generate: next, run the search.reindex job once (deploy/load/README.md) so the search index is complete",
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      const e = err ?? {};
      console.error(
        `mth-load generate: failed: ${e.message ?? e}${e.constraint ? ` (constraint ${e.constraint})` : ""}`,
      );
      process.exit(e.constraint === "load_dataset_marker_empty_database" ? 3 : 1);
    },
  );
}
