#!/usr/bin/env node
// The post-suite log scan (ADR-0053 §5; REQ-S16-029 acceptance "A12;A22: a log scan after the test suite finds no
// secrets or storage URLs"; T-DG6-DO-D). It reads the log files a test run wrote (API and worker output, under the
// run's $TMPDIR) and fails when any line contains:
//   - the literal value of a canary secret: every environment variable whose value starts with `mth-canary-` (the test
//     environment sets them for the database password, the OIDC client secret, the S3 keys and the SMTP password),
//     plus each --canary value;
//   - one of the fixed patterns: a private-key block header, an AWS access-key id, an X-Amz-Signature or
//     X-Amz-Credential parameter, a bearer token, a JWT, a 43-character deep-link token;
//   - the configured object-store host (--store-host, or MTH_LOG_SCAN_STORE_HOSTS, comma-separated);
//   - the EVIDENCE_STORAGE_PATH prefix (--storage-path, or EVIDENCE_STORAGE_PATH).
//
//   node deploy/scripts/log-scan.mjs [--require-canaries] [--canary <v>]... [--store-host <host>]...
//                                    [--storage-path <prefix>]... <file-or-directory>...
//
// Exit 0 and "log-scan: PASS" when nothing matches; exit 1 and one "file:line: <class>: <masked line>" per hit (the
// match itself is never printed); exit 2 (BLOCKED, never a pass) on a usage error, an input under docs/delivery
// (D-138: the scan never reads delivery folders), no readable log file, or --require-canaries without a canary.
// No dependency, no network.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CANARY_PREFIX = "mth-canary-";

/** ADR-0053 §5's fixed patterns, by class. */
export const FIXED_PATTERNS = Object.freeze([
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["aws-access-key-id", /AKIA[0-9A-Z]{16}/g],
  ["x-amz-signature", /X-Amz-Signature=/g],
  ["x-amz-credential", /X-Amz-Credential=/g],
  ["bearer-token", /Bearer [A-Za-z0-9._~+/-]{20,}/g],
  ["jwt", /eyJ[A-Za-z0-9_-]{10,}\.eyJ/g],
  ["deep-link-token", /\/links\/[A-Za-z0-9_-]{43}/g],
]);

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Builds the full rule list: [class, RegExp] for the fixed patterns, the canaries, the store hosts and paths. */
export function buildRules({ canaries = [], storeHosts = [], storagePaths = [] } = {}) {
  const rules = FIXED_PATTERNS.map(([name, re]) => [name, new RegExp(re.source, "g")]);
  for (const c of new Set(canaries)) if (c.length > 0) rules.push(["canary-secret", new RegExp(escapeRegExp(c), "g")]);
  for (const h of new Set(storeHosts.map((x) => x.toLowerCase())))
    if (h.length > 0)
      rules.push(["object-store-host", new RegExp(`(?<![A-Za-z0-9.-])${escapeRegExp(h)}(?![A-Za-z0-9-])`, "gi")]);
  for (const p of new Set(storagePaths.map((x) => x.replace(/\/+$/, ""))))
    if (p.length > 1) rules.push(["evidence-storage-path", new RegExp(escapeRegExp(p), "g")]);
  return rules;
}

/** One line's hits: the classes it matches and the line with every match masked (truncated to 200 characters). */
export function scanLine(line, rules) {
  const classes = [];
  let masked = line;
  for (const [name, re] of rules) {
    re.lastIndex = 0;
    if (re.test(line)) {
      classes.push(name);
      masked = masked.replace(new RegExp(re.source, re.flags), `«masked:${name}»`);
    }
  }
  return { classes, masked: masked.length > 200 ? `${masked.slice(0, 200)}…` : masked };
}

function listFiles(path, out) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path).sort()) listFiles(join(path, name), out);
  } else if (st.isFile()) out.push(path);
  return out;
}

/** True when `path` is inside docs/delivery, or contains it (a directory walk would reach it). */
function touchesDeliveryRecords(path) {
  const delivery = join(repoRoot, "docs", "delivery");
  let real;
  try {
    real = realpathSync(path);
  } catch {
    real = resolve(path);
  }
  const inside = (child, parent) => {
    const rel = relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  return inside(real, delivery) || inside(delivery, real);
}

export function parseArgs(argv, env = process.env) {
  const opts = { canaries: [], storeHosts: [], storagePaths: [], inputs: [], requireCanaries: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--require-canaries") opts.requireCanaries = true;
    else if (a === "--canary") opts.canaries.push(next());
    else if (a === "--store-host") opts.storeHosts.push(next());
    else if (a === "--storage-path") opts.storagePaths.push(next());
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else opts.inputs.push(a);
  }
  for (const [name, value] of Object.entries(env))
    if (typeof value === "string" && value.startsWith(CANARY_PREFIX) && !name.startsWith("npm_"))
      opts.canaries.push(value);
  for (const h of (env.MTH_LOG_SCAN_STORE_HOSTS ?? "").split(",")) if (h.trim()) opts.storeHosts.push(h.trim());
  if (opts.storagePaths.length === 0 && env.EVIDENCE_STORAGE_PATH) opts.storagePaths.push(env.EVIDENCE_STORAGE_PATH);
  return opts;
}

/** Runs the scan; returns { status, lines } where lines is the report (status 0 PASS, 1 FAIL, 2 BLOCKED). */
export function runScan(opts) {
  const report = [];
  if (opts.inputs.length === 0) return { status: 2, lines: ["log-scan: BLOCKED: no log file or directory given"] };
  for (const input of opts.inputs)
    if (touchesDeliveryRecords(input))
      return { status: 2, lines: [`log-scan: BLOCKED: ${input} is or contains docs/delivery (D-138: never scanned)`] };
  if (opts.requireCanaries && opts.canaries.length === 0)
    return { status: 2, lines: [`log-scan: BLOCKED: --require-canaries and no ${CANARY_PREFIX}* value is set`] };
  let files = [];
  try {
    for (const input of opts.inputs) listFiles(input, files);
  } catch (err) {
    return {
      status: 2,
      lines: [`log-scan: BLOCKED: cannot read ${err.path ?? "an input"} (${err.code ?? err.message})`],
    };
  }
  files = [...new Set(files)];
  if (files.length === 0) return { status: 2, lines: ["log-scan: BLOCKED: no log file found in the inputs"] };
  const rules = buildRules(opts);
  let lineCount = 0;
  let hits = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line === "" && i === lines.length - 1) return;
      lineCount++;
      const { classes, masked } = scanLine(line, rules);
      if (classes.length === 0) return;
      hits++;
      report.push(`${file}:${i + 1}: ${classes.join(",")}: ${masked}`);
    });
  }
  const summary =
    `${files.length} file(s), ${lineCount} line(s), ${new Set(opts.canaries).size} canary value(s), ` +
    `${FIXED_PATTERNS.length} fixed pattern(s), ${new Set(opts.storeHosts).size} store host(s), ` +
    `${new Set(opts.storagePaths).size} storage path(s)`;
  if (hits > 0) return { status: 1, lines: [...report, `log-scan: FAIL: ${hits} line(s) matched; ${summary}`] };
  return { status: 0, lines: [`log-scan: PASS: ${summary}`] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`log-scan: BLOCKED: ${err.message}`);
    process.exit(2);
  }
  const { status, lines } = runScan(opts);
  for (const l of lines) (status === 0 ? console.log : console.error)(l);
  process.exit(status);
}
