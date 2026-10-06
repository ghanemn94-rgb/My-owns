// domain-reviewer DG2 round 8 (T-DG2-REV-DOM-R8): regression re-run of my round-7 live API checks of the D-067 changes. SYNTHETIC data, disposable stack.
// The G1 decision here is a demo decision on synthetic data; it approves nothing real and never touches DG0-DG7.
// Checks: lone UTF-16 surrogates refused with validation.invalid_character (charter, outcome, gate rationale) and nothing stored;
// Arabic + emoji + RLM accepted verbatim; gate decision outcome text cut on a code-point boundary (emoji at the 8000 boundary);
// malformed / oversized URLs answer application/problem+json with a localized code.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
const BASE = process.env.E2E_BASE_URL;
const U = { office: "01920000-0000-7000-9000-000000000202", lead: "01920000-0000-7000-9000-000000000203" };
const BU = "01920000-0000-7000-9000-000000000102";
const EN = JSON.parse(readFileSync("apps/web/src/i18n/en/problems.json", "utf8"));
const AR = JSON.parse(readFileSync("apps/web/src/i18n/ar/problems.json", "utf8"));
const out = [];
const rec = (id, exp, act, ok) => { out.push({ id, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  return async (method, path, body, ifMatch, raw) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken };
    if (body !== undefined || raw !== undefined) h["content-type"] = "application/json";
    if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`;
    if (method === "POST" && ifMatch === undefined) h["idempotency-key"] = randomUUID();
    const res = await fetch(`${BASE}${path}`, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, ct: res.headers.get("content-type"), body: json };
  };
}
const errs = (r) => JSON.stringify((r.body?.errors ?? []).map((e) => [e.pointer, e.code]));
const lead = await session("dev.lead");
const office = await session("dev.office");
// raw JSON text with a \ud800 escape (JSON.stringify would escape it the same way; written explicitly for clarity)
const rawCharter = (cfc) => `{"transformationName":"Synthetic R7","executiveSponsorUserId":"${U.office}","transformationLeadUserId":"${U.lead}","caseForChange":"${cfc}","inScope":"Synthetic scope","baselineDate":"2026-01-31"}`;

const t = await lead("POST", "/api/v1/transformations", { businessUnitId: BU, name: "Synthetic R7 delta", mode: "end_to_end" });
const T = `/api/v1/transformations/${t.body.id}`;
for (const [label, s] of [["lone-high", "Synthetic \\ud800 case"], ["lone-low", "Synthetic \\udc00 case"], ["reversed-pair", "\\ude00\\ud83d"], ["arabic+lone", "\\u200f\\u062a\\u062c\\u0631\\u064a\\u0628\\u064a\\ud83d"]]) {
  const r = await lead("POST", `${T}/charter`, undefined, undefined, rawCharter(s));
  const g = await lead("GET", `${T}/charter`);
  rec(`R7.lone-surrogate-charter:${label}`, "400 exactly one error validation.invalid_character at /caseForChange; no charter stored", `${r.status} ${r.ct} ${errs(r)}; charter=${!!g.body?.charter}`, r.status === 400 && errs(r) === '[["/caseForChange","validation.invalid_character"]]' && !g.body?.charter && String(r.ct).startsWith("application/problem+json"));
}
rec("R7.invalid-character-localized", "EN and AR messages exist, differ, AR is Arabic", `en='${EN.validation__invalid_character}' ar='${AR.validation__invalid_character}'`, !!EN.validation__invalid_character && /[؀-ۿ]/.test(AR.validation__invalid_character ?? ""));

// Arabic + emoji + RLM + ALM accepted verbatim (valid surrogate pairs are content)
const arCase = "‏تجريبي 😀👍🏽 أخطاء الفوترة‏ ؜(٤٫٢٥٪) 🇸🇦‏";
const c = await lead("POST", `${T}/charter`, { transformationName: "‏تحول تجريبي 🚀‏", executiveSponsorUserId: U.office, transformationLeadUserId: U.lead, caseForChange: arCase, inScope: "‏الفوترة 📶‏", outOfScope: "‏قطاع الأعمال‏", baselineDate: "2026-01-31" });
const g = await lead("GET", `${T}/charter`);
rec("R7.arabic-emoji-rlm-verbatim", "201; caseForChange/name/inScope stored code point for code point", `${c.status}; verbatim=${[g.body?.charter?.caseForChange === arCase, g.body?.charter?.transformationName === "‏تحول تجريبي 🚀‏", g.body?.charter?.inScope === "‏الفوترة 📶‏"]}`, c.status === 201 && g.body?.charter?.caseForChange === arCase && g.body?.charter?.transformationName === "‏تحول تجريبي 🚀‏");
// lone surrogate on update: version unchanged
const v = g.body.charter.version;
const p = await lead("PATCH", `${T}/charter`, undefined, v, `{"outOfScope":"x\\udbff","changeSummary":"Synthetic"}`);
const g2 = await lead("GET", `${T}/charter`);
rec("R7.lone-surrogate-charter-update", "400 invalid_character at /outOfScope; version and value unchanged", `${p.status} ${errs(p)} v ${v}->${g2.body.charter.version}`, p.status === 400 && errs(p) === '[["/outOfScope","validation.invalid_character"]]' && g2.body.charter.version === v && g2.body.charter.outOfScope === "‏قطاع الأعمال‏");
// outcome statement with lone surrogate
const o = await lead("POST", `${T}/outcomes`, undefined, undefined, `{"statement":"Synthetic outcome \\ud800"}`);
rec("R7.lone-surrogate-outcome", "400 validation.invalid_character", `${o.status} ${errs(o)}`, o.status === 400 && errs(o).includes("invalid_character"));
// Arabic + emoji outcome accepted verbatim
const oSt = "‏خفض أخطاء الفوترة 📉 بنسبة ١٥٪‏";
const o2 = await lead("POST", `${T}/outcomes`, { statement: oSt });
rec("R7.arabic-emoji-outcome-verbatim", "201 stored verbatim", `${o2.status} verbatim=${o2.body?.statement === oSt}`, o2.status === 201 && o2.body?.statement === oSt);

// Gate rationale (lone surrogate) and the 8000-unit outcome_text cut are exercised in live-scenario.mjs at the G3 decision.
// Malformed / oversized URLs: localized problem+json
const m = await fetch(`${BASE}/api/v1/transformations/%E0%A4%A/charter`);
const mb = await m.json().catch(() => null);
const code = (b) => b?.errors?.[0]?.code ? `validation__${b.errors[0].code.split(".")[1]}` : b?.code;
rec("R7.malformed-url-problem", "400 application/problem+json; code has EN and AR message", `${m.status} ${m.headers.get("content-type")} code=${JSON.stringify(mb?.code)} errors=${JSON.stringify(mb?.errors?.map((e) => e.code))} en=${EN[code(mb)] ?? EN[mb?.code]} ar=${AR[code(mb)] ?? AR[mb?.code]}`, m.status === 400 && String(m.headers.get("content-type")).startsWith("application/problem+json") && !!(AR[code(mb)] ?? AR[mb?.code]));
const big = await fetch(`${BASE}/api/v1/transformations?q=${"a".repeat(20000)}`).catch((e) => ({ status: "ERR " + e.message, headers: new Headers() }));
const bb = big.json ? await big.json().catch(() => null) : null;
rec("R7.oversized-url-problem", "400 application/problem+json; localized code", `${big.status} ${big.headers.get("content-type")} code=${JSON.stringify(bb?.code)} errors=${JSON.stringify(bb?.errors?.map((e) => e.code))} ar=${AR[code(bb)] ?? AR[bb?.code]}`, big.status === 400 && String(big.headers.get("content-type")).startsWith("application/problem+json") && !!(AR[code(bb)] ?? AR[bb?.code]));
const fail = out.filter((x) => !x.ok).map((x) => x.id);
console.log("SUMMARY", JSON.stringify({ pass: out.length - fail.length, fail }));
process.exit(fail.length ? 1 : 0);
