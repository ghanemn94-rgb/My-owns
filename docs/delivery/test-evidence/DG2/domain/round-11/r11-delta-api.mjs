// domain-reviewer DG2 round 11 (T-DG2-REV-DOM-R11): live checks of the D-071 / T-DG2-BE16 connection-hygiene fix from the
// domain angle. SYNTHETIC data, disposable stack. Nothing here is a real business decision and nothing touches DG0-DG7.
// Checks: a normal evidence file still uploads and downloads byte-identical with its Arabic file name, and its connection
// stays keep-alive (a second request on the same socket is answered); an oversized upload is refused with the declared
// 413 evidence.too_large (localized EN/AR), the connection is closed promptly, nothing is stored and the earlier content
// is unchanged; a normal upload afterwards still works; SPA deep links (not-found handler, now rate-metered) still serve
// the app; an unknown API address is 404 not_found; product gate codes are G1..G6 only.
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL;
const U = { lead: "01920000-0000-7000-9000-000000000203" };
const BU = "01920000-0000-7000-9000-000000000102";
const EN = JSON.parse(readFileSync("apps/web/src/i18n/en/problems.json", "utf8"));
const AR = JSON.parse(readFileSync("apps/web/src/i18n/ar/problems.json", "utf8"));
const out = [];
const rec = (id, exp, act, ok) => { out.push({ id, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const psql = (q) => execFileSync("psql", [process.env.PSQL_MTH, "-qAtc", q], { encoding: "utf8" }).trim();
const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "dev.lead" }) });
const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
const call = async (method, path, body) => {
  const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken };
  if (body !== undefined) h["content-type"] = "application/json";
  if (method === "POST") h["idempotency-key"] = randomUUID();
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await res.arrayBuffer()); let json; try { json = JSON.parse(buf.toString("utf8")); } catch { json = null; }
  return { status: res.status, headers: res.headers, buf, body: json };
};
const sha = (b) => createHash("sha256").update(b).digest("hex");
const u = new URL(BASE);
const head = (path, lines) => [`${lines.method ?? "POST"} ${path} HTTP/1.1`, `Host: ${u.host}`, `Cookie: ${cookie}`, `Origin: ${BASE}`, `X-CSRF-Token: ${me.csrfToken}`, ...lines.extra].join("\r\n") + "\r\n\r\n";
// Parses as many complete HTTP responses as the buffer holds (Content-Length framed).
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

const t = (await call("POST", "/api/v1/transformations", { businessUnitId: BU, name: "Synthetic R11 evidence connection hygiene", mode: "end_to_end" })).body;
const T = `/api/v1/transformations/${t.id}`;
const ev = (await call("POST", `${T}/evidence`, { kind: "file", title: "Synthetic R11 baseline extract", ownerUserId: U.lead })).body;
const E = `${T}/evidence/${ev.id}`;
const revisions = () => Number(psql(`select count(*) from evidence_content where evidence_id='${ev.id}'`));
const fileName = "خط-الأساس R11 ‏📊.xlsx";

// 1. Normal upload (2 MiB) over a keep-alive socket, then a second request on the same socket.
const bytes = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.alloc(2 * 1024 * 1024, 0x5a), Buffer.from("‏تقرير خط الأساس 📊", "utf8")]);
const ka = await new Promise((resolve, reject) => {
  const s = net.connect(Number(u.port), u.hostname); let acc = Buffer.alloc(0); let sentSecond = false; let closed = false;
  s.on("error", reject);
  s.on("close", () => { closed = true; });
  s.on("data", (c) => {
    acc = Buffer.concat([acc, c]); const rs = parseResponses(acc);
    if (rs.length >= 1 && !sentSecond) { sentSecond = true; s.write(head("/api/v1/me", { method: "GET", extra: ["Connection: keep-alive"] })); }
    if (rs.length >= 2) { s.destroy(); resolve({ rs, closedEarly: closed }); }
  });
  setTimeout(() => { s.destroy(); resolve({ rs: parseResponses(acc), closedEarly: closed, timeout: true }); }, 15000);
  s.write(Buffer.concat([Buffer.from(head(`${E}/content`, { extra: ["Content-Type: application/octet-stream", `Content-Length: ${bytes.length}`, `X-File-Name: ${encodeURIComponent(fileName)}`, `If-Match: "${ev.version}"`, "Connection: keep-alive"] }), "latin1"), bytes]));
});
const up = ka.rs[0], second = ka.rs[1];
const connHdr = (h) => (h?.match(/\r\nconnection:\s*([^\r]*)/i) ?? [])[1] ?? "(none)";
rec("R11.normal-upload-200-keepalive", "200; response not Connection: close; second request on the same socket answered 200", `upload ${up?.status} connection=${connHdr(up?.head)}; second=${second?.status}; timeout=${!!ka.timeout}`, up?.status === 200 && !/close/i.test(connHdr(up?.head)) && second?.status === 200);
const dl = await call("GET", `${E}/content`);
rec("R11.normal-download-identical", "200; byte-identical; Arabic file name with RLM/emoji kept", `${dl.status} ${dl.buf.length}/${bytes.length} bytes sha ${sha(dl.buf).slice(0, 16)} vs ${sha(bytes).slice(0, 16)}; fileName=${JSON.stringify(up?.body?.fileName)}`, dl.status === 200 && Buffer.compare(dl.buf, bytes) === 0 && up?.body?.fileName === fileName);
const revAfterNormal = revisions();
const version = up?.body?.version;

