// domain-reviewer DG2 round 13 (T-DG2-REV-DOM-R13): live checks of the D-073 repairs from the domain angle, through the
// product's own routes. SYNTHETIC data (seed-dev users), disposable stack. Role assignments here are synthetic ACCESS
// changes, not business approvals; nothing touches DG0-DG7 and no G1-G6 decision is taken in this probe.
// (1) A normal evidence upload with an Arabic+RLM+emoji file name: 200, download byte-identical (EN and AR names).
// (2) Access withdrawn while the body is still arriving (the uploader's assignment reaches its effectiveTo mid-stream):
//     the upload is refused 403 forbidden, audited authorization.denied; nothing stored; no temporary left.
// (3) An administrator revokes the uploader's assignment through POST /role-assignments/{id}/revoke mid-stream (which
//     also ends that user's sessions): refused 401 unauthenticated; nothing stored; no temporary left.
// (4) The uploader signs out (POST /auth/logout) mid-stream: refused 401; nothing stored; no temporary left.
// (5) Afterwards the same items accept a normal upload by an authorised user, byte-identical.
// (6) The refusal codes the web client shows (forbidden, unauthenticated) are localized EN and AR.
// (7) Dev sign-in (AUTH_MODE=dev) still works for every seeded synthetic user and /me answers; /auth/login in dev mode.
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import net from "node:net";
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL;
const STORE = process.env.EVIDENCE_STORAGE_PATH;
const ADMIN = "01920000-0000-7000-9000-000000000201", NOBODY = "01920000-0000-7000-9000-000000000205", LEAD = "01920000-0000-7000-9000-000000000203";
const BU = "01920000-0000-7000-9000-000000000102";
const EN = JSON.parse(readFileSync("apps/web/src/i18n/en/problems.json", "utf8"));
const AR = JSON.parse(readFileSync("apps/web/src/i18n/ar/problems.json", "utf8"));
const out = [];
const rec = (id, exp, act, ok) => { out.push({ id, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const psql = (q) => execFileSync("psql", [process.env.PSQL_MTH, "-qAtc", q], { encoding: "utf8" }).trim();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u = new URL(BASE);
const walk = (d) => { let r = []; for (const e of readdirSync(d, { withFileTypes: true })) r = e.isDirectory() ? r.concat(walk(`${d}/${e.name}`)) : r.concat(`${d}/${e.name}`); return r; };
const parts = () => { try { return walk(STORE).filter((f) => f.endsWith(".part")); } catch { return []; } };
async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const meR = await fetch(`${BASE}/api/v1/me`, { headers: { cookie } });
  const me = await meR.json().catch(() => null);
  const call = async (method, path, body, ifMatch) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me?.csrfToken };
    if (body !== undefined) h["content-type"] = "application/json";
    if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`;
    if (method === "POST" && ifMatch === undefined) h["idempotency-key"] = randomUUID();
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const buf = Buffer.from(await res.arrayBuffer()); let json; try { json = JSON.parse(buf.toString("utf8")); } catch { json = null; }
    return { status: res.status, buf, body: json };
  };
  return { call, cookie, me, loginStatus: r.status, meStatus: meR.status };
}
const upload = (s, path, ver, name, bytes) => fetch(`${BASE}${path}`, { method: "POST", headers: { cookie: s.cookie, origin: BASE, "x-csrf-token": s.me.csrfToken, "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name), "if-match": `"${ver}"` }, body: bytes });
// An upload over a raw socket: headers + first half now; second half when finish() is called. Resolves with the first response.
function streamUpload(s, path, ver, name, bytes) {
  const sock = net.connect(Number(u.port), u.hostname); let acc = Buffer.alloc(0);
  const done = new Promise((resolve) => {
    sock.on("data", (c) => { acc = Buffer.concat([acc, c]); const end = acc.indexOf("\r\n\r\n"); if (end < 0) return; const h = acc.slice(0, end).toString("latin1"); const len = Number((h.match(/\r\ncontent-length:\s*(\d+)/i) ?? [])[1] ?? 0); if (acc.length >= end + 4 + len) { let b = null; try { b = JSON.parse(acc.slice(end + 4, end + 4 + len).toString("utf8")); } catch {} sock.destroy(); resolve({ status: Number(h.split(" ")[1]), body: b }); } });
    sock.on("error", (e) => resolve({ err: e.code }));
    sock.on("close", () => resolve({ closed: true }));
  });
  sock.write([`POST ${path} HTTP/1.1`, `Host: ${u.host}`, `Cookie: ${s.cookie}`, `Origin: ${BASE}`, `X-CSRF-Token: ${s.me.csrfToken}`, "Content-Type: application/octet-stream", `Content-Length: ${bytes.length}`, `X-File-Name: ${encodeURIComponent(name)}`, `If-Match: "${ver}"`].join("\r\n") + "\r\n\r\n");
  const half = Math.floor(bytes.length / 2);
  sock.write(bytes.subarray(0, half));
  return { done, finish: () => sock.write(bytes.subarray(half)) };
}
const revisions = (id) => Number(psql(`select count(*) from evidence_content where evidence_id='${id}'`));
// Attempt 1 keyed this on the evidence id; the denial audit records the policy's target (here the transformation), so
// count the uploader's authorization.denied events on this transformation for the content route instead.
const denials = (tid) => psql(`select count(*) || ' ' || coalesce(string_agg(record_type || ' ' || reason, '; '), '') from audit_event where action='authorization.denied' and actor_user_id='${NOBODY}' and transformation_id='${tid}' and reason like '%/content%'`);

const admin = await session("dev.admin");
const lead = await session("dev.lead");
const t = (await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU, name: "Synthetic R13 evidence after D-073", mode: "end_to_end" })).body;
const T = `/api/v1/transformations/${t.id}`;
const bytes = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.alloc(2 * 1024 * 1024, 0x5a), Buffer.from("‏تقرير خط الأساس 📊", "utf8")]);

// (1) normal upload / download, EN and AR file names
for (const [lang, fileName] of [["en", "Baseline R13 extract 📊.xlsx"], ["ar", "خط-الأساس R13 ‏📊.xlsx"]]) {
  const ev = (await lead.call("POST", `${T}/evidence`, { kind: "file", title: `Synthetic R13 baseline ${lang}`, ownerUserId: LEAD })).body;
  const E = `${T}/evidence/${ev.id}`;
  const up = await upload(lead, `${E}/content`, ev.version, fileName, bytes); const ub = await up.json().catch(() => null);
  const dl = await lead.call("GET", `${E}/content`);
  rec(`R13.${lang}.normal-upload-download-unchanged`, "200; download byte-identical; file name kept; one revision", `upload ${up.status} fileName=${JSON.stringify(ub?.fileName)}; download ${dl.status} ${dl.buf.length}/${bytes.length} bytes sha ${sha(dl.buf).slice(0, 16)} vs ${sha(bytes).slice(0, 16)}; revisions=${revisions(ev.id)}`, up.status === 200 && ub?.fileName === fileName && dl.status === 200 && Buffer.compare(dl.buf, bytes) === 0 && revisions(ev.id) === 1);
}

// helper: give dev.nobody TL on this transformation (synthetic access change), optionally with an effectiveTo
async function assignNobody(effectiveTo) {
  const body = { userId: NOBODY, roleCode: "TL", scope: { type: "transformation", id: t.id }, reason: "Synthetic R13 access for the upload probe" };
  if (effectiveTo) body.effectiveTo = effectiveTo;
  return admin.call("POST", "/api/v1/role-assignments", body);
}
const partsBefore = parts().length;

// (2) access reaches its end (effectiveTo) while the body streams -> 403
{
  const a = await assignNobody(new Date(Date.now() + 4000).toISOString());
  const nb = await session("dev.nobody");
  const ev = (await nb.call("POST", `${T}/evidence`, { kind: "file", title: "Synthetic R13 access ends mid-upload", ownerUserId: NOBODY })).body;
  const up = streamUpload(nb, `${T}/evidence/${ev?.id}/content`, ev?.version, "ينتهي-الوصول.bin", bytes);
  await sleep(800); const during = parts().length - partsBefore;
  while (Date.now() < Date.parse(a.body.effectiveTo) + 500) await sleep(100);
  up.finish(); const r = await up.done; await sleep(300);
  const after = await lead.call("GET", `${T}/evidence/${ev?.id}`);
  rec("R13.access-ends-mid-upload-403", "assignment 201; evidence 201; temp object during stream; then 403 forbidden; 0 revisions; item version unchanged; authorization.denied audited; no .part left", `assign=${a.status} evidence=${ev?.id ? 201 : "?"} partsDuring=${during} response=${r.status} code=${r.body?.code} detail=${JSON.stringify(r.body?.detail)} revisions=${revisions(ev.id)} version ${ev.version}->${after.body?.version} denials=${JSON.stringify(denials(t.id))} partsLeft=${parts().length - partsBefore}`, a.status === 201 && during === 1 && r.status === 403 && r.body?.code === "forbidden" && revisions(ev.id) === 0 && after.body?.version === ev.version && Number(denials(t.id).split(' ')[0]) >= 1 && parts().length === partsBefore);
  // (5) the same item then takes a normal upload once the uploader holds access again (attempt 1 used the lead, whom the
  //     ownership rule rightly refuses on another user's item: 403, which is correct behaviour, not a defect)
  // attempt 2: assigning again while the expired (unrevoked) assignment exists answered 409, so the expired assignment is
  // revoked first (an administrator's normal clean-up), then access is granted anew.
  const ra = await admin.call("POST", `/api/v1/role-assignments/${a.body.id}/revoke`, { reason: "Synthetic R13 expired assignment clean-up" }, a.body.version);
  const a2 = await assignNobody();
  console.log(`INFO revoke expired assignment -> ${ra.status}; re-assign -> ${a2.status} ${a2.status === 201 ? "" : JSON.stringify(a2.body)}`);
  const nb2 = await session("dev.nobody");
  const ok = await upload(nb2, `${T}/evidence/${ev.id}/content`, ev.version, "بعد-الرفض.bin", bytes);
  const dl = await lead.call("GET", `${T}/evidence/${ev.id}/content`);
  rec("R13.upload-after-403-regranted", "new assignment 201; 200 by the re-granted uploader; download byte-identical; 1 revision", `assign=${a2.status} upload=${ok.status}; identical=${Buffer.compare(dl.buf, bytes) === 0}; revisions=${revisions(ev.id)}`, a2.status === 201 && ok.status === 200 && Buffer.compare(dl.buf, bytes) === 0 && revisions(ev.id) === 1);
  const lr = await upload(lead, `${T}/evidence/${ev.id}/content`, ev.version + 1, "lead.bin", bytes);
  console.log(`INFO the lead uploading to dev.nobody's item -> ${lr.status} (${(await lr.json().catch(() => ({}))).code}); ownership rule, as in attempt 1`);
  // drop the re-grant again so scenario (3) starts from a single assignment
  const rv0 = await admin.call("POST", `/api/v1/role-assignments/${a2.body.id}/revoke`, { reason: "Synthetic R13 cleanup" }, a2.body.version);
  console.log(`INFO cleanup revoke -> ${rv0.status}`);
}

// (3) an administrator revokes the assignment through the product while the body streams -> 401 (sessions ended too)
{
  const a = await assignNobody();
  const nb = await session("dev.nobody");
  const ev = (await nb.call("POST", `${T}/evidence`, { kind: "file", title: "Synthetic R13 revoked mid-upload", ownerUserId: NOBODY })).body;
  const up = streamUpload(nb, `${T}/evidence/${ev?.id}/content`, ev?.version, "سُحب-الوصول.bin", bytes);
  await sleep(800);
  const rv = await admin.call("POST", `/api/v1/role-assignments/${a.body.id}/revoke`, { reason: "Synthetic R13 revoke during upload" }, a.body.version);
  up.finish(); const r = await up.done; await sleep(300);
  const after = await lead.call("GET", `${T}/evidence/${ev?.id}`);
  const me = await nb.call("GET", "/api/v1/me");
  rec("R13.revoked-mid-upload-refused", "revoke 200; upload refused 401 unauthenticated (revocation ends the sessions); 0 revisions; version unchanged; no .part left; /me 401", `assign=${a.status} revoke=${rv.status} response=${r.status} code=${r.body?.code} revisions=${revisions(ev.id)} version ${ev.version}->${after.body?.version} partsLeft=${parts().length - partsBefore} me=${me.status}`, a.status === 201 && rv.status === 200 && r.status === 401 && r.body?.code === "unauthenticated" && revisions(ev.id) === 0 && after.body?.version === ev.version && parts().length === partsBefore && me.status === 401);
}

// (4) the uploader signs out while the body streams -> 401
{
  const nb = await session("dev.lead");
  const ev = (await nb.call("POST", `${T}/evidence`, { kind: "file", title: "Synthetic R13 sign-out mid-upload", ownerUserId: LEAD })).body;
  const up = streamUpload(nb, `${T}/evidence/${ev.id}/content`, ev.version, "خروج.bin", bytes);
  await sleep(800);
  const lo = await nb.call("POST", "/api/v1/auth/logout", {});
  up.finish(); const r = await up.done; await sleep(300);
  const after = await lead.call("GET", `${T}/evidence/${ev.id}`);
  rec("R13.signout-mid-upload-401", "logout 2xx; upload refused 401 unauthenticated; 0 revisions; version unchanged; no .part left", `logout=${lo.status} response=${r.status} code=${r.body?.code} revisions=${revisions(ev.id)} version ${ev.version}->${after.body?.version} partsLeft=${parts().length - partsBefore}`, lo.status >= 200 && lo.status < 300 && r.status === 401 && r.body?.code === "unauthenticated" && revisions(ev.id) === 0 && after.body?.version === ev.version && parts().length === partsBefore);
  const ok = await upload(lead, `${T}/evidence/${ev.id}/content`, ev.version, "بعد-الخروج.bin", bytes);
  const dl = await lead.call("GET", `${T}/evidence/${ev.id}/content`);
  rec("R13.upload-after-signout-other-session", "the lead's other session still works: 200; byte-identical", `${ok.status}; identical=${Buffer.compare(dl.buf, bytes) === 0}; revisions=${revisions(ev.id)}`, ok.status === 200 && Buffer.compare(dl.buf, bytes) === 0 && revisions(ev.id) === 1);
}

// (6) localized refusal messages the web client shows
for (const k of ["forbidden", "unauthenticated"]) rec(`R13.localized:${k}`, "EN and AR present, AR Arabic", `en='${EN[k]}' ar='${AR[k]}'`, !!EN[k] && /[؀-ۿ]/.test(AR[k] ?? ""));

// (7) dev sign-in for every seeded synthetic user
const signins = [];
for (const n of ["dev.admin", "dev.office", "dev.lead", "dev.auditor", "dev.nobody"]) { const s = await session(n); signins.push(`${n}:${s.loginStatus}/${s.meStatus}/${s.me?.user?.displayName ?? s.me?.displayName ?? "?"}/${s.me?.user?.preferredLocale ?? s.me?.preferredLocale ?? "?"}`); }
rec("R13.dev-signin-all-users", "dev-login 2xx and /me 200 for each seeded synthetic user", signins.join(" "), signins.every((x) => /:2\d\d\/200\//.test(x)));
const lg = await fetch(`${BASE}/api/v1/auth/login`, { redirect: "manual" });
console.log(`INFO GET /api/v1/auth/login in AUTH_MODE=dev -> ${lg.status} ${(await lg.text()).slice(0, 160)}`);
const gates = psql("select string_agg(code, ',' order by code) from gate_definition");
rec("R13.gate-codes", "G1..G6 only", gates, gates === "G1,G2,G3,G4,G5,G6");
console.log(`SUMMARY ${out.filter((x) => x.ok).length}/${out.length} PASS`);
process.exit(out.every((x) => x.ok) ? 0 : 1);
