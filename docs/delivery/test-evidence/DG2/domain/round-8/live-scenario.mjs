// domain-reviewer live scenario (DG2 round 8, T-DG2-REV-DOM-R8). SYNTHETIC data only, disposable stack.
// Product gates G1/G2 here are demo business decisions on synthetic data; they approve nothing real and never touch DG0-DG7.
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
const sqlx = (q) => execFileSync("psql", [process.env.PSQL_MTH, "-qAtc", "SET session_replication_role = replica; " + q], { encoding: "utf8" }).trim();
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
rec("F-DG2-150.empty-out-of-scope-fails", "exclusions_documented = attention (fails) on a saved charter with null Out of scope", `${exNull.result}: ${exNull.detail}`, exNull.result === "attention");
let g1e = must(await lead.call("GET", `${T}/gates/G1`), 200, "g1 early");
const ic = (g) => g.criteria.find((c) => c.key === "g1.initial_charter");
console.log("G1 initial_charter (null oos)", JSON.stringify(ic(g1e)));
rec("F-DG2-150.g1-null-oos", "g1.initial_charter incomplete, names scope out", `${ic(g1e).completeness} ${JSON.stringify(ic(g1e).missing)}`, ic(g1e).completeness !== "complete" && /out/i.test(JSON.stringify(ic(g1e).missing)));
const emptyStr = await lead.call("PATCH", `${T}/charter`, { outOfScope: "", changeSummary: "Synthetic empty" }, cv.charter.version);
rec("F-DG2-150.empty-string-rejected", "400", `${emptyStr.status} ${JSON.stringify(emptyStr.body.errors)}`, emptyStr.status === 400);
for (const v of ["   ", "\t\n ", "\u00a0\u3000"]) {
  const ws = await lead.call("PATCH", `${T}/charter`, { outOfScope: v, changeSummary: "Synthetic whitespace exclusions" }, cv.charter.version);
  const after = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
  rec(`F-DG2-150.whitespace-rejected:${JSON.stringify(v)}`, "400 validation.blank at /outOfScope; nothing written (version unchanged)", `${ws.status} ${JSON.stringify(ws.body.errors)}; version ${cv.charter.version}->${after.charter.version}; stored=${JSON.stringify(after.charter.outOfScope)}`, ws.status === 400 && JSON.stringify(ws.body.errors ?? []).includes("validation.blank") && JSON.stringify(ws.body.errors ?? []).includes("/outOfScope") && after.charter.version === cv.charter.version);
}
const wsIn = await lead.call("PATCH", `${T}/charter`, { inScope: "  ", changeSummary: "x" }, cv.charter.version);
rec("D-063.blank-in-scope-rejected", "400 validation.blank", `${wsIn.status} ${JSON.stringify(wsIn.body.errors)}`, wsIn.status === 400);
const wsSum = await lead.call("PATCH", `${T}/charter`, { outOfScope: "Synthetic", changeSummary: "  " }, cv.charter.version);
rec("D-063.blank-change-summary-rejected", "400 validation.blank", `${wsSum.status} ${JSON.stringify(wsSum.body.errors)}`, wsSum.status === 400);
const clr = await lead.call("PATCH", `${T}/charter`, { outOfScope: null, changeSummary: "Synthetic clear" }, cv.charter.version);
rec("D-063.null-clears", "200 (null clears a nullable field)", `${clr.status}`, clr.status === 200);
cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
// ROUND 4 (F-DG2-160 / D-064): invisible-only text is refused; visible text keeps its marks verbatim.
for (const [label, v] of [["RLM", "‏"], ["ZWSP x3", "​​​"], ["WORD JOINER", "⁠"], ["NEL", "\u0085"], ["HANGUL FILLER", "ㅤ"], ["BRAILLE BLANK", "⠀"], ["ALM+NBSP", "؜ "]]) {
  const r = await lead.call("PATCH", `${T}/charter`, { outOfScope: v, changeSummary: "Synthetic invisible exclusions" }, cv.charter.version);
  const after = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
  rec(`R4.invisible-oos-rejected:${label}`, "400 validation.blank at /outOfScope; version unchanged", `${r.status} ${JSON.stringify(r.body.errors?.map((e) => [e.pointer, e.code]))}; v ${cv.charter.version}->${after.charter.version}`, r.status === 400 && JSON.stringify(r.body.errors ?? []).includes(label.startsWith("lone surrogate") ? "validation.invalid_character" : "validation.blank") && after.charter.version === cv.charter.version); // round 8: D-067 refuses a lone surrogate as invalid_character (intended change, F-DG2-260)
}
for (const [field, v] of [["caseForChange", "​"], ["inScope", "⁠⁠"], ["thesisChange", "‏‏"], ["thesisBecause", "ㅤ"], ["transformationName", "​​"]]) {
  const r = await lead.call("PATCH", `${T}/charter`, { [field]: v, changeSummary: "Synthetic invisible field" }, cv.charter.version);
  rec(`R4.invisible-charter-field-rejected:${field}`, "400 validation.blank", `${r.status} ${JSON.stringify(r.body.errors?.map((e) => [e.pointer, e.code]))}`, r.status === 400 && JSON.stringify(r.body.errors ?? []).includes("validation.blank"));
}
const sumInv = await lead.call("PATCH", `${T}/charter`, { inScope: "Synthetic: retail billing.", changeSummary: "​​​" }, cv.charter.version);
rec("R4.invisible-change-summary-rejected", "400 validation.blank on changeSummary", `${sumInv.status} ${JSON.stringify(sumInv.body.errors?.map((e) => [e.pointer, e.code]))}`, sumInv.status === 400);
// Legitimate text that contains marks: an Arabic exclusion with a leading RLM and an emoji ZWJ sequence must be accepted verbatim
const arOos = "‏خارج النطاق: فوترة الجملة 👩‍💻";
const arOk = await lead.call("PATCH", `${T}/charter`, { outOfScope: arOos, changeSummary: "تجريبي: استثناءات" }, cv.charter.version);
cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
const exAr = cv.scopeCheckPrechecks.find((p) => p.code === "exclusions_documented");
rec("R4.visible-arabic-with-marks-accepted-verbatim", "200; stored byte-for-byte; B0041 pre-check pass", `${arOk.status}; verbatim=${cv.charter.outOfScope === arOos}; precheck=${exAr.result}`, arOk.status === 200 && cv.charter.outOfScope === arOos && exAr.result === "pass");
// ROUND 5 (F-DG2-180 / D-065): the wider invisible classes are refused; Arabic text with directional marks is accepted verbatim.
for (const [label, v] of [["VS16 only", "️"], ["VS16+CGJ", "️͏"], ["C0 control U+0001", "\u0001"], ["lone surrogate U+D800", "\uD800"], ["Mongolian FVS1", "᠋"], ["tag LATIN A", "\u{E0041}"], ["Khmer inherent vowel", "឴"], ["RLM+LRM+ALM", "‏‎؜"]]) {
  const r = await lead.call("PATCH", `${T}/charter`, { outOfScope: v, changeSummary: "Synthetic invisible exclusions (R6)" }, cv.charter.version);
  const after = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
  rec(`R5.invisible-oos-rejected:${label}`, label.startsWith("lone surrogate") ? "400 validation.invalid_character at /outOfScope (D-067); version unchanged" : "400 validation.blank at /outOfScope; version unchanged", `${r.status} ${JSON.stringify(r.body.errors?.map((e) => [e.pointer, e.code]))}; v ${cv.charter.version}->${after.charter.version}`, r.status === 400 && JSON.stringify(r.body.errors ?? []).includes(label.startsWith("lone surrogate") ? "validation.invalid_character" : "validation.blank") && after.charter.version === cv.charter.version); // round 8: D-067 refuses a lone surrogate as invalid_character (intended change, F-DG2-260)
}
{
  const RLM = "‏";
  const arFields = {
    transformationName: `${RLM}تحول الفوترة التجريبي${RLM}`,
    caseForChange: `${RLM}تجريبي: أخطاء الفوترة تؤدي إلى فقدان العملاء (٤٫٢٥٪).${RLM}`,
    inScope: `${RLM}تجريبي: فوترة التجزئة${RLM}`,
    outOfScope: `${RLM}تجريبي: فوترة الجملة ؜والمشغلين${RLM}`,
    governanceForum: `${RLM}لجنة التحول التجريبية${RLM}`,
    thesisChange: `${RLM}رحلة الطلب إلى الفاتورة${RLM}`,
    scExclusionsDocumentedEvidence: `${RLM}قائمة الاستثناءات التجريبية ⁧v2⁩${RLM}`,
  };
  const r = await lead.call("PATCH", `${T}/charter`, { ...arFields, changeSummary: `${RLM}تجريبي: نص عربي بعلامات الاتجاه${RLM}` }, cv.charter.version);
  cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
  const diffs = Object.entries(arFields).filter(([k, v]) => cv.charter[k] !== v).map(([k]) => k);
  const vlist = must(await lead.call("GET", `${T}/charter/versions`), 200, "versions");
  const lastSum = vlist.items.map((x) => x.changeSummary).find((x) => x && x.includes("علامات"));
  rec("R5.arabic-rlm-charter-accepted-verbatim", "200; all 7 Arabic fields with RLM/ALM/isolates stored code-point-for-code-point; change summary verbatim in version history; B0041 pre-check pass",
    `${r.status}; mismatched=${JSON.stringify(diffs)}; summaryVerbatim=${lastSum === `${RLM}تجريبي: نص عربي بعلامات الاتجاه${RLM}`}; precheck=${cv.scopeCheckPrechecks.find((p) => p.code === "exclusions_documented").result}`,
    r.status === 200 && diffs.length === 0 && lastSum === `${RLM}تجريبي: نص عربي بعلامات الاتجاه${RLM}` && cv.scopeCheckPrechecks.find((p) => p.code === "exclusions_documented").result === "pass");
  const sqlName = sqlx(`SELECT char_length(transformation_name) || '/' || octet_length(transformation_name) FROM charter WHERE transformation_id = '${tid}'`);
  rec("R5.db-stores-codepoints", "char_length counts characters (UTF8): 22 chars, more octets", sqlName, sqlName.split("/")[0] === String([...arFields.transformationName].length) && Number(sqlName.split("/")[1]) > Number(sqlName.split("/")[0]));
  const ar200 = RLM + "ب".repeat(199);
  const r200 = await lead.call("PATCH", `${T}/charter`, { transformationName: ar200, changeSummary: "تجريبي: اسم من ٢٠٠ حرف" }, cv.charter.version);
  cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
  rec("R5.arabic-200-chars-accepted", "200 for a 200-character Arabic name (401 bytes); stored verbatim", `${r200.status}; verbatim=${cv.charter.transformationName === ar200}; bytes=${Buffer.byteLength(ar200)}`, r200.status === 200 && cv.charter.transformationName === ar200);
  const r201 = await lead.call("PATCH", `${T}/charter`, { transformationName: ar200 + "ب", changeSummary: "تجريبي: اسم من ٢٠١ حرف" }, cv.charter.version);
  rec("R5.arabic-201-chars-refused", "400 (max 200 characters)", `${r201.status} ${JSON.stringify(r201.body.errors?.map((e) => [e.pointer, e.code]))}`, r201.status === 400);
  const emo = await lead.call("PATCH", `${T}/charter`, { outOfScope: "❤️ تجريبي", changeSummary: "Synthetic emoji VS16" }, cv.charter.version);
  cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
  rec("R5.emoji-vs16-visible-accepted", "200 verbatim", `${emo.status} verbatim=${cv.charter.outOfScope === "❤️ تجريبي"}`, emo.status === 200 && cv.charter.outOfScope === "❤️ تجريبي");
  must(await lead.call("PATCH", `${T}/charter`, { transformationName: "Synthetic domain review", changeSummary: "Synthetic restore name" }, cv.charter.version), 200, "restore name");
  cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
}
for (const v of ["-", "N/A", "0"]) {
  const r = await lead.call("PATCH", `${T}/charter`, { outOfScope: v, changeSummary: "Synthetic short visible" }, cv.charter.version);
  cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
  rec(`R4.short-visible-accepted:${v}`, "200 (any visible content is a value; the human scope answer still decides)", `${r.status} precheck=${cv.scopeCheckPrechecks.find((p) => p.code === "exclusions_documented").result}`, r.status === 200);
}
must(await lead.call("PATCH", `${T}/charter`, { outOfScope: null, changeSummary: "Synthetic clear again" }, cv.charter.version), 200, "clear");
cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
// Invisible-only Out of scope planted in the DB around the API: pre-check and G1 must both treat it as absent
for (const [label, lit] of [["ZWSP", "E'\\u200B'"], ["RLM+NBSP", "E'\\u200F\\u00A0'"], ["HANGUL FILLER", "E'\\u3164'"]]) {
  sqlx(`UPDATE charter SET out_of_scope = ${lit}, version = version + 1 WHERE transformation_id = '${tid}'`);
  cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
  const ex = cv.scopeCheckPrechecks.find((p) => p.code === "exclusions_documented");
  const gg = must(await lead.call("GET", `${T}/gates/G1`), 200, "g1 db invisible");
  rec(`R4.db-invisible-oos-absent:${label}`, "precheck attention; G1 initial_charter incomplete", `stored=${JSON.stringify(cv.charter.outOfScope)} precheck=${ex.result}; g1=${ic(gg).completeness}`, ex.result === "attention" && ic(gg).completeness !== "complete");
}
sqlx(`UPDATE charter SET out_of_scope = NULL, version = version + 1 WHERE transformation_id = '${tid}'`);
cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
// Defense in depth: whitespace that reaches the DB around the API (synthetic direct SQL in the disposable DB)
sqlx(`UPDATE charter SET out_of_scope = '   ', version = version + 1 WHERE transformation_id = '${tid}'`);
cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
const exDb = cv.scopeCheckPrechecks.find((p) => p.code === "exclusions_documented");
g1e = must(await lead.call("GET", `${T}/gates/G1`), 200, "g1 db blank");
rec("F-DG2-150.db-blank-fails", "precheck attention and G1 initial_charter incomplete for a whitespace value stored directly", `stored=${JSON.stringify(cv.charter.outOfScope)} precheck=${exDb.result} (${exDb.detail}); g1=${ic(g1e).completeness} ${JSON.stringify(ic(g1e).missing?.map((m) => m.code))}`, exDb.result === "attention" && ic(g1e).completeness !== "complete");
sqlx(`UPDATE charter SET out_of_scope = NULL, version = version + 1 WHERE transformation_id = '${tid}'`);
cv = must(await lead.call("GET", `${T}/charter`), 200, "get charter");
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
{ const it0 = must(await lead.call("GET", `${T}/diagnostic-items/${t01.items[0].id}`), 200, "t01 get");
  const r = await lead.call("PATCH", `${T}/diagnostic-items/${it0.id}`, { currentState: "​‏" }, it0.version);
  rec("R4.invisible-t01-current-state-rejected", "400 validation.blank", `${r.status} ${JSON.stringify(r.body.errors?.map((e) => [e.pointer, e.code]))}`, r.status === 400); }
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
const invNote = await lead.call("POST", `${T}/gates/G1/submissions`, { submissionNote: "​​" }, g1.gate.version);
rec("R4.invisible-submission-note", "400 validation.blank (or note ignored); gate not submitted", `${invNote.status} ${JSON.stringify(invNote.body.errors?.map((e) => [e.pointer, e.code]) ?? invNote.body.code)}`, invNote.status === 400);
const s1 = must(await lead.call("POST", `${T}/gates/G1/submissions`, { submissionNote: "Synthetic G1" }, g1.gate.version), 201, "submit G1");
const selfDecide = await lead.call("POST", `${T}/gates/G1/decision`, { submissionNo: s1.submissionNo ?? 1, outcome: "approved", rationale: "Synthetic self approval" });
rec("REQ-S04-003.submitter-cannot-decide", "403", `${selfDecide.status}`, selfDecide.status === 403);
const invRat = await office.call("POST", `${T}/gates/G1/decision`, { submissionNo: s1.submissionNo ?? 1, outcome: "approved", rationale: "​​​​" });
rec("R4.invisible-decision-rationale-rejected", "400 validation.blank; no decision recorded", `${invRat.status} ${JSON.stringify(invRat.body.errors?.map((e) => [e.pointer, e.code]))}`, invRat.status === 400);
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
const invReason = await lead.call("POST", `${T}/outcomes/${launch.id}/archive`, { reason: "​​​​" }, launch.version);
rec("R4.invisible-archive-reason-rejected", "400 validation.blank", `${invReason.status} ${JSON.stringify(invReason.body.errors?.map((e) => [e.pointer, e.code]))}`, invReason.status === 400);
const invOutcome = await lead.call("POST", `${T}/outcomes`, { statement: "⁠ㅤ" });
rec("R4.invisible-outcome-rejected", "400", `${invOutcome.status}`, invOutcome.status === 400);
const invGr = await lead.call("POST", `${T}/strategic-guardrails`, { title: "​", category: "cx", statement: "Synthetic." });
rec("R4.invisible-guardrail-title-rejected", "400", `${invGr.status}`, invGr.status === 400);
const invNs = await lead.call("PUT", `${T}/north-star`, { statement: "‏‏" }, (await lead.call("GET", `${T}/north-star`)).body.version);
rec("R4.invisible-north-star-rejected", "400", `${invNs.status}`, invNs.status === 400);
must(await lead.call("POST", `${T}/outcomes/${launch.id}/archive`, { reason: "Synthetic: reworded" }, launch.version), 200, "archive launch");
{ const arStmt = "‏تجريبي: فواتير صحيحة من المرة الأولى‏";
  const ao = await lead.call("POST", `${T}/outcomes`, { statement: arStmt });
  rec("R5.arabic-rlm-outcome-verbatim", "201; statement stored verbatim", `${ao.status} verbatim=${ao.body.statement === arStmt}`, ao.status === 201 && ao.body.statement === arStmt);
  const arc = await lead.call("POST", `${T}/outcomes/${ao.body.id}/archive`, { reason: "‏تجريبي: مكرر‏" }, ao.body.version);
  rec("R5.arabic-rlm-archive-reason", "200 (Arabic reason with RLM is content)", `${arc.status}`, arc.status === 200);
  const ns = (await lead.call("GET", `${T}/north-star`)).body;
  const arNs = "‏كل فاتورة تجريبية صحيحة من المرة الأولى‏";
  const nsr = await lead.call("PUT", `${T}/north-star`, { statement: arNs }, ns.version);
  const nsNow = (await lead.call("GET", `${T}/north-star`)).body;
  rec("R5.arabic-rlm-north-star-verbatim", "200/201; current statement verbatim", `${nsr.status} verbatim=${nsNow.statement === arNs} status=${nsNow.status}`, (nsr.status === 200 || nsr.status === 201) && nsNow.statement === arNs);
  must(await lead.call("PUT", `${T}/north-star`, { statement: "Every synthetic bill is right first time, every month" }, nsNow.version), 200, "restore ns"); }

