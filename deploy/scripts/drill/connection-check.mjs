#!/usr/bin/env node
// connection-check.mjs: the connection-log check of the offline drill (ADR-0069 §5; p7-work-split §B.3, §B.4 T-B13;
// T-DG7-DO-E; closes the REQ-S17-009 residual "the A18 capture is DG7's" as a CONNECTION LOG, not a packet capture,
// D-195 Q8). It reads the ndjson log the product's own module writes (packages/config/src/connection-log.ts, one line
// `{at, process, channel, host, address, port}` per outbound connection attempt of a Node process).
//
//   node deploy/scripts/drill/connection-check.mjs --log <connections.ndjson> [--socket-dir <dir>] [--out <summary.json>]
//
// Each line is put in one category:
//   loopback  every known destination value (host, address) is 127.0.0.0/8, ::1, ::ffff:127.x.x.x or `localhost`;
//   socket    the destination is a path under --socket-dir (the PostgreSQL socket directory), or the line names no
//             destination at all (host, address and port null: a local IPC socket, or a socket destroyed before its first
//             attempt; the module writes a null port only when no TCP attempt was made);
//   outside   anything else, including a host NAME that is not loopback and was never dialled (a failed DNS lookup logs
//             the name with a null port: the DNS-port residual of REQ-S17-009 is carried, ADR-0069 residual 7).
// Fails (exit 1) on any `outside` line, printing for each `offline-drill: connection outside loopback: <address>:<port>
// by <process>` (p7-work-split §B.5; <address> is the host when no address is known, <port> `-` when null). It also
// fails when the log holds no line of the API process (so an empty or switched-off log is never a pass). A missing log
// or a line that is not JSON is BLOCKED (exit 2). Exit 0 PASS. What it does not see: connections made outside the
// logged Node processes (the browser, the database server, the operating system); the namespace with no network
// (bwrap --unshare-net) covers those.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LOOPBACK = [
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^::1$/,
  /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i,
  /^localhost$/i,
];
export const isLoopback = (v) => typeof v === "string" && LOOPBACK.some((r) => r.test(v));

/**
 * Classifies one log line.
 * @param {{host: string|null, address: string|null, port: number|null}} line
 * @param {string|null} socketDir
 * @returns {"loopback"|"socket"|"outside"}
 */
export function classify(line, socketDir = null) {
  const values = [line.host, line.address].filter((v) => typeof v === "string" && v !== "");
  if (values.length === 0) return line.port === null || line.port === undefined ? "socket" : "outside";
  if (values.every(isLoopback)) return "loopback";
  if (socketDir && values.every((v) => v === socketDir || v.startsWith(socketDir.replace(/\/?$/, "/"))))
    return "socket";
  return "outside";
}

/** The B.5 failure line for an `outside` entry. */
export const outsideLine = (l) =>
  `offline-drill: connection outside loopback: ${l.address ?? l.host ?? "-"}:${l.port ?? "-"} by ${l.process}`;

const isApi = (p) => p === "api" || /(^|[/:])api\/dist\/main\.js$/.test(p);

/**
 * Checks a whole log.
 * @param {string} text the ndjson log
 * @param {string|null} socketDir
 */
export function checkLog(text, socketDir = null) {
  const lines = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        throw new Error(`line ${i + 1} is not JSON`);
      }
    });
  const byCategory = { loopback: 0, socket: 0, outside: 0 };
  const byProcess = {};
  const destinations = {};
  const outside = [];
  for (const l of lines) {
    const c = classify(l, socketDir);
    byCategory[c] += 1;
    byProcess[l.process] = (byProcess[l.process] ?? 0) + 1;
    const k = `${l.host ?? "-"}|${l.address ?? "-"}:${l.port ?? "-"}`;
    destinations[k] = (destinations[k] ?? 0) + 1;
    if (c === "outside") outside.push(l);
  }
  const apiLines = Object.entries(byProcess)
    .filter(([p]) => isApi(p))
    .reduce((n, [, v]) => n + v, 0);
  const problems = outside.map(outsideLine);
  if (apiLines === 0)
    problems.push("offline-drill: the connection log holds no line of the API process (was the log switched on?)");
  return {
    lines: lines.length,
    apiLines,
    byCategory,
    byProcess,
    destinations,
    outside,
    problems,
    result: problems.length === 0 ? "PASS" : "FAIL",
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? null) : null;
  };
  const log = opt("--log");
  if (log === null || !existsSync(log)) {
    console.log(`offline-drill: BLOCKED: connection log ${log ?? "(none given)"} not found`);
    process.exit(2);
  }
  let summary;
  try {
    summary = checkLog(readFileSync(log, "utf8"), opt("--socket-dir"));
  } catch (e) {
    console.log(`offline-drill: BLOCKED: connection log ${log}: ${e.message}`);
    process.exit(2);
  }
  const out = opt("--out");
  if (out !== null) writeFileSync(out, JSON.stringify({ log, ...summary }, null, 2) + "\n");
  console.log(
    `offline-drill: connection log: ${summary.lines} lines (${summary.apiLines} of the API); ` +
      `loopback ${summary.byCategory.loopback}, socket ${summary.byCategory.socket}, outside ${summary.byCategory.outside}`,
  );
  for (const p of summary.problems) console.log(p);
  process.exit(summary.result === "PASS" ? 0 : 1);
}
