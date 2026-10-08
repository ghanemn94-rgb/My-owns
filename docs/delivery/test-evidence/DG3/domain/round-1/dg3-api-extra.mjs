// domain-reviewer DG3 round 1: supplementary live API probe (SYNTHETIC data, disposable stack). Covers:
//  - Modular inherited approval: the gate list keeps G1 'draft' with an inheritedApproval annotation; readiness shows it;
//  - End-to-End waiver of G3: accepted by the configured approver, it unblocks only that gate's sequencing and never
//    approves the gate;
//  - Finance validation goes Stale when the baseline text changes after validation (ADR-0024 §5);
//  - an Unknown amount is never summed as 0 (ADR-0019);
// Demo decisions approve nothing real and never touch DG0-DG7.
import { randomUUID } from "node:crypto";
const BASE = process.env.E2E_BASE_URL;
const DEV_ISSUER = "urn:mth:dev-local";
const BU_RETAIL = "01920000-0000-7000-9000-000000000102";
const results = [];
const rec = (id, expected, actual, pass) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };
const j = (x, n = 900) => JSON.stringify(x)?.slice(0, n);
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

await step("modular", async () => {
  const m = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic modular extra", mode: "modular", entryPhase: "mobilize" }), 201, "m");
  const MT = `/api/v1/transformations/${m.id}`;
  const sp = await synthUser(m.id, `dx.sp.${stamp}`, "SP");
  const ev = must(await lead.call("POST", `${MT}/evidence`, { kind: "note", title: "Synthetic prior board minute", ownerUserId: lead.id, noteBody: "Synthetic: approved 2026-01-15." }), 201, "ev");
  must(await office.call("POST", `${MT}/evidence/${ev.id}/review`, { result: "verified", accessibilityStatus: "accessible", note: "Synthetic" }, ev.version), 200, "verify");
  const d = must(await lead.call("POST", `${MT}/gate-dispensations`, { kind: "inherited_approval", gateCode: "G1", approvingBody: "Synthetic executive committee", approvedOn: "2026-01-15", evidenceId: ev.id }), 201, "disp");
  let r = must(await lead.call("GET", `${MT}/readiness`), 200, "readiness");
  const g1r = (r.gates ?? []).find((g) => (g.gateCode ?? g.code) === "G1");
  rec("REQ-PB-004.readiness-pending-inherited", "readiness G1: status draft, dispensation inherited_approval pending (not approved)", j(g1r), g1r && j(g1r).includes("inherited_approval") && j(g1r).includes("pending") && !/"status":"approved"/.test(j(g1r)));
  const del = await sp.call("POST", `${MT}/gate-dispensations/${d.id}/decision`, { result: "accepted", onBehalfOfUserId: lead.id }, d.version);
  rec("REQ-PB-004.no-delegated-acceptance", "422 dispensation.on_behalf_not_supported", `${del.status} ${del.body.code}`, del.status === 422 && del.body.code === "dispensation.on_behalf_not_supported");
  must(await sp.call("POST", `${MT}/gate-dispensations/${d.id}/decision`, { result: "accepted", note: "Synthetic" }, d.version), 200, "accept");
  const list = must(await lead.call("GET", `${MT}/gates`), 200, "gates").items;
  const g1 = list.find((g) => g.definition.code === "G1");
  console.log("G1 LIST ITEM", j(g1, 2500));
  rec("REQ-PB-004.gate-list-draft-with-annotation", "G1 in the gate list: status draft (no fabricated approval) + inheritedApproval annotation", `status=${g1.status ?? g1.gate?.status}; annotation=${/inheritedApproval/.test(j(g1, 99999))}`, (g1.status ?? g1.gate?.status) === "draft" && /inheritedApproval/.test(j(g1, 99999)));
  const hist = must(await lead.call("GET", `${MT}/gates/G1`), 200, "g1");
  rec("REQ-PB-004.no-gate-decision", "G1 has no decision/submission rows", `latestSubmissionNo=${hist.gate.latestSubmissionNo} decisions=${j(hist.decisions ?? hist.history ?? [] , 200)}`, hist.gate.latestSubmissionNo === 0);
  r = must(await lead.call("GET", `${MT}/readiness`), 200, "readiness");
  rec("REQ-PB-004.readiness-can-submit-after-accept", "canSubmitInitiatives true once verified+accepted", `${r.sequencing?.canSubmitInitiatives} ${j(r.sequencing?.blockers)}`, r.sequencing?.canSubmitInitiatives === true);
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
});

await step("finance-stale", async () => {
  const t = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic finance stale", mode: "end_to_end" }), 201, "t");
  const fin = await synthUser(t.id, `dx.fin.${stamp}`, "FIN");
  const c = must(await lead.call("POST", "/api/v1/business-cases", { transformationId: t.id, level: "transformation", title: "Synthetic case", sections: { baselineSummary: "Synthetic baseline v1" } }), 201, "case");
  const v = must(await fin.call("POST", `/api/v1/business-cases/${c.id}/baseline-validation`, { result: "validated", note: "Synthetic demo" }, c.version), 200, "validate");
  const g1 = must(await lead.call("GET", `/api/v1/business-cases/${c.id}`), 200, "get");
  console.log("CASE after validation", j(Object.fromEntries(Object.entries(g1).filter(([k]) => /aseline/i.test(k))), 1200));
  must(await lead.call("PATCH", `/api/v1/business-cases/${c.id}`, { sections: { baselineSummary: "Synthetic baseline v2 (changed)" } }, g1.version), 200, "edit");
  const g2 = must(await lead.call("GET", `/api/v1/business-cases/${c.id}`), 200, "get");
  const st = Object.fromEntries(Object.entries(g2).filter(([k]) => /aseline/i.test(k)));
  console.log("CASE after edit", j(st, 1200));
  rec("REQ-PB-055.baseline-edit-makes-validation-stale", "after a baseline edit the validation is Stale / no longer current", j(st, 600), /stale/i.test(j(st)) || /"baselineValidationCurrent":false/.test(j(st)));
  // Unknown amount
  const l = must(await lead.call("POST", `/api/v1/business-cases/${c.id}/lines`, { lineKind: "investment", class: "opex", valueBasis: "cash", title: "Synthetic unknown cost", currency: "SAR" }), 201, "unknown line");
  const tot = must(await lead.call("GET", `/api/v1/business-cases/${c.id}/totals`), 200, "totals");
  rec("ADR-0019.unknown-never-zero", "implementation cost Unknown (null amount, unknownLineCount 1), net Unknown; never '0'", j({ ic: tot.implementationCost, net: tot.netValue, gb: tot.grossBenefits }, 600), l.amount === null && j(tot.implementationCost).includes('"amount":null') && j(tot.implementationCost).includes('"unknownLineCount":1') && !j(tot.implementationCost).includes('"amount":"0"'));
});

const fails = results.filter((r) => !r.pass);
console.log(`SUMMARY ${results.length - fails.length}/${results.length} PASS; FAIL: ${j(fails.map((f) => f.id), 3000)}`);
process.exit(fails.length ? 1 : 0);
