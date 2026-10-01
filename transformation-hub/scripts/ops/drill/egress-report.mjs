#!/usr/bin/env node
// =====================================================================================================================
// Private-mode egress verdict from `strace -f -e trace=connect,sendto,sendmsg,sendmmsg` logs (AT-22, REQ-DEP-014).
//
//   node egress-report.mjs <label>=<strace.log> [<label>=<strace.log> …] [--require-local <label>,<label>]
//
// Every process of the application is traced with all its threads and children (the API, the worker and the PDF
// browser it launches, the web server). Each socket address the processes tried to reach is classified:
//   local     AF_INET/AF_INET6 loopback (127.0.0.0/8, ::1, ::ffff:127.x) on a port other than 53, AF_UNIX paths
//   dns       ANY address on port 53 — a host-name lookup is an attempt to leave the host in private mode
//   external  any other AF_INET/AF_INET6 address — an unapproved outbound connection attempt
// The verdict is FAIL when a single dns or external attempt exists, whether or not it succeeded (the drill runs in a
// network namespace with only loopback, so every such attempt fails with ENETUNREACH — strace still records it).
// --require-local lists processes that must show local traffic (proof that the trace really captured them).
// =====================================================================================================================
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const requireLocal = new Set();
const requireExec = new Map(); // label → executable basename that must have been launched under the trace
const logs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--require-local') {
    for (const l of (args[++i] ?? '').split(',').filter(Boolean)) requireLocal.add(l);
    continue;
  }
  if (args[i] === '--require-exec') {
    for (const pair of (args[++i] ?? '').split(',').filter(Boolean)) {
      const [l, exe] = pair.split(':');
      requireExec.set(l, exe);
    }
    continue;
  }
  const eq = args[i].indexOf('=');
  if (eq < 1) throw new Error(`expected <label>=<file>, got ${args[i]}`);
  logs.push({ label: args[i].slice(0, eq), file: args[i].slice(eq + 1) });
}

const SYSCALL = /\b(connect|sendto|sendmsg|sendmmsg)\(/;
const INET = /sa_family=AF_INET, sin_port=htons\((\d+)\), sin_addr=inet_addr\("([^"]+)"\)/g;
const INET6 = /sa_family=AF_INET6, sin6_port=htons\((\d+)\)[^}]*?inet_pton\(AF_INET6, "([^"]+)"/g;
const UNIX = /sa_family=AF_UNIX, sun_path=(?:@)?"([^"]*)"/g;

const loopback = (addr) => /^127\./.test(addr) || addr === '::1' || /^::ffff:127\./i.test(addr);

let failed = false;
const out = [];
for (const { label, file } of logs) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    out.push(`FAIL  egress trace ${label.padEnd(10)} trace file missing: ${file}`);
    failed = true;
    continue;
  }
  const pids = new Set();
  const local = new Map();
  const unix = new Map();
  const execs = new Map();
  const bad = [];
  for (const line of text.split('\n')) {
    const pid = /^(\d+) /.exec(line)?.[1];
    if (pid) pids.add(pid);
    const ex = /\bexecve\("([^"]+)"/.exec(line);
    if (ex && !/= -1 /.test(line)) {
      const exe = ex[1].replace(/.*\//, '');
      execs.set(exe, (execs.get(exe) ?? 0) + 1);
    }
    if (!SYSCALL.test(line)) continue;
    const call = SYSCALL.exec(line)[1];
    const outcome = /\) = (-?\d+.*)$/.exec(line)?.[1] ?? 'unfinished';
    for (const re of [INET, INET6]) {
      re.lastIndex = 0;
      for (let m; (m = re.exec(line)); ) {
        const port = Number(m[1]);
        const addr = m[2];
        if (port === 53) bad.push(`dns ${call} ${addr}:53 → ${outcome}`);
        else if (!loopback(addr)) bad.push(`external ${call} ${addr}:${port} → ${outcome}`);
        else local.set(`${addr}:${port}`, (local.get(`${addr}:${port}`) ?? 0) + 1);
      }
    }
    UNIX.lastIndex = 0;
    for (let m; (m = UNIX.exec(line)); ) unix.set(m[1] || '(unnamed)', (unix.get(m[1] || '(unnamed)') ?? 0) + 1);
  }
  const localSummary = [...local].map(([k, n]) => `${k}×${n}`).join(' ') || 'none';
  const unixSummary = [...unix].map(([k, n]) => `${k.replace(/.*\/(?=[^/]+$)/, '…/')}×${n}`).join(' ') || 'none';
  const execSummary = [...execs].map(([k, n]) => `${k}×${n}`).join(' ') || 'none';
  out.push(`INFO  egress trace ${label.padEnd(10)} processes/threads=${pids.size} executables=[${execSummary}] loopback=[${localSummary}] unix=[${unixSummary}]`);
  if (requireExec.has(label)) {
    const exe = requireExec.get(label);
    if (execs.has(exe)) out.push(`PASS  trace covered ${exe} launched by ${label.padEnd(10)} ${execs.get(exe)} execve(s) of ${exe} recorded under the same trace`);
    else {
      failed = true;
      out.push(`FAIL  trace covered ${exe} launched by ${label}: no execve of ${exe} in the trace`);
    }
  }
  if (bad.length) {
    failed = true;
    const uniq = [...new Set(bad)];
    out.push(`FAIL  no unapproved egress: ${label.padEnd(10)} ${bad.length} attempt(s): ${uniq.slice(0, 12).join('; ')}${uniq.length > 12 ? ' …' : ''}`);
  } else {
    out.push(`PASS  no unapproved egress: ${label.padEnd(10)} 0 external / 0 DNS attempts (${pids.size} processes/threads traced)`);
  }
  if (requireLocal.has(label) && local.size === 0 && unix.size === 0) {
    failed = true;
    out.push(`FAIL  trace captured ${label}: no socket activity at all — the trace did not observe the process`);
  }
}
process.stdout.write(out.join('\n') + '\n');
process.exit(failed ? 1 : 0);
