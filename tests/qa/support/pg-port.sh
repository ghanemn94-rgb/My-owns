# shellcheck shell=bash
# Shared PORT POLICY for every disposable-cluster harness (F-DG2-310, REQ-DLV-034). Sourced, never executed:
#   tests/qa/support/with-pg.sh, apps/web/e2e/support/with-stack.sh, e2e/support/qa-stack.sh,
#   e2e/clean-start/a18-clean-start.sh, deploy/scripts/clean-start-local.sh
#
# Why: the Linux ephemeral range (/proc/sys/net/ipv4/ip_local_port_range, 32768-60999 by default) is where the kernel
# puts CLIENT sockets (psql, curl, the API's pool). A client socket that closes first stays in TIME_WAIT for ~60 s on
# its local port; a server that then binds that port fails with EADDRINUSE even with SO_REUSEADDR (the client socket
# did not set it). The old defaults (54331-54371) were inside that range, so a harness failed ~1 run in 6.
#
# Policy:
#   1. Defaults lie BELOW 32768 and are distinct per harness (PostgreSQL 24331/24340/24351/24361/24371; APIs
#      3000/3060/3100/3181). See docs/operations/clean-start.md "Harness port policy".
#   2. The requested port (default or from the environment) is the STARTING point. If the service fails to bind with
#      EADDRINUSE, it is restarted on another free port picked at random from MTH_PORT_POOL (default 25000-31999),
#      excluding the ephemeral range and any port with a socket in any state (/proc/net/tcp{,6}), at most
#      MTH_PORT_RETRIES (default 10) more times. Every retry is logged ("port-policy: ..." on stderr).
#   3. With the harness's <NAME>_STRICT_PORT=1 (or MTH_STRICT_PORT=1 for all), a bind conflict is not retried:
#      "BLOCKED: ..." and return 3.
#   4. Any failure that is NOT a bind conflict is never retried and never passes: mth_pg_start prints
#      "BLOCKED: disposable PostgreSQL did not start" and returns 3; mth_start_with_port_retry returns 1 and the
#      harness reports it (BLOCKED or FAIL, as before).
#   5. The caller exports its URLs from MTH_PORT / MTH_PG_PORT, the port actually in use.
#
# Functions
#   mth_pg_start <pgbin> <datadir> <logfile> <start-port> <strict-var> <pid-var> [extra postgres args...]
#       Starts postgres (as uid 1000 in a user namespace when run as root) on 127.0.0.1 only, no unix socket,
#       fsync=off. Sets MTH_PG_PORT and <pid-var> (the postmaster's PID, kept current during retries so the
#       caller's cleanup trap always sees it). Ready = the postmaster is alive and logged "ready to accept connections".
#   mth_start_with_port_retry <label> <start-port> <strict-var> <pid-var> <logfile> <timeout-s> <launch-fn> <ready-fn>
#       Generic form (used for the APIs). <launch-fn> <port> starts the service in the background, APPENDING its
#       output to <logfile>, and sets MTH_LAUNCHED_PID; <ready-fn> <port> returns 0 once it answers. Before each
#       launch the port is probed: a port on which something already ACCEPTS connections counts as in use (so a
#       foreign server can never be mistaken for ours). Sets MTH_PORT. Returns 0 ready, 3 BLOCKED (bind conflicts
#       exhausted / strict / invalid port / empty pool), 1 any other startup failure.
#       <pid-var> and <strict-var> are names of the CALLER's variables (set/read through printf -v / ${!name}); they
#       must not be one of this helper's local names (pid, port, strict, ...): the harnesses use PG_PID / API_PID.
#   mth_port_busy <port>   0 if any TCP socket uses the local port or something accepts connections on it.
#   mth_port_pick [tried ports...]   prints a random free pool port outside the ephemeral range.

MTH_PORT_POOL_DEFAULT="25000-31999"

mth_port_log() { echo "port-policy: $*" >&2; }

