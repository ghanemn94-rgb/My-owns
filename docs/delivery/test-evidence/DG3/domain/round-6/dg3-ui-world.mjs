// domain-reviewer DG3 round 1: API setup of two more SYNTHETIC worlds for the UI probe (same disposable stack):
//  W2 "Synthetic DG3 UI world": End-to-End, G1-G3 approved by a synthetic Sponsor (demo decisions, approve nothing
//     real), initiative X scored 5,4,3,2,1 under weight set v1 and ranked, then selected with NO owners (so G4 refuses
//     naming 'Owners' and 'Finance validation'); initiative Y submitted with four of five scores (incomplete);
//  F  "Synthetic DG3 fresh": a fresh End-to-End transformation (readiness lists the five B0012 areas).
// Writes $OUT/world.json. Never touches DG0-DG7.
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
const BASE = process.env.E2E_BASE_URL; const OUT = process.env.OUT ?? `${process.env.TMPDIR}/shots`; mkdirSync(OUT, { recursive: true });
const DEV_ISSUER = "urn:mth:dev-local"; const BU_RETAIL = "01920000-0000-7000-9000-000000000102";
const j = (x, n = 1500) => JSON.stringify(x)?.slice(0, n);
async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  if (r.status !== 204) throw new Error(`login ${username} ${r.status}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  const call = async (method, path, body, ifMatch) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken };
    if (body !== undefined) h["content-type"] = "application/json";
    if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`;
    if (method === "POST" && ifMatch === undefined) h["idempotency-key"] = randomUUID();
    const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  return { call, me, id: me.user.id };
}
const must = (r, s, what) => { if (!(Array.isArray(s) ? s : [s]).includes(r.status)) throw new Error(`${what}: ${r.status} ${j(r.body)}`); return r.body; };
const lead = await session("dev.lead"); const admin = await session("dev.admin"); const office = await session("dev.office");
const orgId = admin.me.organization.id; const stamp = Date.now().toString(36);
async function synthUser(tid, username, roleCode) {
  const u = must(await admin.call("POST", "/api/v1/users", { organizationId: orgId, displayName: `Synthetic ${roleCode}`, preferredLocale: "en", identity: { issuer: DEV_ISSUER, subject: username } }), 201, "user");
  must(await admin.call("POST", "/api/v1/role-assignments", { userId: u.id, roleCode, scope: { type: "transformation", id: tid }, reason: "Synthetic demo role (approves nothing real)" }), 201, "grant");
  return { ...(await session(username)), username };
}
const F = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic DG3 fresh", mode: "end_to_end" }), 201, "F");
must(await lead.call("POST", "/api/v1/initiatives", { transformationId: F.id, name: "Synthetic draft before G1" }), 201, "F ini");

const t = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic DG3 UI world", mode: "end_to_end" }), 201, "t");
const T = `/api/v1/transformations/${t.id}`;
const sp = await synthUser(t.id, `dw.sp.${stamp}`, "SP");
const baseline = must(await lead.call("POST", `${T}/baselines`, { metric: "Synthetic attach", unit: "%", scope: "revenue", value: "10", source: "Synthetic", baselineDate: "2026-09-01" }), 201, "baseline");
const note = must(await lead.call("POST", `${T}/evidence`, { kind: "note", title: "Synthetic paper", ownerUserId: lead.id, noteBody: "Synthetic" }), 201, "ev");
must(await lead.call("POST", `${T}/evidence-links`, { evidenceId: note.id, recordType: "baseline", recordId: baseline.id }), 201, "evl");
must(await office.call("POST", `${T}/evidence/${note.id}/review`, { result: "verified", accessibilityStatus: "accessible", note: "Synthetic" }, note.version), 200, "rev");
for (const it of must(await lead.call("GET", `${T}/diagnostic-items?limit=100`), 200, "items").items)
  must(await lead.call("PATCH", `${T}/diagnostic-items/${it.id}`, { currentState: "Synthetic", rootCause: "Synthetic", impactText: "Synthetic", confidence: "M", baselineId: baseline.id }, it.version), 200, "item");
