#!/usr/bin/env bash
# =====================================================================================================================
# Create deploy/compose/.env for the Docker Compose DEVELOPMENT / EVALUATION stack (not production, not HA):
# copies deploy/compose/.env.example and replaces every CHANGE_ME value with a random, clearly local-only value
# (`local_only_<48 hex>`). This is the documented step "cp .env.example .env, then replace every CHANGE_ME value"
# done in one command (docs/deployment/installation.md §7); CI runs it in the `compose` job.
#
#   bash scripts/ops/compose-env-init.sh [--force]
#
# The generated values are never printed. The file is created with mode 600 and is gitignored (.env) and excluded from
# the image build context (.dockerignore). Production never uses this file: secrets come from Kubernetes Secrets or an
# external secret store (docs/deployment/secrets.md).
# =====================================================================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/deploy/compose/.env.example"
DST="${COMPOSE_ENV_FILE:-$ROOT/deploy/compose/.env}"
if [ -e "$DST" ] && [ "${1:-}" != "--force" ]; then
  echo "refusing to overwrite $DST (use --force to regenerate; this changes the database passwords, so also run 'down -v')" >&2
  exit 1
fi
umask 077
tmp="$(mktemp "$(dirname "$DST")/.env.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
n=0
while IFS= read -r line || [ -n "$line" ]; do
  if [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=CHANGE_ME ]]; then
    printf '%s=local_only_%s\n' "${BASH_REMATCH[1]}" "$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
    n=$((n + 1))
  else
    printf '%s\n' "$line"
  fi
done <"$SRC" >"$tmp"
if grep -qE '^[A-Za-z_][A-Za-z0-9_]*=.*CHANGE_ME' "$tmp"; then echo "a CHANGE_ME value is left (not at the start of the value?)" >&2; exit 1; fi
chmod 600 "$tmp"
mv "$tmp" "$DST"
trap - EXIT
echo "wrote $DST ($n CHANGE_ME values replaced with random local-only values; not printed)"
