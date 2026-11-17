#!/usr/bin/env bash
# code-security-reviewer, DG7 round 2 (T-DG7-REV-CS-RG2): verification of F-DG7-1012 on candidate 33266ccd.
# Re-runs the round-1 probe (database phase under umask 022, the Compose `backup` service's sequence with
# MTH_TRANSFER_ATTACHMENTS=none), then probes the new root checks:
#   P1  database phase into an owner-only root under umask 022: every entry must be 0700 (dir) / 0600 (file)
#   P2  a 1777 root (the host /tmp shape): must be refused with exit 2 and nothing written
#   P3  a symlink root pointing to an owner-only directory: observed behaviour
#   P4  an owner-only (0700) root owned by ANOTHER uid (nobody, 65534): observed behaviour (does backup.sh check owner?)
# Run inside tests/qa/support/with-pg.sh (TEST_DATABASE_ADMIN_URL).
# Usage (from a candidate clone): QA_PG_PORT=32460 MTH_PORT_POOL=32400-32499 tests/qa/support/with-pg.sh bash <this> <clone>
set -euo pipefail
REPO="$1"; cd "$REPO"
ADMIN="$TEST_DATABASE_ADMIN_URL"
HOSTPORT="$(printf '%s' "$ADMIN" | sed -E 's#^postgresql://[^@]*@([^/]*)/.*$#\1#')"
psql "$ADMIN" -qAt -c "CREATE ROLE mth_owner LOGIN" -c "CREATE ROLE mth_app LOGIN" \
  -c "CREATE DATABASE mth_bk OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
OWNER_URL="postgresql://mth_owner@${HOSTPORT}/mth_bk"
NODE_ENV=test DATABASE_OWNER_URL="$OWNER_URL" node --conditions=@mth/source packages/db/src/cli.ts migrate | tail -2
W="$(mktemp -d "${TMPDIR:?}/bkmode.XXXXXX")"
mkdir -p "$W/evidence"
umask 022
echo "umask $(umask)"
run_backup() { # <root> <label>
  NODE_ENV=test DATABASE_URL="$OWNER_URL" EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$W/evidence" \
    MTH_TRANSFER_ATTACHMENTS=none bash deploy/scripts/backup.sh --out "$1" --label "$2" --phase database \
    --operator "reviewer probe (synthetic)"
}
set +e
echo "=== P1 owner-only root (created by backup.sh), umask 022"
run_backup "$W/backups" modeprobe; echo "P1 backup.sh exit=$?"
echo "--- modes (octal, type, path relative to the root):"
(cd "$W/backups" && find . -printf '%m %y %p\n' | LC_ALL=C sort -k3)
echo "--- entries readable or writable by group/others (must be none):"
find "$W/backups" -mindepth 1 -perm /077 -printf '%m %p\n' | sed "s#$W#<W>#"
echo "--- dump TABLE DATA (app_user, audit_event, session):"
dump="$(find "$W/backups" -name '*.dump' | head -1)"
[ -n "$dump" ] && pg_restore --list "$dump" | grep -E "TABLE DATA public (app_user|audit_event|session) "

echo "=== P2 1777 root"
mkdir -p "$W/shared" && chmod 1777 "$W/shared"
run_backup "$W/shared" p2probe 2>&1 | sed "s#$W#<W>#g"; echo "P2 backup.sh exit=${PIPESTATUS[0]}"
echo "entries written under the 1777 root: $(find "$W/shared" -mindepth 1 | wc -l)"

echo "=== P3 symlink root -> owner-only directory"
mkdir -p "$W/real" && chmod 700 "$W/real" && ln -s "$W/real" "$W/link"
run_backup "$W/link" p3probe 2>&1 | sed "s#$W#<W>#g" | tail -3; echo "P3 backup.sh exit=${PIPESTATUS[0]}"

echo "=== P4 0700 root owned by uid 65534"
mkdir -p "$W/foreign" && chmod 700 "$W/foreign"
if chown 65534:65534 "$W/foreign" 2>/dev/null; then
  stat -c 'root owner uid=%u mode=%a' "$W/foreign"
  run_backup "$W/foreign" p4probe 2>&1 | sed "s#$W#<W>#g" | tail -2; echo "P4 backup.sh exit=${PIPESTATUS[0]}"
  echo "set written under the foreign-owned root: $(find "$W/foreign" -mindepth 1 -maxdepth 1 | sed "s#$W#<W>#")"
else
  echo "P4 BLOCKED: chown to 65534 is not permitted in this sandbox"
fi
set -e
rm -rf "$W"
