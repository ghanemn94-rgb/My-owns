// Validates the Transformation Hub project templates (P0 carveout-domain-analyst deliverable check).
// Usage: node packages/db/scripts/validate-templates.mjs   (also run by `pnpm --filter @hub/db validate:templates`)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = process.env.TEMPLATE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "seed", "templates");
const ROLES = new Set(["platform_admin", "portfolio_admin", "sponsor", "committee_chair", "secretary_cpmo", "project_manager",
  "workstream_lead", "contributor", "functional_approver", "finance_restricted", "legal_restricted", "clean_team", "auditor",
  "external_partner_limited"]);
const EVIDENCE = new Set(["approved_document", "signed_agreement", "regulatory_record", "committee_decision", "test_report",
  "reconciliation", "sign_off", "register_extract", "board_resolution", "other"]);
const TOP_KEYS = ["key", "version", "kind", "name", "description", "statusDimensions", "phases", "gates", "workstreams", "wbs",
  "readinessAreas", "kpis", "ragPolicy", "tsaStates", "decisionStates", "partnerStages"];
const TSA = ["proposed", "negotiating", "approved", "active", "exit_in_progress", "exit_accepted", "extended", "breached", "expired_unresolved"];
const DEC = ["draft", "submitted", "under_review", "recommended", "approved", "rejected", "deferred", "superseded", "implementation_pending", "implemented_verified"];
const PARTNER = ["identified", "approved_for_contact", "nda", "materials_access", "dd", "proposal", "negotiation", "signing", "closing", "withdrawn"];
const READINESS = ["power", "cooling", "connectivity", "physical_access", "operations", "maintenance", "spares", "noc",
  "incident_management", "billing", "support", "employees", "security", "backup_recovery"];
const DIMS = ["incorporation", "perimeter_transfer", "operational_readiness", "jv_transaction"];
const DC_WS_NAMES = ["Program Governance & PMO", "Strategy & Transaction Perimeter", "Corporate Legal & Regulatory",
  "Finance, Tax & Accounting", "Assets, Sites & Facilities", "Technology, Data & Cybersecurity", "Operations, Continuity & TSA",
  "People & Organization", "Commercial, Customers & GTM", "Procurement & Suppliers", "Business Plan, Valuation & Partner Process",
  "JV Execution & Post-close"];
const ARABIC = /[؀-ۿ]/;

let errors = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) errors.push(msg); };
const isBi = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === "ar,en";
const bi = (v, path) => {
  ok(isBi(v), `${path}: not a bilingual {en,ar} object`);
  if (!isBi(v)) return;
  ok(typeof v.en === "string" && v.en.trim().length > 0, `${path}.en empty`);
  ok(typeof v.ar === "string" && v.ar.trim().length > 0, `${path}.ar empty`);
  ok(ARABIC.test(v.ar), `${path}.ar contains no Arabic script (transliteration?)`);
  ok(!ARABIC.test(v.en), `${path}.en contains Arabic script`);
};
const role = (r, path, nullable = false) => ok((nullable && r === null) || ROLES.has(r), `${path}: invalid role '${r}'`);
const uniq = (arr, what) => { const s = new Set(); for (const x of arr) { ok(!s.has(x), `duplicate ${what}: ${x}`); s.add(x); } return s; };

function walkStrings(node, path, fn) {
  if (typeof node === "string") fn(node, path);
  else if (Array.isArray(node)) node.forEach((x, i) => walkStrings(x, `${path}[${i}]`, fn));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walkStrings(v, `${path}.${k}`, fn);
}
function walkBilingual(node, path) {
  if (Array.isArray(node)) node.forEach((x, i) => walkBilingual(x, `${path}[${i}]`));
  else if (node && typeof node === "object") {
    if ("en" in node || "ar" in node) bi(node, path);
    else for (const [k, v] of Object.entries(node)) walkBilingual(v, `${path}.${k}`);
  }
}
function hasCycle(nodes, edges) { // edges: id -> [prereq ids]
  const state = new Map(); let cyclePath = null;
  const visit = (n, stack) => {
    if (state.get(n) === 2) return false;
    if (state.get(n) === 1) { cyclePath = [...stack, n].join(" -> "); return true; }
    state.set(n, 1);
    for (const p of edges.get(n) || []) if (visit(p, [...stack, n])) return true;
    state.set(n, 2); return false;
  };
  for (const n of nodes) if (visit(n, [])) return cyclePath;
  return null;
}
function closure(start, edges) {
  const seen = new Set(); const st = [...(edges.get(start) || [])];
  while (st.length) { const x = st.pop(); if (!seen.has(x)) { seen.add(x); st.push(...(edges.get(x) || [])); } }
  return seen;
}

