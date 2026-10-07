// domain-reviewer DG2 round 13 (T-DG2-REV-DOM-R13): a graceful server shutdown (SIGTERM) while an evidence upload is
// still arriving leaves no partial file and no stored revision; after a restart, evidence upload/download works again
// and the earlier evidence is unchanged. SYNTHETIC data, disposable stack (API_PID is this stack's own API process,
// exported by with-stack.sh; no other process is signalled).
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync, openSync } from "node:fs";
import net from "node:net";
import { execFileSync, spawn } from "node:child_process";
const BASE = process.env.E2E_BASE_URL, STORE = process.env.EVIDENCE_STORAGE_PATH, PID = Number(process.env.API_PID);
const LEAD = "01920000-0000-7000-9000-000000000203", BU = "01920000-0000-7000-9000-000000000102";
const out = []; const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const psql = (q) => execFileSync("psql", [process.env.PSQL_MTH, "-qAtc", q], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const u = new URL(BASE);
const walk = (d) => { let r = []; for (const e of readdirSync(d, { withFileTypes: true })) r = e.isDirectory() ? r.concat(walk(`${d}/${e.name}`)) : r.concat(`${d}/${e.name}`); return r; };
const files = () => { try { return walk(STORE); } catch { return []; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  const call = async (method, path, body) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken, "idempotency-key": randomUUID() };
    if (body !== undefined) h["content-type"] = "application/json";
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const buf = Buffer.from(await res.arrayBuffer()); let json; try { json = JSON.parse(buf.toString("utf8")); } catch { json = null; }
    return { status: res.status, buf, body: json };
  };
  return { call, cookie, me };
}
const upload = (s, path, ver, name, bytes) => fetch(`${BASE}${path}`, { method: "POST", headers: { cookie: s.cookie, origin: BASE, "x-csrf-token": s.me.csrfToken, "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name), "if-match": `"${ver}"` }, body: bytes });
const bytes = Buffer.concat([Buffer.alloc(3 * 1024 * 1024, 0x33), Buffer.from("‏ملف قبل الإيقاف 📎", "utf8")]);

// Attempt 1 read the stack API's log, but with-stack.sh runs it with LOG_LEVEL=warn, so its info line "shut down" is
// never written, and that API is not this probe's child, so its exit code is not visible. Now the stack's API is stopped
// first (idle, SIGTERM) and the probe runs its OWN API process with LOG_LEVEL=info, so it sees the exit code and the log.
const t00 = Date.now(); process.kill(PID, "SIGTERM"); while (alive(PID) && Date.now() - t00 < 20000) await sleep(100);
console.log(`INFO stack API (idle) stopped: ${!alive(PID)} after ${Date.now() - t00} ms`);
const LOG1 = `${process.env.API_LOG}.probe1`;
const startApi = async (logFile) => { const c = spawn(process.execPath, ["apps/api/dist/main.js"], { stdio: ["ignore", openSync(logFile, "w"), openSync(logFile, "a")], env: { ...process.env, LOG_LEVEL: "info" } }); const exit = new Promise((r) => c.on("exit", (code, signal) => r({ code, signal }))); for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/readyz`)).ok) return { c, exit }; } catch {} await sleep(500); } throw new Error("API did not become ready"); };
const api1 = await startApi(LOG1);
let lead = await session("dev.lead");
const t = (await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU, name: "Synthetic R13 shutdown during upload", mode: "end_to_end" })).body;
const T = `/api/v1/transformations/${t.id}`;
// one committed file before the shutdown
const ev0 = (await lead.call("POST", `${T}/evidence`, { kind: "file", title: "Synthetic R13 committed before shutdown", ownerUserId: LEAD })).body;
const up0 = await upload(lead, `${T}/evidence/${ev0.id}/content`, ev0.version, "قبل-الإيقاف.bin", bytes);
const finalsBefore = files().filter((f) => !f.endsWith(".part"));
// an upload that is still arriving when SIGTERM comes
const ev = (await lead.call("POST", `${T}/evidence`, { kind: "file", title: "Synthetic R13 upload cut by shutdown", ownerUserId: LEAD })).body;
const sock = net.connect(Number(u.port), u.hostname); let resp = Buffer.alloc(0);
sock.on("data", (c) => (resp = Buffer.concat([resp, c]))); sock.on("error", () => {});
const closed = new Promise((r) => sock.on("close", r));
sock.write([`POST ${T}/evidence/${ev.id}/content HTTP/1.1`, `Host: ${u.host}`, `Cookie: ${lead.cookie}`, `Origin: ${BASE}`, `X-CSRF-Token: ${lead.me.csrfToken}`, "Content-Type: application/octet-stream", `Content-Length: ${bytes.length}`, `X-File-Name: ${encodeURIComponent("مقطوع-بالإيقاف.bin")}`, `If-Match: "${ev.version}"`].join("\r\n") + "\r\n\r\n");
sock.write(bytes.subarray(0, 1024 * 1024));
await sleep(800);
const partsDuring = files().filter((f) => f.endsWith(".part")).length;
const t0 = Date.now(); api1.c.kill("SIGTERM");
const ex1 = await Promise.race([api1.exit, sleep(20000).then(() => null)]);
const exitedMs = Date.now() - t0;
await Promise.race([closed, sleep(2000)]);
const partsAfter = files().filter((f) => f.endsWith(".part"));
const finalsAfter = files().filter((f) => !f.endsWith(".part"));
const log = readFileSync(LOG1, "utf8");
console.log(`API LOG (probe API, LOG_LEVEL=info), lines with "msg":\n  ${log.split("\n").filter((l) => l.includes('"msg"')).map((l) => { try { const j = JSON.parse(l); return `${j.level} ${j.msg}${j.signal ? " " + j.signal : ""}${j.err ? " err=" + j.err.message : ""}`; } catch { return l.slice(0, 160); } }).join("\n  ")}`);
rec("R13.shutdown-during-upload-no-partial", "upload 0 committed first (200); a .part exists while the cut upload streams; the API exits with code 0 within the 10 s backstop and logs 'shut down' with no settle warning; afterwards 0 .part files, the cut item has 0 revisions, the final objects are unchanged", `up0=${up0.status} partsDuring=${partsDuring} exit=${JSON.stringify(ex1)} after ${exitedMs} ms; 'shut down' logged=${/"shut down"/.test(log)}; settle warning=${/still running after the settle period/.test(log)}; partsAfter=${partsAfter.length}; cutRevisions=${psql(`select count(*) from evidence_content where evidence_id='${ev.id}'`)}; finals ${finalsBefore.length}->${finalsAfter.length} same=${JSON.stringify(finalsBefore) === JSON.stringify(finalsAfter)}; client got ${JSON.stringify(resp.toString("latin1").split("\r\n")[0] || "no response (connection closed)")}`, up0.status === 200 && partsDuring === 1 && ex1?.code === 0 && exitedMs < 10000 && /"shut down"/.test(log) && !/still running after the settle period/.test(log) && partsAfter.length === 0 && psql(`select count(*) from evidence_content where evidence_id='${ev.id}'`) === "0" && JSON.stringify(finalsBefore) === JSON.stringify(finalsAfter));
// restart this stack's API and confirm evidence still works
const LOG2 = `${process.env.API_LOG}.probe2`;
const api2 = await startApi(LOG2); const ready = 1;
console.log(`INFO restarted API start-up sweep log: ${readFileSync(LOG2, "utf8").split("\n").filter((l) => /sweep|stale temporary/.test(l)).map((l) => { try { const j = JSON.parse(l); return `${j.msg} ${JSON.stringify({ removed: j.removed, kept: j.kept, scanned: j.scanned, olderThanMs: j.olderThanMs })}`; } catch { return l.slice(0, 200); } }).join(" | ") || "(none yet)"}`);
lead = await session("dev.lead");
const dl0 = await lead.call("GET", `${T}/evidence/${ev0.id}/content`);
const up1 = await upload(lead, `${T}/evidence/${ev.id}/content`, ev.version, "بعد-إعادة-التشغيل.bin", bytes);
const dl1 = await lead.call("GET", `${T}/evidence/${ev.id}/content`);
rec("R13.after-restart-evidence-works", "API ready again; the file committed before the shutdown downloads byte-identical; the cut item now takes a normal upload (200) and downloads byte-identical", `ready=${ready}; dl0 ${dl0.status} ${sha(dl0.buf).slice(0, 16)} vs ${sha(bytes).slice(0, 16)}; up1=${up1.status}; dl1 ${dl1.status} identical=${Buffer.compare(dl1.buf, bytes) === 0}`, ready === 1 && dl0.status === 200 && Buffer.compare(dl0.buf, bytes) === 0 && up1.status === 200 && Buffer.compare(dl1.buf, bytes) === 0);
api2.c.kill("SIGTERM"); console.log(`INFO restarted API exit ${JSON.stringify(await api2.exit)}`);
console.log(`SUMMARY ${out.filter(Boolean).length}/${out.length} PASS`);
process.exit(out.every(Boolean) ? 0 : 1);
