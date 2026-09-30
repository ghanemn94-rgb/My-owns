#!/usr/bin/env bash
# Creates the LOCAL secrets for the Compose stack, OUTSIDE the repository (REQ-S16-031: secrets are runtime
# configuration only). Idempotent: existing files are kept unless --force is given.
#
#   deploy/scripts/init-secrets.sh [--force] [--dir <path>] [--no-env-file]
#
# Default directory: ${MTH_SECRETS_DIR:-$HOME/.config/mth-compose/secrets}. The directory is 0700 (only you can list
# or reach it); the files inside are 0644 so the non-root users inside the containers (postgres uid 999, mth uid
# 10001, keycloak uid 1000) can read their bind-mounted copies. It also writes deploy/compose/.env (git-ignored by the
# root .gitignore pattern `.env`) containing ONLY `MTH_SECRETS_DIR=<path>`, never a secret value.
#
# Generated (all random, per machine; nothing here is a real credential):
#   pg_superuser_password, mth_owner_db_password, mth_app_db_password   PostgreSQL passwords
#   database_url, database_owner_url                                     URLs for DATABASE_URL_FILE / DATABASE_OWNER_URL_FILE
#   oidc_client_secret                                                   shared by the API and the TEST realm client
#   test_idp_user_password, test_idp_admin_password                      SYNTHETIC Keycloak users / Keycloak admin
#   test-idp-ca.pem, test-idp.crt, test-idp.key                          a throwaway CA + TLS cert for the TEST IdP
#                                                                        (https://keycloak:8443), so the API keeps
#                                                                        NODE_ENV=production (https issuer required)
# Needs: bash, openssl.
set -euo pipefail

FORCE=0
ENV_FILE=1
DIR="${MTH_SECRETS_DIR:-${HOME}/.config/mth-compose/secrets}"
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --dir) DIR="$2"; shift ;;
    --no-env-file) ENV_FILE=0 ;;
    *) echo "usage: $0 [--force] [--dir <path>] [--no-env-file]" >&2; exit 64 ;;
  esac
  shift
done
command -v openssl >/dev/null || { echo "BLOCKED: openssl is required" >&2; exit 3; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "$HERE/../compose" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
mkdir -p "$DIR"
DIR="$(cd "$DIR" && pwd)"
case "$DIR/" in
  "$REPO"/*) echo "refusing: the secrets directory must be outside the repository ($REPO)" >&2; exit 65 ;;
esac
chmod 0700 "$DIR"
umask 022

rand() { openssl rand -hex 24; }
put() { # put <name> <value>: write only when missing (or --force)
  if [ "$FORCE" = 1 ] || [ ! -s "$DIR/$1" ]; then printf '%s' "$2" >"$DIR/$1"; chmod 0644 "$DIR/$1"; echo "created $1"; else echo "kept    $1"; fi
}

put pg_superuser_password "$(rand)"
put mth_owner_db_password "$(rand)"
put mth_app_db_password "$(rand)"
put oidc_client_secret "$(rand)"
put test_idp_user_password "$(rand)"
put test_idp_admin_password "$(rand)"
# URLs are derived from the passwords every time so they can never drift apart. Hex passwords need no URL escaping.
printf 'postgres://mth_app:%s@db:5432/mth' "$(cat "$DIR/mth_app_db_password")" >"$DIR/database_url"
printf 'postgres://mth_owner:%s@db:5432/mth' "$(cat "$DIR/mth_owner_db_password")" >"$DIR/database_owner_url"
chmod 0644 "$DIR/database_url" "$DIR/database_owner_url"
echo "derived database_url, database_owner_url"

if [ "$FORCE" = 1 ] || [ ! -s "$DIR/test-idp.crt" ]; then
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/mth-idp-ca.XXXXXX")"
  openssl req -x509 -newkey rsa:3072 -nodes -days 825 -subj "/CN=MTH TEST-ONLY IdP CA" \
    -keyout "$tmp/ca.key" -out "$DIR/test-idp-ca.pem" 2>/dev/null
  openssl req -newkey rsa:3072 -nodes -subj "/CN=keycloak" -keyout "$DIR/test-idp.key" -out "$tmp/idp.csr" 2>/dev/null
  printf 'subjectAltName=DNS:keycloak,DNS:localhost\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' >"$tmp/ext"
  openssl x509 -req -in "$tmp/idp.csr" -CA "$DIR/test-idp-ca.pem" -CAkey "$tmp/ca.key" -CAcreateserial \
    -days 825 -extfile "$tmp/ext" -out "$DIR/test-idp.crt" 2>/dev/null
  rm -rf "$tmp" "$DIR/test-idp-ca.srl" # the CA key is discarded: this CA can never sign anything else
  chmod 0644 "$DIR/test-idp-ca.pem" "$DIR/test-idp.crt" "$DIR/test-idp.key"
  echo "created test-idp-ca.pem, test-idp.crt, test-idp.key (TEST IdP only; CA key discarded)"
else
  echo "kept    test-idp TLS files"
fi

if [ "$ENV_FILE" = 1 ]; then
  printf 'MTH_SECRETS_DIR=%s\n' "$DIR" >"$COMPOSE_DIR/.env"
  echo "wrote deploy/compose/.env (MTH_SECRETS_DIR only)"
fi
echo "secrets directory: $DIR"
