// qa-verifier A21 connection-log checker (DG6, T-DG6-QA-D; ADR-0059 §12; REQ-S17-009 "a network capture during the
// e2e suite shows no outbound calls to model or telemetry hosts", read as a CONNECTION LOG of the Node processes, not
// a packet capture: D-195 Q8). Usage: node e2e/support/connection-log-check.ts <log.jsonl> [allowed-host ...]
// Passes (exit 0) only if the log exists, holds at least one line written by the API process (proof that the log was
// on, never a silent pass on an empty file), and EVERY line's destination is a loopback address or host
// (127.0.0.0/8, ::1, ::ffff:127.x, localhost) or a host named on the command line / in QA_CONNECTION_ALLOW (comma
// separated: the run's explicit allow-list, e.g. a local fake IdP). Any other destination fails the run (exit 1) and is
// printed. A missing or empty log is BLOCKED (exit 3). It does not see the browser's, the database server's or the
// operating system's connections (those are tracked in the specs by trackRequests, or are DG7's A18 packet capture).
import { existsSync, readFileSync } from "node:fs";

interface Line {
  at: string;
  process: string;
  channel: string;
  host: string | null;
  address: string | null;
  port: number | null;
}

const [file, ...extra] = process.argv.slice(2);
if (!file || !existsSync(file)) {
  console.log(`BLOCKED: connection log ${file ?? "(none given)"} does not exist`);
  process.exit(3);
}
const allow = new Set(
  [...extra, ...(process.env["QA_CONNECTION_ALLOW"] ?? "").split(",")]
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);
const lines = readFileSync(file, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Line);
if (lines.length === 0) {
  console.log(`BLOCKED: connection log ${file} is empty (was the preload installed?)`);
  process.exit(3);
}
const loopback = (v: string | null) =>
  v !== null &&
  (/^127\.\d+\.\d+\.\d+$/.test(v) || v === "::1" || /^::ffff:127\./.test(v) || v.toLowerCase() === "localhost");
const destinationOk = (l: Line) => {
  const values = [l.host, l.address].filter((v): v is string => v !== null && v !== "");
  if (values.length === 0) return false; // an attempt with no known destination is not provably local
  return values.every((v) => loopback(v) || allow.has(v.toLowerCase()));
};
const byProcess = new Map<string, number>();
for (const l of lines) byProcess.set(l.process, (byProcess.get(l.process) ?? 0) + 1);
const bad = lines.filter((l) => !destinationOk(l));
const destinations = new Map<string, number>();
for (const l of lines) {
  const k = `${l.host ?? "-"}|${l.address ?? "-"}:${l.port ?? "-"}`;
  destinations.set(k, (destinations.get(k) ?? 0) + 1);
}
console.log(`connection log: ${file}`);
console.log(`lines: ${lines.length}; by process: ${JSON.stringify(Object.fromEntries(byProcess))}`);
console.log(`destinations (host|address:port -> count): ${JSON.stringify(Object.fromEntries(destinations))}`);
console.log(`allow-list beyond loopback: ${JSON.stringify([...allow])}`);
const apiLines = [...byProcess.entries()].filter(([p]) => p.endsWith("api/dist/main.js") || p === "api");
if (apiLines.length === 0) {
  console.log("BLOCKED: no line of the API process (apps/api/dist/main.js) in the log");
  process.exit(3);
}
if (bad.length > 0) {
  console.log(`FAIL: ${bad.length} connection(s) to a non-local destination:`);
  for (const l of bad) console.log(JSON.stringify(l));
  process.exit(1);
}
console.log("PASS: every outbound connection of the logged Node processes went to a loopback address");
