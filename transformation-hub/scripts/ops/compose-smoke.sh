#!/usr/bin/env bash
# =====================================================================================================================
# Smoke checks for the Docker Compose stack — DEVELOPMENT / EVALUATION ONLY (single host, no high availability, no
# backups; production uses the Helm chart). Run it after the documented start-up commands
# (docs/deployment/installation.md §7: `up --build --wait` and the Demo seed). CI runs exactly this (job `compose`).
#
#   bash scripts/ops/compose-smoke.sh              # full check (needs the docker CLI and the running stack)
#   bash scripts/ops/compose-smoke.sh --http-only  # only the HTTP checks (e.g. against a stack started with `pnpm dev`)
#
# Checks:
#   1. containers: db, api, worker and web are running and "healthy"; the one-shot migrate container exited 0
#   2. API /healthz and /readyz on the published port (127.0.0.1 only)
#   3. web /login returns 200 with the security headers (CSP, X-Frame-Options)
#   4. through the WEB origin (same-origin /api rewrite, as a browser uses it): list Demo personas → demo login
#      (session + CSRF cookies) → authenticated GET /api/v1/me and /api/v1/projects → CSRF enforced (POST without the
#      header is 403, with it 2xx) → logout → the session no longer works (401)
#   5. worker: heartbeat file fresh (written after every good loop iteration), `healthcheck worker` passes, and the
#      outbox is drained by the worker (no undispatched events left after the seed)
#   6. the internal `backend` network has no route out: the worker cannot open a connection to a public address
# Env: COMPOSE_FILE_PATH (deploy/compose/compose.dev.yml), COMPOSE_ENV_FILE (deploy/compose/.env), HUB_WEB_URL,
#      HUB_API_PUBLIC_URL, HUB_DB_NAME (hub), SMOKE_WAIT_SECONDS (90). Needs curl and python3. Prints no secrets.
# =====================================================================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HTTP_ONLY=false
[ "${1:-}" = "--http-only" ] && HTTP_ONLY=true
COMPOSE_FILE_PATH="${COMPOSE_FILE_PATH:-$ROOT/deploy/compose/compose.dev.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/deploy/compose/.env}"
WEB="${HUB_WEB_URL:-http://127.0.0.1:${HUB_WEB_PORT:-3000}}"
API="${HUB_API_PUBLIC_URL:-http://127.0.0.1:${HUB_API_PORT:-4000}}"
DB_NAME="${HUB_DB_NAME:-hub}"
WAIT="${SMOKE_WAIT_SECONDS:-90}"
PERSONA="Demo Project Manager"

