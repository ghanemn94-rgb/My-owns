#!/usr/bin/env bash
# F-DG2-310 regression check: a client socket in TIME_WAIT on the harness's PostgreSQL port must not stop a
# disposable-cluster harness from starting (tests/qa/support/pg-port.sh port policy).
#
#   tests/qa/support/port-collision-check.sh [--old-rev REV]
#
# For each case it first PROVES the collision: a client socket is bound to port P (no SO_REUSEADDR, like any
# kernel-assigned ephemeral client port), connects, closes first and is left in TIME_WAIT (state 06 in
# /proc/net/tcp); a probe bind+listen on P WITH SO_REUSEADDR (what postgres does) must fail with EADDRINUSE.
#   C1 negative control (P = 54351, its old default): the OLD tests/qa/support/with-pg.sh (from --old-rev, default 06430a4c, the revision before
#      the fix) with QA_PG_PORT=P must FAIL CLOSED: exit 3 and "BLOCKED: disposable PostgreSQL did not start".
#   C2 the current with-pg.sh with QA_PG_PORT=P (54331, an old default, inside the ephemeral range) must start by retrying:
#      exit 0, a "retrying on port N" log line, and TEST_DATABASE_ADMIN_URL on N != P.
#   C3 the same with the NEW default port (QA_PG_PORT unset; TIME_WAIT on 24351).
#   C4 QA_PG_PORT=24352 and QA_PG_STRICT_PORT=1: no retry; exit 3 with "BLOCKED: ...".
#   C5 the generic API path (mth_start_with_port_retry, as used by with-stack/qa-stack/a18/clean-start-local) with a
#      Node HTTP server (Node sets SO_REUSEADDR, like the API): retries on EADDRINUSE and is reachable on the new port.
# Exit 0 = all cases behaved as expected; 1 = a case did not; 3 = BLOCKED (missing tool, or the collision could not
# be reproduced, which would make the check meaningless).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OLD_REV="06430a4c698e3db0d7b4b9645bdaaa6bcfddf87f"
while [ $# -gt 0 ]; do
  case "$1" in
    --old-rev) OLD_REV="$2"; shift ;;
    *) echo "usage: $0 [--old-rev REV]" >&2; exit 64 ;;
  esac
  shift
done
for t in python3 node git psql; do command -v "$t" >/dev/null || { echo "BLOCKED: $t not found"; exit 3; }; done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/port-collision.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
git -C "$ROOT" show "$OLD_REV:tests/qa/support/with-pg.sh" >"$WORK/with-pg.old.sh"
chmod +x "$WORK/with-pg.old.sh"
FAILS=0
pass() { echo "  PASS $*"; }
bad() { echo "  FAIL $*"; FAILS=$((FAILS + 1)); }

# Leaves a client socket bound to 127.0.0.1:$1 in TIME_WAIT and proves a SO_REUSEADDR bind on it fails.
make_time_wait() {
  python3 -I - "$1" <<'PY'
import errno, socket, sys, time
p = int(sys.argv[1])
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", 0)); srv.listen()
c = socket.socket(); c.bind(("127.0.0.1", p)); c.connect(srv.getsockname())
a, _ = srv.accept()
c.close()  # the client closes first -> ITS socket (local port p) enters TIME_WAIT
time.sleep(0.2); a.close(); srv.close(); time.sleep(0.2)
hexp = "%04X" % p
states = [l.split()[3] for l in open("/proc/net/tcp").read().splitlines()[1:] if l.split()[1].endswith(":" + hexp)]
probe = socket.socket(); probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    probe.bind(("127.0.0.1", p)); probe.listen(); res = "bind OK (no collision)"
except OSError as e:
    res = "bind FAILED " + errno.errorcode[e.errno]
print("  collision on port %d: /proc/net/tcp states %s (06 = TIME_WAIT); SO_REUSEADDR probe: %s" % (p, states, res))
sys.exit(0 if "06" in states and "EADDRINUSE" in res else 1)
PY
}
collide() { make_time_wait "$1" || { echo "BLOCKED: could not reproduce the TIME_WAIT collision on port $1"; exit 3; }; }
port_of() { sed -n 's/^URL=postgresql:\/\/postgres@127.0.0.1:\([0-9]*\)\/postgres$/\1/p' "$1"; }

echo "environment: $(uname -srm); ephemeral range $(tr '\t' '-' </proc/sys/net/ipv4/ip_local_port_range); uid $(id -u);" \
  "$(python3 --version); node $(node --version); old harness from $OLD_REV"
SHOW='echo URL=$TEST_DATABASE_ADMIN_URL; psql "$TEST_DATABASE_ADMIN_URL" -qAtc "select '"'"'server port '"'"' || current_setting('"'"'port'"'"')"'

# Each case uses its own port: a port already in TIME_WAIT cannot be bound again by the next collide.
P=54351
echo; echo "== C1 negative control: OLD with-pg.sh, QA_PG_PORT=$P held in TIME_WAIT"
collide "$P"
set +e; T0=$SECONDS; QA_PG_PORT=$P "$WORK/with-pg.old.sh" bash -c "$SHOW" >"$WORK/c1.log" 2>&1; RC=$?; set -e
sed 's/^/  | /' "$WORK/c1.log" | grep -v '^  | [0-9-]* [0-9:.]* [A-Z]* \[[0-9]*\] LOG:' | head -12
echo "  exit $RC after $((SECONDS - T0)) s"
if [ "$RC" = 3 ] && grep -q 'BLOCKED: disposable PostgreSQL did not start' "$WORK/c1.log" \
  && grep -q 'Address already in use' "$WORK/c1.log"; then
  pass "old harness fails closed (exit 3, BLOCKED, postgres: Address already in use) -- the F-DG2-310 defect reproduced"
