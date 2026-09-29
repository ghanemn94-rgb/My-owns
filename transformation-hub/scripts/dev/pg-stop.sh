#!/usr/bin/env bash
set -euo pipefail
command -v pg_ctlcluster >/dev/null && pg_ctlcluster 16 main stop || echo "stop your PostgreSQL manually"
