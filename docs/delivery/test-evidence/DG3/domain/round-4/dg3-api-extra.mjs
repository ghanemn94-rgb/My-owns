// domain-reviewer DG3 round 2: supplementary live API probe (SYNTHETIC data, disposable stack). Round-1 probe, with the
// 'modular' step extended to verify F-DG3-120 (ADR-0021 §5) state by state:
//  - none recorded -> G1 inheritedApproval null;
//  - inherited_approval for G1 with VERIFIED evidence -> pending_verification, counts false; submit still 422 g1;
//  - the synthetic Sponsor accepts -> accepted, counts true; canSubmitInitiatives true;
//  - the evidence is re-reviewed 'rejected' -> accepted, counts false (sequencing rule, not a stored flag);
//    re-verified -> counts true again;
//  - revoked -> revoked, counts false; canSubmitInitiatives false;
//  - at every step: G1 status draft, approvedAt null, latestSubmissionNo 0, 0 gate_submission / gate_decision rows,
//    every other gate null, list item == gate view, Dispensations list agrees;
//  - a second Modular transformation: rejected -> rejected, counts false;
//  - an End-to-End transformation: every gate null, inherited_approval refused (422).
// The 'waiver' and 'finance-stale' steps are the round-1 ones, unchanged. Demo decisions approve nothing real and never
// touch DG0-DG7.
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL;
const PSQL = process.env.PSQL_MTH;
const DEV_ISSUER = "urn:mth:dev-local";
const BU_RETAIL = "01920000-0000-7000-9000-000000000102";
const results = [];
const rec = (id, expected, actual, pass) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };
const j = (x, n = 900) => JSON.stringify(x)?.slice(0, n);
const sqlCount = (q) => Number(execFileSync("psql", [PSQL, "-Atc", q], { encoding: "utf8" }).trim());
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
const must = (r, s, what) => { if (r.status !== s) throw new Error(`${what}: ${r.status} ${j(r.body, 1500)}`); return r.body; };
async function step(name, fn) { try { await fn(); } catch (e) { rec(`${name}.exception`, "no exception", String(e.message ?? e).slice(0, 1500), false); } }
const lead = await session("dev.lead"); const admin = await session("dev.admin"); const office = await session("dev.office");
const orgId = admin.me.organization.id; const stamp = Date.now().toString(36);
async function synthUser(tid, username, roleCode) {
  const u = must(await admin.call("POST", "/api/v1/users", { organizationId: orgId, displayName: `Synthetic ${roleCode}`, preferredLocale: "en", identity: { issuer: DEV_ISSUER, subject: username } }), 201, "user");
  must(await admin.call("POST", "/api/v1/role-assignments", { userId: u.id, roleCode, scope: { type: "transformation", id: tid }, reason: "Synthetic demo role (approves nothing real)" }), 201, "grant");
  return session(username);
}

/** The G1 annotation from the gate list and the gate view, plus the gate's own state and the DB row counts. */
async function g1State(MT, tid) {
  const list = must(await lead.call("GET", `${MT}/gates`), 200, "gates").items;
  const item = list.find((g) => g.definition.code === "G1");
  const view = must(await lead.call("GET", `${MT}/gates/G1`), 200, "g1");
  const others = list.filter((g) => g.definition.code !== "G1").map((g) => g.gate.inheritedApproval);
  const subs = sqlCount(`select count(*) from gate_submission where transformation_id='${tid}'`);
  const decs = sqlCount(`select count(*) from gate_decision where transformation_id='${tid}'`);
  const rd = must(await lead.call("GET", `${MT}/readiness`), 200, "readiness");
  const disp = must(await lead.call("GET", `${MT}/gate-dispensations`), 200, "disp list").items;
  return { item, view, others, subs, decs, rd, disp, ann: item.gate.inheritedApproval };
}
/** The invariant at every step: never a fabricated approval. */
function invariant(tag, s) {
  const ok = s.item.gate.status === "draft" && s.item.gate.approvedAt === null && s.item.gate.latestSubmissionNo === 0 &&
    s.view.gate.status === "draft" && s.subs === 0 && s.decs === 0 && j(s.view.gate.inheritedApproval) === j(s.ann) &&
    s.others.every((x) => x === null) && (s.rd.gates ?? []).find((g) => g.gateCode === "G1")?.status === "draft";
  rec(`REQ-PB-004.${tag}.g1-stays-draft`, "G1 list+view status draft, approvedAt null, latestSubmissionNo 0, 0 gate_submission and 0 gate_decision rows, list annotation == view annotation, other 5 gates null, readiness G1 draft",
    `list=${s.item.gate.status}/${s.item.gate.approvedAt}/${s.item.gate.latestSubmissionNo} view=${s.view.gate.status} subs=${s.subs} decs=${s.decs} others=${j(s.others)} same=${j(s.view.gate.inheritedApproval) === j(s.ann)}`, ok);
}