else
  bad "old harness: expected exit 3 + BLOCKED + Address already in use, got exit $RC"
fi

P=54331
echo; echo "== C2 NEW with-pg.sh, QA_PG_PORT=$P held in TIME_WAIT"
collide "$P"
set +e; QA_PG_PORT=$P "$HERE/with-pg.sh" bash -c "$SHOW" >"$WORK/c2.log" 2>&1; RC=$?; set -e
sed 's/^/  | /' "$WORK/c2.log"
USED="$(port_of "$WORK/c2.log")"
if [ "$RC" = 0 ] && grep -q "port $P is in use (EADDRINUSE; attempt 1 of" "$WORK/c2.log" && [ -n "$USED" ] \
  && [ "$USED" != "$P" ] && [ "$USED" -lt 32768 ] && grep -q "server port $USED" "$WORK/c2.log"; then
  pass "new harness retried and started on $USED (< 32768); exported URL and server agree"
else
  bad "new harness with a TIME_WAIT on $P: exit $RC, port '$USED'"
fi

P2=24351
echo; echo "== C3 NEW with-pg.sh, default port ($P2) held in TIME_WAIT"
collide "$P2"
set +e; env -u QA_PG_PORT "$HERE/with-pg.sh" bash -c "$SHOW" >"$WORK/c3.log" 2>&1; RC=$?; set -e
sed 's/^/  | /' "$WORK/c3.log"
USED="$(port_of "$WORK/c3.log")"
if [ "$RC" = 0 ] && grep -q "port $P2 is in use (EADDRINUSE" "$WORK/c3.log" && [ -n "$USED" ] && [ "$USED" != "$P2" ]; then
  pass "default port in TIME_WAIT: retried and started on $USED"
else
  bad "default port in TIME_WAIT: exit $RC, port '$USED'"
fi

P2=24352
echo; echo "== C4 NEW with-pg.sh, QA_PG_PORT=$P2 in TIME_WAIT with QA_PG_STRICT_PORT=1"
collide "$P2"
set +e; QA_PG_PORT=$P2 QA_PG_STRICT_PORT=1 "$HERE/with-pg.sh" bash -c "$SHOW" >"$WORK/c4.log" 2>&1; RC=$?; set -e
sed 's/^/  | /' "$WORK/c4.log" | grep -v '^  | [0-9-]* [0-9:.]* [A-Z]* \[[0-9]*\] LOG:'
if [ "$RC" = 3 ] && grep -q "^BLOCKED: PostgreSQL port $P2 is in use (EADDRINUSE) and QA_PG_STRICT_PORT=1" "$WORK/c4.log" \
  && ! grep -q '^URL=' "$WORK/c4.log"; then
  pass "strict mode: no retry, exit 3 BLOCKED, the command did not run"
else
  bad "strict mode: exit $RC"
fi

P3=3000
echo; echo "== C5 generic API path (mth_start_with_port_retry) with a Node HTTP server; port $P3 held in TIME_WAIT"
collide "$P3"
set +e
bash -c '
  set -euo pipefail
  . "$1"
  LOG="$2"
  launch() { node -e "require(\"http\").createServer((q,s)=>s.end(\"ok \"+process.argv[1])).listen(+process.argv[1],\"0.0.0.0\")" "$1" >>"$LOG" 2>&1 & MTH_LAUNCHED_PID=$!; }
  ready() { curl -fsS "http://127.0.0.1:$1/" >/dev/null 2>&1; }
  mth_start_with_port_retry "API" 3000 C5_STRICT_PORT API_PID "$LOG" 20 launch ready || exit $?
  echo "API answered: $(curl -fsS "http://127.0.0.1:$MTH_PORT/") (MTH_PORT=$MTH_PORT)"
  kill "$API_PID"
' c5 "$HERE/pg-port.sh" "$WORK/c5-api.log" >"$WORK/c5.log" 2>&1
RC=$?
set -e
sed 's/^/  | /' "$WORK/c5.log"
grep -m1 EADDRINUSE "$WORK/c5-api.log" | sed 's/^/  | api log: /' || true
if [ "$RC" = 0 ] && grep -q "port $P3 is in use (EADDRINUSE; attempt 1" "$WORK/c5.log" \
  && grep -Eq '^API answered: ok [0-9]+ \(MTH_PORT=[0-9]+\)$' "$WORK/c5.log" && ! grep -q 'MTH_PORT=3000)' "$WORK/c5.log"; then
  pass "API-style server retried after EADDRINUSE and answers on the new port"
else
  bad "API path: exit $RC"
fi

echo
if [ "$FAILS" = 0 ]; then echo "PORT COLLISION CHECK: PASS (5 cases)"; exit 0; fi
echo "PORT COLLISION CHECK: FAIL ($FAILS case(s))"
exit 1
