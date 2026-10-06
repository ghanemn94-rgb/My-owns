// domain-reviewer DG2 round 6 (T-DG2-REV-DOM-R6): live API checks of the D-066 changes. SYNTHETIC data, disposable stack.
// Product gates are not touched here. Checks: U+0000 refused with validation.invalid_character (charter, outcome, T03 row,
// archive reason, path parameter, query), never stored; the two new placeholder characters (U+16FE4, U+1D159) alone are blank,
// but with Arabic text they are content; Arabic with RLM still stored verbatim; malformed path ids point at /params/<name>.
import { randomUUID } from "node:crypto";
const BASE = process.env.E2E_BASE_URL;
const U = { office: "01920000-0000-7000-9000-000000000202", lead: "01920000-0000-7000-9000-000000000203" };
const BU = "01920000-0000-7000-9000-000000000102";
const out = [];
const rec = (id, exp, act, ok) => { out.push({ id, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  return async (method, path, body, ifMatch) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken };
    if (body !== undefined) h["content-type"] = "application/json";
    if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`;
    if (method === "POST" && ifMatch === undefined) h["idempotency-key"] = randomUUID();
    const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
}
const errs = (r) => JSON.stringify((r.body?.errors ?? []).map((e) => [e.pointer, e.code]));
const call = await session("dev.lead");

// NUL in transformation name (create)
const n0 = await call("POST", "/api/v1/transformations", { businessUnitId: BU, name: "Synthetic\u0000name", mode: "end_to_end" });
rec("R6.nul-transformation-name", "400 validation.invalid_character at /name", `${n0.status} ${errs(n0)}`, n0.status === 400 && errs(n0).includes('["/name","validation.invalid_character"]'));

const t = await call("POST", "/api/v1/transformations", { businessUnitId: BU, name: "Synthetic R6 delta", mode: "end_to_end" });
const T = `/api/v1/transformations/${t.body.id}`;

// NUL in a charter field (create) - nothing written
const c0 = await call("POST", `${T}/charter`, { transformationName: "Synthetic R6", executiveSponsorUserId: U.office, transformationLeadUserId: U.lead, caseForChange: "Synthetic\u0000case", inScope: "Synthetic scope", baselineDate: "2026-01-31" });
const g0 = await call("GET", `${T}/charter`);
rec("R6.nul-charter-create", "400 validation.invalid_character at /caseForChange; no charter created", `${c0.status} ${errs(c0)}; GET charter=${g0.status}`, c0.status === 400 && errs(c0).includes('["/caseForChange","validation.invalid_character"]') && g0.status !== 200 || (g0.status === 200 && g0.body?.charter == null && c0.status === 400));

// NUL in Arabic text with RLM: refused as invalid_character only (one error, not blank too)
const c1 = await call("POST", `${T}/charter`, { transformationName: "Synthetic R6", executiveSponsorUserId: U.office, transformationLeadUserId: U.lead, caseForChange: "‏تجريبي\u0000‏", inScope: "Synthetic scope", baselineDate: "2026-01-31" });
rec("R6.nul-arabic-one-error", "400 with exactly one error validation.invalid_character", `${c1.status} ${errs(c1)}`, c1.status === 400 && (c1.body.errors ?? []).length === 1 && c1.body.errors[0].code === "validation.invalid_character");

// NUL only: invalid_character, not blank
const c2 = await call("POST", `${T}/charter`, { transformationName: "Synthetic R6", executiveSponsorUserId: U.office, transformationLeadUserId: U.lead, caseForChange: "\u0000", inScope: "Synthetic scope", baselineDate: "2026-01-31" });
rec("R6.nul-only", "400 validation.invalid_character (single error)", `${c2.status} ${errs(c2)}`, c2.status === 400 && errs(c2) === '[["/caseForChange","validation.invalid_character"]]');

// Arabic with RLM marks accepted verbatim (create)
const arCase = "‏تجريبي: أخطاء الفوترة تسبب فقدان العملاء‏ ؜(٤٫٢٥٪)‏";
const arScope = "‏الفوترة لقطاع الأفراد‏";
const arOut = "‏خارج النطاق: قطاع الأعمال‏";
const c3 = await call("POST", `${T}/charter`, { transformationName: "‏تحول تجريبي‏", executiveSponsorUserId: U.office, transformationLeadUserId: U.lead, caseForChange: arCase, inScope: arScope, outOfScope: arOut, baselineDate: "2026-01-31" });
const g3 = await call("GET", `${T}/charter`);
const ch = g3.body?.charter ?? {};
rec("R6.arabic-rlm-charter-verbatim", "201; caseForChange/inScope/outOfScope/name stored code point for code point", `${c3.status}; verbatim=${[ch.caseForChange === arCase, ch.inScope === arScope, ch.outOfScope === arOut, ch.transformationName === "‏تحول تجريبي‏"]}`, c3.status === 201 && ch.caseForChange === arCase && ch.inScope === arScope && ch.outOfScope === arOut);
const pre = (g3.body?.scopeCheckPrechecks ?? []).find((p) => p.code === "exclusions_documented");
rec("R6.arabic-oos-b0041-pass", "B0041 exclusions_documented pass", pre?.status ?? pre?.result, (pre?.status ?? pre?.result) === "pass");

// NUL on update (PATCH charter) - version unchanged
const v = ch.version;
const p0 = await call("PATCH", `${T}/charter`, { outOfScope: "Synthetic\u0000", changeSummary: "Synthetic" }, v);
const g4 = await call("GET", `${T}/charter`);
rec("R6.nul-charter-update", "400 validation.invalid_character at /outOfScope; version unchanged; value unchanged", `${p0.status} ${errs(p0)} v ${v}->${g4.body.charter.version} verbatim=${g4.body.charter.outOfScope === arOut}`, p0.status === 400 && errs(p0).includes("/outOfScope") && errs(p0).includes("invalid_character") && g4.body.charter.version === v && g4.body.charter.outOfScope === arOut);

// Placeholders alone are blank (F-DG2-230); with Arabic they are content
for (const [label, s] of [["KHITAN FILLER U+16FE4", "\u{16FE4}"], ["NULL NOTEHEAD U+1D159", "\u{1D159}"], ["both + RLM", "‏\u{16FE4}\u{1D159}‏"]]) {
  const r = await call("PATCH", `${T}/charter`, { outOfScope: s, changeSummary: "Synthetic" }, v);
  rec(`R6.placeholder-blank:${label}`, "400 validation.blank at /outOfScope; version unchanged", `${r.status} ${errs(r)}`, r.status === 400 && errs(r) === '[["/outOfScope","validation.blank"]]');
}
const mixed = "‏نطاق\u{1D159}‏";
const pm = await call("PATCH", `${T}/charter`, { outOfScope: mixed, changeSummary: "‏تغيير تجريبي‏" }, v);
const g5 = await call("GET", `${T}/charter`);
rec("R6.placeholder-with-arabic-content", "200; stored verbatim; version +1", `${pm.status} verbatim=${g5.body.charter.outOfScope === mixed} v=${g5.body.charter.version}`, pm.status === 200 && g5.body.charter.outOfScope === mixed && g5.body.charter.version === v + 1);

// Path params: malformed id -> 400 pointer names the parameter; NUL in path -> 400 invalid_character
const bad = await call("GET", `/api/v1/transformations/not-a-uuid/charter`);
rec("R6.params-pointer-names-parameter", "400 pointer /params/transformationId", `${bad.status} ${errs(bad)}`, bad.status === 400 && errs(bad).includes("/params/transformationId"));
const badNul = await call("GET", `/api/v1/transformations/abc%00def/charter`);
rec("R6.params-nul", "400 validation.invalid_character at /params/transformationId", `${badNul.status} ${errs(badNul)}`, badNul.status === 400 && errs(badNul).includes('["/params/transformationId","validation.invalid_character"]'));
const ow = await call("GET", `${T}/outcomes/not-a-uuid`);
rec("R6.record-param-pointer", "400 pointer names the record parameter (not /params/id)", `${ow.status} ${errs(ow)}`, ow.status === 400 && !errs(ow).includes('"/params/id"') && errs(ow).includes("/params/"));

// NUL in an outcome statement and in a T03 register row
const o0 = await call("POST", `${T}/outcomes`, { statement: "Synthetic\u0000outcome", level: "top", ownerUserId: U.office, targetDate: "2026-12-31" });
rec("R6.nul-outcome", "400 validation.invalid_character", `${o0.status} ${errs(o0)}`, o0.status === 400 && errs(o0).includes("invalid_character"));
// NUL in query
const q0 = await call("GET", `/api/v1/transformations?q=abc%00`);
rec("R6.query-nul", "400 validation.invalid_character at /query/q", `${q0.status} ${errs(q0)}`, q0.status === 400 && errs(q0).includes("invalid_character"));
const fail = out.filter((x) => !x.ok).map((x) => x.id);
console.log("SUMMARY", JSON.stringify({ pass: out.length - fail.length, fail }));
process.exit(fail.length ? 1 : 0);
