// code-security-reviewer DG3 round-3 probe E (T-DG3-REV-SEC-R3). NOT product code; runs only in a disposable clone,
// copied to apps/api/test/integration/zz-sec-r3/. Checks the ADR-0024 §6 "Production / Browser" claim on the REAL
// built web bundle (apps/web/dist, from `pnpm -r build` in the clone), served by the real API (buildServer, webRoot):
//   E1 GET / (index.html), a SPA route and the main JS asset all carry a CSP whose script-src is exactly 'self', with no
//      'unsafe-eval', no 'wasm-unsafe-eval', no 'unsafe-inline' and no remote origin; default-src is 'self';
//   E2 the CSP on the served page equals the one on /healthz (one policy, no per-route weakening);
//   E3 index.html has no inline <script> body and loads scripts only from same-origin paths;
//   E4 informational: counts of eval( / new Function( / Function( text in the built JS (third-party code included).
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildServer } from "../../../src/server.ts";
import { createPool, testConfig } from "../../support/harness.ts";

const WEB_DIST = fileURLToPath(new URL("../../../../web/dist/", import.meta.url));

describe("probe E: CSP on the served web bundle (ADR-0024 §6 Production/Browser)", () => {
  it("E1-E4", async () => {
    const indexHtml = readFileSync(`${WEB_DIST}index.html`, "utf8");
    const pool = createPool(testConfig().databaseUrl!, { max: 1, applicationName: "sec-r3-csp" });
    const { app, db } = await buildServer({ config: testConfig(), pool, logger: false, webRoot: WEB_DIST });
    try {
      const assets = readdirSync(`${WEB_DIST}assets`).filter((f) => f.endsWith(".js"));
      expect(assets.length).toBeGreaterThan(0);
      const urls = ["/", "/transformations/x/gates", `/assets/${assets[0]}`, "/healthz"];
      const csps: string[] = [];
      for (const url of urls) {
        const res = await app.inject({ method: "GET", url });
        const csp = String(res.headers["content-security-policy"]);
        console.log(`E1 ${url} -> ${res.statusCode} ${String(res.headers["content-type"])}\n   CSP: ${csp}`);
        expect(res.statusCode).toBe(200);
        const directives = Object.fromEntries(
          csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k!, v]),
        );
        expect(directives["script-src"]).toEqual(["'self'"]);
        expect(directives["default-src"]).toEqual(["'self'"]);
        expect(csp).not.toMatch(/unsafe-eval|wasm-unsafe-eval|unsafe-inline|https?:|\*/);
        csps.push(csp);
      }
      expect(new Set(csps).size).toBe(1);
      const scripts = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      console.log(`E3 index.html scripts: ${JSON.stringify(scripts.map((m) => [m[1]!.trim(), m[2]!.trim().length]))}`);
      for (const m of scripts) {
        expect(m[2]!.trim()).toBe("");
        expect(m[1]).toMatch(/src="\/[^/]/);
      }
      let evalCalls = 0;
      let newFunction = 0;
      let functionCalls = 0;
      for (const f of assets) {
        const js = readFileSync(`${WEB_DIST}assets/${f}`, "utf8");
        evalCalls += (js.match(/\beval\s*\(/g) ?? []).length;
        newFunction += (js.match(/\bnew Function\s*\(/g) ?? []).length;
        functionCalls += (js.match(/[^.\w$]Function\s*\(/g) ?? []).length;
      }
      console.log(`E4 built JS (${assets.length} files): eval( ${evalCalls}, new Function( ${newFunction}, Function( ${functionCalls}`);
    } finally {
      await app.close();
      await db.destroy();
      if (!(pool as { ending?: boolean }).ending) await pool.end();
    }
  });
});