// 2. Oversized upload (25 MiB + 1 MiB) streamed: declared refusal, connection closed promptly, nothing stored.
const big = 26 * 1024 * 1024;
const over = await new Promise((resolve) => {
  const s = net.connect(Number(u.port), u.hostname); let acc = Buffer.alloc(0); let tResp = null; const t0 = Date.now(); let errCode = null;
  s.on("error", (e) => { errCode = e.code; });
  s.on("data", (c) => { acc = Buffer.concat([acc, c]); if (tResp === null && parseResponses(acc).length) tResp = Date.now() - t0; });
  s.on("close", () => resolve({ rs: parseResponses(acc), tResp, tClose: Date.now() - t0, errCode }));
  s.write(head(`${E}/content`, { extra: ["Content-Type: application/octet-stream", `Content-Length: ${big}`, `X-File-Name: ${encodeURIComponent("كبير جدا.bin")}`, `If-Match: "${version}"`, "Connection: keep-alive"] }));
  const chunk = Buffer.alloc(256 * 1024, 0x41); let sent = 0;
  const pump = () => { while (sent < big && !s.destroyed) { sent += chunk.length; if (!s.write(chunk)) { s.once("drain", pump); return; } } };
  pump();
  setTimeout(() => { if (!s.destroyed) { s.destroy(); } }, 30000);
});
const o = over.rs[0];
rec("R11.oversized-refused-413", "413 evidence.too_large problem; Connection: close", `${o?.status} code=${o?.body?.code} connection=${connHdr(o?.head)}; detail=${JSON.stringify(o?.body?.detail)}`, o?.status === 413 && o?.body?.code === "evidence.too_large" && /close/i.test(connHdr(o?.head)));
rec("R11.oversized-connection-closed-promptly", "socket closed by the server within 5 s of the response (not held ~65 s)", `response at ${over.tResp} ms, closed at ${over.tClose} ms (socket error code=${over.errCode ?? "none"})`, over.tResp !== null && over.tClose - over.tResp < 5000);
const dl2 = await call("GET", `${E}/content`);
rec("R11.oversized-nothing-stored", "no new revision; current content still the normal upload byte-identical", `revisions ${revAfterNormal}->${revisions()}; identical=${Buffer.compare(dl2.buf, bytes) === 0}`, revisions() === revAfterNormal && dl2.status === 200 && Buffer.compare(dl2.buf, bytes) === 0);
rec("R11.localized:evidence.too_large", "EN and AR present, AR Arabic", `en='${EN.evidence__too_large}' ar='${AR.evidence__too_large}'`, !!EN.evidence__too_large && /[؀-ۿ]/.test(AR.evidence__too_large ?? ""));

// 3. A normal upload after the refusal still works (via fetch).
const meta = await call("GET", E);
const bytes2 = Buffer.from("‏مرجع ثانٍ R11 — second revision 📎\n".repeat(100), "utf8");
const up2 = await fetch(`${BASE}${E}/content`, { method: "POST", headers: { cookie, origin: BASE, "x-csrf-token": me.csrfToken, "content-type": "application/octet-stream", "x-file-name": encodeURIComponent("مرجع-2.txt"), "if-match": `"${meta.body?.version}"` }, body: bytes2 });
const dl3 = await call("GET", `${E}/content`);
rec("R11.upload-after-refusal", "200; new revision; download byte-identical", `${up2.status}; revisions ${revAfterNormal}->${revisions()}; identical=${Buffer.compare(dl3.buf, bytes2) === 0}`, up2.status === 200 && revisions() === revAfterNormal + 1 && Buffer.compare(dl3.buf, bytes2) === 0);

// 4. SPA deep links still served by the not-found handler (now rate-metered); unknown API address 404.
for (const p of ["/transformations", `/transformations/${t.id}/diagnose`, `/transformations/${t.id}/define`, `/transformations/${t.id}/design`]) {
  const res = await fetch(BASE + p, { headers: { cookie } }); const txt = await res.text();
  rec(`R11.spa-deep-link:${p.replace(t.id, ":id")}`, "200 text/html app shell", `${res.status} ${res.headers.get("content-type")}`, res.status === 200 && /text\/html/.test(res.headers.get("content-type") ?? "") && /<div id="root"|<html/i.test(txt));
}
const nf = await call("GET", "/api/v1/no-such-address");
rec("R11.unknown-api-404", "404 not_found", `${nf.status} ${nf.body?.code}`, nf.status === 404 && /not_found/.test(nf.body?.code ?? ""));
const gates = psql("select string_agg(code, ',' order by code) from gate_definition");
rec("R11.gate-codes", "G1..G6 only", gates, gates === "G1,G2,G3,G4,G5,G6");
console.log(`SUMMARY ${out.filter((x) => x.ok).length}/${out.length} PASS`);
process.exit(out.every((x) => x.ok) ? 0 : 1);
