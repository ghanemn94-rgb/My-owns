#!/usr/bin/env node
// TEST-ONLY fake OIDC provider (T-DG1-DEVOPS evidence; NOT shipped, NOT part of the product or the image).
// Stands in for the Keycloak test realm where no container runtime is available, so the OIDC path of
// deploy/scripts/smoke.mjs and the API's authorization-code + PKCE flow can be exercised end to end locally.
// It mimics only what those clients touch: discovery, a login page with <form id="kc-form-login">, the token endpoint
// (client_secret_basic/post, PKCE S256), RS256 ID tokens and JWKS. SYNTHETIC users only; secrets come from files.
//
//   node fake-idp.mjs --port 18080 --client-id mth-hub --client-secret-file F --password-file F \
//        --user smoke.admin=5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0001 --user smoke.office=5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0002
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "18080" },
    "client-id": { type: "string", default: "mth-hub" },
    "client-secret-file": { type: "string" },
    "password-file": { type: "string" },
    user: { type: "string", multiple: true, default: [] },
  },
});
const port = Number(values.port);
const issuer = `http://127.0.0.1:${port}/realms/mth-test`;
const clientId = values["client-id"];
const clientSecret = readFileSync(values["client-secret-file"], "utf8").trim();
const password = readFileSync(values["password-file"], "utf8").trim();
const users = new Map(values.user.map((u) => u.split("=")).map(([name, sub]) => [name, sub]));
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = randomBytes(8).toString("hex");
const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" };
const sessions = new Map();
const codes = new Map();
const b64u = (b) => Buffer.from(b).toString("base64url");

function idToken(claims) {
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = b64u(JSON.stringify(claims));
  const sig = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey);
  return `${header}.${body}.${b64u(sig)}`;
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

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const p = url.pathname.replace("/realms/mth-test", "");
    if (req.method === "GET" && p === "/.well-known/openid-configuration") {
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        scopes_supported: ["openid", "profile", "email"],
      });
    }
    if (req.method === "GET" && p === "/protocol/openid-connect/certs") return json(res, 200, { keys: [jwk] });
    if (req.method === "GET" && p === "/protocol/openid-connect/auth") {
      const q = Object.fromEntries(url.searchParams);
      if (q.client_id !== clientId || q.response_type !== "code" || q.code_challenge_method !== "S256") {
        return json(res, 400, { error: "invalid_request" });
      }
      const sid = randomBytes(12).toString("hex");
      sessions.set(sid, q);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": `AUTH_SESSION_ID=${sid}; Path=/; HttpOnly` });
      return res.end(
        `<!doctype html><html><body><form id="kc-form-login" onsubmit="return true" action="${issuer}/login-actions/authenticate?session_code=${sid}&amp;client_id=${clientId}" method="post"><input name="username"><input name="password" type="password"></form></body></html>`,
      );
    }
    if (req.method === "POST" && p === "/login-actions/authenticate") {
      const sid = url.searchParams.get("session_code");
      const cookieSid = /AUTH_SESSION_ID=([0-9a-f]+)/.exec(req.headers.cookie ?? "")?.[1];
      const q = sessions.get(sid);
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      if (!q || cookieSid !== sid || !users.has(form.username) || form.password !== password) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end('<form id="kc-form-login" action="#"></form><span>Invalid username or password.</span>');
      }
      sessions.delete(sid);
      const code = randomBytes(16).toString("hex");
      codes.set(code, { ...q, sub: users.get(form.username), username: form.username });
      const to = new URL(q.redirect_uri);
      to.searchParams.set("code", code);
      to.searchParams.set("state", q.state);
      res.writeHead(302, { location: to.href });
      return res.end();
    }
    if (req.method === "POST" && p === "/protocol/openid-connect/token") {
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      let [id, secret] = [form.client_id, form.client_secret];
      const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (basic) [id, secret] = Buffer.from(basic, "base64").toString().split(":").map(decodeURIComponent);
      if (id !== clientId || secret !== clientSecret) return json(res, 401, { error: "invalid_client" });
      const c = codes.get(form.code);
      codes.delete(form.code);
      if (!c || form.grant_type !== "authorization_code" || form.redirect_uri !== c.redirect_uri) {
        return json(res, 400, { error: "invalid_grant" });
      }
      const challenge = createHash("sha256").update(form.code_verifier ?? "").digest("base64url");
      if (challenge !== c.code_challenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE" });
      const now = Math.floor(Date.now() / 1000);
      return json(res, 200, {
        access_token: randomBytes(16).toString("hex"),
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken({
          iss: issuer,
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
  .listen(port, "127.0.0.1", () => console.log(`fake-idp (TEST ONLY) ${issuer}`));