const gr = must(await lead.call("POST", `${T}/strategic-guardrails`, { title: "Synthetic: no tariff rise", category: "cx", statement: "Synthetic: must not raise retail tariffs." }), 201, "guardrail");
rec("REQ-PB-037.guardrail-category", "persisted with category", `${gr.category}`, gr.category === "cx");
const ok2now = must(await lead.call("GET", `${T}/outcome-kpis/${ok2.id}`), 200, "t02 get");
const ta = await office.call("POST", `${T}/outcome-kpis/${ok2.id}/trajectory-approval`, { note: "Synthetic demo approval" }, ok2now.version);
console.log("trajectory", ta.status, JSON.stringify(ta.body).slice(0, 200));
cv = must(await lead.call("GET", `${T}/charter`), 200, "charter");
must(await lead.call("PATCH", `${T}/charter`, { northStarId: (await lead.call("GET", `${T}/north-star`)).body.id, thesisChange: "the order-to-bill journey", thesisOutcomes: "first-time-right bills", thesisBenefits: "a lower cost to serve", thesisBecause: "rework drives cost", changeSummary: "Synthetic thesis" }, cv.charter.version), 200, "thesis");
cv = must(await lead.call("GET", `${T}/charter`), 200, "charter");
// ROUND 4: thesis composed from four parts (B0037); an invisible-only part planted in the DB makes it incomplete
rec("R4.thesis-composed", "thesis complete; composed sentence contains all four parts", `warnings=${JSON.stringify(cv.warnings.map((w) => w.code))}; parts=${JSON.stringify([cv.charter.thesisChange, cv.charter.thesisOutcomes, cv.charter.thesisBenefits, cv.charter.thesisBecause])}`, !cv.warnings.some((w) => w.code === "charter.thesis_incomplete"));
sqlx(`UPDATE charter SET thesis_benefits = E'\\u200B\\u2060' WHERE transformation_id = '${tid}'`);
cv = must(await lead.call("GET", `${T}/charter`), 200, "charter");
rec("R4.thesis-invisible-part-incomplete", "charter.thesis_incomplete warning for an invisible-only benefits part", `${JSON.stringify(cv.warnings.map((w) => w.code))} stored benefits=${JSON.stringify(cv.charter.thesisBenefits)}`, cv.warnings.some((w) => w.code === "charter.thesis_incomplete"));
sqlx(`UPDATE charter SET thesis_benefits = 'a lower cost to serve' WHERE transformation_id = '${tid}'`);
cv = must(await lead.call("GET", `${T}/charter`), 200, "charter");
rec("R4.thesis-restored-complete", "no thesis_incomplete after restoring visible text", JSON.stringify(cv.warnings.map((w) => w.code)), !cv.warnings.some((w) => w.code === "charter.thesis_incomplete"));
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
rec("REQ-PB-041.ten-boxes", "10 canvas cells in B0062 order", `${canvas.cells.length} ${JSON.stringify(canvas.cells.map((c) => c.cell.dimensionCode))}`, canvas.cells.length === 10);
const firstDim = canvas.cells[0].cell.dimensionCode;
const dvOld = await lead.call("GET", `${T}/tom/dimensions/${firstDim}`);
const dv = await lead.call("GET", `${T}/tom-canvas/${firstDim}`);
rec("F-DG2-152.register-contract", "GET tom-canvas/{dim} 200 with cell/dimension/gaps/decisions/dependencies/evidence; old register path 404", `new=${dv.status} keys=${JSON.stringify(Object.keys(dv.body ?? {}))}; old=${dvOld.status}`, dv.status === 200 && dvOld.status === 404);
// G3 walk (Design)
for (const c of canvas.cells) {
  const cur = must(await lead.call("GET", `${T}/tom-canvas/${c.cell.dimensionCode}`), 200, "cell");
  const notReady = await lead.call("PATCH", `${T}/tom-canvas/${c.cell.dimensionCode}`, { status: "ready" }, cur.cell.version);
  if (c === canvas.cells[0]) rec("REQ-PB-041.ready-needs-target-owner", "422 when marking ready without target design/owner", `${notReady.status}`, notReady.status === 422 || notReady.status === 400);
  const cur2 = must(await lead.call("GET", `${T}/tom-canvas/${c.cell.dimensionCode}`), 200, "cell");
  must(await lead.call("PATCH", `${T}/tom-canvas/${c.cell.dimensionCode}`, { currentDesign: "Synthetic current.", targetDesign: "Synthetic target.", ownerUserId: U.lead, status: "ready" }, cur2.cell.version), 200, "cell ready");
}
let g3v = must(await lead.call("GET", `${T}/gates/G3`), 200, "g3");
console.log("G3 criteria (canvas only)", JSON.stringify(g3v.criteria.map((c) => [c.key, c.completeness, c.missing?.map((m) => m.code)])));
const g3early = await lead.call("POST", `${T}/gates/G3/submissions`, { submissionNote: "Synthetic incomplete G3" }, g3v.gate.version);
rec("REQ-S04-005.g3-incomplete-blocked", "422 while gap matrix/capability/journey missing", `${g3early.status} ${JSON.stringify(g3early.body.errors?.map((e) => e.pointer))}`, g3early.status === 422);
const blankGap = await lead.call("POST", `${T}/tom-gaps`, { dimensionCode: firstDim, gap: "   " });
rec("D-063.blank-gap-rejected", "400 validation.blank", `${blankGap.status}`, blankGap.status === 400);
must(await lead.call("POST", `${T}/tom-gaps`, { dimensionCode: firstDim, currentState: "Synthetic manual.", targetState: "Synthetic automated.", gap: "Synthetic automation gap.", ownerUserId: U.lead }), 201, "gap");
must(await lead.call("POST", `${T}/capability-heatmap`, { name: "Synthetic billing analytics", dimensionCode: "data_analytics", currentLevel: 2, targetLevel: 4, sourcingNeed: "build", ownerUserId: U.lead }), 201, "capability");
must(await lead.call("POST", `${T}/journeys`, { name: "Synthetic order-to-bill (future)", kind: "journey", state: "future", status: "active", ownerUserId: U.lead }), 201, "journey");
g3v = must(await lead.call("GET", `${T}/gates/G3`), 200, "g3");
console.log("G3 criteria (after)", JSON.stringify(g3v.criteria.map((c) => [c.key, c.completeness, c.missing?.map((m) => m.code)])));
const s3b = await lead.call("POST", `${T}/gates/G3/submissions`, { submissionNote: "Synthetic G3" }, g3v.gate.version);
console.log("submit G3", s3b.status, JSON.stringify(s3b.body).slice(0, 300));
if (s3b.status === 201) {
  // round 8 (D-067): a lone surrogate in the rationale is refused and the gate stays undecided
  const d3bad = await office.call("POST", `${T}/gates/G3/decision`, { submissionNo: s3b.body.submissionNo ?? 1, outcome: "approved", rationale: "Synthetic \ud800 approval" });
  const g3pend = must(await lead.call("GET", `${T}/gates/G3`), 200, "g3 after bad");
  rec("R7.gate-rationale-lone-surrogate", "400 validation.invalid_character at /rationale; G3 not approved", `${d3bad.status} ${JSON.stringify(d3bad.body.errors?.map((e) => [e.pointer, e.code]))} status=${g3pend.gate.status}`, d3bad.status === 400 && JSON.stringify((d3bad.body.errors ?? []).map((e) => [e.pointer, e.code])) === '[["/rationale","validation.invalid_character"]]' && g3pend.gate.status !== "approved");
  // emoji straddling the 8000-unit cut of decision.outcome_text ("approved: " is 10 units; 10 + 7989 = 7999)
  const rat3pre = "Synthetic demo approval (no real business approval). ";
  const rat3 = rat3pre + "x".repeat(7989 - rat3pre.length) + "😀" + "y".repeat(9);
  const d3 = await office.call("POST", `${T}/gates/G3/decision`, { submissionNo: s3b.body.submissionNo ?? 1, outcome: "approved", rationale: rat3 });
  const dl3 = must(await lead.call("GET", `/api/v1/decisions?transformationId=${tid}`), 200, "decisions");
  const ots = (dl3.items ?? []).map((x) => x.outcomeText ?? "").filter((x) => x.includes("😀") || x.endsWith("x"));
  const ot3 = ots.find((x) => x.length >= 7990) ?? "";
  rec("R7.gate-outcome-text-codepoint-cut", "rationale length 8000 accepted; decision log outcome_text = 7999 units ending before the emoji, no U+FFFD, no lone surrogate", `rationaleLen=${rat3.length} d3=${d3.status} decisions=${(dl3.items ?? []).length} len=${ot3.length} tail=${JSON.stringify(ot3.slice(-3))} fffd=${ot3.includes("\uFFFD")} lone=${/\p{Cs}/u.test(ot3)}`, rat3.length === 8000 && ot3.length === 7999 && ot3.endsWith("x") && !ot3.includes("\uFFFD") && !/\p{Cs}/u.test(ot3));
  const tt = must(await lead.call("GET", T), 200, "t");
  rec("LIVE.G3-decision", "approved; phase design->mobilize", `${d3.status}; phase=${tt.currentPhase ?? tt.phase}`, (d3.status === 201 || d3.status === 200) && (tt.currentPhase ?? tt.phase) === "mobilize");
} else rec("LIVE.G3-decision", "G3 submitted and approved", `submit ${s3b.status}`, false);
const glEnd = must(await lead.call("GET", `${T}/gates`), 200, "gates end");
console.log("GATES END", JSON.stringify(glEnd.items.map((g) => [g.definition.code, g.gate.status])));
// DG gates untouched invariant: no transformation/product endpoint mentions DG
rec("INV.product-gates-only", "gate codes G1..G6 only", JSON.stringify(gl.items.map((g) => g.definition.code)), gl.items.map((g) => g.definition.code).join() === "G1,G2,G3,G4,G5,G6");
console.log("SUMMARY", JSON.stringify({ pass: results.filter((r) => r.result === "PASS").length, fail: results.filter((r) => r.result === "FAIL").map((r) => r.id) }));
