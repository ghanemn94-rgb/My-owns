// domain-reviewer DG4 round 1 (T-DG4-REV-DOM-R1): live API probe of P4 source fidelity and operating logic against the
// REAL stack (with-stack.sh: PostgreSQL + API serving the built web, synthetic dev seed). SYNTHETIC data only, in a
// disposable database. The ORACLE is docs/source/playbook.md itself: the probe parses the B0093/B0095/B0099/B0101/B0107/
// B0109-B0115/B0121/B0023/B0021 blocks and compares the API's seeded texts with them. Every in-product approval below is
// a synthetic demo decision that approves nothing real and never touches the engineering gates DG0-DG7.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const BASE = process.env.E2E_BASE_URL;
const OUT = process.env.OUT ?? `${process.env.TMPDIR}/out`;
mkdirSync(OUT, { recursive: true });
const PLAYBOOK = readFileSync(process.env.PLAYBOOK ?? "docs/source/playbook.md", "utf8");
const DEV_ISSUER = "urn:mth:dev-local";
const BU_RETAIL = "01920000-0000-7000-9000-000000000102";
const results = [];
const rec = (id, expected, actual, pass) => {
  results.push({ id, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`);
};
const j = (x, n = 600) => JSON.stringify(x)?.slice(0, n);

// ------------------------------------------------------------------ playbook oracle
function table(block) {
  const i = PLAYBOOK.indexOf(`<!-- ${block} table -->`);
  if (i < 0) throw new Error(`no ${block}`);
  const lines = PLAYBOOK.slice(i).split("\n").slice(1);
  const rows = [];
  for (const l of lines) { if (!l.startsWith("|")) { if (rows.length) break; continue; } rows.push(l.split("|").slice(1, -1).map((c) => c.trim())); }
  return rows.filter((r) => !r.every((c) => /^-+$/.test(c)));
}
const para = (block) => { const m = new RegExp(`\\n([^\\n]+) <!-- ${block} -->`).exec(PLAYBOOK); if (!m) throw new Error(block); return m[1].trim(); };
const B0093 = table("B0093").slice(1), B0095 = table("B0095").slice(1), B0099 = table("B0099").slice(1);
const B0101 = table("B0101"), B0107 = table("B0107"), B0121 = table("B0121").slice(1), B0023 = table("B0023").slice(1);
const B0021 = table("B0021"); // header row is phase 1
const SEVEN = ["B0109", "B0110", "B0111", "B0112", "B0113", "B0114", "B0115"].map(para);

async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  if (r.status !== 204) throw new Error(`login ${username} ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  const call = async (method, path, body, ifMatch) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken };
    if (body !== undefined) h["content-type"] = "application/json";
    if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`;
    if (method === "POST" && ifMatch === undefined) h["idempotency-key"] = randomUUID();
    const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, etag: res.headers.get("etag") };
  };
  return { call, me, id: me.user.id };
}
const must = (r, s, what) => { if (r.status !== s) throw new Error(`${what}: ${r.status} ${j(r.body, 1200)}`); return r.body; };
async function step(name, fn) { try { await fn(); } catch (e) { rec(`${name}.exception`, "no exception", String(e.message ?? e).slice(0, 1500), false); } }

const lead = await session("dev.lead");
const admin = await session("dev.admin");
const orgId = admin.me.organization.id;
const stamp = Date.now().toString(36);
async function synthUser(tid, username, roleCode, scope = { type: "transformation", id: tid }) {
  const u = must(await admin.call("POST", "/api/v1/users", { organizationId: orgId, displayName: `Synthetic ${roleCode} ${username}`, preferredLocale: "en", identity: { issuer: DEV_ISSUER, subject: username } }), 201, `user ${username}`);
  must(await admin.call("POST", "/api/v1/role-assignments", { userId: u.id, roleCode, scope, reason: `Synthetic demo ${roleCode} for the DG4 domain review (approves nothing real)` }), 201, `grant ${roleCode}`);
  return { ...(await session(username)), username };
}

const t = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic DG4 domain review", mode: "end_to_end" }), 201, "create t");
const tid = t.id; const T = `/api/v1/transformations/${tid}`;
const t2 = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic DG4 domain review (second)", mode: "end_to_end" }), 201, "create t2");
const sp = await synthUser(tid, `dom4.sp.${stamp}`, "SP");
const bo = await synthUser(tid, `dom4.bo.${stamp}`, "BO");
const fin = await synthUser(tid, `dom4.fin.${stamp}`, "FIN");
const ids = { tid, t2: t2.id, sp: sp.username, bo: bo.username, fin: fin.username };

// ------------------------------------------------------------------ T11 (B0099)
await step("T11", async () => {
  const tpl = must(await lead.call("GET", "/api/v1/decision-right-templates"), 200, "T11 tpl").items;
  const got = tpl.map((x) => [x.sourceDecisionEn, x.sourceRecommendEn, x.sourceApproveEn, x.sourceConsultEn, x.sourceInformEn, x.sourceSlaEn]);
  rec("T11.template-verbatim-B0099", j(B0099), j(got), j(got) === j(B0099));
  rec("T11.sla-types", "working_days 5, next_steerco_or_urgent, working_days 10, release_plan", tpl.map((x) => `${x.slaType}${x.slaWorkingDays ?? ""}`).join(","),
    tpl.map((x) => `${x.slaType}${x.slaWorkingDays ?? ""}`).join(",") === "working_days5,next_steerco_or_urgent,working_days10,release_plan");
  const dr = must(await lead.call("GET", `${T}/decision-rights`), 200, "T11 per t");
  const rows = dr.items ?? dr;
  rec("T11.copied-per-transformation", "4 rows", `${rows.length} rows: ${j(rows.map((r) => r.decisionEn ?? r.labelEn ?? r.sourceDecisionEn ?? r.templateKey), 300)}`, rows.length === 4);
  ids.decisionRights = rows.map((r) => ({ id: r.id, key: r.templateKey }));
});

// ------------------------------------------------------------------ T12 (B0101)
await step("T12", async () => {
  const tpl = must(await lead.call("GET", "/api/v1/raci-template"), 200, "raci tpl");
  const header = B0101[0].slice(1); // Sponsor, Transformation Lead, Business Owner, Workstream Lead, Finance, Tech/Data
  const parties = ["SP", "TL", "BO", "WL", "FIN", "TD"];
  const want = B0101.slice(1).map((r) => [r[0], ...r.slice(1)]);
  const got = tpl.deliverables.map((d) => [d.sourceDeliverableEn, ...parties.map((p) => d.cells.find((c) => c.partyCode === p)?.value ?? null)]);
  rec("T12.template-verbatim-B0101", `${j(header)} ${j(want)}`, `${j(tpl.parties)} ${j(got)}`, j(got) === j(want));
  const accountable = tpl.deliverables.map((d) => d.cells.filter((c) => c.value === "A" || c.value === "A/R").length);
  rec("T12.one-accountable-each", "[1,1,1,1,1,1]", j(accountable), j(accountable) === "[1,1,1,1,1,1]");
  const raci = must(await lead.call("GET", `${T}/raci`), 200, "raci t");
  const charter = raci.deliverables.find((d) => d.templateKey === "charter");
  const cells = (over) => parties.map((p) => ({ partyCode: p, value: over[p] ?? charter.cells.find((c) => c.partyCode === p)?.value ?? null }));
  const x = await lead.call("PATCH", `${T}/raci/deliverables/${charter.id}`, { cells: cells({ WL: "X" }) }, charter.version);
  rec("T12.value-X-refused", "4xx (400/422)", `${x.status} ${x.body?.code}`, x.status === 400 || x.status === 422);
  const twoA = await lead.call("PATCH", `${T}/raci/deliverables/${charter.id}`, { cells: cells({ TL: "A" }) }, charter.version);
  rec("T12.two-A-refused", "422 raci.accountable_count", `${twoA.status} ${twoA.body?.code}`, twoA.status === 422);
  const ar = await lead.call("PATCH", `${T}/raci/deliverables/${charter.id}`, { cells: cells({ SP: "I", TL: "A/R" }) }, charter.version);
  rec("T12.A/R-accepted-as-one", "200 with TL=A/R", `${ar.status} ${j(ar.body?.cells ?? ar.body, 300)}`, ar.status === 200 && ar.body.cells.find((c) => c.partyCode === "TL")?.value === "A/R");
  const tpl2 = must(await lead.call("GET", "/api/v1/raci-template"), 200, "raci tpl again");
  const raci2 = must(await lead.call("GET", `/api/v1/transformations/${t2.id}/raci`), 200, "raci t2");
  const c2 = raci2.deliverables.find((d) => d.templateKey === "charter");
  rec("T12.edit-isolated (REQ-S10-007)", "template and t2 Charter still SP=A, TL=R",
    `template SP=${tpl2.deliverables[0].cells.find((c) => c.partyCode === "SP").value} TL=${tpl2.deliverables[0].cells.find((c) => c.partyCode === "TL").value}; t2 SP=${c2.cells.find((c) => c.partyCode === "SP").value} TL=${c2.cells.find((c) => c.partyCode === "TL").value}`,
    tpl2.deliverables[0].cells.find((c) => c.partyCode === "SP").value === "A" && c2.cells.find((c) => c.partyCode === "SP").value === "A" && c2.cells.find((c) => c.partyCode === "TL").value === "R");
});

// ------------------------------------------------------------------ five forum layers (B0093)
await step("FORUMS", async () => {
  const f = must(await lead.call("GET", `${T}/forums`), 200, "forums").items;
  const got = f.filter((x) => x.source).map((x) => [x.source.layerEn, x.source.cadenceEn, x.source.purposeEn, x.source.participantsEn, x.source.outputsEn]);
  rec("FORUMS.five-layers-verbatim-B0093", j(B0093), j(got), j(got) === j(B0093));
  rec("FORUMS.cadence-labels", j(B0093.map((r) => r[1])), j(f.map((x) => x.cadenceLabel)), j(f.map((x) => x.cadenceLabel)) === j(B0093.map((r) => r[1])));
  rec("FORUMS.arabic-provisional-flag", "arProvisional is a boolean on each seeded layer", j(f.map((x) => x.source?.arProvisional)), f.every((x) => typeof x.source?.arProvisional === "boolean"));
  ids.forums = f.map((x) => ({ id: x.id, key: x.templateKey }));
});

// ------------------------------------------------------------------ seven indicators (B0109-B0115)
await step("INDICATORS", async () => {
  const it = must(await lead.call("GET", "/api/v1/adoption-indicator-templates"), 200, "ind").items;
  const names = [...new Set(it.map((x) => x.sourceIndicatorEn))];
  rec("INDICATORS.seven-by-name-B0109-B0115", j(SEVEN), j(names), j(names) === j(SEVEN));
  const tp = it.filter((x) => x.indicatorOrdinal === 4).map((x) => `${x.measureEn}<-${x.valueSource}`);
  rec("INDICATORS.training-vs-proficiency-separate (REQ-PB-072)", "two measures for B0112 (training records, assessment records)", j(tp), tp.length === 2 && new Set(it.filter((x) => x.indicatorOrdinal === 4).map((x) => x.valueSource)).size === 2);
});

// ------------------------------------------------------------------ phases (B0021) and G5/G6 evidence (B0023)
await step("PHASES", async () => {
  const p = must(await lead.call("GET", "/api/v1/phases"), 200, "phases").items;
  const want = B0021.map((r) => [r[1], r[2], r[3]]);
  const got = p.map((x) => [x.sourceNameEn.toUpperCase(), x.sourcePurposeEn, x.sourceKeyOutputsEn]);
  rec("PHASES.six-in-order-B0021", j(want), j(got), j(got) === j(want));
  for (const g of ["G5", "G6"]) {
    const gate = await lead.call("GET", `${T}/gates/${g}`);
    const crit = (gate.body?.criteria ?? []).map((c) => c.labelEn ?? c.sourceLabelEn ?? c.nameEn ?? c.key);
    const row = B0023.find((r) => r[0].startsWith(g));
    rec(`GATES.${g}-criteria-vs-B0023`, `${row[1]} | ${row[2]}`, `${gate.status} question=${j(gate.body?.decisionQuestion ?? gate.body?.sourceDecisionQuestionEn ?? gate.body?.definition?.decisionQuestionEn)} criteria=${j(crit, 900)}`, gate.status === 200 && crit.length >= 4);
    ids[`${g}gate`] = gate.body;
  }
});

// ------------------------------------------------------------------ T10 areas (B0095) on an empty transformation
await step("T10", async () => {
  const d = must(await lead.call("GET", `${T}/dashboard`), 200, "dashboard");
  const got = d.areas.map((a) => [a.sourceAreaEn, a.sourceWhatToShowEn, a.sourceRagLogicEn]);
  rec("T10.six-areas-verbatim-B0095", j(B0095), j(got), j(got) === j(B0095));
  const rags = d.areas.map((a) => `${a.code}:${j(a.rag, 120)}`);
  const dataAreas = d.areas.filter((a) => ["outcomes", "value", "portfolio", "people_adoption"].includes(a.code));
  const anyGreen = dataAreas.some((a) => a.rag?.status === "green");
  rec("T10.no-data-never-green", "Outcomes, Value, Portfolio, People & adoption not green with no data (unknown or n/a)", rags.join(" | "), !anyGreen);
  const emptyGreen = d.areas.filter((a) => a.rag?.status === "green").map((a) => `${a.code}:${a.rag.ruleKey}`);
  rec("T10.empty-register-green-is-explicit-rule (observation)", "any green on an empty transformation is an explicit 'none open' rule, not missing data", j(emptyGreen), emptyGreen.every((x) => /none_open/.test(x)));
  const hl = d.areas.flatMap((a) => (a.headlines ?? []).map((h) => `${a.code}.${h.key ?? h.code}=${j(h.value ?? h, 140)}`));
  rec("T10.headlines-distinct-unknown-zero-na", "headlines carry an explicit state (unknown / zero / n/a), not a bare 0", hl.join(" | ").slice(0, 1500), true);
  writeFileSync(`${OUT}/dashboard-empty.json`, JSON.stringify(d, null, 1));
});

// ------------------------------------------------------------------ T13 (B0107)
await step("T13", async () => {
  const body = { name: "Synthetic retail front-line agents", impact: "H", influence: "M", currentStance: "neutral", requiredBehavior: "Synthetic: use the new journey for every order", interventionTypes: ["comms", "training", "involvement", "incentive"], ownerUserId: bo.id };
  const hostile = await lead.call("POST", `${T}/stakeholder-groups`, { ...body, currentStance: "hostile" });
  rec("T13.stance-Hostile-refused", "400", `${hostile.status} ${hostile.body?.code}`, hostile.status === 400);
  const badIv = await lead.call("POST", `${T}/stakeholder-groups`, { ...body, interventionTypes: ["coercion"] });
  rec("T13.intervention-outside-list-refused", "400", `${badIv.status} ${badIv.body?.code}`, badIv.status === 400);
  const badImpact = await lead.call("POST", `${T}/stakeholder-groups`, { ...body, impact: "X" });
  rec("T13.impact-outside-HML-refused", "400", `${badImpact.status}`, badImpact.status === 400);
  const g = await lead.call("POST", `${T}/stakeholder-groups`, body);
  rec("T13.four-source-interventions-accepted", "201", `${g.status} ${j(g.body?.interventionTypes)}`, g.status === 201);
  const plan = must(await lead.call("GET", `${T}/adoption-plan`), 200, "plan");
  const row = plan.rows[0] ?? {};
  const cols = ["stakeholder", "impact", "currentStance", "requiredBehavior", "intervention", "ownerUserId", "adoptionKpiDefinitionId"];
  rec("T13.seven-columns-B0107", j(B0107[0]), j(cols.map((c) => [c, c in row])), cols.every((c) => c in row));
  ids.stakeholderGroup = g.body?.id;
});

// ------------------------------------------------------------------ T15 (B0128)
await step("T15", async () => {
  const base = { description: "Synthetic RAID entry", impact: "high", ownerUserId: bo.id, dueDate: "2026-12-01", mitigation: "Synthetic mitigation" };
  const opp = await lead.call("POST", `${T}/raid`, { ...base, type: "opportunity", probability: "low" });
  rec("T15.type-outside-RAID-refused", "400", `${opp.status} ${opp.body?.code}`, opp.status === 400);
  const issueH = await lead.call("POST", `${T}/raid`, { ...base, type: "issue", probability: "high" });
  rec("T15.issue-with-probability-refused", "422", `${issueH.status} ${issueH.body?.code}`, issueH.status === 422);
  const assumpH = await lead.call("POST", `${T}/raid`, { ...base, type: "assumption", probability: "medium" });
  rec("T15.assumption-with-probability-refused", "422", `${assumpH.status} ${assumpH.body?.code}`, assumpH.status === 422);
  const riskNo = await lead.call("POST", `${T}/raid`, { ...base, type: "risk" });
  rec("T15.risk-without-probability-refused", "422", `${riskNo.status} ${riskNo.body?.code}`, riskNo.status === 422);
  const risk = await lead.call("POST", `${T}/raid`, { ...base, type: "risk", probability: "high" });
  const issue = await lead.call("POST", `${T}/raid`, { ...base, type: "issue" });
  rec("T15.risk-and-issue-created", "201 R-nn (probability high) and 201 I-nn (probability n/a = null)", `${risk.status} ${risk.body?.code} p=${risk.body?.probability}; ${issue.status} ${issue.body?.code} p=${issue.body?.probability}`,
    risk.status === 201 && /^R-/.test(risk.body.code) && issue.status === 201 && /^I-/.test(issue.body.code) && issue.body.probability === null);
  const cols = ["code", "type", "description", "impact", "probability", "ownerUserId", "dueDate", "mitigation", "status"];
  rec("T15.nine-columns", "ID Type Description Impact Probability Owner Due Mitigation Status", j(cols.map((c) => [c, c in (risk.body ?? {})])), cols.every((c) => c in (risk.body ?? {})));
  ids.risk = risk.body?.id;
});

// ------------------------------------------------------------------ T16 (B0130) and the executive ask
await step("T16", async () => {
  const ask = { title: "Synthetic: approve roaming partner rate change", whyNow: "Synthetic: partner contract renews this month", options: [{ title: "Accept the rate" }, { title: "Renegotiate" }, { title: "Exit the partner" }], recommendation: "Synthetic: renegotiate", impactOfDelay: "Synthetic: 2 weeks of lost roaming attach", ownerUserId: sp.id, requiredDate: "2026-11-15" };
  for (const k of ["whyNow", "impactOfDelay", "recommendation", "options", "ownerUserId", "requiredDate", "title"]) {
    const b = { ...ask }; delete b[k];
    const r = await lead.call("POST", `${T}/executive-decisions`, b);
    rec(`T16.ask-without-${k}-refused`, "400", `${r.status} ${r.body?.code} ${j(r.body?.errors ?? r.body?.pointer ?? "", 160)}`, r.status === 400);
  }
  const d = await lead.call("POST", `${T}/executive-decisions`, ask);
  const cols = ["code", "decision", "whyNow", "options", "recommendationText", "ownerUserId", "decisionDate", "impactOfDelay", "outcome"];
  rec("T16.created-nine-columns", "201 DEC-nn with ID, Decision, Why now, Options, Rec., Owner, Decision date, Impact if delayed, Outcome",
    `${d.status} ${d.body?.code} ${j(cols.map((c) => [c, c in (d.body ?? {})]))} options=${j(d.body?.options?.map((o) => o.label))}`, d.status === 201 && /^DEC-/.test(d.body.code) && cols.every((c) => c in d.body));
  ids.decision = d.body?.id;
});

// ------------------------------------------------------------------ status separation and closure guard on a fresh transformation
await step("STATUS", async () => {
  const sm = must(await lead.call("GET", `${T}/status-model`), 200, "status-model");
  rec("STATUS.separate-states", "deliveryState, valueState, bauState, closureState are separate fields; label never 'successful'", j(sm, 500), ["deliveryState", "valueState", "bauState", "closureState"].every((k) => k in sm) && !/success/i.test(sm.label));
  const closeSp = await sp.call("POST", `${T}/close`, { note: "Synthetic closure attempt" });
  rec("STATUS.close-by-SP", "refused (SP holds no closure permission, or the closure guard)", `${closeSp.status} ${closeSp.body?.code}`, closeSp.status === 403 || closeSp.status === 422);
  const close = await lead.call("POST", `${T}/close`, { note: "Synthetic closure attempt" });
  rec("STATUS.close-refused-without-validated-value", "422 (or 403 if not permitted)", `${close.status} ${close.body?.code} ${j(close.body?.detail, 300)}`, close.status === 422 || close.status === 403);
  const cur = must(await lead.call("GET", T), 200, "get t");
  const patch = await lead.call("PATCH", T, { status: "closed" }, cur.version);
  rec("STATUS.patch-closed-refused", "422", `${patch.status} ${patch.body?.code} ${j(patch.body?.detail, 300)}`, patch.status === 422);
  rec("STATUS.transformation-status-while-G1-G6-open", "observation", `status=${cur.status} phase=${cur.currentPhase ?? cur.phase}`, true);
});

// ------------------------------------------------------------------ workspace header and overview
await step("HEADER", async () => {
  const h = must(await lead.call("GET", `${T}/summary`), 200, "header");
  const keys = ["phase", "gateReadiness", "northStar", "owners", "outcomeHealth", "benefits", "keyDecisions", "nextActions"];
  rec("HEADER.eight-elements", j(keys), j(keys.map((k) => [k, k in h])), keys.every((k) => k in h));
  rec("HEADER.unknown-where-missing", "northStar/outcomeHealth/benefits state unknown (not 0)", `northStar=${j(h.northStar)} outcomeHealth=${j(h.outcomeHealth, 200)} benefits=${j(h.benefits, 300)}`,
    h.northStar.state === "unknown" && JSON.stringify(h.outcomeHealth).includes("unknown"));
  writeFileSync(`${OUT}/header-empty.json`, JSON.stringify(h, null, 1));
  const ov = must(await lead.call("GET", `/api/v1/overview?organizationId=${orgId}&transformationId=${tid}`), 200, "overview");
  rec("OVERVIEW.six-areas", "6 areas in T10 order", j(ov.areas.map((a) => a.code)), j(ov.areas.map((a) => a.code)) === j(["outcomes", "value", "portfolio", "dependencies", "decisions", "people_adoption"]));
});

// ------------------------------------------------------------------ technical admin is never a business approver (REQ-S10-003)
await step("ADM", async () => {
  const g = await admin.call("POST", `${T}/gates/G1/decision`, { submissionNo: 1, decision: "approved", rationale: "Synthetic ADM attempt" }, 1);
  rec("ADM.gate-decision-403", "403", `${g.status} ${g.body?.code}`, g.status === 403);
});

console.log(`### summary ${results.filter((r) => r.pass).length}/${results.length} PASS`);
writeFileSync(`${OUT}/ids.json`, JSON.stringify(ids, null, 1));
process.exit(results.every((r) => r.pass) ? 0 : 1);
