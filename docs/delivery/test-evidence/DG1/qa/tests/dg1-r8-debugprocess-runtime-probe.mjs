// QA round-8 adjacent-route runtime probe (qa-verifier, T-DG1-REV-QA-R8). Not part of the candidate.
// Run in a scratch directory with: node dg1-r8-debugprocess-runtime-probe.mjs
// Shows that on the pinned Node 22, the global process._debugProcess(process.pid) starts the inspector in-process
// (no import of node:inspector), and the Node globals fetch + WebSocket can then evaluate an arbitrary code string
// in the same process via the inspector protocol (Runtime.evaluate). Uses loopback 127.0.0.1:9229 only.
process._debugProcess(process.pid);
await new Promise((r) => setTimeout(r, 500));
const [t] = await (await fetch("http://127.0.0.1:9229/json/list")).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
ws.send(
  JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression: "globalThis.__qa = 6*7; process.versions.node" },
  }),
);
const msg = await new Promise((r) => ws.addEventListener("message", (e) => r(e.data)));
console.log("inspector reply:", msg);
console.log("globalThis.__qa set by the evaluated string:", globalThis.__qa);
ws.close();
process.exit(0);
