#!/usr/bin/env bash
# Development-environment helper (docs/delivery/environment.md: "the Docker daemon is started manually and can be
# absent after a container restart"). Idempotent: exits 0 at once if a daemon answers; otherwise, when run as root
# on a host that has dockerd but no service manager, starts dockerd in the background and waits up to 60 s.
# The product never depends on this script; production hosts run Docker (or another OCI runtime) as a managed service.
#
#   deploy/scripts/ensure-docker.sh            exit 0 ready | 3 BLOCKED (cannot start: not root, no dockerd, read-only /run)
set -euo pipefail

if docker info >/dev/null 2>&1; then
  echo "docker: daemon ready ($(docker version -f '{{.Server.Version}}'))"
  exit 0
fi
command -v dockerd >/dev/null || { echo "BLOCKED: dockerd is not installed"; exit 3; }
[ "$(id -u)" = 0 ] || { echo "BLOCKED: not root; start the Docker service with your service manager"; exit 3; }
if ! touch /run/.mth-docker-probe 2>/dev/null; then
  echo "BLOCKED: /run is read-only here (sandboxed shell); dockerd cannot create its socket"
  exit 3
fi
rm -f /run/.mth-docker-probe
LOG="${MTH_DOCKERD_LOG:-/var/log/mth-dockerd.log}"
echo "docker: starting dockerd (log: $LOG)"
nohup dockerd >"$LOG" 2>&1 &
for _ in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    echo "docker: daemon ready ($(docker version -f '{{.Server.Version}}'))"
    exit 0
  fi
  sleep 1
done
echo "BLOCKED: dockerd did not become ready within 60 s; see $LOG"
tail -20 "$LOG" || true
exit 3