mth_port_ephemeral_range() {
  local r
  r="$(cat /proc/sys/net/ipv4/ip_local_port_range 2>/dev/null || true)"
  # shellcheck disable=SC2086
  set -- $r
  MTH_EPH_LO="${1:-32768}"
  MTH_EPH_HI="${2:-60999}"
}

mth_port_in_ephemeral() {
  mth_port_ephemeral_range
  [ "$1" -ge "$MTH_EPH_LO" ] && [ "$1" -le "$MTH_EPH_HI" ]
}

mth_port_busy() {
  local hex
  hex="$(printf '%04X' "$1")"
  # Any socket in any state (LISTEN, ESTABLISHED, TIME_WAIT, ...) with this LOCAL port.
  if cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk -v h="$hex" '$2 ~ (":" h "$") { f = 1 } END { exit !f }'; then
    return 0
  fi
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

mth_port_pick() {
  local pool lo hi p
  pool="${MTH_PORT_POOL:-$MTH_PORT_POOL_DEFAULT}"
  IFS=- read -r lo hi <<<"$pool"
  case "$lo$hi" in '' | *[!0-9]*) mth_port_log "invalid MTH_PORT_POOL '$pool' (expected LOW-HIGH)"; return 1 ;; esac
  if [ "$lo" -lt 1024 ] || [ "$hi" -gt 65535 ] || [ "$lo" -gt "$hi" ]; then
    mth_port_log "invalid MTH_PORT_POOL '$pool'"
    return 1
  fi
  mth_port_ephemeral_range
  for _ in $(seq 1 400); do
    p=$((lo + (RANDOM * 32768 + RANDOM) % (hi - lo + 1)))
    if [ "$p" -ge "$MTH_EPH_LO" ] && [ "$p" -le "$MTH_EPH_HI" ]; then continue; fi
    case " $* " in *" $p "*) continue ;; esac
    mth_port_busy "$p" && continue
    echo "$p"
    return 0
  done
  mth_port_log "no free port in MTH_PORT_POOL $pool outside the ephemeral range $MTH_EPH_LO-$MTH_EPH_HI"
  return 1
}

