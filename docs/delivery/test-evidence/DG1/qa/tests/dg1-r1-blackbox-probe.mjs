// qa-verifier DG1 round-1 independent black-box probe (T-DG1-REV-QA-R1).
// Runs against a REAL local stack (e2e/support/qa-stack.sh: disposable PostgreSQL, migrate, seed-dev with SYNTHETIC
// users, API in AUTH_MODE=dev on http://localhost:3000). Uses only fetch; no product code is imported.
//   e2e/support/qa-stack.sh node <this file>
// Exit 0 = every assertion passed; 1 = at least one FAIL (each assertion is printed PASS/FAIL).
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
};

async function req(session, method, path, { body, headers = {} } = {}) {
  const h = { ...headers };
  if (session?.cookie) h.cookie = session.cookie;
  // Mutations need BOTH a same-origin Origin and the X-CSRF-Token (ADR-0005 §4). Attempt 1 of this probe omitted Origin.
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
  const setCookie = r.headers.getSetCookie().map((c) => c.split(";")[0]);
  const s = { cookie: setCookie.join("; ") };
  const me = await req(s, "GET", "/api/v1/me");
  s.csrf = me.json?.csrfToken;
  s.me = me.json;
  return { status: r.status, session: s };
}

// 1. Unauthenticated access
const unauth = await req(null, "GET", "/api/v1/transformations");
check("unauthenticated list is 401 problem+json", unauth.status === 401 && /problem\+json/.test(unauth.headers.get("content-type") ?? ""), `${unauth.status} ${unauth.headers.get("content-type")}`);

// 2. Login-CSRF: dev-login without a same-origin Origin is refused
const noOrigin = await fetch(BASE + "/api/v1/auth/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "dev.office" }) });
check("dev-login without Origin refused (403)", noOrigin.status === 403, String(noOrigin.status));
const badUser = await fetch(BASE + "/api/v1/auth/dev-login", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "Not A User!" }) });
check("dev-login with invalid username is 400", badUser.status === 400, String(badUser.status));

const office = await login("dev.office");
check("dev-login dev.office is 204 and /me returns csrfToken", office.status === 204 && typeof office.session.csrf === "string" && office.session.csrf.length >= 32, String(office.status));
const orgId = office.session.me?.organization?.id;
const bus = await req(office.session, "GET", `/api/v1/organizations/${orgId}/business-units`);
const bu = (bus.json?.items ?? [])[0];
check("office can list business units of its organization", bus.status === 200 && !!bu, `${bus.status} items=${bus.json?.items?.length}`);

// 3. CSRF on mutations
const noCsrf = await req({ cookie: office.session.cookie }, "POST", "/api/v1/transformations", { body: { businessUnitId: bu?.id, name: "QA probe no csrf", mode: "end_to_end" } });
check("create without CSRF token is 403", noCsrf.status === 403, String(noCsrf.status));
const badOrigin = await req(office.session, "POST", "/api/v1/transformations", { body: { businessUnitId: bu?.id, name: "QA probe bad origin", mode: "end_to_end" }, headers: { origin: "http://evil.example" } });
check("create with valid CSRF token but foreign Origin is 403", badOrigin.status === 403, String(badOrigin.status));

// 4. Validation (negative): modular without entryPhase; unknown property; nothing is written
const before = await req(office.session, "GET", "/api/v1/transformations?limit=100&includeArchived=true");
const nBefore = before.json?.items?.length;
const inval1 = await req(office.session, "POST", "/api/v1/transformations", { body: { businessUnitId: bu?.id, name: "QA modular no phase", mode: "modular" } });
check("modular create without entryPhase is 400", inval1.status === 400, `${inval1.status} ${inval1.json?.type ?? ""}`);
const inval2 = await req(office.session, "POST", "/api/v1/transformations", { body: { businessUnitId: bu?.id, name: "QA extra", mode: "end_to_end", hacker: true } });
check("create with unknown property is 400", inval2.status === 400, String(inval2.status));
const inval3 = await req(office.session, "POST", "/api/v1/transformations", { body: { businessUnitId: bu?.id, name: "", mode: "end_to_end" } });
check("create with empty name is 400", inval3.status === 400, String(inval3.status));
const after = await req(office.session, "GET", "/api/v1/transformations?limit=100&includeArchived=true");
check("rejected creates wrote nothing", after.json?.items?.length === nBefore, `${nBefore} -> ${after.json?.items?.length}`);

// 5. Positive create with defaults (Asia/Riyadh, SAR), version 1, ETag, Location
const created = await req(office.session, "POST", "/api/v1/transformations", { body: { businessUnitId: bu?.id, name: "QA probe تحول تجريبي", mode: "end_to_end" } });
const t = created.json;
check("create is 201 with version 1, ETag and Location", created.status === 201 && t?.version === 1 && !!created.headers.get("etag") && !!created.headers.get("location"), `${created.status} v=${t?.version} etag=${created.headers.get("etag")}`);
check("defaults: timezone Asia/Riyadh, currency SAR", t?.timezone === "Asia/Riyadh" && t?.currency === "SAR", `${t?.timezone} ${t?.currency}`);
check("Arabic name round-trips unchanged", t?.name === "QA probe تحول تجريبي", t?.name);

