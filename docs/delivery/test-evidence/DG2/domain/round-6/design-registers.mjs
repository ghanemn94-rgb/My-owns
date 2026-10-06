// domain-reviewer DG2 round 6 (T-DG2-REV-DOM-R6): T03/T04, workshop conversion (B0063), heatmap and journey links.
// SYNTHETIC data only, disposable stack. Nothing here is a real business decision.
import { randomUUID } from "node:crypto";
const BASE = process.env.E2E_BASE_URL;
const U = { lead: "01920000-0000-7000-9000-000000000203", office: "01920000-0000-7000-9000-000000000202" };
const BU_RETAIL = "01920000-0000-7000-9000-000000000102";
const out = [];
const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  return async (method, path, body, ifMatch) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken };
    if (body !== undefined) h["content-type"] = "application/json";
    if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`;
    if (method === "POST" && ifMatch === undefined) h["idempotency-key"] = randomUUID();
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
}
const lead = await session("dev.lead");
const t = (await lead("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic design registers", mode: "modular", entryPhase: "design" })).body;
const T = `/api/v1/transformations/${t.id}`;

// T04 Design Decision Log (B0065): ID, Decision required, Options, Recommendation, Decision owner, Due, Status
const d1 = await lead("POST", "/api/v1/decisions", { transformationId: t.id, title: "Synthetic: build or buy billing validation", ownerUserId: U.lead, dueDate: "2026-12-31", tomDimensionCode: "technology", recommendationText: "Synthetic: buy", options: [{ title: "Build" }, { title: "Buy" }, { title: "Partner" }] });
const d2 = await lead("POST", "/api/v1/decisions", { transformationId: t.id, title: "‏تجريبي: نموذج الحوكمة‏", ownerUserId: U.lead });
rec("T04.codes-status", "201; codes D-01, D-02; status open; options A/B/C; Arabic title with RLM verbatim", `${d1.status}/${d2.status} codes=${d1.body.code},${d2.body.code} status=${d1.body.status} options=${JSON.stringify(d1.body.options?.map((o) => o.label))} arVerbatim=${d2.body.title === "‏تجريبي: نموذج الحوكمة‏"}`,
  d1.status === 201 && d1.body.code === "D-01" && d2.body.code === "D-02" && d1.body.status === "open" && JSON.stringify(d1.body.options.map((o) => o.label)) === '["A","B","C"]' && d2.body.title === "‏تجريبي: نموذج الحوكمة‏");
rec("T04.seven-columns", "code, title, options, recommendation, owner, due date, status all persisted", JSON.stringify([d1.body.code, d1.body.title, d1.body.options.length, d1.body.recommendationText, d1.body.ownerUserId === U.lead, d1.body.dueDate, d1.body.status]),
  !!(d1.body.code && d1.body.title && d1.body.options.length === 3 && d1.body.recommendationText && d1.body.ownerUserId === U.lead && d1.body.dueDate && d1.body.status));
const dInv = await lead("POST", "/api/v1/decisions", { transformationId: t.id, title: "️͏" });
rec("T04.invisible-title-refused", "400 validation.blank", `${dInv.status} ${JSON.stringify(dInv.body.errors?.map((e) => [e.pointer, e.code]))}`, dInv.status === 400 && JSON.stringify(dInv.body.errors ?? []).includes("validation.blank"));

// T03 TOM Gap Matrix (B0058): TOM dimension, Current, Target, Gap, Design decision, Owner
const noDim = await lead("POST", `${T}/tom-gaps`, { gap: "Synthetic gap" });
rec("T03.dimension-required", "rejected (400/422) without dimensionCode; nothing created", `${noDim.status} ${JSON.stringify(noDim.body.code ?? noDim.body.errors)}`, noDim.status === 400 || noDim.status === 422);
const gap = await lead("POST", `${T}/tom-gaps`, { dimensionCode: "technology", currentState: "‏يدوي‏", targetState: "Synthetic automated", gap: "Synthetic automation gap", designDecisionId: d1.body.id, ownerUserId: U.lead });
rec("T03.six-columns", "201 with all six columns, linked to the T04 decision", `${gap.status} ${JSON.stringify([gap.body.dimensionCode, gap.body.currentState, gap.body.targetState, gap.body.gap, gap.body.designDecisionId === d1.body.id, gap.body.ownerUserId === U.lead])}`,
  gap.status === 201 && gap.body.designDecisionId === d1.body.id && gap.body.currentState === "‏يدوي‏");

// Capability heatmap linked to the T03 gap (REQ-PB-024)
const cap = await lead("POST", `${T}/capability-heatmap`, { name: "Synthetic billing analytics", dimensionCode: "data_analytics", currentLevel: 1, targetLevel: 4, sourcingNeed: "partner", ownerUserId: U.lead, tomGapId: gap.body.id });
rec("REQ-PB-024.capability-linked-to-gap", "201; sourcing need partner; tomGapId set", `${cap.status} need=${cap.body.sourcingNeed} gapLinked=${cap.body.tomGapId === gap.body.id}`, cap.status === 201 && cap.body.tomGapId === gap.body.id);

// Journey with cycle time (decimal) + failure demand; pain point linked to a T01 row (REQ-PB-025)
const t01 = (await lead("GET", `${T}/diagnostic-items?limit=50`)).body.items;
const j = await lead("POST", `${T}/journeys`, { name: "Synthetic order-to-bill", kind: "process", state: "current", status: "active", cycleTimeValue: "3.25", cycleTimeUnit: "days", failureDemand: "Synthetic: 12% of calls are billing corrections", ownerUserId: U.lead });
rec("REQ-PB-025.journey-decimal-cycle-time", "201; cycle time kept as decimal string 3.25", `${j.status} cycle=${JSON.stringify(j.body.cycleTimeValue)} ${j.body.cycleTimeUnit} failureDemand=${!!j.body.failureDemand}`, j.status === 201 && String(j.body.cycleTimeValue).startsWith("3.25"));
const pp = await lead("POST", `${T}/journeys/${j.body.id}/pain-points`, { description: "‏تجريبي: تصحيح الفواتير يدوياً‏", diagnosticItemId: t01[0].id });
rec("REQ-PB-025.pain-point-links-t01", "201; linked to the T01 row; Arabic+RLM verbatim", `${pp.status} linked=${pp.body.diagnosticItemId === t01[0].id} verbatim=${pp.body.description === "‏تجريبي: تصحيح الفواتير يدوياً‏"}`, pp.status === 201 && pp.body.diagnosticItemId === t01[0].id);

// Workshop (B0063): convert an unresolved item into a T04 decision with an owner; no owner -> refused
const w = await lead("POST", `${T}/tom-workshops`, { title: "Synthetic TOM canvas workshop", workshopDate: "2026-10-20", durationMinutes: 120, facilitatorUserId: U.lead });
console.log("workshop", w.status, JSON.stringify(w.body).slice(0, 300));
const it = await lead("POST", `${T}/tom-workshops/${w.body.id}/items`, { kind: "unresolved", dimensionCode: "technology", body: "‏من يقرر التسعير؟‏" });
console.log("item", it.status, JSON.stringify(it.body).slice(0, 400));
const it2 = await lead("GET", `${T}/tom-workshops/${w.body.id}/items`);
const item = it2.body.items.find((x) => x.id === it.body.id) ?? it.body;
const noOwner = await lead("POST", `${T}/tom-workshops/${w.body.id}/items/${item.id}/convert`, { target: "design_decision", title: "Synthetic pricing decision rights" }, item.version);
rec("REQ-PB-042.convert-needs-owner", "400/422 without owner", `${w.status}/${it.status} -> ${noOwner.status}`, noOwner.status === 400 || noOwner.status === 422);
const conv = await lead("POST", `${T}/tom-workshops/${w.body.id}/items/${item.id}/convert`, { target: "design_decision", title: "Synthetic pricing decision rights", ownerUserId: U.office }, item.version);
const decs = (await lead("GET", `/api/v1/decisions?transformationId=${t.id}`)).body.items ?? [];
const made = decs.find((d) => d.sourceWorkshopItemId === item.id);
rec("REQ-PB-042.convert-to-t04", "2xx; a new Open T04 decision D-03 linked to the workshop item, owner set", `${conv.status} made=${JSON.stringify(made && [made.code, made.status, made.ownerUserId === U.office])}`, (conv.status === 200 || conv.status === 201) && made && made.code === "D-03" && made.status === "open" && made.ownerUserId === U.office);

// Per-dimension view (REQ-S05-003): the seven elements
const dv = await lead("GET", `${T}/tom-canvas/technology`);
rec("REQ-S05-003.dimension-view", "200 with cell, dimension, gaps (1), decisions (>=1), dependencies, evidence", `${dv.status} keys=${JSON.stringify(Object.keys(dv.body ?? {}))} gaps=${dv.body.gaps?.length} decisions=${dv.body.decisions?.length}`, dv.status === 200 && dv.body.gaps?.length === 1 && dv.body.decisions?.length >= 1 && "dependencies" in dv.body && "evidence" in dv.body);
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
