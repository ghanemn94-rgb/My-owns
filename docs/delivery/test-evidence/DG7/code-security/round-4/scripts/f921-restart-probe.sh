#!/bin/bash
# F-DG7-921 independent probe: does the candidate's D9 stop/start sequence restart the PostgreSQL postmaster itself?
# Uses the candidate's own helpers (deploy/scripts/drill/cleanup.sh sourced from the disposable clone) and starts
# PostgreSQL exactly as transfer-drill.sh pg_start does (`as_pg postgres ... &` inside a command substitution).
#  P1 (candidate sequence)  stop_pid-equivalent on nothing; td_stop_pg <launcher> && td_stop_pg_dir <data>; pg_start
#     -> expect: old postmaster gone, new postmaster pid differs, pg_postmaster_start_time() later, data persists.
#  P2 (pre-DO-D8 sequence, negative control)  kill -TERM <launcher> only (the old stop_pid), then try a start
#     -> expect: the old postmaster survives (the mechanism AN-P7G cites for "API and worker only").
# Ports 32490-32491 (my range 32400-32499). Scratch in $TMPDIR only.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-4
cd $TMPDIR/rv
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
. deploy/scripts/drill/cleanup.sh
as_pg() { if [ "$(id -u)" = "0" ]; then unshare --user --map-user=1000 --map-group=1000 "$@"; else "$@"; fi; }
start() { # start <dir> <port> -> launcher pid (as pg_start)
  local pid; pid="$( ( as_pg "$PGBIN/postgres" -D "$1/data" -p "$2" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 >>"$1/pg.log" 2>&1 & echo $! ) )"
  for _ in $(seq 1 120); do "$PGBIN/psql" -h 127.0.0.1 -p "$2" -U postgres -d postgres -qAtc 'select 1' >/dev/null 2>&1 && { echo "$pid"; return 0; }; sleep 0.25; done
  echo "start failed" >&2; return 1; }
q() { "$PGBIN/psql" -h 127.0.0.1 -p "$1" -U postgres -d postgres -qAtc "$2" 2>&1; }
pmpid() { head -1 "$1/data/postmaster.pid" 2>/dev/null; }
{
echo "# $(date -u +%FT%TZ) F-DG7-921 restart probe (PGBIN $PGBIN, cleanup.sh sha256 $(sha256sum deploy/scripts/drill/cleanup.sh | cut -c1-16), clone HEAD $(git rev-parse --short=9 HEAD))"
for P in P1 P2; do
  D=$(mktemp -d "$TMPDIR/pgprobe-$P.XXXX"); chmod 0777 "$D"; port=$([ $P = P1 ] && echo 32490 || echo 32491)
  as_pg "$PGBIN/initdb" -D "$D/data" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
  L1=$(start "$D" $port); PM1=$(pmpid "$D"); T1=$(q $port "select pg_postmaster_start_time()")
  q $port "create table persist(x int); insert into persist values (42)" >/dev/null
  echo "== $P: launcher $L1, postmaster $PM1, start_time $T1"
  if [ $P = P1 ]; then
    td_stop_pg "$L1" && td_stop_pg_dir "$D/data"; echo "$P stop rc $?"
  else
    kill -TERM "$L1" 2>/dev/null; sleep 1; echo "$P old stop_pid (SIGTERM launcher) done"
  fi
  td_alive "$PM1" && echo "$P old postmaster $PM1 ALIVE after stop" || echo "$P old postmaster $PM1 gone after stop"
  sleep 1.1
  L2=$(start "$D" $port 2>&1); PM2=$(pmpid "$D"); T2=$(q $port "select pg_postmaster_start_time()"); X=$(q $port "select x from persist")
  echo "$P after start: launcher $L2, postmaster $PM2, start_time $T2, persist=$X"
  [ "$PM1" != "$PM2" ] && [ "$T1" != "$T2" ] && echo "$P RESULT: real restart (new postmaster)" || echo "$P RESULT: NO restart (same postmaster serves the port)"
  # cleanup this cluster
  td_stop_pg_dir "$D/data" 5; echo "$P cleanup rc $?"; rm -rf "$D"
done
echo "postgres processes left under \$TMPDIR: $(pgrep -af "postgres -D $TMPDIR" | wc -l)"
echo "# end $(date -u +%FT%TZ)"
} > $E/33-f921-restart-probe.log 2>&1