await step("modular", async () => {
  const m = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic modular extra R2", mode: "modular", entryPhase: "mobilize" }), 201, "m");
  const MT = `/api/v1/transformations/${m.id}`;
  const sp = await synthUser(m.id, `dx.sp.${stamp}`, "SP");
  let s = await g1State(MT, m.id);
  rec("REQ-PB-004.none.annotation-null", "no dispensation: G1 inheritedApproval null", j(s.ann), s.ann === null);
  invariant("none", s);
  const ini = must(await lead.call("POST", "/api/v1/initiatives", { transformationId: m.id, name: "Synthetic modular initiative" }), 201, "ini");
  const ev = must(await lead.call("POST", `${MT}/evidence`, { kind: "note", title: "Synthetic prior board minute", ownerUserId: lead.id, noteBody: "Synthetic: approved 2026-01-15." }), 201, "ev");
  const evv = must(await office.call("POST", `${MT}/evidence/${ev.id}/review`, { result: "verified", accessibilityStatus: "accessible", note: "Synthetic" }, ev.version), 200, "verify");
  const d = must(await lead.call("POST", `${MT}/gate-dispensations`, { kind: "inherited_approval", gateCode: "G1", approvingBody: "Synthetic executive committee", approvedOn: "2026-01-15", evidenceId: ev.id }), 201, "disp");
  s = await g1State(MT, m.id);
  rec("REQ-PB-004.pending.annotation", "{dispensationId, status pending_verification, counts false, approvingBody, approvedOn 2026-01-15}", j(s.ann),
    j(s.ann) === j({ dispensationId: d.id, status: "pending_verification", counts: false, approvingBody: "Synthetic executive committee", approvedOn: "2026-01-15" }));
  invariant("pending", s);
  const g1r = (s.rd.gates ?? []).find((g) => g.gateCode === "G1");
  rec("REQ-PB-004.pending.readiness", "readiness: canSubmitInitiatives false; G1 dispensation inherited_approval pending, counts false", `${s.rd.sequencing.canSubmitInitiatives} ${j(g1r?.dispensations?.map((x) => [x.kind, x.status, x.counts]))}`,
    s.rd.sequencing.canSubmitInitiatives === false && g1r.dispensations.some((x) => x.id === d.id && x.status === "pending" && x.counts === false));
  rec("REQ-PB-004.pending.dispensations-page-data", "Dispensations list: the record pending, evidenceVerified true, counts false", j(s.disp.map((x) => [x.kind, x.status, x.evidenceVerified, x.counts])),
    s.disp.length === 1 && s.disp[0].status === "pending" && s.disp[0].evidenceVerified === true && s.disp[0].counts === false);
  let iv = must(await lead.call("GET", `/api/v1/initiatives/${ini.id}`), 200, "ini");
  let sub = await lead.call("POST", `/api/v1/initiatives/${ini.id}/submit`, {}, iv.version);
  rec("REQ-PB-004.pending.submit-refused", "422 initiative.g1_not_approved while pending", `${sub.status} ${sub.body.code} ${j(sub.body.errors?.map((e) => e.code))}`, sub.status === 422 && j(sub.body).includes("initiative.g1_not_approved"));
  const self = await lead.call("POST", `${MT}/gate-dispensations/${d.id}/decision`, { result: "accepted" }, d.version);
  rec("REQ-PB-004.no-self-accept", "the recorder cannot accept (403)", `${self.status} ${self.body.code}`, self.status === 403);
  const del = await sp.call("POST", `${MT}/gate-dispensations/${d.id}/decision`, { result: "accepted", onBehalfOfUserId: lead.id }, d.version);
  rec("REQ-PB-004.no-delegated-acceptance", "422 dispensation.on_behalf_not_supported", `${del.status} ${del.body.code}`, del.status === 422 && del.body.code === "dispensation.on_behalf_not_supported");
  const acc = must(await sp.call("POST", `${MT}/gate-dispensations/${d.id}/decision`, { result: "accepted", note: "Synthetic demo (approves nothing real)" }, d.version), 200, "accept");
  s = await g1State(MT, m.id);
  rec("REQ-PB-004.accepted.annotation", "status accepted, counts true, same dispensationId", j(s.ann), s.ann?.dispensationId === d.id && s.ann.status === "accepted" && s.ann.counts === true);
  invariant("accepted", s);
  rec("REQ-PB-004.accepted.can-submit", "canSubmitInitiatives true; blockers no g1", `${s.rd.sequencing.canSubmitInitiatives} ${j(s.rd.sequencing.blockers)}`, s.rd.sequencing.canSubmitInitiatives === true && !j(s.rd.sequencing.blockers).includes("g1_not_approved"));
  iv = must(await lead.call("GET", `/api/v1/initiatives/${ini.id}`), 200, "ini");
  sub = await lead.call("POST", `/api/v1/initiatives/${ini.id}/submit`, {}, iv.version);
  rec("REQ-PB-004.accepted.submit-passes-g1", "submit now fails only on outcome_before_activity (G1 sequencing satisfied)", `${sub.status} ${sub.body.code} ${j(sub.body.errors?.map((e) => e.code))}`,
    sub.status === 422 && !j(sub.body).includes("g1_not_approved") && j(sub.body).includes("outcome_before_activity"));
  // Evidence re-reviewed 'rejected': the acceptance stays, but it no longer counts (counts is the rule's verdict now).
  const evRej = must(await office.call("POST", `${MT}/evidence/${ev.id}/review`, { result: "rejected", accessibilityStatus: "accessible", note: "Synthetic: re-review" }, evv.version), 200, "re-review rejected");
  s = await g1State(MT, m.id);
  rec("REQ-PB-004.accepted-unverified.annotation", "status accepted, counts false once the evidence is no longer verified", j(s.ann), s.ann?.status === "accepted" && s.ann.counts === false);
  rec("REQ-PB-004.accepted-unverified.sequencing", "canSubmitInitiatives false", `${s.rd.sequencing.canSubmitInitiatives}`, s.rd.sequencing.canSubmitInitiatives === false);
  invariant("accepted-unverified", s);
  must(await office.call("POST", `${MT}/evidence/${ev.id}/review`, { result: "verified", accessibilityStatus: "accessible", note: "Synthetic: re-verified" }, evRej.version), 200, "re-verify");
  s = await g1State(MT, m.id);
  rec("REQ-PB-004.reverified.annotation", "accepted, counts true again", j(s.ann), s.ann?.status === "accepted" && s.ann.counts === true);
  const selfRevoke = await lead.call("POST", `${MT}/gate-dispensations/${d.id}/revoke`, { reason: "Synthetic: lead tries" }, acc.version);
  rec("REQ-PB-004.revoke-needs-gate-decide", "the lead (no gate.decide) cannot revoke (403)", `${selfRevoke.status} ${selfRevoke.body.code}`, selfRevoke.status === 403);
  const cur = s.disp.find((x) => x.id === d.id);
  must(await sp.call("POST", `${MT}/gate-dispensations/${d.id}/revoke`, { reason: "Synthetic: the minutes were superseded." }, cur.version), 200, "revoke");
  s = await g1State(MT, m.id);
  rec("REQ-PB-004.revoked.annotation", "status revoked, counts false", j(s.ann), s.ann?.dispensationId === d.id && s.ann.status === "revoked" && s.ann.counts === false);
  rec("REQ-PB-004.revoked.sequencing", "canSubmitInitiatives false", `${s.rd.sequencing.canSubmitInitiatives} ${j(s.rd.sequencing.blockers?.map((b) => b.code))}`, s.rd.sequencing.canSubmitInitiatives === false);
  invariant("revoked", s);
  console.log("G1 LIST ITEM (revoked)", j(s.item.gate, 2500));
});

