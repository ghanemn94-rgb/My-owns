// domain-reviewer live scenario (DG2 round 2, T-DG2-REV-DOM-R2B). SYNTHETIC data only, disposable stack.
// Product gates G1/G2 here are demo business decisions on synthetic data; they approve nothing real and never touch DG0-DG7.
import { randomUUID } from "node:crypto";
const BASE = process.env.E2E_BASE_URL;
const U = { admin: "01920000-0000-7000-9000-000000000201", office: "01920000-0000-7000-9000-000000000202", lead: "01920000-0000-7000-9000-000000000203" };
const BU_RETAIL = "01920000-0000-7000-9000-000000000102";
const results = [];
const rec = (id, expected, actual, pass) => { results.push({ id, expected, actual, result: pass ? "PASS" : "FAIL" }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };

async function session(username) {
  let cookie = "";
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  if (r.status !== 204) throw new Error(`login ${username} ${r.status} ${await r.text()}`);
  cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
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
  return { call, me };
}
const must = (r, s, what) => { if (r.status !== s) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 800)}`); return r.body; };

const lead = await session("dev.lead");
const admin = await session("dev.admin");
const office = await session("dev.office");

// REQ-PB-012 governance roles (B0018)
const B0018 = {
  SP: "Owns enterprise outcome, removes constraints, approves major trade-offs.",
  TL: "Integrates workstreams, drives cadence, ensures outcome realization.",
  BO: "Own target-state capabilities and BAU adoption.",
  WL: "Deliver initiatives and manage dependencies.",
  FIN: "Validates baseline, benefit logic, value realization.",
  TO: "Governance, reporting, risks, dependencies, decisions, standards.",
};
const ra = must(await lead.call("GET", "/api/v1/role-accountabilities"), 200, "role-accountabilities");
const raItems = ra.items ?? ra;
const raText = JSON.stringify(raItems);
const missing = Object.entries(B0018).filter(([, t]) => !raText.includes(t)).map(([k]) => k);
rec("REQ-PB-012.b0018-text", "the six B0018 governance roles present with verbatim accountability", `catalogue count=${raItems.length}; missing=${JSON.stringify(missing)}`, missing.length === 0);

// REQ-PB-003 modes
const bad1 = await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic modular no entry", mode: "modular" });
rec("REQ-PB-003.modular-needs-entry-phase", "400 validation (ADR-0007)", `${bad1.status} ${JSON.stringify(bad1.body.errors ?? bad1.body.code)}`, bad1.status === 400);
const bad2 = await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic bad mode", mode: "hybrid" });
rec("REQ-PB-003.only-two-modes", "400 for mode 'hybrid'", `${bad2.status}`, bad2.status === 400);
const mod = await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic modular at design", mode: "modular", entryPhase: "design" });
rec("REQ-PB-003.modular-with-entry", "201", `${mod.status} mode=${mod.body.mode} entryPhase=${mod.body.entryPhase}`, mod.status === 201 && mod.body.entryPhase === "design");
const t = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic domain review E2E", mode: "end_to_end" }), 201, "create e2e");
const tid = t.id; const T = `/api/v1/transformations/${tid}`;
rec("REQ-PB-003.e2e-created", "201 end_to_end, phase diagnose", `mode=${t.mode} phase=${t.currentPhase ?? t.phase}`, t.mode === "end_to_end");

// Gates list (REQ-PB-016/017/018, B0023)
const gl = must(await lead.call("GET", `${T}/gates`), 200, "gates");
const gnames = gl.items.map((g) => `${g.definition.code}|${g.definition.sourceNameEn}|${g.definition.nameAr}|${g.definition.decisionQuestionEn ?? ""}`);
console.log("GATES", JSON.stringify(gnames));
const b0023 = { G1: "G1 - Case for Change", G2: "G2 - Direction", G3: "G3 - Target State", G4: "G4 - Mobilization", G5: "G5 - Scale", G6: "G6 - Sustain" };
rec("REQ-PB-017.api-gate-names-b0023", "API sourceNameEn equals B0023 gate column", JSON.stringify(gl.items.map((g) => g.definition.sourceNameEn)), gl.items.every((g) => b0023[g.definition.code] === g.definition.sourceNameEn));

// Sequential advance: G2/G3 before G1
for (const code of ["G2", "G3"]) {
  const gv = must(await lead.call("GET", `${T}/gates/${code}`), 200, "gate");
  const s = await lead.call("POST", `${T}/gates/${code}/submissions`, { submissionNote: "Synthetic early" }, gv.gate.version);
  rec(`REQ-PB-016.${code}-before-G1-refused`, "422 gate.out_of_sequence", `${s.status} ${JSON.stringify(s.body.code ?? s.body.errors?.map((e) => e.code))}`, s.status === 422);
}

// Charter WITHOUT out of scope (observation 1)
const ch = must(await lead.call("POST", `${T}/charter`, { transformationName: "Synthetic domain review", executiveSponsorUserId: U.office, transformationLeadUserId: U.lead, caseForChange: "Synthetic: billing errors drive churn.", inScope: "Synthetic: retail billing.", baselineDate: "2026-01-31" }), 201, "charter");
let cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
const exNull = cv.scopeCheckPrechecks.find((p) => p.code === "exclusions_documented");
console.log("PRECHECKS(no out of scope)", JSON.stringify(cv.scopeCheckPrechecks));
rec("REQ-PB-031.empty-out-of-scope-fails", "exclusions_documented check fails (attention/fail) on a saved charter with empty Out of scope", `${exNull.result}: ${exNull.detail}`, exNull.result === "attention");
const emptyStr = await lead.call("PATCH", `${T}/charter`, { outOfScope: "", changeSummary: "Synthetic empty" }, cv.charter.version);
rec("REQ-PB-031.empty-string-out-of-scope", "rejected (400)", `${emptyStr.status}`, emptyStr.status === 400);
const ws = await lead.call("PATCH", `${T}/charter`, { outOfScope: "   ", changeSummary: "Synthetic whitespace exclusions" }, cv.charter.version);
cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
const exWs = cv.scopeCheckPrechecks.find((p) => p.code === "exclusions_documented");
rec("REQ-PB-031.whitespace-out-of-scope", "whitespace-only Out of scope is not 'documented' (no pass)", `PATCH ${ws.status}; stored=${JSON.stringify(cv.charter.outOfScope)}; precheck=${exWs.result}`, !(ws.status === 200 && exWs.result === "pass"));
const yes = await lead.call("PATCH", `${T}/charter`, { scExclusionsDocumented: "yes", changeSummary: "Synthetic answer yes" }, cv.charter.version);
cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
console.log(`human answer 'yes' with blank exclusions: PATCH ${yes.status}; answer=${cv.charter.scExclusionsDocumented}`);
const fix = must(await lead.call("PATCH", `${T}/charter`, { outOfScope: "Synthetic: wholesale billing.", scExclusionsDocumented: "yes", changeSummary: "Synthetic exclusions" }, cv.charter.version), 200, "fix oos");
cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
rec("REQ-PB-031.out-of-scope-present-passes", "pass", cv.scopeCheckPrechecks.find((p) => p.code === "exclusions_documented").result, cv.scopeCheckPrechecks.find((p) => p.code === "exclusions_documented").result === "pass");
rec("REQ-PB-031.five-checks", "5 pre-check entries in source order", JSON.stringify(cv.scopeCheckPrechecks.map((p) => p.code)), cv.scopeCheckPrechecks.length === 5);
const vers = must(await lead.call("GET", `${T}/charter/versions`), 200, "versions");
rec("REQ-PB-029.versions-retained", ">=3 versions", `${vers.items.length}`, vers.items.length >= 3);
rec("REQ-PB-035.top-outcome-warning", "charter.top_outcomes_count warning with 0 top outcomes", JSON.stringify(cv.warnings.map((w) => w.code)), cv.warnings.some((w) => w.code === "charter.top_outcomes_count"));
rec("REQ-PB-030.thesis-incomplete", "thesis incomplete warning", JSON.stringify(cv.warnings.map((w) => w.code)), cv.warnings.some((w) => w.code === "charter.thesis_incomplete"));
const badDate = await lead.call("PATCH", `${T}/charter`, { baselineDate: "2026-02-30", changeSummary: "x" }, cv.charter.version);
rec("REQ-PB-029.baseline-date-valid", "400 for 2026-02-30", `${badDate.status}`, badDate.status === 400);

// T01 seeded dimensions + confidence
const t01 = must(await lead.call("GET", `${T}/diagnostic-items?limit=50`), 200, "t01");
rec("REQ-PB-026.six-dimensions", "6 seeded rows (Financial..Data)", JSON.stringify(t01.items.map((i) => i.dimension ?? i.dimensionCode)), t01.items.filter((i) => i.isSeeded).length === 6);
const badConf = await lead.call("PATCH", `${T}/diagnostic-items/${t01.items[0].id}`, { confidence: "X" }, t01.items[0].version);
rec("REQ-PB-026.confidence-hml", "400 for confidence X", `${badConf.status}`, badConf.status === 400);

// methodology: 10 TOM dims + 6 workstreams
const meth = must(await lead.call("GET", `${T}/methodology`), 200, "methodology");
const dims = meth.tomDimensions ?? []; const wsl = meth.diagnosticWorkstreams ?? meth.workstreams ?? [];
rec("REQ-PB-038.ten-dimensions", "10 dimensions with B0056 design questions", `${dims.length}; first=${JSON.stringify(dims[0])?.slice(0, 200)}`, dims.length === 10);
rec("REQ-PB-023.six-workstreams", "6 workstreams", `${wsl.length}: ${JSON.stringify(wsl.map((w) => w.nameEn ?? w.code))}`, wsl.length === 6);
console.log("METHODOLOGY_KEYS", Object.keys(meth));
const B0056 = ["What experience/value should customers receive?","What portfolio, pricing, features and service model are required?","What end-to-end journeys/processes must change?","What structure, roles and accountabilities are needed?","Who decides what, at what level, using what forums?","What skills, capacity, behaviors and incentives are required?","What platforms, systems and integration are required?","What data, metrics, models and ownership are needed?","What should be built, bought, outsourced or partnered?","How will KPIs, benefits and continuous improvement be managed?"];
const dq = [...dims].sort((a,b)=>a.ordinal-b.ordinal).map((d)=>d.sourceDesignQuestionEn);
rec("REQ-PB-038.b0056-verbatim", "design questions equal B0056 in order", JSON.stringify(dq.map((q,i)=>q===B0056[i])), dq.every((q,i)=>q===B0056[i]));
const B0029Q = ["Where is value created/lost? Revenue, margin, cost, churn, productivity?","Where does the customer experience break?","Where are delays, rework, bottlenecks, handoffs?","Are roles, decision rights, incentives and accountability clear?","What systems/data constrain performance?","What skills/capabilities are missing?"];
const wq = [...wsl].sort((a,b)=>a.ordinal-b.ordinal).map((w)=>w.sourceKeyQuestionsEn);
rec("REQ-PB-023.b0029-verbatim", "key questions equal B0029 in order", JSON.stringify(wq), wq.every((q,i)=>q===B0029Q[i]));
const B0062 = ["Segments / needs / promise / experience principles","Portfolio / bundles / pricing / service model","Critical E2E journeys / automation / controls","Structure / role clarity / accountability","Decision rights / forums / escalation","Skills / capacity / incentives / behaviors","Platforms / architecture / integration","Sources / ownership / insight / AI / measurement","Partner model / vendors / build-buy-partner","KPIs / benefits / management cadence / CI"];
const cp = [...dims].sort((a,b)=>a.ordinal-b.ordinal).map((d)=>d.sourceCanvasPromptEn);
rec("REQ-PB-041.b0062-prompts", "canvas prompts equal B0062", JSON.stringify(cp.map((q,i)=>q===B0062[i])), cp.every((q,i)=>q===B0062[i]));
const sc = meth.charterScopeChecks.map((c)=>c.sourceQuestionEn ?? c.questionEn ?? c.labelEn);
const B0039_43 = ["Is scope tied to outcomes rather than departments?","Can each major scope item be traced to a diagnosed problem or opportunity?","Are explicit exclusions documented?","Is the baseline measurable?","Are executive decisions required to unblock the transformation visible?"];
rec("REQ-PB-031.b0039-43-verbatim", "five questions verbatim", JSON.stringify(sc), sc.every((q,i)=>q===B0039_43[i]));
const gd = meth.gateDefinitions.map((g)=>[g.code, g.sourceDecisionQuestionEn ?? g.decisionQuestionEn, g.sourceEvidenceRequiredEn ?? g.evidenceRequiredEn]);
console.log("GATEDEFS", JSON.stringify(gd));
console.log("SCOPECHECKDEF_KEYS", JSON.stringify(Object.keys(meth.charterScopeChecks[0])));
console.log("DIMS", JSON.stringify(dims.map((d) => [d.ordinal, d.sourceNameEn, d.sourceDesignQuestionEn, d.sourceCanvasBoxEn, d.sourceCanvasPromptEn])));
console.log("WORKSTREAMS", JSON.stringify(wsl.map((w) => [w.sourceNameEn, w.sourceKeyQuestionsEn, w.sourceTypicalOutputsEn])));

// G1 readiness via API (synthetic)
const bl = must(await lead.call("POST", `${T}/baselines`, { metric: "Synthetic billing error rate", unit: "%", scope: "operational", value: "4.25", source: "Synthetic extract", baselineDate: "2026-01-31" }), 201, "baseline");
must(await lead.call("POST", `${T}/value-pools`, { name: "Synthetic rework cost", quantificationStatus: "unquantified", unquantifiedReason: "Synthetic: sizing pending.", materiality: "material" }), 201, "vp");
must(await lead.call("POST", `${T}/diagnostic-findings`, { workstreamCode: "business_financial", kind: "root_cause", statement: "Synthetic: manual order entry.", status: "confirmed" }), 201, "finding");
const ev = must(await lead.call("POST", `${T}/evidence`, { kind: "note", title: "Synthetic notes", noteBody: "Synthetic interview notes.", ownerUserId: U.lead }), 201, "evidence");
must(await office.call("POST", `${T}/evidence/${ev.id}/review`, { result: "verified", accessibilityStatus: "accessible", note: "Synthetic accepted." }, ev.version), 200, "review");
for (const it of t01.items.filter((i) => i.isSeeded)) {
  const cur = must(await lead.call("GET", `${T}/diagnostic-items/${it.id}`), 200, "t01 get");
  must(await lead.call("PATCH", `${T}/diagnostic-items/${it.id}`, { currentState: "Synthetic.", rootCause: "Synthetic.", impactText: "Synthetic.", confidence: "M" }, cur.version), 200, "t01 patch");
  must(await lead.call("POST", `${T}/evidence-links`, { evidenceId: ev.id, recordType: "diagnostic_item", recordId: it.id }), 201, "link");
}
must(await lead.call("POST", `${T}/evidence-links`, { evidenceId: ev.id, recordType: "baseline", recordId: bl.id }), 201, "link bl");
const vpList = must(await lead.call("GET", `${T}/value-pools`), 200, "vps");
rec("INV.unquantified-label", "value pool unquantified, amount null (not 0)", JSON.stringify(vpList.items.map((v) => [v.quantificationStatus, v.amount ?? v.valueAmount ?? null])), vpList.items.every((v) => v.quantificationStatus === "unquantified" && !(v.amount === "0" || v.amount === 0)));
const g1 = must(await lead.call("GET", `${T}/gates/G1`), 200, "g1");
console.log("G1 criteria", JSON.stringify(g1.criteria?.map((c) => [c.key, c.completeness])));
rec("REQ-S04-003.g1-six-outputs", "G1 lists six required outputs", `${g1.criteria?.length}`, g1.criteria?.length === 6);
must(await admin.call("POST", "/api/v1/role-assignments", { userId: U.office, roleCode: "SP", scope: { type: "transformation", id: tid }, reason: "Synthetic demo approver (domain review)" }), 201, "grant SP");
const s1 = must(await lead.call("POST", `${T}/gates/G1/submissions`, { submissionNote: "Synthetic G1" }, g1.gate.version), 201, "submit G1");
const selfDecide = await lead.call("POST", `${T}/gates/G1/decision`, { submissionNo: s1.submissionNo ?? 1, outcome: "approved", rationale: "Synthetic self approval" });
rec("REQ-S04-003.submitter-cannot-decide", "403", `${selfDecide.status}`, selfDecide.status === 403);
const d1 = await office.call("POST", `${T}/gates/G1/decision`, { submissionNo: s1.submissionNo ?? 1, outcome: "approved", rationale: "Synthetic demo approval (no real business approval)." });
const afterG1 = must(await lead.call("GET", T), 200, "t");
rec("LIVE.G1-decision", "201/200 approved; phase advances diagnose->define", `${d1.status}; phase=${afterG1.currentPhase ?? afterG1.phase}`, (d1.status === 201 || d1.status === 200) && (afterG1.currentPhase ?? afterG1.phase) === "define");

// G3 before G2 still refused
const g3 = must(await lead.call("GET", `${T}/gates/G3`), 200, "g3");
const s3 = await lead.call("POST", `${T}/gates/G3/submissions`, { submissionNote: "Synthetic early G3" }, g3.gate.version);
rec("REQ-PB-018.G3-before-G2-refused", "422", `${s3.status} ${JSON.stringify(s3.body.code)}`, s3.status === 422);

// Define: North Star (REQ-PB-033)
const ns1r = await lead.call("PUT", `${T}/north-star`, { statement: "Every synthetic bill is right first time" });
console.log("ns1", ns1r.status, JSON.stringify(ns1r.body).slice(0,300));
const ns1 = ns1r.body;
const twoSent = await lead.call("PUT", `${T}/north-star`, { statement: "Bills are right. Customers are happy." }, ns1.version);
rec("REQ-PB-033.one-sentence", "400/422 for two sentences", `${twoSent.status} ${JSON.stringify(twoSent.body.errors ?? twoSent.body.code)}`, twoSent.status === 400 || twoSent.status === 422);
const ns2 = await lead.call("PUT", `${T}/north-star`, { statement: "Every synthetic bill is right first time, every month" }, ns1.version);
const nsh = must(await lead.call("GET", `${T}/north-star/history`), 200, "ns history");
const currents = nsh.items.filter((n) => n.status === "current");
rec("REQ-PB-033.exactly-one-current", "exactly 1 current after refine; older superseded", `POST2=${ns2.status}; statuses=${JSON.stringify(nsh.items.map((n) => n.status))}`, currents.length === 1);

// Outcomes and good outcome test (REQ-PB-036)
const launch = must(await lead.call("POST", `${T}/outcomes`, { statement: "Launch new app" }), 201, "launch");
rec("REQ-PB-036.launch-fails", "goodOutcomePass=false with reasons", `${launch.goodOutcomePass} ${JSON.stringify(launch.goodOutcomeTest.map((c) => [c.criterionCode, c.result]))}`, launch.goodOutcomePass === false && launch.goodOutcomeTest.some((c) => c.result === "fail"));
const good = must(await lead.call("POST", `${T}/outcomes`, { statement: "Synthetic bills are right the first time", ownerUserId: U.lead, isTopOutcome: true, topRank: 1, specificConfirmed: true, strategicallyRelevantConfirmed: true, causalChain: "Synthetic: validated orders -> fewer errors -> lower cost" }), 201, "good");
const kd = must(await lead.call("POST", `${T}/kpi-definitions`, { name: "Synthetic billing error rate", unitKind: "percentage", unitLabel: "%", polarity: "lower_is_better", ownerUserId: U.lead }), 201, "kpi");
const act = await lead.call("POST", `${T}/kpi-definitions/${kd.id}/activate`, undefined, kd.version);
console.log("activate", act.status, JSON.stringify(act.body).slice(0, 200));
const noDate = await lead.call("POST", `${T}/outcome-kpis`, { outcomeId: good.id, kpiDefinitionId: kd.id, targetValue: "1.5" });
rec("REQ-PB-034.target-date-required", "400/422 without targetDate", `${noDate.status}`, noDate.status === 400 || noDate.status === 422);
const ok2 = must(await lead.call("POST", `${T}/outcome-kpis`, { outcomeId: good.id, kpiDefinitionId: kd.id, targetValue: "1.5", targetDate: "2027-06-30", baselineId: bl.id, ownerUserId: U.lead, leadingIndicatorText: "Synthetic first-pass order validation" }), 201, "t02");
let g2 = must(await lead.call("GET", `${T}/gates/G2`), 200, "g2");
console.log("G2 criteria", JSON.stringify(g2.criteria.map((c) => [c.key, c.completeness, c.missing?.map((m) => m.code)])));
const failingListed = JSON.stringify(g2.criteria).includes(`/outcomes/${launch.id}`);
rec("REQ-PB-036.g2-lists-failing", "G2 readiness lists 'Launch new app' as failing", `${failingListed}`, failingListed);
const zeroG = await lead.call("POST", `${T}/gates/G2/submissions`, { submissionNote: "Synthetic G2 zero guardrails" }, g2.gate.version);
rec("REQ-PB-037.zero-guardrails-blocks", "422 naming g2.guardrails", `${zeroG.status} ${JSON.stringify(zeroG.body.errors?.map((e) => e.pointer))}`, zeroG.status === 422 && JSON.stringify(zeroG.body).includes("g2.guardrails"));
must(await lead.call("POST", `${T}/outcomes/${launch.id}/archive`, { reason: "Synthetic: reworded" }, launch.version), 200, "archive launch");
const gr = must(await lead.call("POST", `${T}/strategic-guardrails`, { title: "Synthetic: no tariff rise", category: "cx", statement: "Synthetic: must not raise retail tariffs." }), 201, "guardrail");
rec("REQ-PB-037.guardrail-category", "persisted with category", `${gr.category}`, gr.category === "cx");
const ok2now = must(await lead.call("GET", `${T}/outcome-kpis/${ok2.id}`), 200, "t02 get");
const ta = await office.call("POST", `${T}/outcome-kpis/${ok2.id}/trajectory-approval`, { note: "Synthetic demo approval" }, ok2now.version);
console.log("trajectory", ta.status, JSON.stringify(ta.body).slice(0, 200));
cv = must(await lead.call("GET", `${T}/charter`), 200, "charter");
must(await lead.call("PATCH", `${T}/charter`, { northStarId: (await lead.call("GET", `${T}/north-star`)).body.id, thesisChange: "the order-to-bill journey", thesisOutcomes: "first-time-right bills", thesisBenefits: "a lower cost to serve", thesisBecause: "rework drives cost", changeSummary: "Synthetic thesis" }, cv.charter.version), 200, "thesis");
cv = must(await lead.call("GET", `${T}/charter`), 200, "charter");
rec("REQ-PB-033.charter-shows-current", "charter northStar = current statement", `${cv.northStar?.statement} / ${cv.northStar?.status}`, cv.northStar?.status === "current" && cv.northStar?.statement.endsWith("every month"));
g2 = must(await lead.call("GET", `${T}/gates/G2`), 200, "g2");
console.log("G2 criteria(after)", JSON.stringify(g2.criteria.map((c) => [c.key, c.completeness, c.missing?.map((m) => m.code)])));
const s2 = await lead.call("POST", `${T}/gates/G2/submissions`, { submissionNote: "Synthetic G2" }, g2.gate.version);
console.log("submit G2", s2.status, JSON.stringify(s2.body).slice(0, 400));
let phase2 = "?";
if (s2.status === 201) {
  const d2 = await office.call("POST", `${T}/gates/G2/decision`, { submissionNo: s2.body.submissionNo ?? 1, outcome: "approved", rationale: "Synthetic demo approval (no real business approval)." });
  const tt = must(await lead.call("GET", T), 200, "t"); phase2 = tt.currentPhase ?? tt.phase;
  rec("LIVE.G2-decision", "approved; phase define->design", `${d2.status}; phase=${phase2}`, (d2.status === 201 || d2.status === 200) && phase2 === "design");
} else rec("LIVE.G2-decision", "G2 submitted and approved", `submit ${s2.status}`, false);

// TOM canvas + per-dimension (REQ-PB-041 / REQ-S05-003)
const canvas = must(await lead.call("GET", `${T}/tom-canvas`), 200, "canvas");
const boxes = canvas.items ?? canvas.boxes ?? canvas;
rec("REQ-PB-041.ten-boxes", "10 canvas boxes", `${Array.isArray(boxes) ? boxes.length : JSON.stringify(Object.keys(canvas))}`, Array.isArray(boxes) && boxes.length === 10);
const firstDim = dims[0]?.code;
const dv = await lead.call("GET", `${T}/tom/dimensions/${firstDim}`);
const dv2 = dv.status === 404 ? await lead.call("GET", `/api/v1/methodology/tom-dimensions/${firstDim}?transformationId=${tid}`) : dv;
console.log("DIMVIEW", dv.status, dv2.status, JSON.stringify(Object.keys(dv2.body ?? {})));

// DG gates untouched invariant: no transformation/product endpoint mentions DG
rec("INV.product-gates-only", "gate codes G1..G6 only", JSON.stringify(gl.items.map((g) => g.definition.code)), gl.items.map((g) => g.definition.code).join() === "G1,G2,G3,G4,G5,G6");
console.log("SUMMARY", JSON.stringify({ pass: results.filter((r) => r.result === "PASS").length, fail: results.filter((r) => r.result === "FAIL").map((r) => r.id) }));