function validate(file, expect) {
  const tpl = JSON.parse(readFileSync(`${DIR}/${file}`, "utf8"));
  const p = file;
  ok(JSON.stringify(Object.keys(tpl)) === JSON.stringify(TOP_KEYS), `${p}: top-level keys differ: ${Object.keys(tpl).join(",")}`);
  ok(tpl.key === expect.key && tpl.kind === expect.kind && tpl.version === 1, `${p}: key/kind/version mismatch`);
  bi(tpl.name, `${p}.name`); bi(tpl.description, `${p}.description`);

  // status dimensions
  ok(JSON.stringify(tpl.statusDimensions.map((d) => d.key)) === JSON.stringify(expect.dims), `${p}: statusDimensions keys`);
  for (const d of tpl.statusDimensions) { uniq(d.states.map((s) => s.key), `${p} ${d.key} state`); ok(d.states.length >= 3, `${p} ${d.key}: too few states`); }

  // gates
  const gateKeys = tpl.gates.map((g) => g.key);
  ok(JSON.stringify(gateKeys) === JSON.stringify(expect.gates), `${p}: gate keys ${gateKeys}`);
  const gateSet = uniq(gateKeys, `${p} gate`);
  tpl.gates.forEach((g, i) => ok(g.order === i, `${p} ${g.key}: order ${g.order} != ${i}`));
  const gEdges = new Map(tpl.gates.map((g) => [g.key, g.prerequisiteGateKeys]));
  for (const g of tpl.gates) {
    for (const pr of g.prerequisiteGateKeys) ok(gateSet.has(pr) && pr !== g.key, `${p} ${g.key}: bad prerequisite ${pr}`);
    role(g.ownerRole, `${p} ${g.key}.ownerRole`); role(g.reviewerRole, `${p} ${g.key}.reviewerRole`); role(g.approverRole, `${p} ${g.key}.approverRole`);
    ok(g.criteria.length >= expect.minCrit && g.criteria.length <= expect.maxCrit, `${p} ${g.key}: ${g.criteria.length} criteria outside ${expect.minCrit}-${expect.maxCrit}`);
    ok(g.criteria.some((c) => c.mandatory), `${p} ${g.key}: no mandatory criterion`);
  }
  const gc = hasCycle(gateKeys, gEdges); ok(!gc, `${p}: gate prerequisite cycle ${gc}`);
  const allCrit = tpl.gates.flatMap((g) => g.criteria.map((c) => ({ g, c })));
  uniq(allCrit.map(({ c }) => c.key), `${p} criterion key`);
  const CRIT_KEYS = ["key", "description", "mandatory", "blocking", "waivable", "waiverAuthorityRole", "evidenceRequired", "evidenceType", "ownerRole", "reviewerRole", "applicability"];
  for (const { g, c } of allCrit) {
    const cp = `${p} ${c.key}`;
    ok(new RegExp(`^${g.key}-C\\d{2}$`).test(c.key), `${cp}: key format/prefix`);
    const keys = Object.keys(c).filter((k) => k !== "waivabilityBasis");
    ok(JSON.stringify(keys) === JSON.stringify(CRIT_KEYS), `${cp}: field set/order ${keys}`);
    for (const f of ["mandatory", "blocking", "waivable", "evidenceRequired"]) ok(typeof c[f] === "boolean", `${cp}.${f} not boolean`);
    if (c.waivable) {
      role(c.waiverAuthorityRole, `${cp}.waiverAuthorityRole`);
      ok(/^Proposed — to be confirmed by .+ specialist$/.test(c.waivabilityBasis || ""), `${cp}: waivabilityBasis missing/format`);
    } else {
      ok(c.waiverAuthorityRole === null, `${cp}: non-waivable must have null waiverAuthorityRole`);
      ok(!("waivabilityBasis" in c), `${cp}: non-waivable must not carry waivabilityBasis`);
    }
    if (c.blocking) ok(c.mandatory, `${cp}: blocking but not mandatory`);
    ok(EVIDENCE.has(c.evidenceType), `${cp}: evidenceType ${c.evidenceType}`);
    role(c.ownerRole, `${cp}.ownerRole`); role(c.reviewerRole, `${cp}.reviewerRole`);
    ok(c.applicability === "proposed", `${cp}: applicability must be 'proposed'`);
  }

  // phases
  uniq(tpl.phases.map((ph) => ph.key), `${p} phase`);
  ok(tpl.phases.length === expect.phases, `${p}: ${tpl.phases.length} phases, expected ${expect.phases}`);
  tpl.phases.forEach((ph, i) => ok(ph.order === i + 1, `${p} phase ${ph.key}: order`));
  const phaseGates = tpl.phases.flatMap((ph) => ph.gateKeys);
  for (const gk of phaseGates) ok(gateSet.has(gk), `${p}: phase references unknown gate ${gk}`);
  ok(JSON.stringify([...phaseGates].sort()) === JSON.stringify([...gateKeys].sort()), `${p}: each gate must belong to exactly one phase`);

  // workstreams
  const wsKeys = tpl.workstreams.map((w) => w.key);
  ok(wsKeys.length === expect.ws, `${p}: ${wsKeys.length} workstreams, expected ${expect.ws}`);
  wsKeys.forEach((k, i) => ok(k === `WS${String(i + 1).padStart(2, "0")}`, `${p}: workstream ${i} key ${k}`));
  if (expect.wsNames) tpl.workstreams.forEach((w, i) => ok(w.name.en === expect.wsNames[i], `${p} ${w.key}: name '${w.name.en}' != spec '${expect.wsNames[i]}'`));
  const wsSet = uniq(wsKeys, `${p} workstream`);
  for (const w of tpl.workstreams) {
    role(w.leadRole, `${p} ${w.key}.leadRole`);
    ok(typeof w.proposedLeadFunction === "string" && w.proposedLeadFunction.length > 0, `${p} ${w.key}: proposedLeadFunction`);
    ok(w.raci.length > 0 && w.raci.every((r) => typeof r.function === "string" && r.function && ["R", "A", "C", "I"].includes(r.raci)), `${p} ${w.key}: raci values`);
    ok(w.raci.filter((r) => r.raci === "A").length === 1, `${p} ${w.key}: must have exactly one A`);
    uniq(w.raci.map((r) => r.function), `${p} ${w.key} raci function`);
    for (const lg of w.linkedGates) ok(gateSet.has(lg), `${p} ${w.key}: linkedGate ${lg} unknown`);
    const derived = [...new Set(tpl.wbs.filter((a) => a.workstreamKey === w.key).map((a) => a.gateKey))].sort();
    ok(JSON.stringify([...w.linkedGates].sort()) === JSON.stringify(derived), `${p} ${w.key}: linkedGates ${w.linkedGates} != WBS-derived ${derived}`);
    ok(typeof w.budgetRelevant === "boolean", `${p} ${w.key}: budgetRelevant`);
    ok(w.typicalRisks.length >= 1 && w.acceptanceEvidence.length >= 1, `${p} ${w.key}: risks/evidence empty`);
  }

  // WBS
  ok(tpl.wbs.length >= expect.minWbs && tpl.wbs.length <= expect.maxWbs, `${p}: ${tpl.wbs.length} WBS activities outside ${expect.minWbs}-${expect.maxWbs}`);
  const ids = tpl.wbs.map((a) => a.id);
  const idSet = uniq(ids, `${p} wbs id`);
  uniq(tpl.wbs.map((a) => a.title.en), `${p} wbs title (duplicate activity?)`);
  const WBS_KEYS = ["id", "workstreamKey", "title", "description", "proposedOwnerFunction", "prerequisites", "output", "acceptanceCriteria",
    "approverRole", "evidenceType", "effort", "durationDays", "durationBasis", "gateKey", "isMilestone", "isDeliverable", "weight",
    "requiresAcceptance", "status", "verificationStatus"];
  const edges = new Map();
  for (const a of tpl.wbs) {
    const ap = `${p} ${a.id}`;
    ok(JSON.stringify(Object.keys(a)) === JSON.stringify(WBS_KEYS), `${ap}: field set/order`);
    ok(/^WS\d{2}-A\d{2}$/.test(a.id) && a.id.startsWith(a.workstreamKey + "-"), `${ap}: id format / workstream prefix`);
    ok(wsSet.has(a.workstreamKey), `${ap}: unknown workstream ${a.workstreamKey}`);
    ok(gateSet.has(a.gateKey), `${ap}: unknown gate ${a.gateKey}`);
    for (const pr of a.prerequisites) { ok(idSet.has(pr), `${ap}: prerequisite ${pr} does not exist`); ok(pr !== a.id, `${ap}: self prerequisite`); }
    uniq(a.prerequisites, `${ap} prerequisite`);
    edges.set(a.id, a.prerequisites);
    role(a.approverRole, `${ap}.approverRole`);
    ok(EVIDENCE.has(a.evidenceType), `${ap}: evidenceType ${a.evidenceType}`);
    ok(/^(TBD|Assumed: \d+ person-days)$/.test(a.effort), `${ap}: effort '${a.effort}'`);
    ok(a.durationDays === null || (Number.isInteger(a.durationDays) && a.durationDays >= 0), `${ap}: durationDays`);
    ok((a.durationDays === null && a.durationBasis === "tbd") || (a.durationDays !== null && a.durationBasis === "assumed"), `${ap}: durationBasis inconsistent`);
    if (a.isMilestone) ok(a.durationDays === 0, `${ap}: milestone must have 0 duration`);
    ok(Number.isInteger(a.weight) && a.weight >= 1 && a.weight <= 5, `${ap}: weight`);
    for (const f of ["isMilestone", "isDeliverable", "requiresAcceptance"]) ok(typeof a[f] === "boolean", `${ap}.${f}`);
    ok(a.status === "draft" && a.verificationStatus === "proposed", `${ap}: status/verificationStatus`);
    ok(typeof a.proposedOwnerFunction === "string" && a.proposedOwnerFunction.length > 0, `${ap}: proposedOwnerFunction`);
  }
  const wc = hasCycle(ids, edges); ok(!wc, `${p}: WBS prerequisite cycle ${wc}`);
  for (const w of wsKeys) ok(tpl.wbs.some((a) => a.workstreamKey === w), `${p}: workstream ${w} has no activities`);
  for (const g of gateKeys) ok(tpl.wbs.some((a) => a.gateKey === g), `${p}: gate ${g} has no activities`);

  // readiness
  ok(JSON.stringify(tpl.readinessAreas.map((r) => r.key)) === JSON.stringify(expect.readiness), `${p}: readiness area keys`);
  uniq(tpl.readinessAreas.flatMap((r) => r.defaultChecks.map((c) => c.key)), `${p} readiness check key`);
  for (const r of tpl.readinessAreas) {
    ok(r.defaultChecks.length >= 1, `${p} ${r.key}: no checks`);
    for (const c of r.defaultChecks) {
      ok(typeof c.mandatory === "boolean" && typeof c.blocker === "boolean", `${p} ${r.key}.${c.key}: flags`);
      if (c.blocker) ok(c.mandatory, `${p} ${r.key}.${c.key}: blocker must be mandatory`);
      role(c.signoffRole, `${p} ${r.key}.${c.key}.signoffRole`);
    }
  }

  // KPIs
  ok(tpl.kpis.length >= expect.minKpi && tpl.kpis.length <= expect.maxKpi, `${p}: ${tpl.kpis.length} KPIs outside ${expect.minKpi}-${expect.maxKpi}`);
  uniq(tpl.kpis.map((k) => k.key), `${p} kpi`);
  for (const k of tpl.kpis) {
    const kp = `${p} kpi ${k.key}`;
    ok(["count", "percent", "days", "SAR", "ratio"].includes(k.unit), `${kp}: unit`);
    ok(["weekly", "monthly", "point_in_time"].includes(k.period), `${kp}: period`);
    ok(["higher_is_better", "lower_is_better"].includes(k.direction), `${kp}: direction`);
    ok(k.target === null && k.status === "proposal", `${kp}: target must be null and status 'proposal'`);
    ok(["green", "amber", "red"].every((t) => typeof k.thresholds?.[t] === "string" && k.thresholds[t]), `${kp}: thresholds`);
    ok(typeof k.formula === "string" && k.formula && typeof k.source === "string" && k.source && typeof k.frequency === "string", `${kp}: formula/source/frequency`);
    role(k.ownerRole, `${kp}.ownerRole`);
  }

  // RAG
  ok(JSON.stringify(tpl.ragPolicy.rules.map((r) => r.status)) === JSON.stringify(["green", "amber", "red", "unknown", "stale"]), `${p}: ragPolicy statuses`);
  ok(Number.isInteger(tpl.ragPolicy.staleAfterDays) && tpl.ragPolicy.staleAfterDays > 0, `${p}: staleAfterDays`);

  // vocabularies
  ok(JSON.stringify(tpl.tsaStates) === JSON.stringify(expect.tsa), `${p}: tsaStates`);
  ok(JSON.stringify(tpl.decisionStates) === JSON.stringify(DEC), `${p}: decisionStates`);
  ok(JSON.stringify(tpl.partnerStages) === JSON.stringify(expect.partner), `${p}: partnerStages`);

  // bilingual everywhere
  walkBilingual(tpl, p);

  // content rules
  walkStrings(tpl, p, (s, path) => {
    ok(!s.includes("%"), `${path}: contains a percentage sign`);
    ok(!/\b(19|20)\d{2}\b/.test(s), `${path}: contains what looks like a year/date`);
    ok(!/\bSAR\s*\d/.test(s), `${path}: contains an amount`);
    if (/Asset Transfer Agreement|Master Services? Agreement|Communications,? Space|Data Cent(er|re) Company/i.test(s))
      ok(s.includes("(proposed expansion — to be confirmed)"), `${path}: abbreviation expanded without '(proposed expansion — to be confirmed)'`);
  });

  return { tpl, gEdges };
}

