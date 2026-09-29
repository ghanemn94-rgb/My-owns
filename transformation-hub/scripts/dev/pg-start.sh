#!/usr/bin/env bash
# Dev helper: start a local PostgreSQL 16 and ensure hub roles/databases exist.
# Priority: (1) DATABASE_URL already reachable → nothing to do; (2) system cluster via pg_ctlcluster
# (Debian/Ubuntu); otherwise print instructions (use deploy/compose/compose.dev.yml).
set -euo pipefail
PGPORT="${PGPORT:-5432}"
if command -v pg_isready >/dev/null && pg_isready -h 127.0.0.1 -p "$PGPORT" -q; then
  echo "PostgreSQL already accepting connections on :$PGPORT"
elif command -v pg_ctlcluster >/dev/null; then
  pg_ctlcluster 16 main start || true
  for i in $(seq 1 20); do pg_isready -h 127.0.0.1 -p "$PGPORT" -q && break; sleep 0.5; done
else
  echo "No local PostgreSQL found. Start one with: docker compose -f deploy/compose/compose.dev.yml up -d db" >&2
  exit 1
fi
bash "$(dirname "$0")/pg-init-roles.sh"
