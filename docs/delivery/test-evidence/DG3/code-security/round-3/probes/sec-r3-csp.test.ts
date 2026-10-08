// code-security-reviewer DG3 round-3 (T-DG3-REV-SEC-R3B): ADR-0024 §6 "Production / Browser" claim check.
// Runs ONLY in a disposable clone, copied to apps/api/test/integration/zz-sec-r3/ and run in the integration project on
// a throwaway PostgreSQL (with-pg.sh). It builds the real API server with webRoot = the BUILT web bundle (apps/web/dist,
// produced by `pnpm -r build` in the same clone), then reads the headers actually emitted for the SPA document, a deep
// SPA route, the JS entry chunk and locale-boot.js. Expected: every one carries a CSP whose script-src is exactly 'self'
// (no 'unsafe-eval', no 'unsafe-inline', no wasm-unsafe-eval), and default-src is 'self'. It also confirms the formula
// engine is in the served bundle (the ENGINE's error message text is present in a served chunk).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildServer } from "../../../src/server.ts";
import { createPool, testConfig } from "../../support/harness.ts";

const dist = fileURLToPath(new URL("../../../../web/dist/", import.meta.url));

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name!.toLowerCase(), values] as const;
      }),
  );
}

describe("ADR-0024 §6: the served web bundle carries script-src 'self' without 'unsafe-eval'", () => {
  it("emitted CSP on the SPA document, a deep route, the entry chunk and locale-boot.js", async () => {
    expect(existsSync(`${dist}index.html`), `built bundle at ${dist}`).toBe(true);
    const html = readFileSync(`${dist}index.html`, "utf8");
    const entry = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
    expect(entry).toBeTruthy();
    const chunks = readdirSync(`${dist}assets`).filter((f) => f.endsWith(".js"));
    const engineChunk = chunks.filter((f) =>
      readFileSync(`${dist}assets/${f}`, "utf8").includes("the formula could not be processed"),
    );
    console.log("[sec-r3-csp] chunks containing the formula engine's internal-problem text:", engineChunk);
    expect(engineChunk.length).toBeGreaterThan(0);

    const pool = createPool(testConfig().databaseUrl!, { max: 1, applicationName: "sec-r3-csp" });
    const { app, db } = await buildServer({ config: testConfig(), pool, logger: false, webRoot: dist });
    try {
      for (const url of ["/", "/transformations/x/gates", entry!, "/locale-boot.js"]) {
        const res = await app.inject({ method: "GET", url });
        const csp = String(res.headers["content-security-policy"] ?? "");
        console.log(`[sec-r3-csp] GET ${url} -> ${res.statusCode} ${res.headers["content-type"]}\n  CSP: ${csp}`);
        expect(res.statusCode, url).toBe(200);
        const d = directives(csp);
        expect(d.get("script-src"), url).toEqual(["'self'"]);
        expect(d.get("default-src"), url).toEqual(["'self'"]);
        expect(csp).not.toMatch(/unsafe-eval|unsafe-inline|wasm-unsafe-eval/);
      }
    } finally {
      await app.close();
      await db.destroy();
      if (!(pool as { ending?: boolean }).ending) await pool.end();
    }
  });
});
