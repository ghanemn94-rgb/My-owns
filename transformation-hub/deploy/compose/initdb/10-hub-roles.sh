#!/usr/bin/env bash
# PostgreSQL image init hook (runs once, on an EMPTY data volume). Delegates to the shared, idempotent role/database
# script in a child shell so its shell options cannot leak into the image's entrypoint (which may `source` this file).
# DEVELOPMENT / EVALUATION ONLY — production roles are provisioned by Mobily DBAs (docs/deployment/installation.md).
bash /hub-ops/db-init-roles.sh
