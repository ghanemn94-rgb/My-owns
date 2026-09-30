#!/usr/bin/env bash
# Docker acceptance runner for T-DG1-DEVOPS checks 1-3 (and the Compose half of A18's first case).
#
#   deploy/scripts/verify-stack.sh [--skip-build] [--evidence-dir DIR] [--keep]
#
#   1. image: build (unless --skip-build; then MTH_APP_IMAGE must exist) and verify non-root + commands
#   2. Compose, default network, profile test-idp: db -> migrate -> api (healthy, /readyz ready) + worker + keycloak;
#      bootstrap the first organization/admin bound to the TEST realm's smoke.admin subject; OIDC login smoke
#      (admin + office through the Keycloak login form, create/read a transformation); worker consumed the event
#   3. the same with compose.no-egress.yaml (network internal: true): smoke also asserts that egress is blocked
# Uses a private project name and a throwaway secrets directory, so it never touches a developer's own stack or
# deploy/compose/.env. Every phase is timed. Exit 0 only if everything passed; exit 3 = BLOCKED (no Docker daemon).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKIP_BUILD=0
KEEP=0
EVIDENCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1 ;;
    --keep) KEEP=1 ;;
    --evidence-dir) EVIDENCE="$2"; shift ;;
    *) echo "usage: $0 [--skip-build] [--evidence-dir DIR] [--keep]" >&2; exit 64 ;;
  esac
  shift