// 6. Optimistic concurrency
const id = t?.id;
const noIfMatch = await req(office.session, "PATCH", `/api/v1/transformations/${id}`, { body: { name: "QA no if-match" } });
check("PATCH without If-Match is 428", noIfMatch.status === 428, String(noIfMatch.status));
const etag1 = created.headers.get("etag");
const racers = await Promise.all(
  [1, 2, 3, 4, 5].map((i) => req(office.session, "PATCH", `/api/v1/transformations/${id}`, { body: { name: `QA racer ${i}` }, headers: { "if-match": etag1 } })),
);
const ok = racers.filter((r) => r.status === 200).length;
const conflicts = racers.filter((r) => r.status === 409).length;
check("5 concurrent PATCHes on v1: exactly one 200, four 409", ok === 1 && conflicts === 4, racers.map((r) => r.status).join(","));
const cur = await req(office.session, "GET", `/api/v1/transformations/${id}`);
check("version bumped exactly once (2)", cur.json?.version === 2, `v=${cur.json?.version}`);
const stale = await req(office.session, "PATCH", `/api/v1/transformations/${id}`, { body: { name: "QA stale" }, headers: { "if-match": etag1 } });
check("stale If-Match is 409 with currentVersion 2", stale.status === 409 && JSON.stringify(stale.json).includes("2"), `${stale.status} ${JSON.stringify(stale.json?.currentVersion)}`);

// 7. Archive needs a reason; archived is read-only
const etag2 = cur.headers.get("etag");
const noReason = await req(office.session, "POST", `/api/v1/transformations/${id}/archive`, { body: {}, headers: { "if-match": etag2 } });
check("archive without reason is 400", noReason.status === 400, String(noReason.status));
const arch = await req(office.session, "POST", `/api/v1/transformations/${id}/archive`, { body: { reason: "QA probe archive" }, headers: { "if-match": etag2 } });
check("archive with reason is 200 and bumps version to 3", arch.status === 200 && arch.json?.version === 3, `${arch.status} v=${arch.json?.version}`);
const editArchived = await req(office.session, "PATCH", `/api/v1/transformations/${id}`, { body: { name: "QA after archive" }, headers: { "if-match": arch.headers.get("etag") } });
check("editing an archived record is refused (422)", editArchived.status === 422, String(editArchived.status));

// 8. Audit trail: create, update, archive with versions; no delete endpoint
const audit = await req(office.session, "GET", `/api/v1/transformations/${id}/audit`);
const actions = (audit.json?.items ?? []).map((e) => `${e.action}:${e.priorVersion ?? "-"}->${e.newVersion ?? "-"}`);
check("audit lists create, update and archive with version steps", audit.status === 200 && ["transformation.create", "transformation.update", "transformation.archive"].every((a) => actions.some((x) => x.startsWith(a + ":"))), actions.join(" | "));
const del = await req(office.session, "DELETE", `/api/v1/transformations/${id}`);
check("DELETE transformation is not offered (404/405)", del.status === 404 || del.status === 405, String(del.status));

// 9. Authorization by role
const auditor = await login("dev.auditor");
const audCreate = await req(auditor.session, "POST", "/api/v1/transformations", { body: { businessUnitId: bu?.id, name: "QA auditor create", mode: "end_to_end" } });
check("auditor cannot create (403/404)", audCreate.status === 403 || audCreate.status === 404, String(audCreate.status));
const nobody = await login("dev.nobody");
const nbList = await req(nobody.session, "GET", "/api/v1/transformations");
check("user without roles sees no business records", (nbList.status === 200 && (nbList.json?.items ?? []).length === 0) || nbList.status === 403, `${nbList.status} items=${nbList.json?.items?.length}`);
const nbRead = await req(nobody.session, "GET", `/api/v1/transformations/${id}`);
check("user without roles cannot read the record by id (404, not disclosed)", nbRead.status === 404, String(nbRead.status));
const adminS = await login("dev.admin");
const adminRead = await req(adminS.session, "GET", `/api/v1/transformations/${id}`);
check("access administrator has no business-record access (403/404)", adminRead.status === 403 || adminRead.status === 404, String(adminRead.status));

// 10. Branding tokens: authenticated-only, provisional provenance
const brUnauth = await req(null, "GET", "/api/v1/branding/tokens");
const br = await req(office.session, "GET", "/api/v1/branding/tokens");
check("branding tokens: 401 unauthenticated, 200 authenticated", brUnauth.status === 401 && br.status === 200, `${brUnauth.status}/${br.status}`);
check("branding tokens mark #0078FF as provisional", /provisional/i.test(br.text) && /0078FF/i.test(br.text), br.text.slice(0, 160));

// 11. Logout invalidates the session server-side
const lo = await req(office.session, "POST", "/api/v1/auth/logout", { headers: { origin: BASE } });
const afterLo = await req(office.session, "GET", "/api/v1/me");
check("logout then /me with the old cookie is 401", (lo.status === 200 || lo.status === 204) && afterLo.status === 401, `${lo.status} -> ${afterLo.status}`);

console.log(failures === 0 ? "BLACKBOX PROBE: PASS" : `BLACKBOX PROBE: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
