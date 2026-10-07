// domain-reviewer DG2 round 10: my round-9 r9-delta-api.mjs rerun unchanged as the D-069 regression (labels R9.*).
// SYNTHETIC data, disposable stack. Nothing here is a real business decision and nothing touches DG0-DG7.
// Checks: a binary file (all 256 byte values, invalid UTF-8 included) uploaded as application/octet-stream with an Arabic
// file name is stored and downloads byte-for-byte unchanged (sha256 + Digest header); a text/plain or JSON upload is refused
// 400 validation.content_type with no revision stored; a JSON charter with charset=utf-8 still stores Arabic+emoji+RLM
// verbatim; text/plain or octet-stream to a JSON operation is refused 400 validation.content_type with nothing stored;
// invisible-only is still validation.blank; EN/AR messages exist for each code.
import { randomUUID, createHash } from "node:crypto";
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
const call = async (method, path, body, ifMatch, ct = "application/json") => {
  const h = hdr(body !== undefined ? { "content-type": ct } : {});
  if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`;
  if (method === "POST" && ifMatch === undefined) h["idempotency-key"] = randomUUID();
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body) });
  const buf = Buffer.from(await res.arrayBuffer()); const text = buf.toString("utf8"); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, ct: res.headers.get("content-type"), headers: res.headers, buf, body: json };
};
const rawPost = (path, bytes, headers, chunked) => new Promise((resolve, reject) => {
  const u = new URL(BASE + path);
  const h = hdr(headers);
  if (!chunked) h["content-length"] = String(bytes.length);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: h }, (res) => {
    const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8"); let json; try { json = JSON.parse(text); } catch { json = text; }
      resolve({ status: res.statusCode, ct: res.headers["content-type"], body: json });
    });
  });
  req.on("error", reject);
  if (chunked) { req.write(bytes.subarray(0, 7)); req.end(bytes.subarray(7)); } else req.end(bytes);
});
const errs = (x) => JSON.stringify((x.body?.errors ?? []).map((e) => [e.pointer, e.code]));
const key = (c) => c.replace(/\./g, "__");
const loc = (code) => `en='${EN[key(code)]}' ar='${AR[key(code)]}'`;
const isArabic = (s) => /[؀-ۿ]/.test(s ?? "");
const sha = (b) => createHash("sha256").update(b).digest("hex");

const t = (await call("POST", "/api/v1/transformations", { businessUnitId: BU, name: "Synthetic R9 evidence and media types", mode: "end_to_end" })).body;
const T = `/api/v1/transformations/${t.id}`;
const ev = await call("POST", `${T}/evidence`, { kind: "file", title: "Synthetic R9 baseline extract", ownerUserId: U.lead });
rec("R9.evidence-create", "201 file evidence", `${ev.status} kind=${ev.body?.kind}`, ev.status === 201 && ev.body?.kind === "file");
const E = `${T}/evidence/${ev.body.id}`;
const revisions = () => Number(execPsql(`select count(*) from evidence_content where evidence_id='${ev.body.id}'`));
import { execFileSync } from "node:child_process";
function execPsql(q) { return execFileSync("psql", [process.env.PSQL_MTH, "-qAtc", q], { encoding: "utf8" }).trim(); }

// 1. Binary upload (every byte value, incl. 0xFF/0xC0/lone continuation bytes) as octet-stream, Arabic file name, both framings
const bytes = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.from("‏تقرير خط الأساس 📊\r\n", "utf8"), Buffer.from([0xff, 0xfe, 0xed, 0xa0, 0x80, 0xc0, 0xaf])]);
const fileName = "خط-الأساس 2026 ‏📊.xlsx";
let version = ev.body.version;
for (const chunked of [false, true]) {
  const up = await rawPost(`${E}/content`, bytes, { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(fileName), "if-match": `"${version}"` }, chunked);
  version = up.body?.version ?? version;
  const dl = await call("GET", `${E}/content`);
  const digest = dl.headers.get("digest");
  const ok = up.status === 200 && dl.status === 200 && Buffer.compare(dl.buf, bytes) === 0 && digest === `sha-256=${createHash("sha256").update(bytes).digest("base64")}` && up.body?.fileName === fileName;
  rec(`R9.evidence-binary-roundtrip:${chunked ? "chunked" : "content-length"}`, "upload 200; download 200 byte-identical; Digest = sha-256 of the sent bytes; Arabic file name kept", `upload ${up.status} fileName=${JSON.stringify(up.body?.fileName)}; download ${dl.status} ${dl.buf.length}/${bytes.length} bytes sha256 ${sha(dl.buf).slice(0, 16)} vs ${sha(bytes).slice(0, 16)}; digest=${digest}; disposition=${dl.headers.get("content-disposition")}`, ok);
}
// 2. Same upload sent as text/plain (chunked and length) or JSON: refused, nothing stored
const before = revisions();
for (const [ct, body, chunked] of [["text/plain; charset=utf-8", bytes, false], ["text/plain", bytes, true], ["application/json", Buffer.from(JSON.stringify("نص عربي")), false], ["application/json", Buffer.from('{"a":1}'), true]]) {
  const res = await rawPost(`${E}/content`, body, { "content-type": ct, "x-file-name": "x.txt", "if-match": `"${version}"` }, chunked);
  rec(`R9.evidence-upload-refused:${ct}:${chunked ? "chunked" : "length"}`, "400 problem+json validation.content_type; no new revision", `${res.status} ${res.ct} code=${res.body?.code} errors=${errs(res)}; revisions ${before}->${revisions()}`, res.status === 400 && /problem\+json/.test(res.ct ?? "") && JSON.stringify(res.body).includes("validation.content_type") && revisions() === before);
}
const dl2 = await call("GET", `${E}/content`);
rec("R9.evidence-unchanged-after-refusals", "current content still byte-identical to the binary upload", `${Buffer.compare(dl2.buf, bytes) === 0}`, dl2.status === 200 && Buffer.compare(dl2.buf, bytes) === 0);

// 3. JSON operation: Arabic + emoji + RLM verbatim with charset=utf-8; text/plain and octet-stream refused, nothing stored
const arText = "‏حالة التغيير: أخطاء الفوترة تزيد التسرب 📉 ‎(SAR 1,250.50)‏ 👩‍💼";
const charter = (cfc) => ({ transformationName: "Synthetic R9", executiveSponsorUserId: U.office, transformationLeadUserId: U.lead, caseForChange: cfc, inScope: "نطاق تجريبي", baselineDate: "2026-01-31" });
for (const ct of ["text/plain;charset=utf-8", "application/octet-stream", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
  const res = await rawPost(`${T}/charter`, Buffer.from(JSON.stringify(charter(arText)), "utf8"), { "content-type": ct, "idempotency-key": randomUUID() }, false);
  const g = await call("GET", `${T}/charter`);
  rec(`R9.json-op-refuses:${ct.split(";")[0]}`, "400 validation.content_type; no charter", `${res.status} ${errs(res)} code=${res.body?.code}; GET charter ${g.status}`, res.status === 400 && JSON.stringify(res.body).includes("validation.content_type") && g.status === 404);
}
const ok = await rawPost(`${T}/charter`, Buffer.from(JSON.stringify(charter(arText)), "utf8"), { "content-type": "Application/JSON; charset=UTF-8", "idempotency-key": randomUUID() }, true);
const g = await call("GET", `${T}/charter`);
rec("R9.json-arabic-emoji-rlm-verbatim", "201; caseForChange equal code point for code point; inScope Arabic kept", `${ok.status}; verbatim=${g.body?.charter?.caseForChange === arText}; inScope=${g.body?.charter?.inScope}`, ok.status === 201 && g.body?.charter?.caseForChange === arText && g.body?.charter?.inScope === "نطاق تجريبي");
// 4. Invisible-only still validation.blank
const t2 = (await call("POST", "/api/v1/transformations", { businessUnitId: BU, name: "Synthetic R9 invisible", mode: "end_to_end" })).body;
const inv = await call("POST", `/api/v1/transformations/${t2.id}/charter`, charter("‏‎​⁠ "));
rec("R9.invisible-only-blank", "400 validation.blank at /caseForChange", `${inv.status} ${errs(inv)}`, inv.status === 400 && errs(inv).includes("validation.blank"));
// 5. Localized messages
for (const c of ["validation.content_type", "validation.blank", "validation.json"]) rec(`R9.localized:${c}`, "EN and AR present, AR is Arabic", loc(c), !!EN[key(c)] && isArabic(AR[key(c)]));
// 6. Gate codes untouched: G1..G6 only
const gates = execPsql("select string_agg(code, ',' order by code) from gate_definition").trim();
rec("R9.gate-codes", "G1..G6 only", gates, gates === "G1,G2,G3,G4,G5,G6");
console.log(`SUMMARY ${out.filter((x) => x.ok).length}/${out.length} PASS`);
process.exit(out.every((x) => x.ok) ? 0 : 1);
