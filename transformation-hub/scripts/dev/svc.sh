#!/usr/bin/env bash
# Dev helper: start/stop the API or worker in the background with a pid file.
#   scripts/dev/svc.sh start api|worker   scripts/dev/svc.sh stop api|worker   scripts/dev/svc.sh restart api
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUN="$ROOT/.dev"; mkdir -p "$RUN"
action="$1"; svc="$2"
case "$svc" in api) entry="dist/main.js";; worker) entry="dist/worker.js";; *) echo "unknown service $svc" >&2; exit 1;; esac
pidf="$RUN/$svc.pid"; logf="$RUN/$svc.log"
stop() { if [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; then kill "$(cat "$pidf")"; sleep 1; fi; rm -f "$pidf"; }
start() {
  cd "$ROOT/apps/api"
  nohup node "$entry" >"$logf" 2>&1 &
  echo $! >"$pidf"
  if [ "$svc" = api ]; then
    for i in $(seq 1 40); do curl -sf "http://127.0.0.1:${PORT:-4000}/healthz" >/dev/null && { echo "api up (pid $(cat "$pidf"))"; return 0; }; sleep 0.25; done
    echo "api failed to start; log:" >&2; tail -20 "$logf" >&2; exit 1
  fi
  echo "$svc started (pid $(cat "$pidf"))"
}
case "$action" in start) start;; stop) stop;; restart) stop; start;; *) echo "usage: $0 start|stop|restart api|worker" >&2; exit 1;; esac