await step("modular-rejected", async () => {
  const m = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic modular rejected R2", mode: "modular", entryPhase: "mobilize" }), 201, "m");
  const MT = `/api/v1/transformations/${m.id}`;
  const sp = await synthUser(m.id, `dx.spr.${stamp}`, "SP");
  const ev = must(await lead.call("POST", `${MT}/evidence`, { kind: "note", title: "Synthetic claimed minute", ownerUserId: lead.id, noteBody: "Synthetic." }), 201, "ev");
  const d = must(await lead.call("POST", `${MT}/gate-dispensations`, { kind: "inherited_approval", gateCode: "G1", approvingBody: "Synthetic steering board", approvedOn: "2026-02-01", evidenceId: ev.id }), 201, "disp");
  let s = await g1State(MT, m.id);
  rec("REQ-PB-004.unverified-pending.annotation", "unverified evidence: pending_verification, counts false", j(s.ann), s.ann?.status === "pending_verification" && s.ann.counts === false);
  const acc = await sp.call("POST", `${MT}/gate-dispensations/${d.id}/decision`, { result: "accepted", note: "Synthetic" }, d.version);
  rec("REQ-PB-004.unverified-accept-refused", "422 dispensation.evidence_not_verified", `${acc.status} ${acc.body.code}`, acc.status === 422 && acc.body.code === "dispensation.evidence_not_verified");
  must(await sp.call("POST", `${MT}/gate-dispensations/${d.id}/decision`, { result: "rejected", note: "Synthetic: the minute does not show an approval" }, d.version), 200, "reject");
  s = await g1State(MT, m.id);
  rec("REQ-PB-004.rejected.annotation", "status rejected, counts false", j(s.ann), s.ann?.dispensationId === d.id && s.ann.status === "rejected" && s.ann.counts === false);
  invariant("rejected", s);
});

