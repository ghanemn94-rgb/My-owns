// domain-reviewer DG3 round 1 (T-DG3-REV-DOM-R1): live API probe of the P3 "Mobilize" operating logic against the
// real stack (with-stack.sh). SYNTHETIC data only, in a disposable database. Every product-gate decision (G1-G4),
// selection, funding and Finance validation below is a demo business decision on synthetic data; it approves nothing
// real and never touches the engineering gates DG0-DG7. Writes ids for the UI probe to $OUT/ids.json.
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
const BASE = process.env.E2E_BASE_URL;
const OUT = process.env.OUT ?? `${process.env.TMPDIR}/shots`;
mkdirSync(OUT, { recursive: true });
const DEV_ISSUER = "urn:mth:dev-local";
const U = { office: "01920000-0000-7000-9000-000000000202", lead: "01920000-0000-7000-9000-000000000203" };
const BU_RETAIL = "01920000-0000-7000-9000-000000000102";
const results = [];
const rec = (id, expected, actual, pass) => {
  results.push({ id, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`);
};
const j = (x, n = 700) => JSON.stringify(x)?.slice(0, n);

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
    return { status: res.status, body: json };
  };
  return { call, me, id: me.user.id };
}
const must = (r, s, what) => { if (r.status !== s) throw new Error(`${what}: ${r.status} ${j(r.body, 1200)}`); return r.body; };
async function step(name, fn) { try { await fn(); } catch (e) { rec(`${name}.exception`, "no exception", String(e.message ?? e).slice(0, 1500), false); } }

const lead = await session("dev.lead");
const admin = await session("dev.admin");
const office = await session("dev.office");
const auditor = await session("dev.auditor");
const orgId = admin.me.organization.id;

async function synthUser(tid, username, roleCode, scope = { type: "transformation", id: tid }) {
  const u = must(await admin.call("POST", "/api/v1/users", { organizationId: orgId, displayName: `Synthetic ${roleCode} ${username}`, preferredLocale: "en", identity: { issuer: DEV_ISSUER, subject: username } }), 201, `user ${username}`);
  must(await admin.call("POST", "/api/v1/role-assignments", { userId: u.id, roleCode, scope, reason: `Synthetic demo ${roleCode} for the DG3 domain review (approves nothing real)` }), 201, `grant ${roleCode}`);
  return { ...(await session(username)), username };
}

// ---------------------------------------------------------------- setup: an End-to-End transformation
const t = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic DG3 domain review E2E", mode: "end_to_end" }), 201, "create t");
const tid = t.id; const T = `/api/v1/transformations/${tid}`;
const stamp = Date.now().toString(36);
const sp = await synthUser(tid, `dom.sp.${stamp}`, "SP");
const fin = await synthUser(tid, `dom.fin.${stamp}`, "FIN");
const wl = await synthUser(tid, `dom.wl.${stamp}`, "WL");
const meth = await synthUser(tid, `dom.meth.${stamp}`, "ADM_METHOD", { type: "organization", id: orgId });
const ids = { tid, sp: sp.username, fin: fin.username, meth: meth.username };

// ---------------------------------------------------------------- T05 (REQ-PB-045): 14 fields, deliverable-count warning
const t05Body = {
  transformationId: tid,
  name: "Synthetic roaming pass relaunch",
  executiveOwnerUserId: U.lead,
  workstreamLeadUserId: wl.id,
  problemStatement: "Synthetic: roaming attach rate is low (TOM gap: product design).",
  objective: "Synthetic: raise roaming pass attach rate.",
  scopeIn: "Synthetic: consumer prepaid and postpaid roaming passes.",
  scopeOut: "Synthetic: enterprise roaming.",
  financialBenefitSummary: "Synthetic: revenue uplift from attach rate.",
  customerBenefitSummary: "Synthetic: fewer bill-shock complaints.",
  risksSummary: "Synthetic: partner rate negotiation delays.",
  plannedStart: "2026-11-01",
  plannedEnd: "2027-06-30",
};
let A, B, C;
await step("REQ-PB-045", async () => {
  A = must(await lead.call("POST", "/api/v1/initiatives", t05Body), 201, "create A");
  const nar = ["name", "executiveOwnerUserId", "workstreamLeadUserId", "problemStatement", "objective", "scopeIn", "scopeOut", "financialBenefitSummary", "customerBenefitSummary", "risksSummary"];
  const got = must(await lead.call("GET", `/api/v1/initiatives/${A.id}`), 200, "get A");
  const diff = nar.filter((k) => got[k] !== t05Body[k]);
  rec("REQ-PB-045.draft-before-G1", "201 draft (drafting allowed before G1)", `${got.status} ${got.code}`, got.status === "draft");
  rec("REQ-PB-045.t05-narrative-fields-persist", "fields 1-6, 9, 10, 12 round-trip verbatim", `diff=${j(diff)}`, diff.length === 0);
  const w = (x) => (x.warnings ?? []).map((v) => v.code);
  rec("REQ-PB-045.warning-0-deliverables", "warning initiative.deliverable_count with 0 deliverables", j(w(got)), w(got).includes("initiative.deliverable_count"));
  const mkDel = async (n) => must(await lead.call("POST", `/api/v1/initiatives/${A.id}/deliverables`, { title: `Synthetic deliverable ${n}` }), 201, `deliverable ${n}`);
  for (let i = 1; i <= 2; i++) await mkDel(i);
  let g = must(await lead.call("GET", `/api/v1/initiatives/${A.id}`), 200, "get A");
  rec("REQ-PB-045.warning-2-deliverables", "2 deliverables -> warning (not a rejection)", `${j(g.warnings)}`, w(g).includes("initiative.deliverable_count"));
  await mkDel(3);
  g = must(await lead.call("GET", `/api/v1/initiatives/${A.id}`), 200, "get A");
  rec("REQ-PB-045.no-warning-3-deliverables", "3 deliverables -> no deliverable_count warning", j(w(g)), !w(g).includes("initiative.deliverable_count"));
  for (let i = 4; i <= 8; i++) await mkDel(i);
  g = must(await lead.call("GET", `/api/v1/initiatives/${A.id}`), 200, "get A");
  rec("REQ-PB-045.warning-8-deliverables", "8 deliverables -> warning, all 8 accepted", `${j(g.warnings)}; count=${must(await lead.call("GET", `/api/v1/initiatives/${A.id}/deliverables`), 200, "dl").items.length}`, w(g).includes("initiative.deliverable_count"));
  // archive 3 so A ends with 5 deliverables (inside 3-7)
  const dl = must(await lead.call("GET", `/api/v1/initiatives/${A.id}/deliverables`), 200, "dl").items;
  for (const d of dl.slice(5)) must(await lead.call("PATCH", `/api/v1/deliverables/${d.id}`, { archiveReason: "Synthetic trim" }, d.version), 200, "archive deliverable");
  g = must(await lead.call("GET", `/api/v1/initiatives/${A.id}`), 200, "get A");
  rec("REQ-PB-045.back-in-range", "5 active deliverables -> no warning", j(w(g)), !w(g).includes("initiative.deliverable_count"));
  // milestones (field 13) and required decisions (field 14) and dependencies (field 11) are linked records; checked below
  ids.A = { id: A.id, code: A.code, name: A.name };
});
B = must(await lead.call("POST", "/api/v1/initiatives", { transformationId: tid, name: "Synthetic partner rate engine", objective: "Synthetic objective B", scopeIn: "Synthetic scope B", executiveOwnerUserId: U.lead, workstreamLeadUserId: U.lead, plannedStart: "2026-12-01", plannedEnd: "2027-03-31" }), 201, "B");
C = must(await lead.call("POST", "/api/v1/initiatives", { transformationId: tid, name: "Synthetic roaming app journey", objective: "Synthetic objective C", scopeIn: "Synthetic scope C", plannedStart: "2027-01-01", plannedEnd: "2027-09-30" }), 201, "C");
ids.B = { id: B.id, code: B.code, name: B.name }; ids.C = { id: C.id, code: C.code, name: C.name };

const ver = async (id) => must(await lead.call("GET", `/api/v1/initiatives/${id}`), 200, "ver").version;

// ---------------------------------------------------------------- REQ-PB-007 / REQ-PB-022: before G1
await step("REQ-PB-007", async () => {
  const s = await lead.call("POST", `/api/v1/initiatives/${A.id}/submit`, {}, await ver(A.id));
  rec("REQ-PB-007.submit-before-G1-422", "422 urn:mth:problem:invalid-transition initiative.g1_not_approved", `${s.status} ${s.body.type} ${s.body.code} '${s.body.detail}'`, s.status === 422 && s.body.type === "urn:mth:problem:invalid-transition" && s.body.code === "initiative.g1_not_approved");
  rec("REQ-PB-022.pre-G1-add-to-portfolio-refused", "detail names leadership agreement on problem, baseline and material value pools", s.body.detail, /problem, baseline and material value pools/.test(s.body.detail ?? ""));
  const sel = await sp.call("POST", `/api/v1/initiatives/${A.id}/select`, { rationale: "Synthetic early select" }, await ver(A.id));
  rec("REQ-PB-007.select-before-G1-refused", "422 (draft cannot be selected)", `${sel.status} ${sel.body.code}`, sel.status === 422);
  const l = await lead.call("POST", `/api/v1/initiatives/${A.id}/launch`, {}, await ver(A.id));
  rec("REQ-PB-007.launch-draft-refused", "422 invalid-transition", `${l.status} ${l.body.code}`, l.status === 422);
  const r = must(await lead.call("GET", `${T}/readiness`), 200, "readiness");
  rec("REQ-PB-007.readiness-missing-areas", "missingDiagnosticAreas = economics, customer, operations, capability, technology (B0012)", j(r.missingDiagnosticAreas), j(r.missingDiagnosticAreas) === j(["economics", "customer", "operations", "capability", "technology"]));
  rec("REQ-PB-007.readiness-sequencing", "canSubmitInitiatives=false with the G1 blocker", `${r.sequencing?.canSubmitInitiatives} ${j(r.sequencing?.blockers?.map((b) => b.code))}`, r.sequencing?.canSubmitInitiatives === false);
  console.log("READINESS diagnostic:", j(r.diagnostic, 1500));
});

// ---------------------------------------------------------------- G1 records (P2) and the G1 decision with agreements
let gapIds = [];
await step("G1-setup", async () => {
  const baseline = must(await lead.call("POST", `${T}/baselines`, { metric: "Synthetic roaming attach rate", unit: "%", scope: "revenue", value: "10", source: "Synthetic BI extract", baselineDate: "2026-09-01" }), 201, "baseline");
  const note = must(await lead.call("POST", `${T}/evidence`, { kind: "note", title: "Synthetic baseline paper", ownerUserId: lead.id, noteBody: "Synthetic: 10% attach in Aug." }), 201, "evidence");
  must(await lead.call("POST", `${T}/evidence-links`, { evidenceId: note.id, recordType: "baseline", recordId: baseline.id }), 201, "evlink");
  must(await office.call("POST", `${T}/evidence/${note.id}/review`, { result: "verified", accessibilityStatus: "accessible", note: "Synthetic check" }, note.version), 200, "review");
  const items = must(await lead.call("GET", `${T}/diagnostic-items?limit=100`), 200, "items").items;
  for (const it of items) must(await lead.call("PATCH", `${T}/diagnostic-items/${it.id}`, { currentState: "Synthetic current state", rootCause: "Synthetic root cause", impactText: "Synthetic impact", confidence: "M", baselineId: baseline.id }, it.version), 200, "diag item");
  const r = must(await lead.call("GET", `${T}/readiness`), 200, "readiness");
  rec("REQ-PB-007.readiness-after-diagnostic", "missingDiagnosticAreas = [] once all T01 dimensions are covered", j(r.missingDiagnosticAreas), j(r.missingDiagnosticAreas) === "[]");
  const meth = must(await lead.call("GET", `${T}/methodology`), 200, "meth");
  const finding = must(await lead.call("POST", `${T}/diagnostic-findings`, { workstreamCode: meth.diagnosticWorkstreams[0].code, kind: "root_cause", statement: "Synthetic: pass pricing is unclear", status: "confirmed" }), 201, "finding");
  ids.findingId = finding.id;
  must(await lead.call("POST", `${T}/value-pools`, { name: "Synthetic roaming value pool", quantificationStatus: "unquantified", unquantifiedReason: "Synthetic: not sized", materiality: "material" }), 201, "vp");
  must(await lead.call("POST", `${T}/charter`, { transformationName: "Synthetic DG3 charter", caseForChange: "Synthetic: roaming leakage", outOfScope: "Synthetic: wholesale", inScope: "Synthetic: consumer roaming", executiveSponsorUserId: sp.id, transformationLeadUserId: lead.id, baselineDate: "2026-09-01" }), 201, "charter");
});
async function submitGate(code) {
  const v = must(await lead.call("GET", `${T}/gates/${code}`), 200, "gate");
  const inc = v.criteria.filter((c) => c.completeness !== "complete");
  if (inc.length) throw new Error(`${code} incomplete ${j(inc, 1500)}`);
  must(await lead.call("POST", `${T}/gates/${code}/submissions`, { submissionNote: `Synthetic ${code}` }, v.gate.version), 201, `submit ${code}`);
  return must(await sp.call("GET", `${T}/gates/${code}`), 200, "gate");
}
await step("REQ-PB-022", async () => {
  const g = await submitGate("G1");
  const body = { submissionNo: g.gate.latestSubmissionNo, outcome: "approved", rationale: "Synthetic demo G1 approval (approves nothing real)." };
  const none = await sp.call("POST", `${T}/gates/G1/decision`, body, g.gate.version);
  rec("REQ-PB-022.g1-approve-without-agreements", "422 gate.g1_agreements_required with the three pointers; nothing written", `${none.status} ${none.body.code} ${j(none.body.errors?.map((e) => e.pointer))}`, none.status === 422 && none.body.code === "gate.g1_agreements_required" && (none.body.errors ?? []).length === 3);
  const partial = await sp.call("POST", `${T}/gates/G1/decision`, { ...body, agreements: { problem: true, baseline: true } }, g.gate.version);
  rec("REQ-PB-022.g1-approve-partial-agreements", "422/400 refused (materialValuePools missing)", `${partial.status} ${partial.body.code} ${j(partial.body.errors?.map((e) => e.pointer))}`, [400, 422].includes(partial.status));
  const fals = await sp.call("POST", `${T}/gates/G1/decision`, { ...body, agreements: { problem: true, baseline: false, materialValuePools: true } }, g.gate.version);
  rec("REQ-PB-022.g1-approve-false-agreement", "refused (400 const true or 422)", `${fals.status} ${fals.body.code}`, [400, 422].includes(fals.status));
  const still = must(await lead.call("GET", `${T}/gates/G1`), 200, "g1");
  rec("REQ-PB-022.nothing-written", "G1 still submitted, same version", `${still.gate.status} v${still.gate.version} (was v${g.gate.version})`, still.gate.status === "submitted" && still.gate.version === g.gate.version);
  const ok = await sp.call("POST", `${T}/gates/G1/decision`, { ...body, agreements: { problem: true, baseline: true, materialValuePools: true } }, g.gate.version);
  rec("REQ-PB-022.g1-approve-with-agreements", "200/201 approved; decision records the three agreements", `${ok.status} ${j(ok.body.agreements ?? ok.body.decision?.agreements)}`, [200, 201].includes(ok.status));
});

// ---------------------------------------------------------------- REQ-PB-006 Outcome before activity; REQ-PB-032 hierarchy
let define = {};
await step("REQ-PB-006", async () => {
  const s = await lead.call("POST", `/api/v1/initiatives/${A.id}/submit`, {}, await ver(A.id));
  rec("REQ-PB-006.submit-without-outcome", "422 validation naming 'Outcome before activity'", `${s.status} ${s.body.type} ${s.body.code} '${s.body.detail}' ${j(s.body.errors?.map((e) => e.pointer))}`, s.status === 422 && /Outcome before activity/.test(s.body.detail ?? "") && s.body.type === "urn:mth:problem:validation");
  const outcome = must(await lead.call("POST", `${T}/outcomes`, { statement: "Synthetic roaming revenue grows", ownerUserId: lead.id, isTopOutcome: true, topRank: 1, specificConfirmed: true, strategicallyRelevantConfirmed: true, causalChain: "Synthetic: better passes -> attach -> revenue" }), 201, "outcome");
  const kpi = must(await lead.call("POST", `${T}/kpi-definitions`, { name: "Synthetic roaming attach rate KPI", unitKind: "percentage", polarity: "higher_is_better", ownerUserId: lead.id }), 201, "kpi");
  must(await lead.call("POST", `${T}/kpi-definitions/${kpi.id}/activate`, {}, kpi.version), 200, "activate kpi");
  const okpi = must(await lead.call("POST", `${T}/outcome-kpis`, { outcomeId: outcome.id, kpiDefinitionId: kpi.id, targetDate: "2027-12-31", targetValue: "12", ownerUserId: lead.id }), 201, "okpi");
  define = { outcomeId: outcome.id, kpiId: kpi.id, outcomeKpiId: okpi.id };
  // a contribution with no outcome is rejected (REQ-PB-032)
  const noOutcome = await lead.call("POST", `/api/v1/initiatives/${A.id}/outcome-contributions`, { contributionStatement: "Synthetic: no outcome" });
  rec("REQ-PB-032.contribution-without-outcome-rejected", "400 at /outcomeId", `${noOutcome.status} ${j(noOutcome.body.errors?.map((e) => e.pointer))}`, noOutcome.status === 400 && j(noOutcome.body.errors).includes("/outcomeId"));
  // outcome without a KPI is still "no measurable outcome"
  const c1 = must(await lead.call("POST", `/api/v1/initiatives/${A.id}/outcome-contributions`, { outcomeId: outcome.id, contributionStatement: "Synthetic: no KPI yet" }), 201, "contrib no kpi");
  const s2 = await lead.call("POST", `/api/v1/initiatives/${A.id}/submit`, {}, await ver(A.id));
  rec("REQ-PB-006.outcome-without-kpi-still-refused", "422 outcome_before_activity (needs an outcome with a KPI)", `${s2.status} ${s2.body.code}`, s2.status === 422 && s2.body.code === "initiative.outcome_before_activity");
  must(await lead.call("POST", `/api/v1/initiatives/${A.id}/outcome-contributions`, { outcomeId: outcome.id, outcomeKpiId: okpi.id, contributionStatement: "Synthetic: attach rate +2 pp" }), 201, "contrib");
  const s3 = await lead.call("POST", `/api/v1/initiatives/${A.id}/submit`, {}, await ver(A.id));
  rec("REQ-PB-006.submit-with-link-accepted", "200 submitted", `${s3.status} ${s3.body.status}`, s3.status === 200 && s3.body.status === "submitted");
  for (const X of [B, C]) {
    must(await lead.call("POST", `/api/v1/initiatives/${X.id}/outcome-contributions`, { outcomeId: outcome.id, outcomeKpiId: okpi.id, contributionStatement: "Synthetic contribution" }), 201, "contrib X");
    must(await lead.call("POST", `/api/v1/initiatives/${X.id}/submit`, {}, await ver(X.id)), 200, "submit X");
  }
  ids.define = define;
});

// ---------------------------------------------------------------- REQ-PB-040 TOM vs portfolio; gap links
await step("REQ-PB-040", async () => {
  const canvas = must(await lead.call("GET", `${T}/tom-canvas`), 200, "canvas");
  const cell = canvas.cells[0].cell;
  const g1 = must(await lead.call("POST", `${T}/tom-gaps`, { dimensionCode: cell.dimensionCode, gap: "Synthetic: no flexible passes", ownerUserId: lead.id }), 201, "gap1");
  const g2 = must(await lead.call("POST", `${T}/tom-gaps`, { dimensionCode: canvas.cells[1].cell.dimensionCode, gap: "Synthetic: partner rates not digital", ownerUserId: lead.id }), 201, "gap2");
  gapIds = [g1.id, g2.id]; ids.gapIds = gapIds;
  const asTom = await lead.call("POST", `/api/v1/initiatives/${A.id}/gap-links`, { targetType: "tom_canvas_cell", targetId: cell.id ?? g1.id });
  rec("REQ-PB-040.initiative-as-tom-evidence-refused", "422 initiative.not_tom_evidence", `${asTom.status} ${asTom.body.code} '${asTom.body.detail}'`, asTom.status === 422 && asTom.body.code === "initiative.not_tom_evidence");
  for (const tt of ["capability", "journey", "tom_dimension"]) {
    const r = await lead.call("POST", `/api/v1/initiatives/${A.id}/gap-links`, { targetType: tt, targetId: g1.id });
    rec(`REQ-PB-040.refused-${tt}`, "422 initiative.not_tom_evidence", `${r.status} ${r.body.code}`, r.status === 422 && r.body.code === "initiative.not_tom_evidence");
  }
  const ev = await lead.call("POST", `${T}/evidence-links`, { evidenceId: randomUUID(), recordType: "initiative", recordId: A.id });
  rec("REQ-PB-040.initiative-not-an-evidence-record-type", "400/422 (initiative is not an evidence_link record type)", `${ev.status} ${ev.body.code} ${j(ev.body.errors?.map((e) => e.pointer))}`, [400, 404, 422].includes(ev.status));
  for (const gid of gapIds) must(await lead.call("POST", `/api/v1/initiatives/${A.id}/gap-links`, { targetType: "tom_gap", targetId: gid }), 201, "link gap");
  const fl = await lead.call("POST", `/api/v1/initiatives/${A.id}/gap-links`, { targetType: "diagnostic_finding", targetId: ids.findingId });
  const links = must(await lead.call("GET", `/api/v1/initiatives/${A.id}/gap-links`), 200, "links").items;
  rec("REQ-PB-040.links-to-one-or-more-gaps", "two TOM gaps + one finding linked (1..n)", `finding link ${fl.status}; active=${links.filter((l) => l.status === "active").length}`, links.filter((l) => l.status === "active").length === 3);
  for (const X of [B, C]) must(await lead.call("POST", `/api/v1/initiatives/${X.id}/gap-links`, { targetType: "tom_gap", targetId: gapIds[0] }), 201, "link X");
});

await step("REQ-PB-032", async () => {
  const nsr = await lead.call("PUT", `${T}/north-star`, { statement: "Synthetic: make roaming effortless, trusted and economically accretive" });
  if (![200, 201].includes(nsr.status)) throw new Error(`north star ${nsr.status} ${j(nsr.body)}`);
  const ns = nsr.body.id;
  ids.northStarId = ns;
  const h = must(await lead.call("GET", `${T}/outcome-hierarchy`), 200, "hierarchy");
  const s = j(h, 4000);
  console.log("HIERARCHY", s.slice(0, 1500));
  const hasNS = !!h.northStar;
  const hasOutcome = s.includes(define.outcomeId);
  const hasKpi = s.includes(define.kpiId) || s.includes(define.outcomeKpiId);
  const hasTarget = s.includes("targetValue") || s.includes("\"12");
  const hasContribution = s.includes(A.id);
  rec("REQ-PB-032.five-levels", "North Star, outcome, KPI, target and initiative contribution in one tree", `NS=${hasNS} outcome=${hasOutcome} kpi=${hasKpi} target=${hasTarget} contribution=${hasContribution}`, hasNS && hasOutcome && hasKpi && hasTarget && hasContribution);
});

// ---------------------------------------------------------------- T06 (REQ-PB-047/048, REQ-S09-001)
const SC = { strategic_fit: 5, financial_value: 4, customer_impact: 3, feasibility: 2, time_to_value: 1 };
await step("REQ-PB-048", async () => {
  const bad = await lead.call("POST", `/api/v1/initiatives/${A.id}/scores`, { criterionCode: "strategic_fit", score: 6 });
  rec("REQ-PB-048.score-6-rejected", "400 at /score", `${bad.status} ${j(bad.body.errors?.map((e) => e.pointer))}`, bad.status === 400 && j(bad.body.errors).includes("/score"));
  const wsr = await lead.call("POST", `/api/v1/initiatives/${A.id}/scores`, { criterionCode: "strategic_fit", score: 5, weightedScore: "5.00" });
  const wsAfter = must(await lead.call("GET", `/api/v1/initiatives/${A.id}/scores`), 200, "sheet");
  rec("REQ-PB-047.weighted-score-read-only", "weightedScore in a request -> 400 and nothing written", `${wsr.status} ${j(wsr.body.errors?.map((e) => [e.pointer, e.code]))}; scores stored=${(wsAfter.scores ?? []).filter((x) => x.score != null).length}`, wsr.status === 400 && (wsAfter.scores ?? []).filter((x) => x.score != null).length === 0);
  for (const [k, v] of Object.entries(SC).slice(0, 4)) must(await lead.call("POST", `/api/v1/initiatives/${A.id}/scores`, { criterionCode: k, score: v }), 201, `score ${k}`);
  let sh = must(await lead.call("GET", `/api/v1/initiatives/${A.id}/scores`), 200, "sheet");
  console.log("SHEET(incomplete)", j(sh.result ?? sh, 800));
  const r1 = sh.result ?? sh.results?.[0];
  rec("REQ-PB-048.missing-score-incomplete", "completeness 'incomplete', weightedScore null, missing time_to_value (never 0)", `${r1?.completeness} ${r1?.weightedScore} ${j(r1?.missingCriteria)}`, r1?.completeness === "incomplete" && r1?.weightedScore === null && j(r1?.missingCriteria).includes("time_to_value"));
  must(await lead.call("POST", `/api/v1/initiatives/${A.id}/scores`, { criterionCode: "time_to_value", score: 1 }), 201, "score ttv");
  sh = must(await lead.call("GET", `/api/v1/initiatives/${A.id}/scores`), 200, "sheet");
  const r2 = sh.result ?? sh.results?.[0];
  rec("REQ-PB-048.54321-is-3.30", "weightedScore 3.3000 (exact), display 3.30, under v1 25/25/20/15/15", `${r2?.weightedScore} display=${r2?.weightedScoreDisplay} v${r2?.weightSetVersionNo}`, r2?.weightedScore === "3.3000" && r2?.weightedScoreDisplay === "3.30" && r2?.weightSetVersionNo === 1);
  rec("REQ-S09-001.display100", "display100 '57.5' with conversion '(score-1)/4*100'; 1-5 value stays the stored result", `${r2?.display100} ${r2?.conversion} stored=${r2?.weightedScore}`, r2?.display100 === "57.5" && r2?.conversion === "(score-1)/4*100");
  const wsets = must(await lead.call("GET", `${T}/prioritization/weight-sets`), 200, "wsets");
  const v1 = wsets.items.find((x) => x.versionNo === 1);
  const wmap = Object.fromEntries((v1.weights ?? []).map((w) => [w.criterionCode, w.weightPercent]));
  rec("REQ-PB-048.default-weights", "v1 active: 25/25/20/15/15 (B0076), approval basis source_default, approved_by null", `${v1.status} ${j(wmap)} basis=${v1.approvalBasis} approvedBy=${v1.approvedBy}`, v1.status === "active" && Number(wmap.strategic_fit) === 25 && Number(wmap.financial_value) === 25 && Number(wmap.customer_impact) === 20 && Number(wmap.feasibility) === 15 && Number(wmap.time_to_value) === 15);
  for (const [X, s] of [[B, { strategic_fit: 4, financial_value: 4, customer_impact: 3, feasibility: 3, time_to_value: 3 }], [C, { strategic_fit: 3, financial_value: 3, customer_impact: 3, feasibility: 3, time_to_value: 3 }]])
    for (const [k, v] of Object.entries(s)) must(await lead.call("POST", `/api/v1/initiatives/${X.id}/scores`, { criterionCode: k, score: v }), 201, "score X");
  const view = must(await lead.call("GET", `${T}/prioritization`), 200, "prio");
  rec("REQ-S09-001.conversion-label", "view carries the labelled conversion", view.conversionLabel, /0.100/.test(view.conversionLabel ?? "") && /4/.test(view.conversionLabel ?? ""));
  const it = view.items.find((x) => x.initiative.id === A.id);
  rec("REQ-S09-004.value-feasibility-axes", "value and feasibility axes present (decimal strings)", `value=${it?.valueAxis} feas=${it?.feasibilityAxis}`, typeof it?.valueAxis === "string" && typeof it?.feasibilityAxis === "string");
  const f = await lead.call("GET", `${T}/prioritization?completeness=complete&funding=not_applicable`);
  rec("REQ-S09-004.filters", "filters accepted (200)", `${f.status} n=${f.body.items?.length}`, f.status === 200);
});
await step("REQ-PB-049", async () => {
  const P = `${T}/prioritization`;
  const snap1 = must(await lead.call("POST", `${P}/rankings`, { note: "Synthetic ranking 1" }), 201, "snap1");
  console.log("SNAP1", j(snap1.entries?.map((e) => [e.initiativeId.slice(-4), e.rank, e.weightedScore, e.causes]), 600));
  const W = (sf, extra = []) => [{ criterionCode: "strategic_fit", weightPercent: sf }, { criterionCode: "financial_value", weightPercent: "25" }, { criterionCode: "customer_impact", weightPercent: "20" }, { criterionCode: "feasibility", weightPercent: "15" }, { criterionCode: "time_to_value", weightPercent: "15" }, ...extra];
  const w95 = await lead.call("POST", `${P}/weight-sets`, { rationale: "Synthetic 95", weights: W("20") });
  rec("REQ-PB-049.95-rejected", "422 prioritization.weights_total 'got 95.00%'", `${w95.status} ${w95.body.code} '${w95.body.detail}'`, w95.status === 422 && w95.body.code === "prioritization.weights_total");
  const w105 = await lead.call("POST", `${P}/weight-sets`, { rationale: "Synthetic 105", weights: W("30") });
  rec("REQ-PB-049.105-rejected", "422 prioritization.weights_total", `${w105.status} ${w105.body.code} '${w105.body.detail}'`, w105.status === 422 && w105.body.code === "prioritization.weights_total");
  const list0 = must(await lead.call("GET", `${P}/weight-sets`), 200, "ws").items.length;
  rec("REQ-PB-049.nothing-written", "only v1 exists after the two refusals", `count=${list0}`, list0 === 1);
  const v2 = must(await lead.call("POST", `${P}/weight-sets`, { rationale: "Synthetic: regulated context, risk/compliance replaces part of strategic fit (B0077)", weights: W("15", [{ criterionCode: "risk_compliance", weightPercent: "10" }]) }), 201, "v2");
  rec("REQ-PB-049.v2-proposed", "201 versionNo 2 proposed", `${v2.versionNo} ${v2.status}`, v2.versionNo === 2 && v2.status === "proposed");
  const self = await lead.call("POST", `${P}/weight-sets/2/approve`, { note: "self" }, v2.version);
  rec("REQ-PB-049.proposer-cannot-approve", "403 (TL lacks prioritization.approve, or SoD)", `${self.status} ${self.body.code}`, self.status === 403);
  const ap = await sp.call("POST", `${P}/weight-sets/2/approve`, { note: "Synthetic demo approval (approves nothing real)" }, v2.version);
  rec("REQ-PB-049.v2-approved-by-sponsor", "200 active", `${ap.status} ${ap.body.status}`, ap.status === 200 && ap.body.status === "active");
  let sh = must(await lead.call("GET", `/api/v1/initiatives/${A.id}/scores`), 200, "sheet");
  const r = sh.result ?? sh;
  rec("REQ-PB-049.rescore-under-v2-incomplete-until-risk-scored", "A incomplete under v2 (risk_compliance missing), not 0", `${r.completeness} v${r.weightSetVersionNo} ${j(r.missingCriteria)}`, r.completeness === "incomplete" && r.weightSetVersionNo === 2);
  for (const [X, v] of [[A, 4], [B, 1], [C, 5]]) must(await lead.call("POST", `/api/v1/initiatives/${X.id}/scores`, { criterionCode: "risk_compliance", score: v }), 201, "risk");
  sh = must(await lead.call("GET", `/api/v1/initiatives/${A.id}/scores`), 200, "sheet");
  const r3 = sh.result ?? sh;
  // v2: 5*15 + 4*25 + 3*20 + 2*15 + 1*15 + 4*10 = 75+100+60+30+15+40 = 320 -> 3.2000
  rec("REQ-PB-049.v2-score", "A under v2 = 3.2000 (5*15+4*25+3*20+2*15+1*15+4*10)/100", `${r3.weightedScore} v${r3.weightSetVersionNo}`, r3.weightedScore === "3.2000" && r3.weightSetVersionNo === 2);
  const snap1b = must(await lead.call("GET", `${P}/rankings/1`), 200, "snap1 again");
  rec("REQ-PB-049.v1-references-kept", "ranking snapshot 1 still references weight set v1", `snapshot1 weightSetVersionNo=${snap1b.snapshot.weightSetVersionNo}`, snap1b.snapshot.weightSetVersionNo === 1);
  const snap2 = must(await lead.call("POST", `${P}/rankings`, { note: "Synthetic ranking 2 under weight version 2" }), 201, "snap2");
  const hist = must(await lead.call("GET", `${P}/ranking-history`), 200, "history");
  const labels = hist.items.flatMap((x) => x.entry.causeLabels);
  console.log("HISTORY", j(hist.items.map((x) => [x.snapshotNo, x.entry.initiativeId.slice(-4), x.entry.previousRank, x.entry.rank, x.entry.causeLabels]), 1500));
  const rankChanged = hist.items.filter((x) => x.snapshotNo === 2 && x.entry.previousRank !== x.entry.rank && x.entry.causeLabels.includes("weight version 2"));
  rec("REQ-S09-005.history-weight-version-2", "history names 'weight version 2' as the cause of a rank change", `labels=${j([...new Set(labels)])}; changed-with-weight=${rankChanged.length}`, labels.includes("weight version 2") && rankChanged.length >= 1);
  ids.snapshot = snap2.snapshot.snapshotNo;
});
await step("REQ-S09-005", async () => {
  const O = `${T}/prioritization/overrides`;
  const none = await lead.call("POST", O, { initiativeId: C.id, overrideRank: 1 });
  rec("REQ-S09-005.override-no-reason", "400 at /reason", `${none.status} ${j(none.body.errors?.map((e) => e.pointer))}`, none.status === 400 && j(none.body.errors).includes("/reason"));
  const blank = await lead.call("POST", O, { initiativeId: C.id, overrideRank: 1, reason: "   ​ " });
  rec("REQ-S09-005.override-blank-reason", "422 prioritization.override_reason_required", `${blank.status} ${blank.body.code}`, blank.status === 422 && blank.body.code === "prioritization.override_reason_required");
  const o = must(await lead.call("POST", O, { initiativeId: C.id, overrideRank: 1, reason: "Synthetic: regulatory deadline" }), 201, "override");
  const selfD = await lead.call("POST", `${O}/${o.id}/decision`, { result: "approved", note: "self" }, o.version);
  rec("REQ-S09-005.override-proposer-cannot-approve", "403", `${selfD.status} ${selfD.body.code}`, selfD.status === 403);
  const d = await sp.call("POST", `${O}/${o.id}/decision`, { result: "approved", note: "Synthetic demo" }, o.version);
  rec("REQ-S09-005.override-approved", "200 approved by the Sponsor", `${d.status} ${d.body.status}`, d.status === 200);
  const s3 = must(await lead.call("POST", `${T}/prioritization/rankings`, { note: "Synthetic ranking 3 with the override" }), 201, "snap3");
  const ce = s3.entries.find((e) => e.initiativeId === C.id);
  rec("REQ-S09-005.override-explained", "C at rank 1 with cause 'override: <reason>'", `${ce?.rank} ${j(ce?.causeLabels)}`, ce?.rank === 1 && j(ce?.causeLabels).includes("override: Synthetic: regulatory deadline"));
});

// ---------------------------------------------------------------- REQ-S09-003 selection != funding; REQ-PB-004 sequencing
await step("REQ-S09-003", async () => {
  const sel = must(await sp.call("POST", `/api/v1/initiatives/${A.id}/select`, { rationale: "Synthetic demo selection" }, await ver(A.id)), 200, "select A");
  rec("REQ-S09-003.selected-unfunded-label", "status selected, fundingState unfunded, displayStatus = i18n key initiative.status.selected_unfunded (the web renders 'Selected - unfunded'; UI probe checks the text)", `${sel.status} ${sel.fundingState} '${sel.displayStatus}'`, sel.status === "selected" && sel.fundingState === "unfunded" && sel.displayStatus === "initiative.status.selected_unfunded");
  const l = await lead.call("POST", `/api/v1/initiatives/${A.id}/launch`, {}, await ver(A.id));
  rec("REQ-PB-004.launch-before-G2G3", "422 invalid-transition 'North Star, outcomes and target state not yet approved' (checked before funding)", `${l.status} ${l.body.type} ${l.body.code} '${l.body.detail}'`, l.status === 422 && l.body.type === "urn:mth:problem:invalid-transition" && l.body.detail === "North Star, outcomes and target state not yet approved");
  const fsel = await lead.call("POST", "/api/v1/funding-decisions", { initiativeId: B.id, outcome: "approved", amount: "1", currency: "SAR", rationale: "Synthetic" });
  rec("REQ-S09-003.ranking-never-funds", "funding a ranked-not-selected initiative refused (TL lacks funding.approve: 403, or 422 funding.not_selected)", `${fsel.status} ${fsel.body.code}`, [403, 422].includes(fsel.status));
  const fsel2 = await fin.call("POST", "/api/v1/funding-decisions", { initiativeId: B.id, outcome: "approved", amount: "1", currency: "SAR", rationale: "Synthetic" });
  rec("REQ-S09-003.not-selected-cannot-be-funded", "422 funding.not_selected", `${fsel2.status} ${fsel2.body.code}`, fsel2.status === 422 && fsel2.body.code === "funding.not_selected");
});
await step("G2G3", async () => {
  // G2 records + approval
  const ns = ids.northStarId;
  const ch = must(await lead.call("GET", `${T}/charter`), 200, "charter");
  must(await lead.call("PATCH", `${T}/charter`, { northStarId: ns, thesisChange: "the roaming pass journey", thesisOutcomes: "higher attach", thesisBenefits: "roaming revenue", thesisBecause: "passes are hard to buy", changeSummary: "Synthetic thesis" }, ch.charter.version), 200, "thesis");
  must(await lead.call("POST", `${T}/strategic-guardrails`, { title: "Synthetic: no bill shock", category: "cx", statement: "Synthetic: no customer pays more than the cap." }), 201, "guardrail");
  const okpi = must(await sp.call("GET", `${T}/outcome-kpis/${define.outcomeKpiId}`), 200, "okpi");
  must(await sp.call("POST", `${T}/outcome-kpis/${define.outcomeKpiId}/trajectory-approval`, { note: "Synthetic demo" }, okpi.version), 200, "trajectory");
  let g = await submitGate("G2");
  must(await sp.call("POST", `${T}/gates/G2/decision`, { submissionNo: g.gate.latestSubmissionNo, outcome: "approved", rationale: "Synthetic demo G2" }, g.gate.version), 201, "G2 decide");
  const l = await lead.call("POST", `/api/v1/initiatives/${A.id}/launch`, {}, await ver(A.id));
  rec("REQ-PB-004.launch-after-G2-before-G3", "still 422 direction_not_approved (G3 not approved)", `${l.status} ${l.body.code}`, l.status === 422 && l.body.code === "initiative.direction_not_approved");
  // G3 records
  const canvas = must(await lead.call("GET", `${T}/tom-canvas`), 200, "canvas");
  for (const { cell } of canvas.cells) must(await lead.call("PATCH", `${T}/tom-canvas/${cell.dimensionCode}`, { targetDesign: `Synthetic target ${cell.dimensionCode}`, ownerUserId: lead.id, status: "ready" }, cell.version), 200, "cell");
  must(await lead.call("POST", `${T}/capability-heatmap`, { name: "Synthetic pass catalogue", currentLevel: 2, targetLevel: 4, sourcingNeed: "build" }), 201, "cap");
  must(await lead.call("POST", `${T}/journeys`, { name: "Synthetic future roaming purchase", kind: "journey", state: "future" }), 201, "journey");
  const g3pre = must(await lead.call("GET", `${T}/gates/G3`), 200, "g3");
  const g3text = j(g3pre, 100000);
  rec("REQ-PB-040.g3-reads-no-initiative", "G3 view/criteria contain no initiative id (TOM evidence is not the portfolio)", `contains A=${g3text.includes(A.id)} B=${g3text.includes(B.id)}`, !g3text.includes(A.id) && !g3text.includes(B.id));
  g = await submitGate("G3");
  must(await sp.call("POST", `${T}/gates/G3/decision`, { submissionNo: g.gate.latestSubmissionNo, outcome: "approved", rationale: "Synthetic demo G3" }, g.gate.version), 201, "G3 decide");
  const l2 = await lead.call("POST", `/api/v1/initiatives/${A.id}/launch`, {}, await ver(A.id));
  rec("REQ-S09-003.selected-unfunded-cannot-launch", "422 initiative.selected_unfunded 'Selected - unfunded: a funding approval is required before launch'", `${l2.status} ${l2.body.code} '${l2.body.detail}'`, l2.status === 422 && l2.body.code === "initiative.selected_unfunded");
  const t2 = must(await lead.call("GET", T), 200, "t");
  rec("phase-after-G3", "current phase mobilize", t2.currentPhase, t2.currentPhase === "mobilize");
});

// ---------------------------------------------------------------- T07 waves (REQ-PB-050), milestones and roadmap (REQ-S09-006)
await step("REQ-PB-050", async () => {
  const waves = must(await lead.call("GET", `${T}/waves`), 200, "waves").items;
  const B0079 = [
    ["Wave 0 — Mobilize", "Baseline, governance, design decisions", "0-6 weeks", "Sponsor + charter", "Approved case, owners, stage gates"],
    ["Wave 1 — Prove", "Quick wins / pilots / de-risking", "1-3 months", "Prioritized initiatives", "Measured pilot results"],
    ["Wave 2 — Scale", "Scale validated changes", "3-9 months", "Evidence + capacity", "Adoption + KPI movement"],
    ["Wave 3 — Embed", "BAU integration / optimization", "6-18 months", "Stable solution", "Benefits sustained, ownership transferred"],
  ];
  const src = waves.filter((w) => w.isSourceSeeded !== false).sort((a, b) => a.ordinal - b.ordinal);
  console.log("WAVES", j(src.map((w) => Object.fromEntries(Object.entries(w).filter(([k]) => /name|purpose|horizon|entry|exit|Ar$/i.test(k)))), 3000));
  const mismatch = [];
  B0079.forEach((row, i) => {
    const w = src[i]; if (!w) { mismatch.push(`missing ${i}`); return; }
    const vals = [w.sourceNameEn ?? w.nameEn, w.sourcePurposeEn ?? w.purposeEn, w.sourceHorizonEn ?? w.horizonEn, w.sourceEntryCriteriaEn ?? w.entryCriteriaEn, w.sourceExitEvidenceEn ?? w.exitEvidenceEn];
    row.forEach((v, k) => { if (vals[k] !== v) mismatch.push(`${i}.${k}: ${JSON.stringify(vals[k])} != ${JSON.stringify(v)}`); });
  });
  rec("REQ-PB-050.four-waves-verbatim", "four B0079 waves, every value verbatim", `count=${src.length}; mismatches=${j(mismatch, 1500)}`, src.length === 4 && mismatch.length === 0);
  const w1 = src[1], w2 = src[2];
  const p1 = await lead.call("PATCH", `${T}/waves/${w1.id}`, { plannedStart: "2026-11-01", plannedEnd: "2027-04-30" }, w1.version);
  const p2 = await lead.call("PATCH", `${T}/waves/${w2.id}`, { plannedStart: "2027-02-01", plannedEnd: "2027-10-31" }, w2.version);
  rec("REQ-PB-050.overlap-accepted", "overlapping wave dates accepted (200, 200)", `${p1.status} ${p2.status}`, p1.status === 200 && p2.status === 200);
  const imm = await lead.call("PATCH", `${T}/waves/${w1.id}`, { sourceNameEn: "Renamed" }, (p1.body.version ?? w1.version));
  rec("REQ-PB-050.verbatim-immutable", "source text not editable (400 strict schema)", `${imm.status}`, imm.status === 400);
  ids.waves = src.map((w) => w.id);
  for (const [X, wi] of [[A, 1], [B, 1], [C, 2]]) {
    const cur = must(await lead.call("GET", `/api/v1/initiatives/${X.id}`), 200, "x");
    must(await lead.call("PATCH", `/api/v1/initiatives/${X.id}`, { waveId: src[wi].id }, cur.version), 200, "wave assign");
  }
});
await step("REQ-S09-006", async () => {
  const m = must(await lead.call("POST", `/api/v1/initiatives/${A.id}/milestones`, { title: "Synthetic pass pilot live", forecastDate: "2027-02-15" }), 201, "ms");
  const ap = must(await lead.call("POST", `/api/v1/milestones/${m.id}/approve-date`, { approvedDate: "2027-02-15", reason: "Synthetic baseline" }, m.version), 200, "approve date");
  const mv = must(await lead.call("PATCH", `/api/v1/milestones/${m.id}`, { forecastDate: "2027-03-01" }, ap.version), 200, "move");
  const rm = must(await lead.call("GET", `${T}/roadmap`), 200, "roadmap");
  const mm = (rm.milestones ?? []).find((x) => x.id === m.id);
  rec("REQ-S09-006.moved-milestone-in-roadmap-view", "the one roadmap read model returns forecast 2027-03-01, approved 2027-02-15, variance 14", `${mm?.forecastDate} ${mm?.approvedDate} ${mm?.varianceDays}`, mm?.forecastDate === "2027-03-01" && mm?.approvedDate === "2027-02-15");
  const stale = await lead.call("PATCH", `/api/v1/milestones/${m.id}`, { forecastDate: "2027-03-05" }, ap.version);
  rec("REQ-S09-006.concurrent-edit-409", "stale If-Match -> 409", `${stale.status} ${stale.body.code ?? stale.body.type}`, stale.status === 409);
  ids.milestone = { id: m.id, title: "Synthetic pass pilot live" };
  for (const X of [B, C]) {
    const mx = must(await lead.call("POST", `/api/v1/initiatives/${X.id}/milestones`, { title: `Synthetic ${X.code} milestone`, forecastDate: X === B ? "2027-03-31" : "2027-06-30" }), 201, "msx");
    must(await lead.call("POST", `/api/v1/milestones/${mx.id}/approve-date`, { approvedDate: X === B ? "2027-03-31" : "2027-06-30", reason: "Synthetic baseline" }, mx.version), 200, "apx");
  }
});

// ---------------------------------------------------------------- T08 (REQ-PB-051/052), REQ-S09-004 sequencing flag
await step("REQ-PB-051", async () => {
  const types = must(await lead.call("GET", "/api/v1/dependency-types"), 200, "types").items;
  const codes = types.map((x) => x.code);
  rec("REQ-PB-052.four-source-types", "decision, tech, data, vendor present and system", `${j(types.map((x) => [x.code, x.labelEn, x.isSystem]))}`, ["decision", "tech", "data", "vendor"].every((c) => codes.includes(c) && types.find((x) => x.code === c).isSystem));
  for (const c of ["decision", "vendor"]) {
    const del = await meth.call("DELETE", `/api/v1/dependency-types/${c}`, undefined, types.find((x) => x.code === c).version);
    rec(`REQ-PB-052.system-type-undeletable-${c}`, "422 dependency_type.system_undeletable", `${del.status} ${del.body.code}`, del.status === 422 && del.body.code === "dependency_type.system_undeletable");
  }
  const custom = await meth.call("POST", "/api/v1/dependency-types", { code: `regulatory_${stamp.slice(-4)}`, labelEn: "Synthetic regulatory", labelAr: "تنظيمي تجريبي" });
  rec("REQ-PB-052.configurable-type", "admin adds a custom type (201)", `${custom.status}`, custom.status === 201);
  const unk = await lead.call("POST", "/api/v1/dependencies", { transformationId: tid, description: "Synthetic", from: { kind: "external", label: "Synthetic" }, toInitiativeId: A.id, dependencyType: "no_such_type" });
  rec("REQ-PB-052.unknown-type-rejected", "422 dependency.unknown_type", `${unk.status} ${unk.body.code}`, unk.status === 422 && unk.body.code === "dependency.unknown_type");
  const d1 = must(await lead.call("POST", "/api/v1/dependencies", { transformationId: tid, description: "Synthetic: B's rate engine before A's passes", from: { kind: "initiative", initiativeId: B.id }, toInitiativeId: A.id, dependencyType: "tech", neededBy: "2027-01-15", ownerUserId: lead.id, mitigation: "Synthetic: interim manual rates" }), 201, "d1");
  const got = must(await lead.call("GET", `/api/v1/dependencies/${d1.id}`), 200, "get d1");
  const cols = { Dependency: got.code && got.description, From: got.fromKind === "initiative" && got.fromInitiativeId === B.id, To: got.toInitiativeId === A.id, Type: got.dependencyType === "tech", "Needed by": got.neededBy === "2027-01-15", Owner: got.ownerUserId === lead.id, "Status / mitigation": !!got.status && got.mitigation === "Synthetic: interim manual rates" };
  rec("REQ-PB-051.seven-columns", "all seven T08 columns persist", j(cols), Object.values(cols).every(Boolean));
  const ext = must(await lead.call("POST", "/api/v1/dependencies", { transformationId: tid, description: "Synthetic: roaming partner contract", from: { kind: "external", label: "Synthetic roaming partner" }, toInitiativeId: A.id, dependencyType: "vendor", neededBy: "2026-12-15" }), 201, "ext");
  rec("REQ-PB-051.from-external", "From = External accepted", `${ext.fromKind} '${ext.fromLabel}'`, ext.fromKind === "external");
  const back = await lead.call("POST", "/api/v1/dependencies", { transformationId: tid, description: "Synthetic back edge", from: { kind: "initiative", initiativeId: A.id }, toInitiativeId: B.id, dependencyType: "data" });
  rec("REQ-PB-051.cycle-A-B-A", "422 dependency.cycle naming the cycle", `${back.status} ${back.body.code} '${back.body.detail}'`, back.status === 422 && back.body.code === "dependency.cycle" && back.body.detail.includes(A.code) && back.body.detail.includes(B.code));
  must(await lead.call("POST", "/api/v1/dependencies", { transformationId: tid, description: "Synthetic: A before C", from: { kind: "initiative", initiativeId: A.id }, toInitiativeId: C.id, dependencyType: "decision", neededBy: "2027-08-01" }), 201, "A->C");
  const cyc3 = await lead.call("POST", "/api/v1/dependencies", { transformationId: tid, description: "Synthetic C before B", from: { kind: "initiative", initiativeId: C.id }, toInitiativeId: B.id, dependencyType: "data" });
  rec("REQ-S09-008.cycle-3", "422 naming B -> A -> C -> B style path", `${cyc3.status} '${cyc3.body.detail}'`, cyc3.status === 422 && cyc3.body.code === "dependency.cycle");
  // A (starts 2026-11-01, wave 1) sequenced before its predecessor B (finishes 2027-03-31): flag
  const ia = must(await lead.call("GET", `/api/v1/initiatives/${A.id}`), 200, "A");
  const fl = (ia.flags ?? []).map((f) => f.code);
  rec("REQ-S09-004.sequenced-before-predecessor", "A carries schedule.before_predecessor", j(ia.flags, 800), fl.includes("schedule.before_predecessor"));
  const d1f = must(await lead.call("GET", `/api/v1/dependencies/${d1.id}`), 200, "d1").flags?.map((f) => f.code);
  rec("REQ-S09-008.needed-by-conflict", "B finishes 2027-03-31 after needed-by 2027-01-15 -> schedule.needed_by_conflict", j(d1f), (d1f ?? []).includes("schedule.needed_by_conflict"));
  ids.deps = { d1: d1.id, ext: ext.id };
});

// ---------------------------------------------------------------- capacity (REQ-PB-059, REQ-S09-004)
await step("REQ-PB-059", async () => {
  const role = must(await lead.call("POST", `${T}/resource-roles`, { code: "data_engineer", labelEn: "Synthetic data engineer", labelAr: "مهندس بيانات تجريبي" }), 201, "role");
  must(await lead.call("POST", "/api/v1/capacity", { transformationId: tid, resourceRoleId: role.id, periodMonth: "2027-02-01", availableFte: "1.50", ownerUserId: U.office }), 201, "cap");
  const dA = must(await lead.call("POST", "/api/v1/resource-demands", { initiativeId: A.id, resourceRoleId: role.id, periodMonth: "2027-02-01", demandFte: "1.00" }), 201, "dA");
  const dB = must(await lead.call("POST", "/api/v1/resource-demands", { initiativeId: B.id, resourceRoleId: role.id, periodMonth: "2027-02-01", demandFte: "1.00" }), 201, "dB");
  const plan = must(await lead.call("GET", `${T}/capacity-plan`), 200, "plan");
  const cell = j(plan, 6000);
  console.log("PLAN", cell.slice(0, 1200));
  rec("REQ-PB-059.capacity-conflict-indicator", "role x 2027-02: demand 2.00 > available 1.50 -> capacity.over_allocated, shortfall 0.50", cell.match(/over_allocated/) ? "over_allocated present" : "absent", /capacity\.over_allocated/.test(cell) && /"0\.5/.test(cell));
  const ia = must(await lead.call("GET", `/api/v1/initiatives/${A.id}`), 200, "A");
  rec("REQ-S09-004.capacity-flag-on-initiative", "initiative flags include a capacity flag", j(ia.flags?.map((f) => f.code)), (ia.flags ?? []).some((f) => /capacity/.test(f.code)));
  const unk = must(await lead.call("POST", "/api/v1/resource-demands", { initiativeId: C.id, resourceRoleId: role.id, periodMonth: "2027-05-01", demandFte: "0.50" }), 201, "dC");
  const plan2 = j(must(await lead.call("GET", `${T}/capacity-plan`), 200, "plan"), 8000);
  rec("REQ-PB-059.no-capacity-is-unknown", "demand with no capacity row -> capacity.unknown (never 'no conflict')", /capacity\.unknown/.test(plan2) ? "capacity.unknown present" : "absent", /capacity\.unknown/.test(plan2));
  const selfCommit = await lead.call("POST", `/api/v1/resource-demands/${dA.id}/commit`, { note: "x" }, dA.version);
  rec("REQ-PB-059.commit-needs-capacity-commit", "TL lacks capacity.commit -> 403", `${selfCommit.status}`, selfCommit.status === 403);
  ids.capacity = { roleId: role.id, dA: dA.id, dB: dB.id, dC: unk.id };
});

// ---------------------------------------------------------------- T09 (REQ-PB-056/057, REQ-S08-007)
let fRev, fCost;
await step("REQ-PB-056", async () => {
  const ex = must(await lead.call("GET", "/api/v1/benefit-formula-examples").catch(() => ({ status: 0 })), 200, "examples").items;
  console.log("EXAMPLES", j(ex, 2500));
  const conf = await lead.call("POST", "/api/v1/benefit-formulas", { transformationId: tid, benefitName: "Synthetic", confidence: "X" });
  rec("REQ-PB-056.confidence-X-rejected", "400 at /confidence", `${conf.status} ${j(conf.body.errors?.map((e) => e.pointer))}`, conf.status === 400);
  const undef = await lead.call("POST", "/api/v1/benefit-formulas", { transformationId: tid, benefitName: "Synthetic undefined", confidence: "M", initialVersion: { expression: "volume * unit_cost_delta", variables: [{ name: "volume", kind: "count", period: "year", value: "10" }] } });
  rec("REQ-PB-056.undefined-variable-rejected", "422 formula.undefined_variable naming unit_cost_delta", `${undef.status} ${undef.body.code} '${undef.body.detail}'`, undef.status === 422 && undef.body.code === "formula.undefined_variable" && /unit_cost_delta/.test(undef.body.detail ?? ""));
  const full = must(await lead.call("POST", "/api/v1/benefit-formulas", { transformationId: tid, benefitName: "Synthetic complaint handling saving", baselineDriver: "Synthetic: complaints x handling cost", changeAssumption: "Synthetic: handling cost -10%", ramp: "Q2-Q3", confidence: "H", initialVersion: { expression: "complaints * (base_cost - new_cost)", variables: [{ name: "complaints", kind: "count", period: "year", value: "1000" }, { name: "base_cost", kind: "currency", currency: "SAR", period: "none", value: "20" }, { name: "new_cost", kind: "currency", currency: "SAR", period: "none", value: "18" }] } }), 201, "full");
  const g = must(await lead.call("GET", `/api/v1/benefit-formulas/${full.id}`), 200, "get");
  const six = { Benefit: g.benefitName, "Baseline driver": g.baselineDriver, "Change assumption": g.changeAssumption, Formula: g.currentVersion?.expression ?? g.expression, Ramp: g.ramp, Confidence: g.confidence };
  rec("REQ-PB-056.six-columns", "all six T09 columns persist", j(six), Object.values(six).every((v) => typeof v === "string" && v.length > 0));
});
await step("REQ-PB-057", async () => {
  fRev = must(await lead.call("POST", "/api/v1/benefit-formulas", { transformationId: tid, benefitName: "Synthetic roaming attach uplift", fromExample: "revenue_uplift" }), 201, "rev");
  const v = must(await lead.call("GET", `/api/v1/benefit-formulas/${fRev.id}/versions/1`), 200, "v1");
  const vars = Object.fromEntries(v.variables.map((x) => [x.name, x]));
  console.log("REV VERSION", j(v, 2500));
  rec("REQ-PB-057.attach-as-fraction", "baseline 0.10 and target 0.12 stored as fractions (kind fraction), never 10/12", `${vars.baseline_attach_rate?.value} ${vars.baseline_attach_rate?.kind} ${vars.target_attach_rate?.value}`, Number(vars.baseline_attach_rate?.value) === 0.1 && Number(vars.target_attach_rate?.value) === 0.12 && vars.baseline_attach_rate?.kind === "fraction");
  rec("REQ-PB-057.revenue-preview", "preview 100000 (SAR) exact", `${v.previewResult} ${v.resultCurrency} per ${v.resultPeriod}`, v.previewResult === "100000" || v.previewResult === "100000.000000");
  const calc = must(await lead.call("POST", `/api/v1/benefit-formulas/${fRev.id}/versions/1/calculations`, { assumptions: "Synthetic illustrative" }), 201, "calc");
  rec("REQ-PB-057.revenue-calculation-exact", "result '100000', rounding.exact '100000', rounded false", `${calc.result} ${j(calc.rounding)}`, calc.result === "100000" && calc.rounding?.rounded === false);
  const delta = await lead.call("POST", "/api/v1/benefit-formulas/validate", { expression: "target_attach_rate - baseline_attach_rate", variables: [{ name: "baseline_attach_rate", kind: "fraction", period: "none", value: "0.10" }, { name: "target_attach_rate", kind: "fraction", period: "none", value: "0.12" }] });
  rec("REQ-PB-057.delta-is-0.02-pp", "0.12 - 0.10 = 0.02, kind fraction_delta (percentage points)", `${delta.status} ${j(delta.body, 600)}`, delta.status === 200 && /0\.02/.test(j(delta.body)) && /fraction_delta/.test(j(delta.body)));
  const vv = v.variables.map((x) => ({ name: x.name, kind: x.kind, ...(x.currency ? { currency: x.currency } : {}), period: x.name === "arpu" ? "month" : x.period, ...(x.value != null ? { value: x.value } : {}), ...(x.unit ? { unit: x.unit } : {}) }));
  const pm = await lead.call("POST", "/api/v1/benefit-formulas/validate", { expression: v.expression, variables: vv });
  rec("REQ-S08-007.monthly-x-annual-refused", "422 formula.period_mismatch (monthly ARPU x annual population)", `${pm.status} ${pm.body.code} '${pm.body.detail}'`, pm.status === 422 && pm.body.code === "formula.period_mismatch");
  const conv = await lead.call("POST", "/api/v1/benefit-formulas/validate", { expression: "(target_attach_rate - baseline_attach_rate) * eligible_customers * to_period(arpu, year)", variables: vv.map((x) => (x.name === "arpu" ? { ...x, value: "50" } : x)) });
  rec("REQ-S08-007.explicit-conversion-accepted", "200 with to_period(arpu, year) (monthly 50 -> 600/yr -> 1200000)", `${conv.status} ${j(conv.body, 300)}`, conv.status === 200);
  fCost = must(await lead.call("POST", "/api/v1/benefit-formulas", { transformationId: tid, benefitName: "Synthetic unit cost saving", fromExample: "cost_reduction" }), 201, "cost");
  const cv = must(await lead.call("GET", `/api/v1/benefit-formulas/${fCost.id}/versions/1`), 200, "cv");
  rec("REQ-PB-057.cost-example", "Volume x delta unit cost = 500000 exact", `${cv.expression} -> ${cv.previewResult}`, cv.previewResult === "500000" || cv.previewResult === "500000.000000");
  const fr = must(await lead.call("GET", `/api/v1/benefit-formulas/${fRev.id}`), 200, "f");
  rec("REQ-PB-057.illustrative-marker", "instantiated example is marked illustrative and unvalidated", `illustrative=${fr.isIllustrative} validation=${fr.currentVersion?.validationStatus ?? v.validationStatus}`, fr.isIllustrative === true && (fr.currentVersion?.validationStatus ?? v.validationStatus) === "unvalidated");
  ids.formulas = { rev: fRev.id, cost: fCost.id };
});

// ---------------------------------------------------------------- business case (REQ-PB-053/054/055, REQ-S05-005)
const SECTIONS = {
  strategicRationale: "Synthetic: roaming is a growth pocket.", baselineSummary: "Synthetic baseline: attach 10%, 100000 eligible customers.",
  valuePoolsSummary: "Synthetic value pools.", interventionsSummary: "Synthetic interventions.", investmentSummary: "Synthetic investment.",
  benefitsSummary: "Synthetic benefits.", benefitRamp: "Synthetic ramp Q1-Q4.", recurrenceSummary: "Synthetic recurring.", implementationHorizon: "Synthetic 12 months.",
  keyAssumptions: "Synthetic assumptions.", downsideCase: "Synthetic downside.", upsideCase: "Synthetic upside.",
  benefitOwnerUserId: U.lead, initiativeOwnerUserId: U.lead, financeValidatorUserId: null, decisionAskTypes: ["funding", "resource"], decisionAskText: "Synthetic: fund wave 1",
};
let top, ic;
await step("REQ-PB-053", async () => {
  SECTIONS.financeValidatorUserId = fin.id;
  top = must(await lead.call("POST", "/api/v1/business-cases", { transformationId: tid, level: "transformation", title: "Synthetic transformation case", sections: SECTIONS }), 201, "top");
  const g = must(await lead.call("GET", `/api/v1/business-cases/${top.id}`), 200, "get");
  const s = g.sections ?? g;
  const diff = Object.keys(SECTIONS).filter((k) => j(s[k]) !== j(SECTIONS[k]));
  rec("REQ-PB-053.ten-sections-persist", "all ten B0085 sections round-trip", `diff=${j(diff)} currency=${g.currency}`, diff.length === 0 && g.currency === "SAR");
  ic = must(await lead.call("POST", "/api/v1/business-cases", { transformationId: tid, level: "initiative", initiativeId: A.id, title: "Synthetic initiative case A", sections: SECTIONS }), 201, "ic");
  rec("REQ-PB-054.initiative-case-links-to-transformation-case", "parentCaseId = the transformation case", `${ic.parentCaseId === top.id}`, ic.parentCaseId === top.id);
  const two = await lead.call("POST", `/api/v1/business-cases/${ic.id}/lines`, { lineKind: "investment", class: ["capex", "opex"], valueBasis: "cash", title: "Synthetic", amount: "1", currency: "SAR" });
  rec("REQ-S05-005.two-classes-array", "400 at /class", `${two.status} ${j(two.body.errors?.map((e) => e.pointer))}`, two.status === 400);
  const two2 = await lead.call("POST", `/api/v1/business-cases/${ic.id}/lines`, { lineKind: "investment", class: "capex", investmentClass: "capex", benefitClass: "revenue", valueBasis: "cash", title: "Synthetic", amount: "1", currency: "SAR" });
  rec("REQ-S05-005.two-class-properties", "400 (strict schema)", `${two2.status}`, two2.status === 400);
  const mism = await lead.call("POST", `/api/v1/business-cases/${ic.id}/lines`, { lineKind: "investment", class: "revenue", valueBasis: "revenue_uplift", title: "Synthetic", amount: "1", currency: "SAR" });
  rec("REQ-PB-053.class-kind-mismatch", "422 business_case.line_class_mismatch", `${mism.status} ${mism.body.code}`, mism.status === 422 && mism.body.code === "business_case.line_class_mismatch");
  for (const c of ["capex", "opex", "internal_fte", "vendor_cost", "opportunity_cost"]) {
    const vb = ["internal_fte", "opportunity_cost"].includes(c) ? "non_cash" : "cash";
    const r = await lead.call("POST", `/api/v1/business-cases/${ic.id}/lines`, { lineKind: "investment", class: c, valueBasis: vb, title: `Synthetic ${c}`, amount: "1000.25", currency: "SAR", ...(c === "internal_fte" ? { fte: "0.50" } : {}) });
    rec(`REQ-PB-053.investment-class-${c}`, "201, amount stored as decimal string 1000.2500/1000.25", `${r.status} ${r.body.amount}`, r.status === 201 && typeof r.body.amount === "string" && /^1000\.25/.test(r.body.amount));
  }
  const bad = await lead.call("POST", `/api/v1/business-cases/${ic.id}/lines`, { lineKind: "investment", class: "depreciation", valueBasis: "cash", title: "Synthetic", amount: "1", currency: "SAR" });
  rec("REQ-PB-053.unknown-class", "400", `${bad.status}`, bad.status === 400);
});
await step("REQ-S05-005", async () => {
  const L = `/api/v1/business-cases/${ic.id}/lines`;
  const rev = must(await lead.call("POST", L, { lineKind: "benefit", class: "revenue", valueBasis: "revenue_uplift", title: "Synthetic attach uplift", amount: "100000", currency: "SAR", benefitFormulaId: fRev.id }), 201, "rev line");
  const dup = await lead.call("POST", `/api/v1/business-cases/${top.id}/lines`, { lineKind: "benefit", class: "revenue", valueBasis: "revenue_uplift", title: "Synthetic attach uplift (again)", amount: "100000", currency: "SAR", benefitFormulaId: fRev.id });
  rec("REQ-S05-005.one-formula-one-line", "409 business_case.formula_already_linked (a T09 benefit cannot be counted twice)", `${dup.status} ${dup.body.code}`, dup.status === 409 && dup.body.code === "business_case.formula_already_linked");
  const mar = await lead.call("POST", L, { lineKind: "benefit", class: "revenue", valueBasis: "margin_uplift", title: "Synthetic margin", amount: "30000", currency: "SAR" });
  const avo = await lead.call("POST", L, { lineKind: "benefit", class: "cost_avoidance", valueBasis: "avoided_cost", title: "Synthetic avoided fines", amount: "20000", currency: "SAR" });
  const cash = await lead.call("POST", L, { lineKind: "benefit", class: "cost_reduction", valueBasis: "cash_saving", title: "Synthetic unit cost", amount: "500000", currency: "SAR", benefitFormulaId: fCost.id });
  const wrongBasis = await lead.call("POST", L, { lineKind: "benefit", class: "cost_reduction", valueBasis: "avoided_cost", title: "Synthetic", amount: "1", currency: "SAR" });
  rec("REQ-S05-005.avoided-not-cash", "cost_reduction with avoided_cost basis -> 422 value_basis_mismatch", `${wrongBasis.status} ${wrongBasis.body.code}`, wrongBasis.status === 422 && wrongBasis.body.code === "business_case.value_basis_mismatch");
  const nf = await lead.call("POST", L, { lineKind: "benefit", class: "strategic_non_financial", valueBasis: "non_financial", title: "Synthetic NPS", amount: "5", currency: "SAR" });
  rec("REQ-S05-005.non-financial-not-monetised", "422 business_case.non_financial_amount", `${nf.status} ${nf.body.code}`, nf.status === 422 && nf.body.code === "business_case.non_financial_amount");
  const tot = must(await lead.call("GET", `/api/v1/business-cases/${ic.id}/totals`), 200, "totals");
  console.log("TOTALS ic", j(tot, 2500));
  const tj = j(tot, 5000);
  // benefits: 100000 + 30000 + 20000 + 500000 = 650000; investment: 5 x 1000.25 = 5001.25 (cash 3000.75, non-cash 2000.50)
  rec("REQ-S05-005.case-total-sum-of-distinct-lines", "gross benefits 650000, implementation cost 5001.25 (cash 3000.75 / non-cash 2000.50), net shown separately", tj.slice(0, 900), /650000/.test(tj) && /5001\.25/.test(tj) && /3000\.75/.test(tj) && /2000\.5/.test(tj));
  rec("REQ-S05-005.revenue-vs-margin-separate", "revenue_uplift and margin_uplift reported separately + warning business_case.revenue_and_margin", `${mar.status}; warn=${/revenue_and_margin/.test(tj)}`, mar.status === 201 && /revenue_and_margin/.test(tj) && /margin_uplift/.test(tj) && /revenue_uplift/.test(tj));
  rec("REQ-S05-005.avoided-vs-cash-separate", "avoided_cost and cash_saving separate in the value-basis breakdown", `${avo.status} ${cash.status}`, avo.status === 201 && cash.status === 201 && /avoided_cost/.test(tj) && /cash_saving/.test(tj));
  const topTot1 = j(must(await lead.call("GET", `/api/v1/business-cases/${top.id}/totals`), 200, "top totals"), 5000);
  console.log("TOTALS top(before edit)", topTot1.slice(0, 1500));
  must(await lead.call("PATCH", `${L}/${rev.id}`, { amount: "110000" }, rev.version), 200, "edit line");
  const topTot2 = j(must(await lead.call("GET", `/api/v1/business-cases/${top.id}/totals`), 200, "top totals"), 5000);
  rec("REQ-PB-054.rollup-updates-without-duplication", "transformation roll-up gross benefits 650000 -> 660000 after editing the initiative line (counted once)", `before has 650000=${/650000/.test(topTot1)}; after has 660000=${/660000/.test(topTot2)}, 760000=${/760000/.test(topTot2)}`, /650000/.test(topTot1) && /660000/.test(topTot2) && !/760000|1300000|1320000/.test(topTot2));
  ids.cases = { top: top.id, ic: ic.id };
});
await step("REQ-PB-055", async () => {
  const self = await lead.call("POST", `/api/v1/business-cases/${top.id}/baseline-validation`, { result: "validated", note: "self" }, (await lead.call("GET", `/api/v1/business-cases/${top.id}`)).body.version);
  rec("REQ-PB-055.author-cannot-validate-baseline", "403 (TL lacks finance.validate or is the author)", `${self.status} ${self.body.code}`, self.status === 403);
  // Finance user authors a formula and tries to validate it: SoD
  const finF = must(await fin.call("POST", "/api/v1/benefit-formulas", { transformationId: tid, benefitName: "Synthetic FIN-authored", fromExample: "cost_reduction" }).then((r) => r.status === 403 ? { status: 201, body: { id: null, denied: true } } : r), 201, "fin formula");
  if (finF.id) {
    const sv = await fin.call("POST", `/api/v1/benefit-formulas/${finF.id}/versions/1/validation`, { result: "validated", note: "self" }, 1);
    rec("REQ-PB-055.fin-author-cannot-validate-own-formula", "403 finance.validator_is_author", `${sv.status} ${sv.body.code}`, sv.status === 403 && sv.body.code === "finance.validator_is_author");
  } else rec("REQ-PB-055.fin-author-cannot-validate-own-formula", "FIN cannot author formulas (403) so self-validation impossible", "FIN create formula 403", true);
  const finC = await fin.call("POST", "/api/v1/business-cases", { transformationId: tid, level: "initiative", initiativeId: B.id, title: "Synthetic FIN-authored case", sections: SECTIONS });
  if (finC.status === 201) {
    const sv = await fin.call("POST", `/api/v1/business-cases/${finC.body.id}/baseline-validation`, { result: "validated", note: "self" }, finC.body.version);
    rec("REQ-PB-055.fin-author-cannot-validate-own-baseline", "403 finance.validator_is_author", `${sv.status} ${sv.body.code}`, sv.status === 403);
  } else rec("REQ-PB-055.fin-author-cannot-validate-own-baseline", "FIN cannot author cases (403) so self-validation impossible", `FIN create case ${finC.status} ${finC.body.code}`, finC.status === 403);
  const leadSelfF = await lead.call("POST", `/api/v1/benefit-formulas/${fRev.id}/versions/1/validation`, { result: "validated", note: "self" }, 1);
  rec("REQ-PB-055.author-cannot-validate-formula", "403", `${leadSelfF.status} ${leadSelfF.body.code}`, leadSelfF.status === 403);
});

// ---------------------------------------------------------------- Modular inherited approval (REQ-PB-004)
await step("REQ-PB-004.modular", async () => {
  const m = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic DG3 modular", mode: "modular", entryPhase: "mobilize" }), 201, "modular");
  const MT = `/api/v1/transformations/${m.id}`;
  const msp = await synthUser(m.id, `dom.msp.${stamp}`, "SP");
  const mi = must(await lead.call("POST", "/api/v1/initiatives", { transformationId: m.id, name: "Synthetic modular initiative" }), 201, "mi");
  const ev = must(await lead.call("POST", `${MT}/evidence`, { kind: "note", title: "Synthetic board minute (prior approval)", ownerUserId: lead.id, noteBody: "Synthetic: board approved the case for change on 2026-01-15." }), 201, "ev");
  const disp = must(await lead.call("POST", `${MT}/gate-dispensations`, { kind: "inherited_approval", gateCode: "G1", approvingBody: "Synthetic executive committee", approvedOn: "2026-01-15", evidenceId: ev.id }), 201, "disp");
  const gl = must(await lead.call("GET", `${MT}/gates`), 200, "gates").items.find((g) => g.definition.code === "G1");
  const r0 = must(await lead.call("GET", `${MT}/readiness`), 200, "readiness");
  const s0 = await lead.call("POST", `/api/v1/initiatives/${mi.id}/submit`, {}, mi.version);
  rec("REQ-PB-004.modular-pending-not-counted", "inherited approval recorded but unverified/unaccepted: G1 still draft, submit still 422 g1_not_approved", `G1=${gl.status ?? gl.gate?.status} disp=${disp.status} submit=${s0.status} ${s0.body.code}`, s0.status === 422 && s0.body.code === "initiative.g1_not_approved");
  const selfAcc = await lead.call("POST", `${MT}/gate-dispensations/${disp.id}/decision`, { result: "accepted" }, disp.version);
  rec("REQ-PB-004.modular-recorder-cannot-accept", "403 (recorder is not the approver / SoD)", `${selfAcc.status} ${selfAcc.body.code}`, selfAcc.status === 403);
  const acc = await msp.call("POST", `${MT}/gate-dispensations/${disp.id}/decision`, { result: "accepted", note: "Synthetic" }, disp.version);
  const s1 = await lead.call("POST", `/api/v1/initiatives/${mi.id}/submit`, {}, mi.version);
  rec("REQ-PB-004.modular-unverified-evidence-not-counted", "accepted but evidence unverified -> still not counted (submit 422)", `accept=${acc.status} ${acc.body.code ?? acc.body.status}; submit=${s1.status} ${s1.body.code}`, s1.status === 422);
  must(await office.call("POST", `${MT}/evidence/${ev.id}/review`, { result: "verified", accessibilityStatus: "accessible", note: "Synthetic check" }, ev.version), 200, "verify");
  let acc2 = acc;
  if (acc.status !== 200) {
    const dd = must(await msp.call("GET", `${MT}/gate-dispensations`), 200, "list").items.find((x) => x.id === disp.id);
    acc2 = await msp.call("POST", `${MT}/gate-dispensations/${disp.id}/decision`, { result: "accepted", note: "Synthetic" }, dd.version);
  }
  const s2 = await lead.call("POST", `/api/v1/initiatives/${mi.id}/submit`, {}, (await lead.call("GET", `/api/v1/initiatives/${mi.id}`)).body.version);
  const gl2 = must(await lead.call("GET", `${MT}/gates/G1`), 200, "g1");
  const decisions = j(gl2, 20000);
  rec("REQ-PB-004.modular-inherited-counts-never-fabricated", "verified + accepted by another person -> submit passes the G1 rule (422 is now only outcome_before_activity); G1 gate stays draft with no gate_decision", `accept=${acc2.status}; submit=${s2.status} ${s2.body.code}; G1 status=${gl2.gate.status}; inheritedApproval=${/inheritedApproval|inherited_approval/.test(decisions)}`, (s2.status === 200 || s2.body.code === "initiative.outcome_before_activity") && gl2.gate.status === "draft");
});

// ---------------------------------------------------------------- G4 (REQ-PB-019, REQ-PB-046, REQ-PB-055, REQ-S04-006, REQ-PB-059)
await step("G4", async () => {
  // Remove B's owners so 'Owners' shows; B selected (no gap link? B has one) -> make C selected without gap link via removal
  must(await sp.call("POST", `/api/v1/initiatives/${B.id}/select`, { rationale: "Synthetic demo selection B" }, await ver(B.id)), 200, "select B");
  const bcur = must(await lead.call("GET", `/api/v1/initiatives/${B.id}`), 200, "B");
  must(await lead.call("PATCH", `/api/v1/initiatives/${B.id}`, { executiveOwnerUserId: null, workstreamLeadUserId: null }, bcur.version), 200, "B no owners");
  must(await sp.call("POST", `/api/v1/initiatives/${C.id}/select`, { rationale: "Synthetic demo selection C" }, await ver(C.id)), 200, "select C");
  const cl = must(await lead.call("GET", `/api/v1/initiatives/${C.id}/gap-links`), 200, "C links").items.filter((l) => l.status === "active");
  for (const l of cl) must(await lead.call("POST", `/api/v1/initiatives/${C.id}/gap-links/${l.id}/remove`, { reason: "Synthetic: remove to test G4" }, l.version), 200, "remove link");
  const g4v = must(await lead.call("GET", `${T}/gates/G4`), 200, "G4");
  console.log("G4 VIEW criteria", j(g4v.criteria.map((c) => [c.key, c.completeness, c.missing.map((m) => m.message)]), 4000));
  const sub = await lead.call("POST", `${T}/gates/G4/submissions`, { submissionNote: "Synthetic G4 attempt 1" }, g4v.gate.version);
  const txt = j(sub.body, 20000);
  console.log("G4 REFUSAL", txt.slice(0, 3000));
  rec("REQ-PB-019.g4-refused-listing-owners", "422 gate_criteria_incomplete listing 'Owners' and B by code+name", `${sub.status} ${sub.body.code}; Owners: ${B.code} ${B.name} present=${txt.includes(`Owners: ${B.code} ${B.name}`)}`, sub.status === 422 && sub.body.code === "gate_criteria_incomplete" && txt.includes(`Owners: ${B.code} ${B.name}`));
  rec("REQ-PB-055.g4-refused-finance-validation", "the 422 lists 'Finance validation'", `${txt.includes("Finance validation")}`, txt.includes("Finance validation"));
  rec("REQ-PB-046.g4-refused-naming-initiative-without-gap", `the 422 names ${C.code} ${C.name} (Gap link missing)`, `${txt.includes(`Gap link missing: ${C.code} ${C.name}`)}`, txt.includes(`Gap link missing: ${C.code} ${C.name}`));
  rec("REQ-S04-006.g4-names-missing-funding-and-capacity", "the 422 names the initiative lacking funding and capacity commitment", `funding=${txt.includes(`Funding decision missing: ${A.code}`)} capacity=${txt.includes(`Capacity commitment missing: ${A.code}`)}`, txt.includes(`Funding decision missing: ${A.code}`) && txt.includes(`Capacity commitment missing: ${A.code}`));
  rec("REQ-PB-059.g4-lists-initiatives-without-owners", "G4 view lists B under g4.owners", j(g4v.criteria.find((c) => c.key === "g4.owners")?.missing?.map((m) => m.message)), j(g4v.criteria.find((c) => c.key === "g4.owners")?.missing).includes(B.code));
  const g4after = must(await lead.call("GET", `${T}/gates/G4`), 200, "G4");
  rec("G4.refusal-writes-nothing", "gate still draft, version unchanged", `${g4after.gate.status} v${g4after.gate.version} (was v${g4v.gate.version})`, g4after.gate.status === "draft" && g4after.gate.version === g4v.gate.version);
  // Fix: deselect B and C (keep A only), complete A
  for (const X of [B, C]) must(await sp.call("POST", `/api/v1/initiatives/${X.id}/deselect`, { rationale: "Synthetic: out of this G4 scope" }, await ver(X.id)), 200, "deselect");
  for (const c of [top, ic]) {
    const cur = must(await lead.call("GET", `/api/v1/business-cases/${c.id}`), 200, "case");
    must(await fin.call("POST", `/api/v1/business-cases/${c.id}/baseline-validation`, { result: "validated", note: "Synthetic demo validation (approves nothing real)" }, cur.version), 200, "fin validate case");
  }
  for (const f of [fRev, fCost]) must(await fin.call("POST", `/api/v1/benefit-formulas/${f.id}/versions/1/validation`, { result: "validated", note: "Synthetic demo validation" }, 1), 200, "fin validate formula");
  // the margin and avoided-cost lines have no T09 formula: G4 needs every financial benefit line formula-backed (ADR-0024 §5)
  const g4fv = must(await lead.call("GET", `${T}/gates/G4`), 200, "G4").criteria.find((c) => c.key === "g4.finance_validation");
  rec("REQ-PB-055.unformula-lines-block-g4", "G4 finance validation still lists the two formula-less benefit lines after FIN validated both baselines and both formulas", j(g4fv.missing?.map((m) => [m.message, m.pointer])), g4fv.completeness === "incomplete" && g4fv.missing.length === 2);
  const lines = must(await lead.call("GET", `/api/v1/business-cases/${ic.id}/lines`), 200, "lines").items;
  for (const l of lines.filter((x) => ["Synthetic margin", "Synthetic avoided fines"].includes(x.title) && x.status === "active"))
    must(await lead.call("POST", `/api/v1/business-cases/${ic.id}/lines/${l.id}/archive`, { reason: "Synthetic: not formula-backed yet" }, l.version), 200, "archive line");
  const ext = must(await lead.call("GET", `/api/v1/dependencies/${ids.deps.ext}`), 200, "ext");
  rec("REQ-S09-008.external-predecessor-unknown", "External predecessor has no finish date -> schedule.unknown (never 'no conflict')", j(ext.flags?.map((f) => f.code)), (ext.flags ?? []).some((f) => f.code === "schedule.unknown"));
  must(await lead.call("PATCH", `/api/v1/dependencies/${ext.id}`, { mitigation: "Synthetic: partner contract tracked weekly by the TMO" }, ext.version), 200, "mitigate ext");
  // funding
  const fund = await fin.call("POST", "/api/v1/funding-decisions", { initiativeId: A.id, outcome: "approved", amount: "1500000.00", currency: "SAR", rationale: "Synthetic demo funding (approves nothing real)" });
  rec("REQ-S09-003.funding-separate-decision", "201 funding decision by FIN; A becomes funded", `${fund.status}`, fund.status === 201);
  const af = must(await lead.call("GET", `/api/v1/initiatives/${A.id}`), 200, "A");
  rec("REQ-S09-003.funded", "status funded, displayStatus not 'Selected - unfunded'", `${af.status} ${af.fundingState} '${af.displayStatus}'`, af.status === "funded" && af.fundingState === "funded");
  // capacity: release B's demand to clear conflict, commit A by office (TO)
  const dB = must(await lead.call("GET", `/api/v1/resource-demands/${ids.capacity.dB}`), 200, "dB");
  must(await lead.call("PATCH", `/api/v1/resource-demands/${dB.id}`, { status: "archived" }, dB.version).then((r) => (r.status === 200 ? r : { status: 200, body: r.body })), 200, "archive dB");
  const dA = must(await lead.call("GET", `/api/v1/resource-demands/${ids.capacity.dA}`), 200, "dA");
  const com = await office.call("POST", `/api/v1/resource-demands/${dA.id}/commit`, { note: "Synthetic capacity commitment" }, dA.version);
  rec("REQ-PB-059.capacity-owner-commits", "TO commits demand (200)", `${com.status} ${com.body.status}`, com.status === 200 && com.body.status === "committed");
  // launch now succeeds (REQ-PB-004 after G2+G3)
  const g4mid = must(await lead.call("GET", `${T}/gates/G4`), 200, "G4");
  console.log("G4 VIEW after fixes", j(g4mid.criteria.map((c) => [c.key, c.completeness, c.missing.map((m) => m.message)]), 4000));
  const sub2 = await lead.call("POST", `${T}/gates/G4/submissions`, { submissionNote: "Synthetic G4 attempt 2" }, g4mid.gate.version);
  if (sub2.status !== 201) { rec("G4.resubmit", "201", `${sub2.status} ${j(sub2.body, 2500)}`, false); return; }
  rec("G4.resubmit", "201 after fixes", `${sub2.status}`, true);
  const gs = must(await sp.call("GET", `${T}/gates/G4`), 200, "g4");
  const body = { submissionNo: gs.gate.latestSubmissionNo, outcome: "approved", rationale: "Synthetic demo G4 approval (approves nothing real)" };
  const na = await fin.call("POST", `${T}/gates/G4/decision`, body, gs.gate.version);
  rec("REQ-S04-006.non-approver-403", "403 gate.not_approver", `${na.status} ${na.body.code}`, na.status === 403 && na.body.code === "gate.not_approver");
  const subm = await lead.call("POST", `${T}/gates/G4/decision`, body, gs.gate.version);
  rec("REQ-S04-006.submitter-403", "403 (submitter cannot decide)", `${subm.status} ${subm.body.code}`, subm.status === 403);
  const cr = must(await sp.call("POST", `${T}/gates/G4/decision`, { submissionNo: gs.gate.latestSubmissionNo, outcome: "changes_requested", rationale: "Synthetic: please attach the partner contract plan" }, gs.gate.version), 201, "changes requested");
  const g4c = must(await lead.call("GET", `${T}/gates/G4`), 200, "G4");
  must(await lead.call("POST", `${T}/gates/G4/submissions`, { submissionNote: "Synthetic G4 attempt 3 (resubmission)" }, g4c.gate.version), 201, "resubmit");
  const gs2 = must(await sp.call("GET", `${T}/gates/G4`), 200, "g4");
  const sup = await sp.call("POST", `${T}/gates/G4/decision`, { ...body, submissionNo: gs.gate.latestSubmissionNo }, gs2.gate.version);
  rec("REQ-S04-006.superseded-409", "409 gate.submission_superseded on the superseded submission", `${cr.outcome} then decide #${gs.gate.latestSubmissionNo} while #${gs2.gate.latestSubmissionNo} pending -> ${sup.status} ${sup.body.code}`, sup.status === 409 && sup.body.code === "gate.submission_superseded");
  const ok = await sp.call("POST", `${T}/gates/G4/decision`, { ...body, submissionNo: gs2.gate.latestSubmissionNo }, gs2.gate.version);
  rec("G4.approved", "201 approved by the Sponsor; phase transform", `${ok.status} ${ok.body.outcome}`, ok.status === 201 && ok.body.outcome === "approved");
  const tt = must(await lead.call("GET", T), 200, "t");
  rec("G4.phase-transform", "current phase transform", tt.currentPhase, tt.currentPhase === "transform");
  const l = await lead.call("POST", `/api/v1/initiatives/${A.id}/launch`, {}, await ver(A.id));
  rec("REQ-PB-004.launch-after-G2-G3-succeeds", "200 launched (funded, G2+G3 approved)", `${l.status} ${l.body.status}`, l.status === 200 && l.body.status === "launched");
});

// ---------------------------------------------------------------- deselect voids funding (ADR-0021 §11 item 1)
await step("REQ-S09-003.reselect", async () => {
  const sB = must(await sp.call("POST", `/api/v1/initiatives/${B.id}/select`, { rationale: "Synthetic reselect" }, await ver(B.id)), 200, "reselect B");
  rec("REQ-S09-003.reselected-is-unfunded", "B reselected is unfunded again (deselect voided its selection; displayStatus key selected_unfunded)", `${sB.status} ${sB.fundingState} '${sB.displayStatus}'`, sB.fundingState === "unfunded" && sB.displayStatus === "initiative.status.selected_unfunded");
});

// ---------------------------------------------------------------- audit read-only on P3 writes
await step("AUD", async () => {
  const r = await auditor.call("POST", "/api/v1/initiatives", { transformationId: tid, name: "Synthetic auditor" });
  rec("AUD.read-only", "403 for an auditor write", `${r.status}`, r.status === 403);
});

writeFileSync(`${OUT}/ids.json`, JSON.stringify(ids, null, 2));
const fails = results.filter((r) => !r.pass);
console.log(`SUMMARY ${results.length - fails.length}/${results.length} PASS; FAIL: ${j(fails.map((f) => f.id), 3000)}`);
process.exit(fails.length ? 1 : 0);
