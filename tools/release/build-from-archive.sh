#!/usr/bin/env bash
# Build the hub from the release archive with NO network (ADR-0062 §5.1; REQ-S19-002).
#
#   tools/release/build-from-archive.sh <archive.tar.gz> --sha256 <hex> --store <pnpm store dir> [--work <dir>] [--keep]
#
# 1. checks the archive checksum before unpacking; 2. unpacks into an EMPTY work directory (default: a new directory
# under $TMPDIR) and asserts source/.git does not exist; 3. enters a network namespace with no interfaces
# (unshare --user --map-root-user --net, else bwrap --unshare-net); 4. probes that a TCP connect to 1.1.1.1:443 and a
# DNS lookup of registry.npmjs.org both FAIL; 5. inside the namespace, from source/: offline frozen install from the
# store, pnpm -r build, deploy/scripts/assemble-runtime.sh, check-no-cdn and scan-assets; 6. prints each step with its
# duration and exit status, and the SHA-256 of apps/web/dist/index.html and of the runtime tree listing.
#
# Exit codes: 0 PASS; 1 FAIL (checksum, a step, or network isolation not effective); 2 BLOCKED (usage, missing input);
# 3 BLOCKED (no network namespace). It never builds with the network on.
# The image build and `docker compose up` from the archive need a Docker daemon and are the orchestrator's half
# (D-243 Q1); they are not part of this script. A local build is not evidence of production readiness.
set -euo pipefail

usage() { echo "usage: build-from-archive.sh <archive.tar.gz> --sha256 <hex> --store <pnpm store dir> [--work <dir>] [--keep]" >&2; exit 2; }
ARCHIVE=""; SHA=""; STORE=""; WORK=""; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --sha256) SHA="${2:-}"; shift 2 ;;
    --store) STORE="${2:-}"; shift 2 ;;
    --work) WORK="${2:-}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -*) usage ;;
    *) [ -z "$ARCHIVE" ] || usage; ARCHIVE="$1"; shift ;;
  esac
done

# ---- inner mode: runs inside the network namespace --------------------------------------------------------------
if [ "${MTH_BFA_INNER:-}" = "1" ]; then
  SRC="$MTH_BFA_SRC"; STORE="$MTH_BFA_STORE"; RUNTIME="$MTH_BFA_RUNTIME"
  node -e '
    const net = require("node:net"), dns = require("node:dns");
    let ok = 0;
    const s = net.connect({ host: "1.1.1.1", port: 443, timeout: 5000 });
    s.on("connect", () => { console.log("probe tcp 1.1.1.1:443: CONNECTED"); process.exit(1); });
    s.on("timeout", () => { console.log("probe tcp 1.1.1.1:443: timeout"); s.destroy(); done(); });
    s.on("error", (e) => { console.log(`probe tcp 1.1.1.1:443: failed (${e.code})`); done(); });
    dns.lookup("registry.npmjs.org", (e, a) => {
      if (!e) { console.log(`probe dns registry.npmjs.org: RESOLVED ${a}`); process.exit(1); }
      console.log(`probe dns registry.npmjs.org: failed (${e.code})`); done();
    });
    function done() { if (++ok === 2) process.exit(0); }
  ' || { echo "build-from-archive: network isolation is not effective"; exit 1; }
  export GIT_DIR=/nonexistent GIT_CEILING_DIRECTORIES="$(dirname "$SRC")" CI=true
  cd "$SRC"
  status=0
  step() {
    local name="$1"; shift
    local t0 t1 rc
    t0=$(date +%s.%N)
    set +e; "$@" > "$MTH_BFA_LOGS/$name.log" 2>&1; rc=$?; set -e
    t1=$(date +%s.%N)
    printf 'step %-14s exit %d  %6.1fs  (log %s)\n' "$name" "$rc" "$(awk "BEGIN{print $t1 - $t0}")" "$MTH_BFA_LOGS/$name.log"
    if [ "$rc" -ne 0 ]; then tail -20 "$MTH_BFA_LOGS/$name.log" | sed 's/^/    | /'; status=1; return 1; fi
  }
  step install pnpm install --frozen-lockfile --offline --store-dir "$STORE" || exit 1
  step build pnpm -r build || exit 1
  # Kept for the scan: assemble-runtime prunes the work copy to production dependencies in place, as designed.
  step assemble deploy/scripts/assemble-runtime.sh --store-dir "$STORE" . "$RUNTIME" || exit 1
  step check-no-cdn node scripts/check-no-cdn.mjs apps packages || exit 1
  step scan-assets node tools/release/scan-assets.mjs --web apps/web/dist --runtime "$RUNTIME" --config . || exit 1
  echo "sha256 apps/web/dist/index.html $(sha256sum apps/web/dist/index.html | cut -d' ' -f1)"
  echo "sha256 runtime-tree-listing $(cd "$RUNTIME" && find . -type f -o -type l | LC_ALL=C sort | sha256sum | cut -d' ' -f1)"
  exit "$status"