await step("e2e-null", async () => {
  const t = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic E2E null annotation", mode: "end_to_end" }), 201, "t");
  const T = `/api/v1/transformations/${t.id}`;
  const list = must(await lead.call("GET", `${T}/gates`), 200, "gates").items;
  rec("REQ-PB-004.e2e.all-null", "End-to-End: all six gates inheritedApproval null (field present)", j(list.map((g) => [g.definition.code, g.gate.inheritedApproval])), list.length === 6 && list.every((g) => "inheritedApproval" in g.gate && g.gate.inheritedApproval === null));
  const ev = must(await lead.call("POST", `${T}/evidence`, { kind: "note", title: "Synthetic", ownerUserId: lead.id, noteBody: "Synthetic." }), 201, "ev");
  const r = await lead.call("POST", `${T}/gate-dispensations`, { kind: "inherited_approval", gateCode: "G1", approvingBody: "Synthetic", approvedOn: "2026-01-15", evidenceId: ev.id });
  rec("REQ-PB-004.e2e.inherited-refused", "422 dispensation.inherited_requires_modular", `${r.status} ${r.body.code}`, r.status === 422 && r.body.code === "dispensation.inherited_requires_modular");
});

await step("waiver", async () => {
  const t = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic E2E waiver", mode: "end_to_end" }), 201, "t");
  const T = `/api/v1/transformations/${t.id}`;
  const sp = await synthUser(t.id, `dx.wsp.${stamp}`, "SP");
  const noReason = await lead.call("POST", `${T}/gate-dispensations`, { kind: "waiver", gateCode: "G3", reason: "  ", expiresOn: "2027-01-31" });
  rec("REQ-PB-004.waiver-needs-reason", "400 blank reason", `${noReason.status}`, noReason.status === 400);
  const w = must(await lead.call("POST", `${T}/gate-dispensations`, { kind: "waiver", gateCode: "G3", reason: "Synthetic: pilot may launch before G3", expiresOn: "2027-01-31" }), 201, "waiver");
  const self = await lead.call("POST", `${T}/gate-dispensations/${w.id}/decision`, { result: "accepted" }, w.version);
  rec("REQ-PB-004.waiver-not-self-accepted", "403", `${self.status} ${self.body.code}`, self.status === 403);
  must(await sp.call("POST", `${T}/gate-dispensations/${w.id}/decision`, { result: "accepted", note: "Synthetic demo" }, w.version), 200, "accept");
  const r = must(await lead.call("GET", `${T}/readiness`), 200, "readiness");
  const g3 = (r.gates ?? []).find((g) => (g.gateCode ?? g.code) === "G3");
  rec("REQ-PB-004.waiver-never-approves", "G3 status stays draft; waiver shown; launch still blocked on G2 (only G3 waived)", `G3=${j(g3, 400)}; canLaunch=${r.sequencing?.canLaunchInitiatives}; blockers=${j(r.sequencing?.blockers?.map((b) => b.code))}`, j(g3).includes("waiver") && /"status":"draft"/.test(j(g3)) && r.sequencing?.canLaunchInitiatives === false);
  const gl = must(await lead.call("GET", `${T}/gates`), 200, "gates").items;
  rec("REQ-PB-004.waiver-not-an-inherited-annotation", "a waiver never shows as inheritedApproval (all null)", j(gl.map((g) => g.gate.inheritedApproval)), gl.every((g) => g.gate.inheritedApproval === null));
});

