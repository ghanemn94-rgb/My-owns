#!/bin/sh
# mth: the command dispatcher of the mth-app image (ADR-0011). POSIX sh (the slim base image has no bash guarantee).
#
#   mth api                 HTTP API (+ SPA) on $PORT                        (app role: DATABASE_URL[_FILE])
#   mth worker              background worker                                (app role: DATABASE_URL[_FILE])
#   mth migrate             apply pending migrations, then exit              (owner role: DATABASE_OWNER_URL[_FILE])
#   mth db <command> [...]  other mth-db commands: status | bootstrap ...    (owner role)
#   mth health [path]       exit 0 when GET http://127.0.0.1:$PORT<path> is 2xx (default /readyz); for health checks
#   mth version             print component versions
#
# Configuration is validated by @mth/config at startup; an invalid configuration exits 78 (EX_CONFIG) with a message
# that names the variable, never its value. Secrets come from the environment or `<NAME>_FILE` mounts only.
set -eu

# MTH_APP_ROOT exists only so the local clean start can run this same script against an assembled runtime tree;
# in the image it is always /app.
APP="${MTH_APP_ROOT:-/app}"
DB_CLI="$APP/packages/db/dist/cli.js"

usage() {
  cat >&2 <<'EOF'
usage: mth api | worker | migrate | db <status|bootstrap ...> | health [/healthz|/readyz] | version
EOF
}

cmd="${1:-api}"
[ "$#" -gt 0 ] && shift

case "$cmd" in
  api) exec node "$APP/apps/api/dist/main.js" "$@" ;;
  worker) exec node "$APP/apps/worker/dist/main.js" "$@" ;;
  migrate) exec node "$DB_CLI" migrate "$@" ;;
  db)
    if [ "$#" -eq 0 ]; then usage; exit 64; fi
    case "$1" in
      seed-dev)
        # Synthetic dev users are never part of production initialization (REQ-S18-001); the seeds are not shipped.
        echo "mth: seed-dev is not available in the production image" >&2
        exit 64
        ;;
    esac
    exec node "$DB_CLI" "$@"
    ;;
  health) exec node "${MTH_HEALTHCHECK:-/app/healthcheck.mjs}" "${1:-/readyz}" ;;
  version)
    exec node -e 'const r=(p)=>JSON.parse(require("fs").readFileSync(p,"utf8")).version;
      console.log(JSON.stringify({node:process.version,api:r(process.argv[1]+"/apps/api/package.json"),worker:r(process.argv[1]+"/apps/worker/package.json")}))' "$APP"
    ;;
  -h | --help | help) usage ;;
  *) usage; exit 64 ;;
esac
