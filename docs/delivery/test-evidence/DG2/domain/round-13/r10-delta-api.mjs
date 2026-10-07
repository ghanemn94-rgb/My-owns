// domain-reviewer DG2 round 10 (T-DG2-REV-DOM-R10): live API checks of the D-070 media-type change from the domain angle.
// SYNTHETIC data, disposable stack. Nothing here is a real business decision and nothing touches DG0-DG7.
// Checks: unknown addresses answer 404 not_found for every media type; the upload refusal names application/octet-stream
// and the JSON-operation refusal names application/json; OWS/HTAB before ';' is accepted on both (bytes and Arabic verbatim);
// a non-UTF-8 charset on JSON is refused with nothing stored; duplicate Content-Type lines are refused; localized
// validation.content_type message in EN and AR; the web client still sends application/json and application/octet-stream.
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL;
const U = { office: "01920000-0000-7000-9000-000000000202", lead: "01920000-0000-7000-9000-000000000203" };
const BU = "01920000-0000-7000-9000-000000000102";
const EN = JSON.parse(readFileSync("apps/web/src/i18n/en/problems.json", "utf8"));
const AR = JSON.parse(readFileSync("apps/web/src/i18n/ar/problems.json", "utf8"));
const out = [];
const rec = (id, exp, act, ok) => { out.push({ id, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const psql = (q) => execFileSync("psql", [process.env.PSQL_MTH, "-qAtc", q], { encoding: "utf8" }).trim();
const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "dev.lead" }) });
const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
const hdr = (extra = {}) => ({ cookie, origin: BASE, "x-csrf-token": me.csrfToken, ...extra });
const call = async (method, path, body, extra = {}) => {
  const h = hdr(body !== undefined ? { "content-type": "application/json", ...extra } : extra);
  if (method === "POST" && !h["if-match"]) h["idempotency-key"] = randomUUID();
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await res.arrayBuffer()); let json; try { json = JSON.parse(buf.toString("utf8")); } catch { json = null; }
  return { status: res.status, headers: res.headers, buf, body: json };
};
// Raw HTTP/1.1 over a socket so header bytes (HTAB, duplicate lines) go out exactly as written.
const raw = (path, headerLines, bytes) => new Promise((resolve, reject) => {
  const u = new URL(BASE);
  const s = net.connect(Number(u.port), u.hostname);
  const base = [`POST ${path} HTTP/1.1`, `Host: ${u.host}`, `Cookie: ${cookie}`, `Origin: ${BASE}`, `X-CSRF-Token: ${me.csrfToken}`, `Content-Length: ${bytes.length}`, "Connection: close", ...headerLines];
  const chunks = [];
  s.on("data", (c) => chunks.push(c)); s.on("error", reject);
  s.on("close", () => {
    const all = Buffer.concat(chunks).toString("utf8"); const status = Number(all.split(" ")[1]);
    const bodyText = all.slice(all.indexOf("\r\n\r\n") + 4); let json = null;
    const m = bodyText.match(/\{[\s\S]*\}/); if (m) { try { json = JSON.parse(m[0]); } catch {} }
    resolve({ status, body: json, head: all.slice(0, all.indexOf("\r\n\r\n")) });
  });
  s.write(Buffer.concat([Buffer.from(base.join("\r\n") + "\r\n\r\n", "latin1"), bytes]));
});
const sha = (b) => createHash("sha256").update(b).digest("hex");
const code = (x) => JSON.stringify((x.body?.errors ?? []).map((e) => e.code).concat(x.body?.code ? [x.body.code] : []));

