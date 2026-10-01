// qa-verifier DG1 round-2 independent black-box probe (T-DG1-REV-QA-R2). Uses only fetch; imports no product code.
// Runs against a REAL local stack (e2e/support/qa-stack.sh: disposable PostgreSQL, migrate, seed-dev with SYNTHETIC
// users, API in AUTH_MODE=dev on http://localhost:3000):
//   e2e/support/qa-stack.sh node <this file>
// Covers: REQ-S15-002 (GET /api/v1/branding/tokens: 401 unauthenticated; the seven seeded values; provenance
// provisional), REQ-S19-004 / F-DG1-140 (business-unit hierarchy: concurrent re-parent race through the API never
// commits a cycle; nesting deeper than 10 levels is refused with 422).
// Exit 0 = every assertion passed; 1 = at least one FAIL.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
};

async function req(session, method, path, { body, headers = {} } = {}) {
  const h = { ...headers };
  if (session?.cookie) h.cookie = session.cookie;
  if (method !== "GET" && !("origin" in h)) h.origin = BASE;
  if (session?.csrf && method !== "GET") h["x-csrf-token"] = session.csrf;
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  return { status: r.status, headers: r.headers, json, text };
}

async function login(username) {
  const r = await fetch(BASE + "/api/v1/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ username }),
  });
  const s = { cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
  const me = await req(s, "GET", "/api/v1/me");
  s.csrf = me.json?.csrfToken;
  s.me = me.json;
  return { status: r.status, session: s };
}

// ---------- REQ-S15-002: branding tokens ----------
const unauth = await req(null, "GET", "/api/v1/branding/tokens");
check("branding tokens unauthenticated -> 401", unauth.status === 401, String(unauth.status));

const admin = await login("dev.admin");
check("dev-login dev.admin -> 204", admin.status === 204, String(admin.status));
const tok = await req(admin.session, "GET", "/api/v1/branding/tokens");
console.log("branding body:", tok.text);
const expected = {
  "brand.primary": "#0078FF",
  "brand.deep": "#003B73",
  "surface.page": "#F5F8FC",
  "surface.card": "#FFFFFF",
  "text.primary": "#142438",
  "text.secondary": "#526174",
  "border.default": "#DCE5EF",
};
check("branding tokens authenticated -> 200", tok.status === 200, String(tok.status));
// Accept either an array of {name,value,...} or a map; report what was found.
const raw = tok.json?.tokens ?? tok.json;
const entries = Array.isArray(raw)
  ? raw.map((t) => [t.name ?? t.key ?? t.token, t.value, t.provenance])
  : Object.entries(raw ?? {}).map(([k, v]) => [k, typeof v === "object" ? v?.value : v, typeof v === "object" ? v?.provenance : undefined]);
