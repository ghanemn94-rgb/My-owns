// domain-reviewer DG2 round 12 (T-DG2-REV-DOM-R12): live checks of the D-072 repairs from the domain angle.
// SYNTHETIC data, disposable stack. Nothing here is a real business decision and nothing touches DG0-DG7.
// (1) A normal evidence file with an Arabic+RLM+emoji name still uploads (200) and downloads byte-identical.
// (2) Slow uploads no longer hold database connections: 24 uploads (> pool max 20) trickle their bodies for ~4 s; while
//     they are in flight another user's reads and a charter write are answered quickly (not 503/timeout); afterwards every
//     upload completes 200 and every download is byte-identical.
// (3) An interrupted request (body shorter than Content-Length, then the client half-closes) gets the declared 400
//     validation.malformed_request (not 500), on a JSON route and on the upload route; nothing is stored; the message is
//     localized EN and AR.
// (4) A charter edit with Arabic text containing RLM marks is still accepted verbatim after the repairs.
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL;
const U = { lead: "01920000-0000-7000-9000-000000000203", office: "01920000-0000-7000-9000-000000000202" };
const BU = "01920000-0000-7000-9000-000000000102";
const EN = JSON.parse(readFileSync("apps/web/src/i18n/en/problems.json", "utf8"));
const AR = JSON.parse(readFileSync("apps/web/src/i18n/ar/problems.json", "utf8"));
const out = [];
const rec = (id, exp, act, ok) => { out.push({ id, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const psql = (q) => execFileSync("psql", [process.env.PSQL_MTH, "-qAtc", q], { encoding: "utf8" }).trim();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const u = new URL(BASE);
async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  const call = async (method, path, body, ifMatch) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken };
    if (body !== undefined) h["content-type"] = "application/json";
    if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`;
    if (method === "POST" && ifMatch === undefined) h["idempotency-key"] = randomUUID();
    const t0 = Date.now();
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const buf = Buffer.from(await res.arrayBuffer()); let json; try { json = JSON.parse(buf.toString("utf8")); } catch { json = null; }
    return { status: res.status, buf, body: json, ms: Date.now() - t0 };
  };
  return { call, cookie, me };
}
const parseResponses = (buf) => {
  const res = []; let off = 0;
  while (true) {
    const end = buf.indexOf("\r\n\r\n", off); if (end < 0) break;
    const h = buf.slice(off, end).toString("latin1"); const len = Number((h.match(/\r\ncontent-length:\s*(\d+)/i) ?? [])[1] ?? 0);
    if (buf.length < end + 4 + len) break;
    const body = buf.slice(end + 4, end + 4 + len); let json = null; try { json = JSON.parse(body.toString("utf8")); } catch {}
    res.push({ status: Number(h.split(" ")[1]), head: h, body: json }); off = end + 4 + len;
  }
  return res;
};
const lead = await session("dev.lead");
const office = await session("dev.office");
const head = (s, path, method, extra) => [`${method} ${path} HTTP/1.1`, `Host: ${u.host}`, `Cookie: ${s.cookie}`, `Origin: ${BASE}`, `X-CSRF-Token: ${s.me.csrfToken}`, ...extra].join("\r\n") + "\r\n\r\n";

const t = (await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU, name: "Synthetic R12 evidence after D-072", mode: "end_to_end" })).body;
const T = `/api/v1/transformations/${t.id}`;
const newEvidence = async (title) => (await lead.call("POST", `${T}/evidence`, { kind: "file", title, ownerUserId: U.lead })).body;
const revisions = (id) => Number(psql(`select count(*) from evidence_content where evidence_id='${id}'`));

// (1) normal upload / download
const ev = await newEvidence("Synthetic R12 baseline extract");
const E = `${T}/evidence/${ev.id}`;
const fileName = "خط-الأساس R12 ‏📊.xlsx";
const bytes = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.alloc(1024 * 1024, 0x5a), Buffer.from("‏تقرير خط الأساس 📊", "utf8")]);
const up = await fetch(`${BASE}${E}/content`, { method: "POST", headers: { cookie: lead.cookie, origin: BASE, "x-csrf-token": lead.me.csrfToken, "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(fileName), "if-match": `"${ev.version}"` }, body: bytes });
const upBody = await up.json().catch(() => null);
const dl = await lead.call("GET", `${E}/content`);
rec("R12.normal-upload-download-unchanged", "200; download byte-identical; Arabic+RLM+emoji file name kept; one revision", `upload ${up.status} fileName=${JSON.stringify(upBody?.fileName)}; download ${dl.status} ${dl.buf.length}/${bytes.length} bytes sha ${sha(dl.buf).slice(0, 16)} vs ${sha(bytes).slice(0, 16)}; revisions=${revisions(ev.id)}`, up.status === 200 && upBody?.fileName === fileName && dl.status === 200 && Buffer.compare(dl.buf, bytes) === 0 && revisions(ev.id) === 1);

// (2) slow uploads do not block other users
const N = 24, TRICKLE_MS = 4000, STEPS = 8;
const slowItems = [];
for (let i = 0; i < N; i++) slowItems.push(await newEvidence(`Synthetic R12 slow upload ${i}`));
const payload = (i) => Buffer.from(`‏ملف بطيء ${i} — slow upload body 📎\n`.repeat(200), "utf8");
const slow = slowItems.map((item, i) => new Promise((resolve) => {
  const body = payload(i); const s = net.connect(Number(u.port), u.hostname); let acc = Buffer.alloc(0); const t0 = Date.now();
  s.on("error", (e) => resolve({ i, err: e.code }));
  s.on("data", (c) => { acc = Buffer.concat([acc, c]); const rs = parseResponses(acc); if (rs.length) { s.destroy(); resolve({ i, r: rs[0], ms: Date.now() - t0 }); } });
  s.write(head(lead, `${T}/evidence/${item.id}/content`, "POST", ["Content-Type: application/octet-stream", `Content-Length: ${body.length}`, `X-File-Name: ${encodeURIComponent(`بطيء-${i}.txt`)}`, `If-Match: "${item.version}"`]));
  const step = Math.ceil(body.length / STEPS); let k = 0;
  const tick = () => { if (s.destroyed) return; s.write(body.subarray(k * step, (k + 1) * step)); k++; if (k < STEPS) setTimeout(tick, TRICKLE_MS / STEPS); };
  setTimeout(tick, TRICKLE_MS / STEPS);
  setTimeout(() => { if (!s.destroyed) { s.destroy(); resolve({ i, timeout: true }); } }, 60000);
}));
await new Promise((r) => setTimeout(r, 1200)); // all 24 uploads are now mid-body
const pending = Number(psql("select count(*) from pg_stat_activity where application_name='mth-api' and state like 'idle in transaction%'"));
const others = [];
for (const path of ["/api/v1/transformations", `${T}`, `${T}/gates`, "/api/v1/role-accountabilities", "/api/v1/me"]) others.push(await office.call("GET", path));
const ch = await lead.call("POST", `${T}/charter`, { transformationName: "Synthetic R12", caseForChange: "‏تجريبي: أخطاء الفوترة تسبب فقدان العملاء‏", baselineDate: "2026-01-31" });
others.push(ch);
const worst = Math.max(...others.map((o) => o.ms));
rec("R12.slow-uploads-do-not-block-others", `while ${N} uploads (> pool max 20) trickle their bodies, other users' reads and a charter write answer 2xx within 2 s; no session idle in transaction`, `statuses=${JSON.stringify(others.map((o) => o.status))} worst=${worst} ms; idle-in-transaction mth-api sessions during uploads=${pending}`, others.every((o) => o.status >= 200 && o.status < 300) && worst < 2000 && pending === 0);
const slowRes = await Promise.all(slow);
const okUploads = slowRes.filter((x) => x.r?.status === 200).length;
let identical = 0;
for (let i = 0; i < N; i++) { const d = await lead.call("GET", `${T}/evidence/${slowItems[i].id}/content`); if (d.status === 200 && Buffer.compare(d.buf, payload(i)) === 0) identical++; }
rec("R12.slow-uploads-complete-unchanged", `all ${N} slow uploads 200; each download byte-identical`, `200=${okUploads}/${N} statuses=${JSON.stringify([...new Set(slowRes.map((x) => x.r?.status ?? x.err ?? "timeout"))])}; identical=${identical}/${N}; slowest=${Math.max(...slowRes.map((x) => x.ms ?? 0))} ms`, okUploads === N && identical === N);
const chv = await lead.call("GET", `${T}/charter`);
rec("R12.arabic-rlm-charter-verbatim", "charter created 201; caseForChange stored verbatim incl. U+200F", `create=${ch.status}; verbatim=${chv.body?.charter?.caseForChange === "‏تجريبي: أخطاء الفوترة تسبب فقدان العملاء‏"}`, ch.status === 201 && chv.body?.charter?.caseForChange === "‏تجريبي: أخطاء الفوترة تسبب فقدان العملاء‏");

// (3) interrupted requests
const interrupted = (path, extra, partial) => new Promise((resolve) => {
  const s = net.connect(Number(u.port), u.hostname); let acc = Buffer.alloc(0);
  s.on("error", (e) => resolve({ err: e.code, rs: parseResponses(acc) }));
  s.on("data", (c) => { acc = Buffer.concat([acc, c]); });
  s.on("close", () => resolve({ rs: parseResponses(acc) }));
  s.write(head(lead, path, "POST", extra)); s.write(partial); setTimeout(() => s.end(), 300);
  setTimeout(() => { if (!s.destroyed) s.destroy(); }, 15000);
});
const jsonPartial = Buffer.from('{"title":"Synthetic R12 interrupted', "utf8");
const before = Number(psql(`select count(*) from evidence where transformation_id='${t.id}'`));
const ij = await interrupted(`${T}/evidence`, ["Content-Type: application/json", "Content-Length: 400", `Idempotency-Key: ${randomUUID()}`], jsonPartial);
const after = Number(psql(`select count(*) from evidence where transformation_id='${t.id}'`));
rec("R12.interrupted-json-400", "400 validation.malformed_request (not 500); nothing created", `${ij.rs[0]?.status ?? "no response"} code=${ij.rs[0]?.body?.code} errors=${JSON.stringify(ij.rs[0]?.body?.errors?.map((e) => e.code))} err=${ij.err ?? "none"}; evidence rows ${before}->${after}`, ij.rs[0]?.status === 400 && JSON.stringify(ij.rs[0]?.body).includes("malformed_request") && before === after);
const evI = await newEvidence("Synthetic R12 interrupted upload");
const iu = await interrupted(`${T}/evidence/${evI.id}/content`, ["Content-Type: application/octet-stream", "Content-Length: 100000", `X-File-Name: ${encodeURIComponent("مقطوع.bin")}`, `If-Match: "${evI.version}"`], Buffer.alloc(5000, 0x41));
rec("R12.interrupted-upload-400", "400 validation.malformed_request (not 500); no revision stored", `${iu.rs[0]?.status ?? "no response"} code=${iu.rs[0]?.body?.code} errors=${JSON.stringify(iu.rs[0]?.body?.errors?.map((e) => e.code))} err=${iu.err ?? "none"}; revisions=${revisions(evI.id)}`, iu.rs[0]?.status === 400 && JSON.stringify(iu.rs[0]?.body).includes("malformed_request") && revisions(evI.id) === 0);
const ok2 = await fetch(`${BASE}${T}/evidence/${evI.id}/content`, { method: "POST", headers: { cookie: lead.cookie, origin: BASE, "x-csrf-token": lead.me.csrfToken, "content-type": "application/octet-stream", "x-file-name": encodeURIComponent("كامل.bin"), "if-match": `"${evI.version}"` }, body: bytes });
const dl2 = await lead.call("GET", `${T}/evidence/${evI.id}/content`);
rec("R12.upload-after-interruption", "200 on the same item afterwards; byte-identical", `${ok2.status}; identical=${Buffer.compare(dl2.buf, bytes) === 0}; revisions=${revisions(evI.id)}`, ok2.status === 200 && Buffer.compare(dl2.buf, bytes) === 0 && revisions(evI.id) === 1);
rec("R12.localized:validation.malformed_request", "EN and AR present, AR Arabic", `en='${EN.validation__malformed_request}' ar='${AR.validation__malformed_request}'`, !!EN.validation__malformed_request && /[؀-ۿ]/.test(AR.validation__malformed_request ?? ""));
const gates = psql("select string_agg(code, ',' order by code) from gate_definition");
rec("R12.gate-codes", "G1..G6 only", gates, gates === "G1,G2,G3,G4,G5,G6");
console.log(`SUMMARY ${out.filter((x) => x.ok).length}/${out.length} PASS`);
process.exit(out.every((x) => x.ok) ? 0 : 1);