// 1. Unknown addresses: 404 not_found for every media type (F-DG2-350)
for (const ct of ["application/octet-stream", "text/plain", "application/json", "application/json\t; charset=utf-8"]) {
  const res = await raw("/api/v1/no-such-address/xyz", [`Content-Type: ${ct}`], Buffer.from("payload"));
  rec(`R10.unknown-address-404:${JSON.stringify(ct)}`, "404 not_found", `${res.status} ${code(res)}`, res.status === 404 && /not_found/.test(code(res) + JSON.stringify(res.body)));
}
const t = (await call("POST", "/api/v1/transformations", { businessUnitId: BU, name: "Synthetic R10 media types", mode: "end_to_end" })).body;
const T = `/api/v1/transformations/${t.id}`;
const ev = (await call("POST", `${T}/evidence`, { kind: "file", title: "Synthetic R10 baseline extract", ownerUserId: U.lead })).body;
const E = `${T}/evidence/${ev.id}`;
const revisions = () => Number(psql(`select count(*) from evidence_content where evidence_id='${ev.id}'`));
// 2. Upload: HTAB/SP before ';' accepted, bytes unchanged, Arabic file name kept
const bytes = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.from("‏تقرير خط الأساس 📊", "utf8")]);
const fileName = "خط-الأساس R10 ‏📊.xlsx";
let version = ev.version;
for (const ct of ["application/octet-stream\t; x=1", "application/octet-stream ;x=\"a b\""]) {
  const up = await raw(`${E}/content`, [`Content-Type: ${ct}`, `X-File-Name: ${encodeURIComponent(fileName)}`, `If-Match: "${version}"`], bytes);
  version = up.body?.version ?? version;
  const dl = await call("GET", `${E}/content`);
  rec(`R10.upload-ows-accepted:${JSON.stringify(ct)}`, "200; download byte-identical; Arabic file name kept", `${up.status} fileName=${JSON.stringify(up.body?.fileName)}; ${dl.buf.length}/${bytes.length} bytes sha ${sha(dl.buf).slice(0, 16)} vs ${sha(bytes).slice(0, 16)}`, up.status === 200 && dl.status === 200 && Buffer.compare(dl.buf, bytes) === 0 && up.body?.fileName === fileName);
}
// 3. Upload refusal names octet-stream (F-DG2-351), nothing stored
const before = revisions();
for (const ct of ["text/plain", "application/json\t; charset=utf-8", "application/json"]) {
  const res = await raw(`${E}/content`, [`Content-Type: ${ct}`, `X-File-Name: x.bin`, `If-Match: "${version}"`], Buffer.from('{"a":1}'));
  rec(`R10.upload-refusal-detail:${JSON.stringify(ct)}`, "400 validation.content_type; detail names application/octet-stream only; no revision", `${res.status} ${code(res)} detail=${JSON.stringify(res.body?.detail ?? res.body?.errors?.[0]?.detail)}; revisions ${before}->${revisions()}`, res.status === 400 && /validation\.content_type/.test(JSON.stringify(res.body)) && /application\/octet-stream/.test(JSON.stringify(res.body)) && !/application\/json/.test(JSON.stringify(res.body)) && revisions() === before);
}
// 4. Duplicate Content-Type lines refused
{
  const res = await raw(`${E}/content`, ["Content-Type: application/octet-stream", "Content-Type: text/plain", `X-File-Name: x.bin`, `If-Match: "${version}"`], bytes);
  rec("R10.upload-duplicate-content-type", "400 validation.content_type; no revision", `${res.status} ${code(res)}; revisions ${before}->${revisions()}`, res.status === 400 && /validation\.content_type/.test(JSON.stringify(res.body)) && revisions() === before);
}
// 5. JSON charter: refusal names application/json; non-UTF-8 charset refused; OWS before ';' accepted, Arabic+emoji+RLM verbatim
const arText = "‏حالة التغيير: أخطاء الفوترة تزيد التسرب 📉 ‎(SAR 1,250.50)‏ 👩‍💼";
const charter = { transformationName: "Synthetic R10", executiveSponsorUserId: U.office, transformationLeadUserId: U.lead, caseForChange: arText, inScope: "نطاق تجريبي", baselineDate: "2026-01-31" };
const body = Buffer.from(JSON.stringify(charter), "utf8");
for (const ct of ["application/octet-stream", "application/json; charset=iso-8859-1", "application/json; charset=\"windows-1256\""]) {
  const res = await raw(`${T}/charter`, [`Content-Type: ${ct}`, `Idempotency-Key: ${randomUUID()}`], body);
  const g = await call("GET", `${T}/charter`);
  rec(`R10.charter-refused:${JSON.stringify(ct)}`, "400 validation.content_type naming application/json; GET charter 404", `${res.status} ${code(res)} detail=${JSON.stringify(res.body?.detail)}; GET ${g.status}`, res.status === 400 && /validation\.content_type/.test(JSON.stringify(res.body)) && /application\/json/.test(JSON.stringify(res.body)) && g.status === 404);
}
{
  const res = await raw(`${T}/charter`, [`Content-Type: application/json\t;\tcharset="UTF-8"`, `Idempotency-Key: ${randomUUID()}`], body);
  const g = await call("GET", `${T}/charter`);
  rec("R10.charter-ows-arabic-verbatim", "201; caseForChange code-point identical; inScope Arabic", `${res.status}; verbatim=${g.body?.charter?.caseForChange === arText}; inScope=${g.body?.charter?.inScope}`, res.status === 201 && g.body?.charter?.caseForChange === arText && g.body?.charter?.inScope === "نطاق تجريبي");
}
// 6. Invisible-only still validation.blank, with plain application/json
const t2 = (await call("POST", "/api/v1/transformations", { businessUnitId: BU, name: "Synthetic R10 invisible", mode: "end_to_end" })).body;
const inv = await call("POST", `/api/v1/transformations/${t2.id}/charter`, { ...charter, caseForChange: "‏‎​⁠ " });
rec("R10.invisible-only-blank", "400 validation.blank at /caseForChange", `${inv.status} ${JSON.stringify((inv.body?.errors ?? []).map((e) => [e.pointer, e.code]))}`, inv.status === 400 && JSON.stringify(inv.body).includes("validation.blank"));
rec("R10.localized:validation.content_type", "EN and AR present, AR Arabic", `en='${EN.validation__content_type}' ar='${AR.validation__content_type}'`, !!EN.validation__content_type && /[؀-ۿ]/.test(AR.validation__content_type ?? ""));
const gates = psql("select string_agg(code, ',' order by code) from gate_definition");
rec("R10.gate-codes", "G1..G6 only", gates, gates === "G1,G2,G3,G4,G5,G6");
console.log(`SUMMARY ${out.filter((x) => x.ok).length}/${out.length} PASS`);
process.exit(out.every((x) => x.ok) ? 0 : 1);