const got = Object.fromEntries(entries.map(([k, v]) => [k, String(v ?? "").toUpperCase()]));
for (const [k, v] of Object.entries(expected)) check(`token ${k} = ${v}`, got[k] === v, `got ${got[k]}`);
const provs = [tok.json?.provenance, ...entries.map((e) => e[2])].filter((p) => p !== undefined);
check("provenance is 'provisional' (and nothing else)", provs.length > 0 && provs.every((p) => p === "provisional"), JSON.stringify([...new Set(provs)]));
check("no claim of official/verified Mobily brand compliance in the response", !/official|verified|compliant|compliance/i.test(tok.text.replace(/not (an )?(official|verified)[^"]*/gi, "")), "");

// ---------- REQ-S19-004 / F-DG1-140: hierarchy via the API ----------
const orgId = admin.session.me?.organization?.id;
let seq = 0;
async function mkBu(parentBusinessUnitId) {
  seq++;
  const code = `QA${Date.now().toString(36).toUpperCase()}${seq}`.slice(0, 32);
  const body = { code, nameEn: `QA probe ${code} (synthetic)`, nameAr: `وحدة اختبار ${seq}` };
  if (parentBusinessUnitId) body.parentBusinessUnitId = parentBusinessUnitId;
  const r = await req(admin.session, "POST", `/api/v1/organizations/${orgId}/business-units`, { body });
  return { status: r.status, id: r.json?.id, etag: r.headers.get("etag"), problem: r.json };
}
async function reparent(id, parentBusinessUnitId) {
  const g = await req(admin.session, "GET", `/api/v1/business-units/${id}`);
  return req(admin.session, "PATCH", `/api/v1/business-units/${id}`, {
    body: { parentBusinessUnitId },
    headers: { "if-match": g.headers.get("etag") },
  });
}
async function parentOf(id) {
  return (await req(admin.session, "GET", `/api/v1/business-units/${id}`)).json?.parentBusinessUnitId ?? null;
}

const probeA = await mkBu();
check("admin can create a business unit", probeA.status === 201 && !!probeA.id, `${probeA.status} ${JSON.stringify(probeA.problem)?.slice(0, 200)}`);

// Direct cycle through the API: 422 business_unit.cycle
{
  const a = await mkBu();
  const b = await mkBu(a.id);
  const r = await reparent(a.id, b.id);
  check("API direct cycle (A under its child B) -> 422", r.status === 422, `${r.status} ${r.json?.type ?? ""} ${r.json?.code ?? ""}`);
}

// Concurrent race, repeated: C under B; then simultaneously A under C and B under A.
const TRIALS = 25;
let bothCommitted = 0;
let cycles = 0;
const outcomes = {};
for (let i = 0; i < TRIALS; i++) {
  const a = await mkBu();
  const b = await mkBu();
  const c = await mkBu(b.id);
  const ga = await req(admin.session, "GET", `/api/v1/business-units/${a.id}`);
  const gb = await req(admin.session, "GET", `/api/v1/business-units/${b.id}`);
  const [r1, r2] = await Promise.all([
    req(admin.session, "PATCH", `/api/v1/business-units/${a.id}`, { body: { parentBusinessUnitId: c.id }, headers: { "if-match": ga.headers.get("etag") } }),
    req(admin.session, "PATCH", `/api/v1/business-units/${b.id}`, { body: { parentBusinessUnitId: a.id }, headers: { "if-match": gb.headers.get("etag") } }),
  ]);
  const key = `${r1.status}/${r2.status}`;
  outcomes[key] = (outcomes[key] ?? 0) + 1;
  if (r1.status === 200 && r2.status === 200) bothCommitted++;
  // Walk up from A (at most 12 hops); a revisit means a cycle was committed.
  const seen = new Set();
  let cur = a.id;
  let hops = 0;
  while (cur && hops < 12) {
    if (seen.has(cur)) {
      cycles++;
      break;
    }
    seen.add(cur);
    cur = await parentOf(cur);
    hops++;
  }
}
console.log(`race outcomes (PATCH A->C / PATCH B->A): ${JSON.stringify(outcomes)}`);
check(`concurrent re-parent race x${TRIALS}: never both committed`, bothCommitted === 0, `bothCommitted=${bothCommitted}`);
check(`concurrent re-parent race x${TRIALS}: no committed cycle`, cycles === 0, `cycles=${cycles}`);

// Depth: a chain of 10 levels is allowed; the 11th is refused with 422.
{
  let parent = null;
  const statuses = [];
  for (let level = 1; level <= 11; level++) {
    const r = await mkBu(parent);
    statuses.push(r.status);
    if (r.status === 201) parent = r.id;
    else console.log(`level ${level} refused: ${JSON.stringify(r.problem)?.slice(0, 300)}`);
  }
  check("API depth: levels 1-10 created (201)", statuses.slice(0, 10).every((s) => s === 201), JSON.stringify(statuses));
  check("API depth: level 11 refused (400/422, not 201/500)", [400, 422].includes(statuses[10]), String(statuses[10]));
}

console.log(failures ? `R2 BLACK-BOX PROBE: FAIL (${failures})` : "R2 BLACK-BOX PROBE: PASS");
process.exit(failures ? 1 : 0);
