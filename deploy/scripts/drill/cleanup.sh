# deploy/scripts/drill/cleanup.sh: process shutdown and work-tree removal for transfer-drill.sh (T-DG7-DO-D8,
# F-DG7-963). Sourced, never executed; it sets no shell options of its own and every function returns 0 or a documented
# status, so a caller running under `set -e` is never stopped by it.
#
#   td_alive <pid>              0 while <pid> exists and is not a zombie (a zombie has exited; only its parent's wait
#                               is missing, so it writes nothing)
#   td_descendants <pid>        every descendant pid of <pid>, one per line (read from /proc, no procps needed)
#   td_postmaster <pid>         <pid> or its nearest descendant whose command is postgres (the postmaster)
#   td_stop_pg <pid> [secs]     stop the PostgreSQL postmaster at or under <pid> and wait, bounded, until it AND its children (checkpointer,
#                               walwriter, backends) have exited: SIGINT (fast shutdown) and up to <secs> (default
#                               MTH_TD_PG_STOP_SECS or 30) s, then SIGQUIT (immediate shutdown) and 5 s, then SIGKILL to
#                               every remaining process and 5 s. Returns 0 when everything exited, 1 when a process is
#                               still alive after the bound (the caller reports it; it never hangs).
#   td_remove_work <dir> <rc> [log]
#                               remove the drill's work tree after the result is known. Five attempts, 1 s apart (a process that has just
#                               exited may still be releasing files). A failure prints one WARNING line on stderr (and
#                               appends it to [log]) saying the result <rc> is unchanged, and returns 0: cleanup can never
#                               change the drill's result, and it is never silent.
#
# The postmaster was started in a `$( … & )` command substitution, so it is not a child of the caller and cannot be
# `wait`ed for: every wait here polls /proc.

td_alive() {
  [[ "${1:-}" =~ ^[1-9][0-9]*$ ]] || return 1
  local stat
  stat="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  # Field 3 (the state) follows the last ')' of the command name.
  stat="${stat##*) }"
  [ "${stat%% *}" != "Z" ]
}

td_descendants() {
  [[ "${1:-}" =~ ^[1-9][0-9]*$ ]] || return 0
  local f stat pid ppid queue=("$1") cur
  declare -A parent=()
  for f in /proc/[0-9]*/stat; do
    stat="$(cat "$f" 2>/dev/null)" || continue
    pid="${stat%% *}"
    stat="${stat##*) }"
    ppid="${stat#* }"
    ppid="${ppid%% *}"
    parent[$pid]="$ppid"
  done
  while [ "${#queue[@]}" -gt 0 ]; do
    cur="${queue[0]}"
    queue=("${queue[@]:1}")
    for pid in "${!parent[@]}"; do
      if [ "${parent[$pid]}" = "$cur" ]; then
        echo "$pid"
        queue+=("$pid")
      fi
    done
  done
}

# _td_wait_gone <tenths> <pid>...: 0 once none of the pids is alive, 1 when the bound passes first.
_td_wait_gone() {
  local n="$1" p any
  shift
  while :; do
    any=0
    for p in "$@"; do td_alive "$p" && { any=1; break; }; done
    [ "$any" -eq 0 ] && return 0
    [ "$n" -le 0 ] && return 1
    n=$((n - 1))
    sleep 0.1
  done
}

# td_postmaster <pid>: <pid> itself when its command is postgres, otherwise its nearest postgres descendant (empty when
# there is none). pg_start's `as_pg postgres … &` backgrounds a shell function, so `$!` is a bash subshell whose child
# is the postmaster (T-DG7-DO-D8: measured; the subshell ignores SIGINT and SIGQUIT, and a SIGTERM to it left the
# postmaster running, which is the F-DG7-963 race).
td_postmaster() {
  [[ "${1:-}" =~ ^[1-9][0-9]*$ ]] || return 0
  local p
  for p in "$1" $(td_descendants "$1"); do
    if [ "$(cat "/proc/$p/comm" 2>/dev/null)" = "postgres" ]; then
      echo "$p"
      return 0
    fi
  done
}

td_stop_pg() {
  [[ "${1:-}" =~ ^[1-9][0-9]*$ ]] || return 0
  local pid="$1" secs="${2:-${MTH_TD_PG_STOP_SECS:-30}}" procs p pm
  [[ "$secs" =~ ^[0-9]+$ ]] || secs=30
  td_alive "$pid" || return 0
  # The tree is listed before the signal: once the postmaster is gone its children are re-parented and not found.
  pm="$(td_postmaster "$pid")"
  mapfile -t procs < <(td_descendants "$pid")
  procs=("$pid" "${procs[@]}")
  if [ -n "$pm" ]; then kill -INT "$pm" 2>/dev/null || true; fi
  _td_wait_gone $((secs * 10)) "${procs[@]}" && return 0
  # Processes forked after the first listing (a backend) are added.
  mapfile -t -O "${#procs[@]}" procs < <(td_descendants "$pid")
  if [ -n "$pm" ]; then kill -QUIT "$pm" 2>/dev/null || true; fi
  _td_wait_gone 50 "${procs[@]}" && return 0
  mapfile -t -O "${#procs[@]}" procs < <(td_descendants "$pid")
  for p in "${procs[@]}"; do kill -KILL "$p" 2>/dev/null || true; done
  _td_wait_gone 50 "${procs[@]}" && return 0
  echo "transfer-drill: WARNING: PostgreSQL pid $pid or one of its processes was still running after the bounded shutdown" >&2
  return 1
}

td_remove_work() {
  local dir="${1:-}" rc="${2:-?}" log="${3:-}" i err="" line
  [ -n "$dir" ] && [ "$dir" != "/" ] || return 0
  for i in 1 2 3 4 5; do
    [ -e "$dir" ] || return 0
    if err="$(rm -rf -- "$dir" 2>&1)" && [ ! -e "$dir" ]; then return 0; fi
    [ "$i" -lt 5 ] && sleep 1
  done
  line="transfer-drill: WARNING: could not remove the work directory $dir (${err:-it still exists}); the drill result (exit $rc) is unchanged; remove the directory by hand"
  echo "$line" >&2
  if [ -n "$log" ]; then echo "$line" >>"$log" 2>/dev/null || true; fi
  return 0
}
