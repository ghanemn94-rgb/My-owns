#!/usr/bin/env node
// TEST-ONLY STAND-IN for the Keycloak test IdP (T-DG6-DO-B rehearsal evidence; NOT shipped, NOT Keycloak, NOT part of
// the product). Derived from docs/delivery/handbacks/DG1/T-DG1-DEVOPS-evidence/fake-idp.mjs. It exists only to rehearse
// the MECHANICS of e2e/identity/keycloak-login.spec.ts (navigation, the realm re-addressing, waits, assertions) where
// no container runtime can run the pinned Keycloak image. It is never evidence that Keycloak behaves this way.
//
// Two realms, mth-test and mth-other, each with its OWN issuer and its OWN RSA signing key; the same client id and
// secret in both (as deploy/keycloak/realm-mth-other.json). Keycloak-like login form ids (kc-form-login, username,
// password, kc-login). Authorization responses carry RFC 9207 `iss`, as Keycloak's do. Codes are realm-local: a code
// of one realm is unknown to the other realm's token endpoint. SYNTHETIC users only; secrets come from files.
//
//   node standin-idp.mjs --port 26262 --client-secret-file F --password-file F \
//        --user smoke.admin=5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0001
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "26262" },
    "client-id": { type: "string", default: "mth-hub" },
    "client-secret-file": { type: "string" },
    "password-file": { type: "string" },
    user: { type: "string", multiple: true, default: [] },
  },
});
const port = Number(values.port);
const origin = `http://127.0.0.1:${port}`;
const clientId = values["client-id"];
const clientSecret = readFileSync(values["client-secret-file"], "utf8").trim();
const password = readFileSync(values["password-file"], "utf8").trim();
const users = new Map(values.user.map((u) => u.split("=")));
const b64u = (b) => Buffer.from(b).toString("base64url");

const realms = new Map(
  ["mth-test", "mth-other"].map((name) => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const kid = randomBytes(8).toString("hex");
    return [
      name,
      {
        issuer: `${origin}/realms/${name}`,
        privateKey,
        kid,
        jwk: { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" },
        sessions: new Map(),
        codes: new Map(),
      },
    ];
  }),
);

function idToken(r, claims) {
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid: r.kid }));
  const body = b64u(JSON.stringify(claims));
  return `${header}.${body}.${b64u(sign("RSA-SHA256", Buffer.from(`${header}.${body}`), r.privateKey))}`;
}
const readBody = (req) =>
  new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });
const json = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
};
const loginPage = (r, sid, error = "") =>
  `<!doctype html><html lang="en"><head><title>Sign in (STAND-IN, not Keycloak)</title></head><body>` +
  `<p>STAND-IN test IdP, realm ${r.issuer.split("/").pop()} (synthetic)</p>${error}` +
  `<form id="kc-form-login" method="post" action="${r.issuer}/login-actions/authenticate?session_code=${sid}">` +
  `<label for="username">Username</label><input id="username" name="username">` +
  `<label for="password">Password</label><input id="password" name="password" type="password">` +
  `<button id="kc-login" type="submit">Sign In</button></form></body></html>`;

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const m = /^\/realms\/([a-z-]+)(\/.*)$/.exec(url.pathname);
    const r = m && realms.get(m[1]);
    if (!r) return json(res, 404, { error: "realm_not_found" });
    const p = m[2];
    const cookieName = `AUTH_SESSION_ID_${m[1].replace("-", "_")}`;
    if (req.method === "GET" && p === "/.well-known/openid-configuration") {
      return json(res, 200, {
        issuer: r.issuer,
        authorization_endpoint: `${r.issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${r.issuer}/protocol/openid-connect/token`,
        jwks_uri: `${r.issuer}/protocol/openid-connect/certs`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        scopes_supported: ["openid", "profile", "email"],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (req.method === "GET" && p === "/protocol/openid-connect/certs") return json(res, 200, { keys: [r.jwk] });
    if (req.method === "GET" && p === "/protocol/openid-connect/auth") {
      const q = Object.fromEntries(url.searchParams);
      if (q.client_id !== clientId || q.response_type !== "code" || q.code_challenge_method !== "S256")
        return json(res, 400, { error: "invalid_request" });
      const sid = randomBytes(12).toString("hex");
      r.sessions.set(sid, q);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": `${cookieName}=${sid}; Path=/realms/${m[1]}/; HttpOnly`,
      });
      return res.end(loginPage(r, sid));
    }
    if (req.method === "POST" && p === "/login-actions/authenticate") {
      const sid = url.searchParams.get("session_code");
      const cookieSid = new RegExp(`${cookieName}=([0-9a-f]+)`).exec(req.headers.cookie ?? "")?.[1];
      const q = r.sessions.get(sid);
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      if (!q || cookieSid !== sid || !users.has(form.username) || form.password !== password) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(loginPage(r, sid, "<span>Invalid username or password.</span>"));
      }
      r.sessions.delete(sid);
      const code = randomBytes(16).toString("hex");
      r.codes.set(code, { ...q, sub: users.get(form.username), username: form.username });
      const to = new URL(q.redirect_uri);
      to.searchParams.set("code", code);
      to.searchParams.set("state", q.state);
      to.searchParams.set("iss", r.issuer);
      res.writeHead(302, { location: to.href });
      return res.end();
    }
    if (req.method === "POST" && p === "/protocol/openid-connect/token") {
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      let [id, secret] = [form.client_id, form.client_secret];
      const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (basic) [id, secret] = Buffer.from(basic, "base64").toString().split(":").map(decodeURIComponent);
      if (id !== clientId || secret !== clientSecret) return json(res, 401, { error: "invalid_client" });
      const c = r.codes.get(form.code);
      r.codes.delete(form.code);
      if (!c || form.grant_type !== "authorization_code" || form.redirect_uri !== c.redirect_uri)
        return json(res, 400, { error: "invalid_grant" });
      const challenge = createHash("sha256").update(form.code_verifier ?? "").digest("base64url");
      if (challenge !== c.code_challenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE" });
      const now = Math.floor(Date.now() / 1000);
      return json(res, 200, {
        access_token: randomBytes(16).toString("hex"),
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken(r, {
          iss: r.issuer,
          sub: c.sub,
          aud: clientId,
          iat: now,
          exp: now + 300,
          nonce: c.nonce,
          email: `${c.username}@example.invalid`,
          email_verified: true,
          name: `Synthetic ${c.username}`,
          preferred_username: c.username,
        }),
      });
    }
    json(res, 404, { error: "not_found" });
  })
  .listen(port, "127.0.0.1", () => console.log(`standin-idp (TEST ONLY, NOT Keycloak) ${origin}/realms/{mth-test,mth-other}`));