FAILS=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }
dc() { docker compose -f "$COMPOSE_FILE_PATH" --env-file "$COMPOSE_ENV_FILE" "$@"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
JAR="$WORK/cookies.txt"
: >"$JAR"
chmod 600 "$JAR"

# ---- 1. containers ---------------------------------------------------------------------------------------------------
if [ "$HTTP_ONLY" = false ]; then
  dc ps -a --format json >"$WORK/ps.json"
  if python3 - "$WORK/ps.json" <<'PY'
import json, sys
raw = open(sys.argv[1]).read().strip()
# `docker compose ps --format json` prints one object per line (Compose >= 2.21) or a JSON array (older releases).
rows = json.loads(raw) if raw.startswith('[') else [json.loads(l) for l in raw.splitlines() if l.strip()]
by = {r['Service']: r for r in rows}
bad = []
for svc in ('db', 'api', 'worker', 'web'):
    r = by.get(svc)
    if not r: bad.append(f'{svc}: no container'); continue
    print(f"      {svc:7s} state={r.get('State')} health={r.get('Health') or '-'}")
    if r.get('State') != 'running' or r.get('Health') != 'healthy': bad.append(f"{svc}: {r.get('State')}/{r.get('Health')}")
m = by.get('migrate')
print(f"      migrate state={m.get('State') if m else '-'} exit={m.get('ExitCode') if m else '-'}")
if not m or m.get('State') != 'exited' or int(m.get('ExitCode', 1)) != 0: bad.append('migrate did not exit 0')
for b in bad: print('      ' + b)
sys.exit(1 if bad else 0)
PY
  then pass "containers: db, api, worker, web healthy; migrate exited 0"; else fail "container state (see above)"; fi
fi

# ---- 2. API probes -------------------------------------------------------------------------------------------------------
if curl -fsS "$API/healthz" >"$WORK/healthz" && [ "$(json "d['status']" <"$WORK/healthz")" = ok ]; then pass "API /healthz"; else fail "API /healthz"; fi
if curl -fsS "$API/readyz" >"$WORK/readyz" && [ "$(json "d['status']" <"$WORK/readyz")" = ready ]; then pass "API /readyz (database reachable)"; else fail "API /readyz"; fi

# ---- 3. web --------------------------------------------------------------------------------------------------------------
code="$(curl -sS -o "$WORK/login.html" -D "$WORK/login.hdr" -w '%{http_code}' "$WEB/login" || true)"
if [ "$code" = 200 ] && grep -qi '^content-security-policy:' "$WORK/login.hdr" && grep -qi '^x-frame-options: *deny' "$WORK/login.hdr"; then
  pass "web /login 200 with CSP and X-Frame-Options"
else fail "web /login (HTTP $code)"; fi

# ---- 4. demo login and authenticated calls through the web origin --------------------------------------------------------
req() { # req <method> <path> [curl args...] → prints the HTTP status; body in $WORK/body
  local m="$1" p="$2"; shift 2
  curl -sS -o "$WORK/body" -w '%{http_code}' -X "$m" -c "$JAR" -b "$JAR" "$@" "$WEB$p" || echo 000
}
csrf() { awk '$6 == "hub_csrf" { print $7 }' "$JAR" | tail -n 1; }
is2xx() { case "$1" in 2??) return 0 ;; *) return 1 ;; esac; }  # NestJS answers POST with 201

code="$(req GET /api/v1/auth/demo-users)"
USER_ID=""
if [ "$code" = 200 ]; then
  USER_ID="$(PERSONA="$PERSONA" python3 -c "import json,os,sys; d=json.load(open(sys.argv[1])); print(next((u['id'] for u in d['items'] if u['displayName']==os.environ['PERSONA']), ''))" "$WORK/body" || true)"
fi
if [ -n "$USER_ID" ]; then pass "web origin: GET /api/v1/auth/demo-users lists '$PERSONA' (Demo seed loaded)"; else fail "web origin: demo persona list (HTTP $code; was the Demo seed run?)"; fi

code="$(req POST /api/v1/auth/demo-login -H 'content-type: application/json' --data "{\"userId\":\"$USER_ID\"}")"
if is2xx "$code" && grep -q $'\thub_session\t' "$JAR" && [ -n "$(csrf)" ]; then pass "web origin: POST /api/v1/auth/demo-login ($code) → session and CSRF cookies"; else fail "web origin: demo login (HTTP $code)"; fi

code="$(req GET /api/v1/me)"
if [ "$code" = 200 ] && [ "$(json "d['user']['displayName'] + '|' + str(d['user']['isDemo'])" <"$WORK/body")" = "$PERSONA|True" ]; then
  pass "web origin: authenticated GET /api/v1/me → '$PERSONA' (isDemo)"
else fail "web origin: GET /api/v1/me (HTTP $code)"; fi

code="$(req GET '/api/v1/projects?pageSize=10')"
if [ "$code" = 200 ] && [ "$(json "d['total']" <"$WORK/body")" -ge 1 ]; then
  pass "web origin: authenticated GET /api/v1/projects → $(json "d['total']" <"$WORK/body") project(s) in scope"