const dc = validate("dc-carveout.v1.json", {
  key: "dc-carveout", kind: "dc_carveout", dims: DIMS, gates: ["G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7"],
  minCrit: 3, maxCrit: 12, phases: 8, ws: 12, wsNames: DC_WS_NAMES, minWbs: 80, maxWbs: 400, readiness: READINESS,
  minKpi: 12, maxKpi: 40, tsa: TSA, partner: PARTNER,
});
const G5c = closure("G5", dc.gEdges);
ok(!G5c.has("G3") && !G5c.has("G4"), `dc: G5 must not (transitively) require G3/G4; requires ${[...G5c]}`);
ok(closure("G6", dc.gEdges).has("G5"), "dc: G6 must depend on G5");
const dcWbs = new Map(dc.tpl.wbs.map((a) => [a.id, a.prerequisites]));
const jvSigning = closure("WS12-A06", dcWbs);
const dcGate = Object.fromEntries(dc.tpl.wbs.map((a) => [a.id, a.gateKey]));
const leak = [...jvSigning].filter((id) => ["G3", "G4"].includes(dcGate[id]));
ok(leak.length === 0, `dc: JV signing (WS12-A06) transitively depends on G3/G4 activities: ${leak.join(",")}`);

// REQ-SRC-002: every reference heading claim of the source register (docs/source-register.md rows "Heading: …") is mapped to
// at least one workstream of the DC template, and every mapped WBS activity exists and belongs to a mapped workstream.
{
  const mapPath = join(DIR, "..", "source-maps", "dc-carveout.v1.json");
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  const register = readFileSync(join(DIR, "..", "..", "..", "..", "docs", "source-register.md"), "utf8");
  const headingClaims = [...register.matchAll(/^\| (CLM-\d{3}) \|[^|]*\|[^|]*\| Heading: /gm)].map((m) => m[1]);
  ok(headingClaims.length === 7, `source register: expected 7 reference heading claims, found ${headingClaims.length}`);
  ok(map.template === "dc-carveout" && map.version === 1, "source map: not for dc-carveout v1");
  ok(map.verificationStatus === "proposed", "source map: a mapping stays proposed (design trace, not a determination)");
  const wsKeys = new Set(dc.tpl.workstreams.map((w) => w.key ?? w.code));
  const wbsWs = new Map(dc.tpl.wbs.map((a) => [a.id, a.workstreamKey]));
  const mapped = new Map(map.claims.map((c) => [c.claimId, c]));
  for (const id of headingClaims) {
    const c = mapped.get(id);
    ok(!!c, `source map: reference heading ${id} is not mapped to the template`);
    if (!c) continue;
    ok(Array.isArray(c.workstreams) && c.workstreams.length > 0, `source map ${id}: no workstream`);
    for (const w of c.workstreams ?? []) ok(wsKeys.has(w), `source map ${id}: unknown workstream ${w}`);
    for (const a of c.wbs ?? []) {
      ok(wbsWs.has(a), `source map ${id}: unknown WBS activity ${a}`);
      ok(!wbsWs.has(a) || (c.workstreams ?? []).includes(wbsWs.get(a)), `source map ${id}: ${a} belongs to ${wbsWs.get(a)}, not a mapped workstream`);
    }
  }
  for (const id of mapped.keys()) ok(headingClaims.includes(id), `source map: ${id} is not a reference heading claim of the source register`);
  console.log(`source map dc-carveout.v1: ${headingClaims.length} reference headings → ${new Set(map.claims.flatMap((c) => c.workstreams)).size} workstreams, ${map.claims.flatMap((c) => c.wbs ?? []).length} WBS activities`);
}