await step("finance-stale", async () => {
  const t = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic finance stale", mode: "end_to_end" }), 201, "t");
  const fin = await synthUser(t.id, `dx.fin.${stamp}`, "FIN");
  const c = must(await lead.call("POST", "/api/v1/business-cases", { transformationId: t.id, level: "transformation", title: "Synthetic case", sections: { baselineSummary: "Synthetic baseline v1" } }), 201, "case");
  must(await fin.call("POST", `/api/v1/business-cases/${c.id}/baseline-validation`, { result: "validated", note: "Synthetic demo" }, c.version), 200, "validate");
  const g1 = must(await lead.call("GET", `/api/v1/business-cases/${c.id}`), 200, "get");
  console.log("CASE after validation", j(Object.fromEntries(Object.entries(g1).filter(([k]) => /aseline/i.test(k))), 1200));
  must(await lead.call("PATCH", `/api/v1/business-cases/${c.id}`, { sections: { baselineSummary: "Synthetic baseline v2 (changed)" } }, g1.version), 200, "edit");
  const g2 = must(await lead.call("GET", `/api/v1/business-cases/${c.id}`), 200, "get");
  const st = Object.fromEntries(Object.entries(g2).filter(([k]) => /aseline/i.test(k)));
  console.log("CASE after edit", j(st, 1200));
  rec("REQ-PB-055.baseline-edit-makes-validation-stale", "after a baseline edit the validation is Stale / no longer current", j(st, 600), /stale/i.test(j(st)) || /"baselineValidationCurrent":false/.test(j(st)));
  const l = must(await lead.call("POST", `/api/v1/business-cases/${c.id}/lines`, { lineKind: "investment", class: "opex", valueBasis: "cash", title: "Synthetic unknown cost", currency: "SAR" }), 201, "unknown line");
  const tot = must(await lead.call("GET", `/api/v1/business-cases/${c.id}/totals`), 200, "totals");
  rec("ADR-0019.unknown-never-zero", "implementation cost Unknown (null amount, unknownLineCount 1), net Unknown; never '0'", j({ ic: tot.implementationCost, net: tot.netValue, gb: tot.grossBenefits }, 600), l.amount === null && j(tot.implementationCost).includes('"amount":null') && j(tot.implementationCost).includes('"unknownLineCount":1') && !j(tot.implementationCost).includes('"amount":"0"'));
});

const fails = results.filter((r) => !r.pass);
console.log(`SUMMARY ${results.length - fails.length}/${results.length} PASS; FAIL: ${j(fails.map((f) => f.id), 3000)}`);
process.exit(fails.length ? 1 : 0);
