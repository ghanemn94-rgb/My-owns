// QA round-8 adjacent-route probe (qa-verifier, T-DG1-REV-QA-R8). Not part of the candidate.
// Copy to apps/api/src/ in a DISPOSABLE clone and run with: pnpm vitest run --project unit-node apps/api/src/<this file>
// Route: the global `process._debugProcess(process.pid)` (or `process.kill(process.pid, "SIGUSR1")`) activates the
// in-process inspector without importing `node:inspector`; the Node globals `fetch` + `WebSocket` then send
// `Runtime.evaluate` with an arbitrary code string, which runs in the same process (see the runtime companion
// dg1-r8-debugprocess-runtime-probe.mjs). The test records what the candidate's lint reports for each plant; it
// PASSES when the lint reports nothing (i.e. it documents the gap) and would FAIL once the route is closed.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileViolations, MODULES_DIR } from "./architecture.testkit.ts";

const FILE = join(MODULES_DIR, "transformations", "zz-qa-planted.ts");
const v = (src: string) => fileViolations("transformations", FILE, src);

describe("QA r8 adjacent route: inspector activation via process._debugProcess / SIGUSR1", () => {
  const plants: [string, string][] = [
    [
      "D1 full route (_debugProcess + fetch + WebSocket Runtime.evaluate)",
      `export async function x(code: string) {\n  process._debugProcess(process.pid);\n  await new Promise((r) => setTimeout(r, 500));\n  const [t] = await (await fetch("http://127.0.0.1:9229/json/list")).json();\n  const ws = new WebSocket(t.webSocketDebuggerUrl);\n  await new Promise((r) => ws.addEventListener("open", r));\n  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: code } }));\n}`,
    ],
    ["D2 process._debugProcess(process.pid) alone", `process._debugProcess(process.pid);`],
    ["D3 process.kill(process.pid, 'SIGUSR1') alone", `process.kill(process.pid, "SIGUSR1");`],
  ];
  for (const [name, src] of plants) {
    it(`${name}: candidate lint reports no violation (gap)`, () => {
      const out = v(src);
      console.log(name, "violations =", JSON.stringify(out));
      expect(out).toEqual([]);
    });
  }
});