const meth = must(await lead.call("GET", `${T}/methodology`), 200, "meth");
must(await lead.call("POST", `${T}/diagnostic-findings`, { workstreamCode: meth.diagnosticWorkstreams[0].code, kind: "root_cause", statement: "Synthetic finding", status: "confirmed" }), 201, "finding");
must(await lead.call("POST", `${T}/value-pools`, { name: "Synthetic pool", quantificationStatus: "unquantified", unquantifiedReason: "Synthetic", materiality: "material" }), 201, "vp");
must(await lead.call("POST", `${T}/charter`, { transformationName: "Synthetic UI world", caseForChange: "Synthetic", outOfScope: "Synthetic", inScope: "Synthetic", executiveSponsorUserId: sp.id, transformationLeadUserId: lead.id, baselineDate: "2026-09-01" }), 201, "charter");
async function gate(code, extra = {}) {
  const v = must(await lead.call("GET", `${T}/gates/${code}`), 200, "g");
  must(await lead.call("POST", `${T}/gates/${code}/submissions`, { submissionNote: `Synthetic ${code}` }, v.gate.version), 201, `submit ${code}`);
  const g = must(await sp.call("GET", `${T}/gates/${code}`), 200, "g");
  must(await sp.call("POST", `${T}/gates/${code}/decision`, { submissionNo: g.gate.latestSubmissionNo, outcome: "approved", rationale: `Synthetic demo ${code} approval (approves nothing real)`, ...extra }, g.gate.version), 201, `decide ${code}`);
}
await gate("G1", { agreements: { problem: true, baseline: true, materialValuePools: true } });
const outcome = must(await lead.call("POST", `${T}/outcomes`, { statement: "Synthetic outcome", ownerUserId: lead.id, isTopOutcome: true, topRank: 1, specificConfirmed: true, strategicallyRelevantConfirmed: true, causalChain: "Synthetic" }), 201, "o");
const kpi = must(await lead.call("POST", `${T}/kpi-definitions`, { name: "Synthetic KPI", unitKind: "percentage", polarity: "higher_is_better", ownerUserId: lead.id }), 201, "k");
must(await lead.call("POST", `${T}/kpi-definitions/${kpi.id}/activate`, {}, kpi.version), 200, "ka");
const okpi = must(await lead.call("POST", `${T}/outcome-kpis`, { outcomeId: outcome.id, kpiDefinitionId: kpi.id, targetDate: "2027-12-31", targetValue: "12", ownerUserId: lead.id }), 201, "okpi");
const ns = must(await lead.call("PUT", `${T}/north-star`, { statement: "Synthetic North Star" }), [200, 201], "ns");
const ch = must(await lead.call("GET", `${T}/charter`), 200, "ch");
must(await lead.call("PATCH", `${T}/charter`, { northStarId: ns.id, thesisChange: "x journey", thesisOutcomes: "y", thesisBenefits: "z", thesisBecause: "w", changeSummary: "Synthetic" }, ch.charter.version), 200, "thesis");
must(await lead.call("POST", `${T}/strategic-guardrails`, { title: "Synthetic guardrail", category: "cx", statement: "Synthetic" }), 201, "gr");
const ok1 = must(await sp.call("GET", `${T}/outcome-kpis/${okpi.id}`), 200, "okpi");
must(await sp.call("POST", `${T}/outcome-kpis/${okpi.id}/trajectory-approval`, { note: "Synthetic" }, ok1.version), 200, "traj");
await gate("G2");
const canvas = must(await lead.call("GET", `${T}/tom-canvas`), 200, "canvas");
for (const { cell } of canvas.cells) must(await lead.call("PATCH", `${T}/tom-canvas/${cell.dimensionCode}`, { targetDesign: "Synthetic", ownerUserId: lead.id, status: "ready" }, cell.version), 200, "cell");
const gap = must(await lead.call("POST", `${T}/tom-gaps`, { dimensionCode: canvas.cells[0].cell.dimensionCode, gap: "Synthetic gap", ownerUserId: lead.id }), 201, "gap");
must(await lead.call("POST", `${T}/capability-heatmap`, { name: "Synthetic capability", currentLevel: 2, targetLevel: 4, sourcingNeed: "build" }), 201, "cap");
must(await lead.call("POST", `${T}/journeys`, { name: "Synthetic journey", kind: "journey", state: "future" }), 201, "jr");
await gate("G3");
const mk = async (name) => {
  const i = must(await lead.call("POST", "/api/v1/initiatives", { transformationId: t.id, name, objective: "Synthetic objective", scopeIn: "Synthetic scope" }), 201, "ini");
  must(await lead.call("POST", `/api/v1/initiatives/${i.id}/outcome-contributions`, { outcomeId: outcome.id, outcomeKpiId: okpi.id, contributionStatement: "Synthetic" }), 201, "contrib");
  must(await lead.call("POST", `/api/v1/initiatives/${i.id}/gap-links`, { targetType: "tom_gap", targetId: gap.id }), 201, "gap link");
  const v = must(await lead.call("GET", `/api/v1/initiatives/${i.id}`), 200, "v");
  must(await lead.call("POST", `/api/v1/initiatives/${i.id}/submit`, {}, v.version), 200, "submit");
  return i;
};
const X = await mk("Synthetic scorecard 5-4-3-2-1");
const Y = await mk("Synthetic scorecard with a missing score");
for (const [k, s] of Object.entries({ strategic_fit: 5, financial_value: 4, customer_impact: 3, feasibility: 2, time_to_value: 1 })) must(await lead.call("POST", `/api/v1/initiatives/${X.id}/scores`, { criterionCode: k, score: s }), 201, "sx");
for (const [k, s] of Object.entries({ strategic_fit: 4, financial_value: 4, customer_impact: 4, feasibility: 4 })) must(await lead.call("POST", `/api/v1/initiatives/${Y.id}/scores`, { criterionCode: k, score: s }), 201, "sy");
must(await lead.call("POST", `${T}/prioritization/rankings`, { note: "Synthetic ranking" }), 201, "rank");
const xv = must(await lead.call("GET", `/api/v1/initiatives/${X.id}`), 200, "x");
must(await sp.call("POST", `/api/v1/initiatives/${X.id}/select`, { rationale: "Synthetic demo selection" }, xv.version), 200, "select X");
const world = { F: F.id, W2: t.id, sp2: sp.username, X: { id: X.id, code: X.code, name: X.name }, Y: { id: Y.id, code: Y.code, name: Y.name } };
writeFileSync(`${OUT}/world.json`, JSON.stringify(world, null, 2));
console.log("WORLD", j(world));
console.log("SETUP-OK");