done
docker info >/dev/null 2>&1 || { echo "BLOCKED: no Docker daemon reachable (docker info failed)"; exit 3; }
docker compose version >/dev/null 2>&1 || { echo "BLOCKED: docker compose plugin missing"; exit 3; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/mth-verify.XXXXXX")"
EVIDENCE="${EVIDENCE:-$WORK/evidence}"
mkdir -p "$EVIDENCE"
exec > >(tee "$EVIDENCE/verify-stack.log") 2>&1

export MTH_APP_IMAGE="${MTH_APP_IMAGE:-mth-app:verify}"
export MTH_SECRETS_DIR="$WORK/secrets"
export MTH_API_PORT="${MTH_API_PORT:-3180}" MTH_TEST_IDP_PORT="${MTH_TEST_IDP_PORT:-8543}"
PROJECT="mth-verify-$$"
BASE=(docker compose -p "$PROJECT" -f "$REPO/deploy/compose/compose.yaml")
NOEGRESS=(docker compose -p "$PROJECT" -f "$REPO/deploy/compose/compose.yaml" -f "$REPO/deploy/compose/compose.no-egress.yaml")
ISSUER="https://keycloak:8443/realms/mth-test"
ADMIN_SUB="5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0001" # smoke.admin in deploy/keycloak/realm-mth-test.json
T_ALL=$(date +%s)
CURRENT=()

cleanup() {
  if [ "${#CURRENT[@]}" -gt 0 ]; then
    "${CURRENT[@]}" --profile test-idp --profile smoke logs --no-color >"$EVIDENCE/compose-logs-last.txt" 2>&1 || true
    [ "$KEEP" = 1 ] || "${CURRENT[@]}" --profile test-idp --profile smoke down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  [ "$KEEP" = 1 ] || rm -rf "$WORK/secrets"
}
trap cleanup EXIT
phase() { echo; echo "==> $* ($(date -u +%H:%M:%SZ))"; PHASE_T=$(date +%s); }
done_() { echo "<== ok ($(( $(date +%s) - PHASE_T )) s)"; }
die() { echo "FAIL: $*"; exit 1; }

phase "environment"
echo "  docker: $(docker version -f '{{.Server.Version}}') compose: $(docker compose version --short)"
echo "  repo HEAD: $(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo n/a); image: $MTH_APP_IMAGE"
node "$REPO/deploy/scripts/pin-images.mjs" --check || echo "WARNING: images are not all digest-pinned (reported, not ignored)"
done_

phase "1. image"
if [ "$SKIP_BUILD" = 0 ]; then
  bash "$REPO/deploy/scripts/build-image.sh" --tag "$MTH_APP_IMAGE"
else
  docker image inspect "$MTH_APP_IMAGE" >/dev/null || die "--skip-build but $MTH_APP_IMAGE does not exist"
  [ "$(docker image inspect -f '{{.Config.User}}' "$MTH_APP_IMAGE")" = "10001:10001" ] || die "image is not non-root"
fi
bash "$REPO/deploy/scripts/init-secrets.sh" --dir "$MTH_SECRETS_DIR" --no-env-file >/dev/null
done_

wait_healthy() { # wait_healthy <compose...> -- <service> <timeout-s>
  local svc="${@: -2:1}" timeout="${@: -1}"; local cmd=("${@:1:$#-2}")
  local id; id="$("${cmd[@]}" ps -q "$svc")"
  for _ in $(seq 1 "$timeout"); do
    [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")" = healthy ] && return 0
    sleep 1
  done
  return 1
}

run_variant() { # run_variant <label> <compose command array name>
  local label="$1"; local -n C="$2"
  CURRENT=("${C[@]}")
  phase "$label: up (profile test-idp)"
  "${C[@]}" --profile test-idp up -d
  wait_healthy "${C[@]}" api 180 || { "${C[@]}" ps -a; die "api not healthy"; }
  [ "$("${C[@]}" ps -a --format '{{.ExitCode}}' migrate)" = 0 ] || die "migrate did not exit 0"
  "${C[@]}" ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
  local internal; internal="$(docker network inspect -f '{{.Internal}}' "${PROJECT}_default")"
  echo "  network ${PROJECT}_default internal=$internal"
  if [ "$label" = no-egress ]; then [ "$internal" = true ] || die "no-egress variant network is not internal"; fi
  echo "  api readiness (inside the container): $("${C[@]}" exec -T api node -e 'fetch("http://127.0.0.1:3000/readyz").then(r=>r.text()).then(console.log)')"
  echo "  api uid: $("${C[@]}" exec -T api id -u); worker uid: $("${C[@]}" exec -T worker id -u)"
  [ "$("${C[@]}" exec -T api id -u)" = 10001 ] || die "api is not running as 10001"
  "${C[@]}" logs migrate --no-color | tail -3
  done_

  phase "$label: bootstrap first organization + admin bound to the TEST realm subject"
  "${C[@]}" run --rm -T migrate db bootstrap --org-code MTH-VERIFY --org-name-en "Verify org (synthetic)" \
    --org-name-ar "مؤسسة التحقق (اصطناعية)" --admin-name "Synthetic Access Admin" --admin-email smoke.admin@example.invalid \
    --admin-issuer "$ISSUER" --admin-subject "$ADMIN_SUB" | tail -3
  done_

  phase "$label: OIDC login smoke (smoke service; synthetic users)"
  "${C[@]}" --profile test-idp --profile smoke run --rm -T smoke | tee "$EVIDENCE/smoke-$label.txt"
  grep -q '"smoke":"PASS"' "$EVIDENCE/smoke-$label.txt" || die "smoke failed ($label)"
  done_

  phase "$label: worker consumed transformation.created; record counts"
  local n=0
  for _ in $(seq 1 30); do
    n="$("${C[@]}" exec -T db psql -U postgres -d mth -qAtc "select count(*) from processed_message")"
    [ "$n" -ge 1 ] && break; sleep 1
  done
  [ "$n" -ge 1 ] || die "worker did not process the event"
  "${C[@]}" exec -T db psql -U postgres -d mth -qAt -F ' ' -c "select 'organization', count(*) from organization
    union all select 'business_unit', count(*) from business_unit union all select 'app_user', count(*) from app_user
    union all select 'transformation', count(*) from transformation union all select 'audit_event', count(*) from audit_event
    union all select 'outbox_published', count(*) from outbox_event where published_at is not null
    union all select 'processed_message', count(*) from processed_message"
  done_

  phase "$label: down -v"
  "${C[@]}" --profile test-idp --profile smoke logs --no-color >"$EVIDENCE/compose-logs-$label.txt" 2>&1 || true
  "${C[@]}" --profile test-idp --profile smoke down -v --remove-orphans
  CURRENT=()
  done_
}

run_variant default BASE
run_variant no-egress NOEGRESS
echo
echo "VERIFY-STACK: PASS (total $(( $(date +%s) - T_ALL )) s; evidence $EVIDENCE)"
