// qa-verifier (T-DG6-QA-C): the REAL API composition (buildServer from apps/api/src/server.ts, every module and every
// import target the domains register) in its own OS process, so the A13 P6 drills can SIGKILL it in the middle of a
// connector run or an import commit. It adds no route, handler or import target of its own.
//
// Modes (QA_CHILD_MODE):
//   watch   - the connector run watch: the production step `connectorRunWatchStep` every 200 ms, exactly what
//             `startConnectorRunWatch` does every 10 s in a production API (that timer is not started under
//             NODE_ENV=test, so this process drives the same step itself), limited to QA_CHILD_CONNECTORS (a comma
//             list) so it never touches another suite's runs.
//   request - one HTTP request through the composed app (inject): QA_CHILD_METHOD, QA_CHILD_URL, QA_CHILD_COOKIE,
//             QA_CHILD_CSRF, QA_CHILD_HEADERS (JSON), QA_CHILD_BODY (JSON). Prints `RESPONSE <status> <body>` when it
//             completes (it does not when the process is killed first).
// Started by the drills with `node --conditions=@mth/source`. Prints READY when the app is composed.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../../packages/config/src/index.ts";
import { createPool } from "../../../packages/db/src/index.ts";
import { buildServer } from "../../../apps/api/src/server.ts";
import { connectorRunWatchStep } from "../../../apps/api/src/modules/integrations/runs.ts";

const url = process.env["QA_CHILD_DB_URL"];
if (!url) throw new Error("QA_CHILD_DB_URL is required");
const mode = process.env["QA_CHILD_MODE"] ?? "watch";
const appName = process.env["QA_CHILD_APP_NAME"] ?? "qa-a13c-child-api";

const config = loadConfig("api", {
  NODE_ENV: "test",
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: url,
  AUTH_MODE: "dev",
  RATE_LIMIT_PER_MINUTE: "100000",
  AUTH_RATE_LIMIT_PER_MINUTE: "100000",
  UPLOAD_RATE_LIMIT_PER_MINUTE: "100000",
  SEARCH_RATE_LIMIT_PER_MINUTE: "100000",
  ASSISTANT_RATE_LIMIT_PER_MINUTE: "100000",
  WEBHOOK_RATE_LIMIT_PER_MINUTE: "100000",
  EXPORT_RATE_LIMIT_PER_MINUTE: "100000",
  EVIDENCE_STORAGE_PATH: mkdtempSync(join(tmpdir(), "qa-a13c-evidence-")),
});
const pool = createPool(url, { max: 4, applicationName: appName });
const { app, db } = await buildServer({ config, pool, logger: false, webRoot: null });
await app.ready();
process.stdout.write("READY\n");

if (mode === "watch") {
  const only = (process.env["QA_CHILD_CONNECTORS"] ?? "").split(",").filter((s) => s !== "");
  for (;;) {
    try {
      const out = await connectorRunWatchStep(db, { onlyConnectors: only });
      for (const r of out) process.stdout.write(`STEP ${r.outcome}\n`);
    } catch (err) {
      process.stdout.write(`STEP-ERROR ${err instanceof Error ? err.message : String(err)}\n`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
} else {
  const headers: Record<string, string> = {
    ...(JSON.parse(process.env["QA_CHILD_HEADERS"] ?? "{}") as Record<string, string>),
    cookie: process.env["QA_CHILD_COOKIE"] ?? "",
    "x-csrf-token": process.env["QA_CHILD_CSRF"] ?? "",
    origin: "http://localhost:3000",
  };
  const body = process.env["QA_CHILD_BODY"];
  const res = await app.inject({
    method: (process.env["QA_CHILD_METHOD"] ?? "POST") as "POST",
    url: process.env["QA_CHILD_URL"]!,
    headers,
    ...(body !== undefined ? { payload: JSON.parse(body) as object } : {}),
  });
  process.stdout.write(`RESPONSE ${res.statusCode} ${res.body}\n`);
  await app.close();
  process.exit(0);
}
