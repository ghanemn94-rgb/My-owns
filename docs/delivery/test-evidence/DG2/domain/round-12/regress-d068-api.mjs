// domain-reviewer DG2 round 8 (T-DG2-REV-DOM-R8): live API checks of the D-068 changes from the domain/bilingual angle.
// SYNTHETIC data, disposable stack. Nothing here is a real business decision and nothing touches DG0-DG7.
// Checks: raw UTF-8 bytes of Arabic + emoji + RLM/LRM/ZWJ accepted verbatim (Content-Length and chunked); one leading BOM
// accepted; invalid UTF-8 / CESU-8 body bytes refused 400 validation.json with nothing stored and a localized EN/AR message;
// Arabic search text in the query string (percent-encoded, '+' as space, literal %2B) still finds the transformation;
// an undecodable query component is refused 400 validation.format at /query/q with a localized EN/AR message;
// invisible-only charter values are still refused with validation.blank (localized EN/AR).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
const BASE = process.env.E2E_BASE_URL;
const U = { office: "01920000-0000-7000-9000-000000000202", lead: "01920000-0000-7000-9000-000000000203" };
const BU = "01920000-0000-7000-9000-000000000102";
const EN = JSON.parse(readFileSync("apps/web/src/i18n/en/problems.json", "utf8"));
const AR = JSON.parse(readFileSync("apps/web/src/i18n/ar/problems.json", "utf8"));
const out = [];
const rec = (id, exp, act, ok) => { out.push({ id, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "dev.lead" }) });
const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
const hdr = (extra = {}) => ({ cookie, origin: BASE, "x-csrf-token": me.csrfToken, ...extra });
const call = async (method, path, body, ifMatch) => {
  const h = hdr(body !== undefined ? { "content-type": "application/json" } : {});
  if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`;
  if (method === "POST" && ifMatch === undefined) h["idempotency-key"] = randomUUID();
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, ct: res.headers.get("content-type"), body: json };
};
// Raw-byte POST through node:http so the exact bytes reach the server (chunked when chunked=true).
const rawPost = (path, bytes, chunked = false) => new Promise((resolve, reject) => {
  const u = new URL(BASE + path);
  const headers = hdr({ "content-type": "application/json", "idempotency-key": randomUUID() });
  if (!chunked) headers["content-length"] = String(bytes.length);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers }, (res) => {
    const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8"); let json; try { json = JSON.parse(text); } catch { json = text; }
      resolve({ status: res.statusCode, ct: res.headers["content-type"], body: json });
    });
  });
  req.on("error", reject);
  if (chunked) { req.write(bytes.subarray(0, 7)); req.end(bytes.subarray(7)); } else req.end(bytes);
});
const errs = (x) => JSON.stringify((x.body?.errors ?? []).map((e) => [e.pointer, e.code]));
const loc = (code) => `en='${EN[code]}' ar='${AR[code]}'`;
const isArabic = (s) => /[؀-ۿ]/.test(s ?? "");

const mk = async (name) => (await call("POST", "/api/v1/transformations", { businessUnitId: BU, name, mode: "end_to_end" })).body;
const charterJson = (cfc) => ({ transformationName: "Synthetic R8", executiveSponsorUserId: U.office, transformationLeadUserId: U.lead, caseForChange: cfc, inScope: "نطاق تجريبي", baselineDate: "2026-01-31" });

// 1. Arabic + emoji + RLM/LRM/ZWJ as raw UTF-8 bytes, Content-Length and chunked
const arText = "‏حالة التغيير: أخطاء الفوترة تزيد التسرب 📉 ‎(SAR 1,250.50)‏ 👩‍💼";
for (const chunked of [false, true]) {
  const t = await mk(`Synthetic R8 bytes ${chunked ? "chunked" : "length"}`);
  const res = await rawPost(`/api/v1/transformations/${t.id}/charter`, Buffer.from(JSON.stringify(charterJson(arText)), "utf8"), chunked);
  const g = await call("GET", `/api/v1/transformations/${t.id}/charter`);
  const stored = g.body?.charter?.caseForChange;
  rec(`R8.arabic-emoji-rlm-raw-utf8:${chunked ? "chunked" : "content-length"}`, "201; caseForChange stored code point for code point (RLM/LRM/ZWJ/emoji kept)", `${res.status}; verbatim=${stored === arText}; cps=${[...(stored ?? "")].length}/${[...arText].length}`, res.status === 201 && stored === arText);
}
// 2. One leading BOM accepted
{
  const t = await mk("Synthetic R8 BOM");
  const res = await rawPost(`/api/v1/transformations/${t.id}/charter`, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(charterJson(arText)), "utf8")]));
  rec("R8.leading-bom-accepted", "201", `${res.status} ${errs(res)}`, res.status === 201);
}
// 3. Invalid UTF-8 bytes inside an Arabic value: refused, nothing stored, localized
for (const [label, bad] of [["xFF", [0xff]], ["truncated-arabic", [0xd8]], ["cesu8-surrogate", [0xed, 0xa0, 0x80]], ["overlong-slash", [0xc0, 0xaf]]]) {
  for (const chunked of [false, true]) {
    const t = await mk(`Synthetic R8 bad ${label}`);
    const [pre, post] = JSON.stringify(charterJson("حالة XX التغيير")).split("XX");
    const body = Buffer.concat([Buffer.from(pre, "utf8"), Buffer.from(bad), Buffer.from(post, "utf8")]);
    const res = await rawPost(`/api/v1/transformations/${t.id}/charter`, body, chunked);
    const g = await call("GET", `/api/v1/transformations/${t.id}/charter`);
    const code = res.body?.code ?? res.body?.errors?.[0]?.code;
    rec(`R8.invalid-utf8-body:${label}:${chunked ? "chunked" : "content-length"}`, "400 problem+json validation.json; no charter stored; EN/AR message", `${res.status} ${res.ct} code=${code} errors=${errs(res)} charter=${g.status === 200 && !!g.body?.charter}`,
      res.status === 400 && String(res.ct).startsWith("application/problem+json") && JSON.stringify(res.body).includes("validation.json") && !(g.status === 200 && g.body?.charter));
  }
}
rec("R8.validation-json-localized", "EN and AR messages exist and AR is Arabic", loc("validation__json"), !!EN.validation__json && isArabic(AR.validation__json));

// 4. Arabic search through the query string (what the web client's URLSearchParams sends)
const arName = "تحويل الفوترة التجريبي R8 + اختبار";
const ta = await mk(arName);
const qs = new URLSearchParams({ q: "الفوترة التجريبي" }).toString(); // spaces become '+'
const s1 = await call("GET", `/api/v1/transformations?${qs}`);
const hit1 = (s1.body?.items ?? []).some((x) => x.id === ta.id);
rec("R8.query-arabic-plus-space", "200 and the Arabic-named transformation is found", `${s1.status} qs=${qs.slice(0, 60)}… found=${hit1}`, s1.status === 200 && hit1);
const s2 = await call("GET", `/api/v1/transformations?q=${encodeURIComponent("R8 + اختبار")}`);
const hit2 = (s2.body?.items ?? []).some((x) => x.id === ta.id);
rec("R8.query-literal-plus-%2B", "200; %2B decodes to a literal '+' and still matches", `${s2.status} found=${hit2}`, s2.status === 200 && hit2);
const s3 = await call("GET", `/api/v1/transformations?q=${encodeURIComponent("‏الفوترة")}`);
rec("R8.query-rlm-prefixed", "200 (RLM is valid text, not refused as undecodable)", `${s3.status} ${errs(s3)}`, s3.status === 200);
// 5. Undecodable query component: refused, localized
for (const [label, raw] of [["xFF", "%FF"], ["cesu8", "%ED%A0%80"], ["truncated-arabic", "%D8"]]) {
  const s = await call("GET", `/api/v1/transformations?q=${raw}`);
  rec(`R8.query-undecodable:${label}`, "400 problem+json validation.format at /query/q", `${s.status} ${s.ct} ${errs(s)}`, s.status === 400 && String(s.ct).startsWith("application/problem+json") && errs(s).includes('["/query/q","validation.format"]'));
}
rec("R8.validation-format-localized", "EN and AR messages exist and AR is Arabic", loc("validation__format"), !!EN.validation__format && isArabic(AR.validation__format));

// 6. Invisible-only value still refused (localized), not rewritten
{
  const t = await mk("Synthetic R8 invisible");
  const res = await rawPost(`/api/v1/transformations/${t.id}/charter`, Buffer.from(JSON.stringify(charterJson("‏‎​  "))));
  rec("R8.invisible-only-refused", "400 validation.blank at /caseForChange", `${res.status} ${errs(res)}`, res.status === 400 && errs(res).includes('["/caseForChange","validation.blank"]'));
}
rec("R8.validation-blank-localized", "EN and AR messages exist and AR is Arabic", loc("validation__blank"), !!EN.validation__blank && isArabic(AR.validation__blank));

const fail = out.filter((x) => !x.ok).map((x) => x.id);
console.log("SUMMARY", JSON.stringify({ pass: out.length - fail.length, fail }));
process.exit(fail.length ? 1 : 0);
