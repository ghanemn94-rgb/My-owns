#!/usr/bin/env bash
# offline-drill.sh: the lifecycle e2e suite with outbound network disabled (ADR-0069 §5; p7-work-split §B.3, §B.4 T-B13;
# T-DG7-DO-E). REQ-S19-018 first half "the lifecycle e2e suite passes with egress blocked", REQ-S01-006 "runs key
# workflows with outbound public internet disabled"; the connection log closes the REQ-S17-009 residual "the A18
# capture is DG7's" (a connection log of the Node processes, not a packet capture: D-195 Q8).
#
#   deploy/scripts/offline-drill.sh --out <dir> [--spec <e2e/....spec.ts>]...
#
# The whole run happens inside ONE `bwrap --dev-bind / / --unshare-net` namespace, which this script enters itself
# (loopback up, no route off the host; never `unshare --net`, whose loopback is down: ADR-0069 §Context 5). Its first
# step is the network probe of ADR-0062 §5.1 (a TCP connect to 1.1.1.1:443 and a DNS lookup of registry.npmjs.org must
# both fail; MTH_EGRESS_PROBE / MTH_EGRESS_DNS_PROBE override the targets, as in transfer-drill.sh).
#
# The specs: every e2e/a02-*.spec.ts and e2e/a21-*.spec.ts present (or the --spec list), in both Playwright projects
# (chromium-en, chromium-ar), on the stack each spec's header names: e2e/support/with-demo-stack.sh (a demo database,
# `mth-db seed-demo`) when its first 25 lines name it, else apps/web/e2e/support/with-stack.sh. Both stacks start a
# disposable PostgreSQL cluster and the BUILT API serving the BUILT SPA, as the specs were written for (ADR-0069 §5 says
# "through ci-e2e-stack.mjs"; that launcher needs an already running PostgreSQL service, which the namespace does not
# have, so the specs' own stacks are used: disclosed in T-DG7-DO-E's handback). Every Node process of the run (API,
# migrate, seed, Playwright runner, worker) writes the product's connection log (packages/config connection-log.ts,
# through e2e/support/connection-log-preload.mjs) to <out>/connections.ndjson; the stacks run with NODE_ENV
# development/test, because the log writes nothing under production. drill/connection-check.mjs then fails the drill if
# any logged connection went outside 127.0.0.0/8, ::1 or a socket (p7-work-split §B.5 line).
#
# Browsers: Playwright's Chromium already installed for the e2e suite (PLAYWRIGHT_BROWSERS_PATH). It is never
# downloaded; without it the drill is BLOCKED (exit 3).
#
# Output (--out): offline-drill-report.json (schemaVersion mth-offline-drill/1: the probe results, the spec list with
# their outcomes per project, the connection-log summary, seconds, result), connections.ndjson, connection-check.json,
# playwright-<group>.json, offline-drill.log.
#
# Exit codes (p7-work-split §2 rule 4): 0 PASS; 1 FAIL (isolation not effective, a spec failed, a connection outside
# loopback, no API line in the log); 2 BLOCKED (usage); 3 BLOCKED (no bwrap, no installed Chromium, no PostgreSQL
# server binaries, no build). Everything is synthetic. A local drill is not evidence of high-availability production
# readiness, and it approves nothing (no G1-G6 decision, no DG0-DG7 record).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT="" SPECS=()
usage() {
  echo "offline-drill: BLOCKED: usage: offline-drill.sh --out <dir> [--spec <e2e/....spec.ts>]..." >&2
  exit 2
}
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 ;;
    --spec) SPECS+=("${2:-}"); shift 2 ;;
    *) usage ;;
  esac
done