const gen = validate("general-transformation.v1.json", {
  key: "general-transformation", kind: "general_transformation", dims: [], gates: ["T0", "T1", "T2", "T3"],
  minCrit: 3, maxCrit: 5, phases: 4, ws: 4, wsNames: ["Governance & PMO", "Process & Organization", "Technology Enablement", "Change & Adoption"],
  minWbs: 14, maxWbs: 20, readiness: [], minKpi: 5, maxKpi: 5, tsa: [], partner: [],
});

const per = {}; for (const a of dc.tpl.wbs) per[a.workstreamKey] = (per[a.workstreamKey] || 0) + 1;
console.log(`dc-carveout.v1.json: gates=${dc.tpl.gates.length} workstreams=${dc.tpl.workstreams.length} wbs=${dc.tpl.wbs.length} kpis=${dc.tpl.kpis.length} readinessAreas=${dc.tpl.readinessAreas.length}`);
console.log(`  wbs per workstream: ${Object.entries(per).map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(`  criteria per gate:  ${dc.tpl.gates.map((g) => `${g.key}=${g.criteria.length}`).join(" ")}`);
console.log(`  milestones=${dc.tpl.wbs.filter((a) => a.isMilestone).length} waivable criteria=${dc.tpl.gates.flatMap((g) => g.criteria).filter((c) => c.waivable).map((c) => c.key).join(",")}`);
console.log(`  G5 prerequisite closure: ${[...G5c].sort().join(",")}; JV signing upstream gates: ${[...new Set([...jvSigning].map((i) => dcGate[i]))].sort().join(",")}`);
console.log(`general-transformation.v1.json: gates=${gen.tpl.gates.length} workstreams=${gen.tpl.workstreams.length} wbs=${gen.tpl.wbs.length} kpis=${gen.tpl.kpis.length}`);
console.log(`  criteria per gate:  ${gen.tpl.gates.map((g) => `${g.key}=${g.criteria.length}`).join(" ")}`);
console.log(`checks executed: ${checks}`);
if (errors.length) { console.log(`FAIL — ${errors.length} error(s):`); for (const e of errors) console.log("  - " + e); process.exit(1); }
console.log("PASS — all checks passed");