fi

# ---- outer mode ------------------------------------------------------------------------------------------------------
[ -n "$ARCHIVE" ] && [ -n "$SHA" ] && [ -n "$STORE" ] || usage
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || { echo "build-from-archive: BLOCKED: --sha256 must be 64 lowercase hex" >&2; exit 2; }
[ -f "$ARCHIVE" ] || { echo "build-from-archive: BLOCKED: archive $ARCHIVE not found" >&2; exit 2; }
[ -d "$STORE" ] || { echo "build-from-archive: BLOCKED: pnpm store $STORE not found" >&2; exit 2; }
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
STORE="$(cd "$STORE" && pwd)"
# `pnpm store path` prints <store-dir>/v10, while --store-dir takes the parent: accept either.
if [ "$(basename "$STORE")" = "v10" ] && [ -d "$STORE/files" ]; then STORE="$(dirname "$STORE")"; fi
echo "store $STORE"

actual="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
if [ "$actual" != "$SHA" ]; then
  echo "build-from-archive: archive checksum $actual does not match $SHA" >&2
  exit 1
fi
echo "checksum ok $actual"

if [ -z "$WORK" ]; then WORK="$(mktemp -d "${TMPDIR:-/tmp}/mth-build-from-archive.XXXXXX")"; fi
mkdir -p "$WORK"
[ -z "$(ls -A "$WORK")" ] || { echo "build-from-archive: BLOCKED: work directory $WORK is not empty" >&2; exit 2; }
WORK="$(cd "$WORK" && pwd)"
cleanup() { if [ "$KEEP" -eq 0 ]; then rm -rf "$WORK"; fi; }
trap cleanup EXIT

t0=$(date +%s.%N)
mkdir -p "$WORK/unpacked" "$WORK/logs"
tar -xzf "$ARCHIVE" -C "$WORK/unpacked"
TOP="$(ls "$WORK/unpacked")"
[ "$(echo "$TOP" | wc -l)" -eq 1 ] || { echo "build-from-archive: the archive has more than one top-level entry" >&2; exit 1; }
SRC="$WORK/unpacked/$TOP/source"
[ -d "$SRC" ] || { echo "build-from-archive: no source/ directory in the archive" >&2; exit 1; }
if [ -e "$SRC/.git" ]; then echo "build-from-archive: source/.git exists" >&2; exit 1; fi
printf 'step %-14s exit 0  %6.1fs  (no source/.git)\n' unpack "$(awk "BEGIN{print $(date +%s.%N) - $t0}")"

if unshare --user --map-root-user --net true 2>/dev/null; then
  NS=(unshare --user --map-root-user --net)
  echo "namespace unshare --user --map-root-user --net ($(unshare --version | head -1))"
elif bwrap --dev-bind / / --unshare-net true 2>/dev/null; then
  NS=(bwrap --dev-bind / / --unshare-net)
  echo "namespace bwrap --dev-bind / / --unshare-net ($(bwrap --version))"
else
  echo "build-from-archive: BLOCKED: no network namespace (unshare and bwrap unavailable)"
  exit 3
fi

set +e
MTH_BFA_INNER=1 MTH_BFA_SRC="$SRC" MTH_BFA_STORE="$STORE" MTH_BFA_RUNTIME="$WORK/runtime" MTH_BFA_LOGS="$WORK/logs" \
  "${NS[@]}" bash "$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
rc=$?
set -e
printf 'total %.1fs\n' "$(awk "BEGIN{print $(date +%s.%N) - $t0}")"
if [ "$rc" -eq 0 ]; then echo "build-from-archive: PASS"; else echo "build-from-archive: FAIL (exit $rc)"; fi
exit "$rc"