else fail "web origin: GET /api/v1/projects (HTTP $code)"; fi

code="$(req POST /api/v1/me/locale -H 'content-type: application/json' --data '{"locale":"en"}')"
if [ "$code" = 403 ]; then pass "web origin: POST without x-csrf-token refused (403)"; else fail "web origin: CSRF not enforced (HTTP $code, expected 403)"; fi
code="$(req POST /api/v1/me/locale -H 'content-type: application/json' -H "x-csrf-token: $(csrf)" --data '{"locale":"en"}')"
if is2xx "$code"; then pass "web origin: CSRF-protected POST /api/v1/me/locale ($code)"; else fail "web origin: POST /api/v1/me/locale with CSRF header (HTTP $code)"; fi

code="$(req POST /api/v1/auth/logout -H "x-csrf-token: $(csrf)")"
code2="$(req GET /api/v1/me)"
if is2xx "$code" && [ "$code2" = 401 ]; then pass "web origin: logout ($code) revokes the session (then 401)"; else fail "web origin: logout (HTTP $code, then $code2)"; fi

# ---- 5. worker --------------------------------------------------------------------------------------------------------------
if [ "$HTTP_ONLY" = false ]; then
  # The heartbeat file is written after each successful loop iteration (apps/api/src/platform/jobs/worker.service.ts).
  # shellcheck disable=SC2016  # JavaScript template literals, not shell expansions
  if dc exec -T worker node -e '
    const fs = require("node:fs"); const f = process.env.HUB_WORKER_HEARTBEAT_FILE;
    if (!f || !fs.existsSync(f)) { console.log("      no heartbeat file"); process.exit(1); }
    const age = Date.now() - fs.statSync(f).mtimeMs;
    console.log(`      heartbeat ${fs.readFileSync(f, "utf8").trim()} (age ${Math.round(age)} ms)`);
    process.exit(age < 30000 ? 0 : 1);'; then pass "worker heartbeat fresh (< 30 s)"; else fail "worker heartbeat"; fi
  if dc exec -T worker node /app/hub-entrypoint.cjs healthcheck worker; then pass "worker: healthcheck worker exit 0"; else fail "worker: healthcheck worker"; fi

  # The Demo seed writes outbox events; the worker must dispatch every one of them.
  drained=false
  for _ in $(seq 1 "$WAIT"); do
    counts="$(dc exec -T db psql -X -qAt -U postgres -d "$DB_NAME" -c "select count(*) filter (where dispatched_at is null) || ' ' || count(*) from outbox_event" 2>/dev/null || true)"
    if [ -n "$counts" ] && [ "${counts%% *}" = 0 ] && [ "${counts##* }" -gt 0 ]; then drained=true; break; fi
    sleep 1
  done
  if [ "$drained" = true ]; then pass "worker drained the outbox (${counts##* } events dispatched, 0 pending)"; else fail "outbox not drained within ${WAIT}s (pending/total: ${counts:-n/a})"; fi

  # ---- 6. no route out of the internal backend network ----------------------------------------------------------------------
  # shellcheck disable=SC2016  # JavaScript template literal, not a shell expansion
  if dc exec -T worker node -e '
    const s = require("node:net").connect({ host: "1.1.1.1", port: 443, timeout: 5000 });
    s.on("connect", () => { console.log("      UNEXPECTED: connected to a public address"); process.exit(1); });
    s.on("timeout", () => { console.log("      no connection (timeout)"); process.exit(0); });
    s.on("error", (e) => { console.log(`      no connection (${e.code})`); process.exit(0); });'; then
    pass "backend network is internal: the worker has no route to a public address"
  else fail "worker reached a public address (backend network not internal)"; fi
fi

echo
if [ "$FAILS" = 0 ]; then echo "COMPOSE SMOKE: PASS"; else echo "COMPOSE SMOKE: FAIL ($FAILS)"; fi
[ "$FAILS" = 0 ]