# ---------------------------------------------------------------------------------------------------- outer mode
if [ "${MTH_OD_INNER:-}" != "1" ]; then
  [ -n "$OUT" ] || usage
  for s in "${SPECS[@]}"; do [ -f "$REPO/$s" ] || { echo "offline-drill: BLOCKED: spec $s not found" >&2; exit 2; }; done
  # Chromium first: the installed browser of the pinned @playwright/test, never downloaded.
  if ! (cd "$REPO" && node --input-type=module -e '
    import { existsSync } from "node:fs";
    const { chromium } = await import("@playwright/test");
    const p = chromium.executablePath();
    process.exit(p && existsSync(p) ? 0 : 1);' >/dev/null 2>&1); then
    echo "offline-drill: BLOCKED: no installed Chromium for Playwright (it is never downloaded)"
    exit 3
  fi
  if ! command -v bwrap >/dev/null 2>&1 || ! bwrap --dev-bind / / --unshare-net true 2>/dev/null; then
    echo "offline-drill: BLOCKED: no network namespace with loopback (bwrap unavailable)"
    exit 3
  fi
  PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  for b in initdb postgres; do
    [ -n "$PGBIN" ] && [ -x "$PGBIN/$b" ] || {
      echo "offline-drill: BLOCKED: PostgreSQL server binaries not found (set PGBIN)"
      exit 3
    }
  done
  for f in apps/api/dist/main.js apps/web/dist/index.html packages/db/dist/cli.js packages/config/dist/connection-log.js; do
    [ -f "$REPO/$f" ] || { echo "offline-drill: BLOCKED: $f not found (run 'pnpm -r build' first)"; exit 3; }
  done
  mkdir -p "$OUT"
  OUT="$(cd "$OUT" && pwd)"
  # One run per output directory: a second run into the same directory would mix two connection logs and reports.
  [ -z "$(ls -A "$OUT")" ] || { echo "offline-drill: BLOCKED: output directory $OUT is not empty" >&2; exit 2; }
  PASS_ON=(--out "$OUT")
  for s in "${SPECS[@]}"; do PASS_ON+=(--spec "$s"); done
  set +e
  MTH_OD_INNER=1 PGBIN="$PGBIN" bwrap --dev-bind / / --unshare-net --die-with-parent \
    bash "$HERE/offline-drill.sh" "${PASS_ON[@]}" 2>&1 | tee "$OUT/offline-drill.log"
  rc="${PIPESTATUS[0]}"
  set -e
  exit "$rc"
fi

# ---------------------------------------------------------------------------------------------------- inner mode
INNER_SPECS=("${SPECS[@]}")
cd "$REPO"
export LANG=C.UTF-8 TZ=UTC
T_ALL="$(date +%s.%N)"
clock() { date +%s.%N; }
secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.3f", (b - a) }'; }
log() { echo "offline-drill: $*"; }
log "out $OUT; environment: node $(node --version); $(bwrap --version 2>/dev/null || echo 'bwrap (version unknown)'); PostgreSQL $("$PGBIN/postgres" --version | awk '{print $3}'); uid $(id -u); PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-(default)}"

# ---- the network probe (ADR-0062 §5.1) ------------------------------------------------------------------------------
PROBE_JSON="$OUT/probe.json"
if ! node -e '
  const net = require("node:net"), dns = require("node:dns"), fs = require("node:fs");
  const r = { tcp: null, dns: null };
  let bad = 0, n = 0;
  const done = () => { if (++n === 2) { fs.writeFileSync(process.argv[1], JSON.stringify({ ...r, isolated: !bad }) + "\n"); process.exit(bad ? 1 : 0); } };
  const [host, port] = (process.env.MTH_EGRESS_PROBE || "1.1.1.1:443").split(":");
  const name = process.env.MTH_EGRESS_DNS_PROBE || "registry.npmjs.org";
  const s = net.connect({ host, port: Number(port), timeout: 5000 });
  s.on("connect", () => { r.tcp = `${host}:${port} CONNECTED`; console.log(`probe tcp ${r.tcp}`); bad = 1; s.destroy(); done(); });
  s.on("timeout", () => { r.tcp = `${host}:${port} timeout`; console.log(`probe tcp ${r.tcp}`); s.destroy(); done(); });
  s.on("error", (e) => { r.tcp = `${host}:${port} ${e.code}`; console.log(`probe tcp ${r.tcp}`); done(); });
  dns.lookup(name, (e, a) => { if (e) r.dns = `${name} ${e.code}`; else { r.dns = `${name} RESOLVED ${a}`; bad = 1; } console.log(`probe dns ${r.dns}`); done(); });
' "$PROBE_JSON"; then
  echo "offline-drill: network isolation is not effective"
  exit 1
fi
log "probe: network isolation effective (no route, no resolver); loopback only"

# ---- the spec list and its stacks ------------------------------------------------------------------------------------
if [ "${#INNER_SPECS[@]}" -eq 0 ]; then
  mapfile -t INNER_SPECS < <(find e2e -maxdepth 1 \( -name 'a02-*.spec.ts' -o -name 'a21-*.spec.ts' \) | LC_ALL=C sort)
fi
[ "${#INNER_SPECS[@]}" -gt 0 ] || { echo "offline-drill: no e2e/a02-*.spec.ts or e2e/a21-*.spec.ts found"; exit 1; }
DEMO=() PLAIN=()
for s in "${INNER_SPECS[@]}"; do
  if head -25 "$s" | grep -q 'with-demo-stack\.sh'; then DEMO+=("$s"); else PLAIN+=("$s"); fi
done
log "specs on the demo stack: ${DEMO[*]:-(none)}"
log "specs on the plain stack: ${PLAIN[*]:-(none)}"

LOG="$OUT/connections.ndjson"
: >"$LOG"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mth-offline-drill.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
GROUPS_FILE="$OUT/groups.ndjson"
: >"$GROUPS_FILE"
# run_group <name> <stack> <api port> <pg port> <specs...>
run_group() {
  local name="$1" stack="$2" api="$3" pg="$4"; shift 4
  [ $# -gt 0 ] || return 0
  local t0 rc; t0="$(clock)"
  log "group $name: $stack; $*"
  set +e
  # MTH_PORT_POOL is set explicitly: a21-p6-degradation's fresh-install API takes its port from it (pg-port.sh policy).
  MTH_PORT_POOL="${MTH_PORT_POOL:-25000-31999}" MTH_CONNECTION_LOG="$LOG" NODE_OPTIONS="${NODE_OPTIONS:-} --import $REPO/e2e/support/connection-log-preload.mjs" \
    E2E_API_PORT="$api" E2E_PG_PORT="$pg" PLAYWRIGHT_JSON_OUTPUT_NAME="$OUT/playwright-$name.json" \
    "$stack" npx playwright test "$@" --workers=1 --reporter=list,json --output="$WORK/results-$name"
  rc=$?
  set -e
  log "group $name: exit $rc in $(secs "$t0" "$(clock)") s"
  node -e 'const [f, name, stack, rc, s, ...specs] = process.argv.slice(1);
    require("node:fs").appendFileSync(f, JSON.stringify({ group: name, stack, specs, exit: Number(rc), seconds: Number(s) }) + "\n");' \
    "$GROUPS_FILE" "$name" "$stack" "$rc" "$(secs "$t0" "$(clock)")" "$@"
}
# Ports: the namespace is fresh, so they are free; all in the pool 25000-31999.
run_group demo e2e/support/with-demo-stack.sh 25310 25440 "${DEMO[@]}"
run_group plain apps/web/e2e/support/with-stack.sh 25320 25450 "${PLAIN[@]}"

# ---- the connection log ------------------------------------------------------------------------------------------------
set +e
node "$REPO/deploy/scripts/drill/connection-check.mjs" --log "$LOG" --out "$OUT/connection-check.json"
CHECK=$?
set -e

# ---- the report --------------------------------------------------------------------------------------------------------
node -e '
  const fs = require("node:fs");
  const [out, groupsFile, probeFile, checkFile, check, seconds] = process.argv.slice(1);
  const groups = fs.readFileSync(groupsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const specs = [];
  for (const g of groups) {
    const pw = `${out}/playwright-${g.group}.json`;
    const tally = new Map();
    if (fs.existsSync(pw)) {
      const walk = (suite, file) => {
        const f = suite.file ?? file;
        for (const s of suite.specs ?? [])
          for (const t of s.tests ?? []) {
            const k = `${f}\u0000${t.projectName}`;
            const e = tally.get(k) ?? { file: f, project: t.projectName, passed: 0, failed: 0, skipped: 0, flaky: 0 };
            const st = t.status === "expected" ? "passed" : t.status === "unexpected" ? "failed" : t.status === "flaky" ? "flaky" : "skipped";
            e[st] += 1;
            tally.set(k, e);
          }
        for (const c of suite.suites ?? []) walk(c, f);
      };
      for (const s of JSON.parse(fs.readFileSync(pw, "utf8")).suites ?? []) walk(s, undefined);
    }
    for (const e of tally.values())
      specs.push({ ...e, file: e.file.startsWith("e2e/") ? e.file : `e2e/${e.file}`, stack: g.stack,
        outcome: e.failed > 0 || e.flaky > 0 ? "FAIL" : e.passed > 0 ? "PASS" : "NOT_RUN" });
    for (const f of g.specs)
      if (!specs.some((s) => s.file === f)) specs.push({ file: f, project: null, stack: g.stack, passed: 0, failed: 0, skipped: 0, flaky: 0, outcome: "NOT_RUN" });
  }
  const probe = JSON.parse(fs.readFileSync(probeFile, "utf8"));
  const connections = fs.existsSync(checkFile) ? JSON.parse(fs.readFileSync(checkFile, "utf8")) : null;
  const ok = probe.isolated && groups.length > 0 && groups.every((g) => g.exit === 0) && specs.length > 0 &&
    specs.every((s) => s.outcome === "PASS") && Number(check) === 0;
  const report = {
    schemaVersion: "mth-offline-drill/1",
    generatedAt: new Date().toISOString(),
    mode: "container-free, inside one bwrap --unshare-net namespace (agent sandbox; ADR-0069 §5, §7 split)",
    note: "Synthetic data. Not evidence of high-availability production readiness. Approves nothing (no G1-G6 decision, no DG0-DG7 record). A connection log of the Node processes, not a packet capture.",
    probe,
    groups,
    specs,
    connections: connections && { lines: connections.lines, apiLines: connections.apiLines, byCategory: connections.byCategory,
      byProcess: connections.byProcess, destinations: connections.destinations, outside: connections.outside, result: connections.result,
      exit: Number(check) },
    seconds: Number(seconds),
    result: ok ? "PASS" : "FAIL",
  };
  fs.writeFileSync(`${out}/offline-drill-report.json`, JSON.stringify(report, null, 2) + "\n");
  const n = specs.filter((s) => s.outcome === "PASS").length;
  console.log(`offline-drill: ${report.result} in ${seconds} s: ${n} of ${specs.length} spec runs passed; connection log ${connections ? connections.result : "missing"}; report ${out}/offline-drill-report.json`);
  process.exit(ok ? 0 : 1);
' "$OUT" "$GROUPS_FILE" "$PROBE_JSON" "$OUT/connection-check.json" "$CHECK" "$(secs "$T_ALL" "$(clock)")"