mth_start_with_port_retry() {
  local label="$1" port="$2" strictvar="$3" pidvar="$4" log="$5" timeout="$6" launch="$7" ready="$8"
  local max="${MTH_PORT_RETRIES:-10}" attempt=0 tried="" strict=0 off pid outcome deadline next why=""
  [ "${!strictvar:-0}" = 1 ] || [ "${MTH_STRICT_PORT:-0}" = 1 ] && strict=1
  case "$port" in '' | *[!0-9]*) echo "BLOCKED: $label: invalid port '$port'"; return 3 ;; esac
  if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then echo "BLOCKED: $label: invalid port '$port'"; return 3; fi
  if mth_port_in_ephemeral "$port"; then
    mth_port_log "warning: $label port $port is inside the ephemeral range $MTH_EPH_LO-$MTH_EPH_HI (a client socket" \
      "in TIME_WAIT can hold it); $([ "$strict" = 1 ] && echo "strict: no retry" || echo "will retry outside it on EADDRINUSE")"
  fi
  touch "$log"
  while :; do
    attempt=$((attempt + 1))
    tried="$tried $port"
    outcome=""
    # Something already ACCEPTS connections there: do not start (its answers could look like ours).
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then outcome=inuse why="already accepting connections"; fi
    if [ -z "$outcome" ]; then
      off="$(stat -c %s "$log" 2>/dev/null || echo 0)"
      MTH_LAUNCHED_PID=""
      "$launch" "$port" || { mth_port_log "$label: launcher failed on port $port"; return 1; }
      pid="$MTH_LAUNCHED_PID"
      [ -n "$pid" ] || { mth_port_log "$label: launcher set no PID"; return 1; }
      printf -v "$pidvar" '%s' "$pid"
      outcome=timeout
      deadline=$((SECONDS + timeout))
      while [ "$SECONDS" -lt "$deadline" ]; do
        if ! kill -0 "$pid" 2>/dev/null; then outcome=exited; break; fi
        if "$ready" "$port"; then
          if kill -0 "$pid" 2>/dev/null; then outcome=ready; else outcome=exited; fi
          break
        fi
        sleep 0.25
      done
      if [ "$outcome" = exited ]; then
        wait "$pid" 2>/dev/null || true
        printf -v "$pidvar" '%s' ""
        if tail -c "+$((off + 1))" "$log" | grep -Eq 'Address already in use|EADDRINUSE'; then outcome=inuse why=EADDRINUSE; fi
      fi
    fi
    case "$outcome" in
      ready)
        MTH_PORT="$port"
        mth_port_log "$label listening on port $port (attempt $attempt)"
        return 0
        ;;
      timeout)
        mth_port_log "$label did not become ready on port $port within ${timeout}s (not a bind conflict; no retry)"
        kill "$pid" 2>/dev/null || true
        return 1
        ;;
      exited)
        mth_port_log "$label exited during startup on port $port (not a bind conflict; no retry); see $log"
        return 1
        ;;
      inuse)
        if [ "$strict" = 1 ]; then
          echo "BLOCKED: $label port $port is in use ($why) and $strictvar=1 / MTH_STRICT_PORT=1 forbids another port"
          return 3
        fi
        if [ "$attempt" -gt "$max" ]; then
          echo "BLOCKED: $label could not bind after $attempt attempts (ports:$tried; MTH_PORT_RETRIES=$max)"
          return 3
        fi
        next="$(mth_port_pick $tried)" || { echo "BLOCKED: $label: port $port in use and no free pool port"; return 3; }
        mth_port_log "$label: port $port is in use ($why; attempt $attempt of $((max + 1))); retrying on port $next"
        port="$next"
        ;;
    esac
  done
}

# ---- PostgreSQL ---------------------------------------------------------------------------------------------------
mth__pg_launch() {
  local as=()
  [ "$(id -u)" = "0" ] && as=(unshare --user --map-user=1000 --map-group=1000)
  # A simple command in the background, so $! IS the postmaster (`unshare` without --fork execs it).
  "${as[@]}" "$MTH__PG_BIN/postgres" -D "$MTH__PG_DATA" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 \
    -p "$1" -c fsync=off "${MTH__PG_EXTRA[@]}" >>"$MTH__PG_LOG" 2>&1 </dev/null &
  MTH_LAUNCHED_PID=$!
}
mth__pg_ready() {
  # Tied to OUR postmaster's own log, never to whatever answers on the port.
  tail -c "+$((MTH__PG_OFF + 1))" "$MTH__PG_LOG" 2>/dev/null | grep -q 'database system is ready to accept connections'
}
mth__pg_launch_marked() {
  MTH__PG_OFF="$(stat -c %s "$MTH__PG_LOG" 2>/dev/null || echo 0)"
  mth__pg_launch "$1"
}

mth_pg_start() {
  MTH__PG_BIN="$1" MTH__PG_DATA="$2" MTH__PG_LOG="$3"
  local start="$4" strictvar="$5" pidvar="$6" rc=0
  shift 6
  MTH__PG_EXTRA=("$@")
  MTH__PG_OFF=0
  mth_start_with_port_retry "PostgreSQL" "$start" "$strictvar" "$pidvar" "$MTH__PG_LOG" \
    "${MTH_PG_START_TIMEOUT:-30}" mth__pg_launch_marked mth__pg_ready || rc=$?
  if [ "$rc" = 0 ]; then
    MTH_PG_PORT="$MTH_PORT"
    return 0
  fi
  [ "$rc" = 3 ] || echo "BLOCKED: disposable PostgreSQL did not start"
  echo "---- postgres log (tail)"
  tail -20 "$MTH__PG_LOG" 2>/dev/null || true
  return 3
}
