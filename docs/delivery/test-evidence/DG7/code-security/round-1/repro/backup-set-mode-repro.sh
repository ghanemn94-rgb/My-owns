#!/usr/bin/env bash
# code-security-reviewer, DG7 round 1 (T-DG7-REV-CS-RG1): the file modes of a backup set written by
# deploy/scripts/backup.sh (database phase) under the default umask 022 (the umask of a root process in the Compose
# `backup` container, and of a typical operator shell). Run inside tests/qa/support/with-pg.sh (TEST_DATABASE_ADMIN_URL).
# Usage (from a candidate clone): QA_PG_PORT=32450 MTH_PORT_POOL=32400-32499 tests/qa/support/with-pg.sh bash <this> <clone>
set -euo pipefail
REPO="$1"; cd "$REPO"
ADMIN="$TEST_DATABASE_ADMIN_URL"
HOSTPORT="$(printf '%s' "$ADMIN" | sed -E 's#^postgresql://[^@]*@([^/]*)/.*$#\1#')"
psql "$ADMIN" -qAt -c "CREATE ROLE mth_owner LOGIN" -c "CREATE ROLE mth_app LOGIN" \
  -c "CREATE DATABASE mth_bk OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
OWNER_URL="postgresql://mth_owner@${HOSTPORT}/mth_bk"
NODE_ENV=test DATABASE_OWNER_URL="$OWNER_URL" node --conditions=@mth/source packages/db/src/cli.ts migrate | tail -2
W="$(mktemp -d "${TMPDIR:?}/bkmode.XXXXXX")"
mkdir -p "$W/evidence" "$W/backups"
umask 022
echo "umask $(umask)"
set +e
NODE_ENV=test DATABASE_URL="$OWNER_URL" EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$W/evidence" MTH_TRANSFER_ATTACHMENTS=none \
  bash deploy/scripts/backup.sh --out "$W/backups" --label modeprobe --phase database --operator "reviewer probe (synthetic)"
echo "backup.sh exit=$?"
set -e
echo "--- modes of the set (octal, type, path relative to the backup root):"
(cd "$W/backups" && find . -printf '%m %y %p\n' | LC_ALL=C sort -k3)
echo "--- what the dump holds (pg_restore --list, the user_account and audit_event TABLE DATA lines):"
dump="$(find "$W/backups" -name '*.dump' -o -name '*.pgdump' | head -1)"
[ -n "$dump" ] && pg_restore --list "$dump" | grep -E "TABLE DATA public (app_user|user_account|\"user\"|audit_event|session) " || true
rm -rf "$W"
