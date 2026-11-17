#!/usr/bin/env bash
# qa-verifier DG7 round 2: independent probe of backup.sh's backup-root check (F-DG7-1012 repair). No database: the
# root check runs before DATABASE_URL is read, so a root that passes the check stops at "DATABASE_URL ... not set".
# Roots: 1777 (like /tmp), 0777, a symlink to the 1777 dir, a symlink to an owner-only 0700 dir, a regular file,
# 0750 and 0700. Expected by backup-restore.md §3.3: refuse only roots that group or others can WRITE (and non-dirs).
set -u
P=$TMPDIR/qa-root-probe; rm -rf "$P"; mkdir -p "$P" && cd "$P" || exit 2
mkdir -m 0700 real700; mkdir -m 1777 shared1777; mkdir -m 0777 open777; mkdir -m 0750 grp750
ln -s real700 link-to-700; ln -s shared1777 link-to-1777; touch afile; chmod 600 afile
for r in shared1777 open777 link-to-1777 link-to-700 afile grp750 real700; do
  env -u DATABASE_URL -u DATABASE_OWNER_URL bash "$TMPDIR/rv/deploy/scripts/backup.sh" --out "$P/$r" --label qa-probe --operator qa >"$P.out" 2>&1
  echo "$r exit=$?: $(head -1 "$P.out" | sed "s#$P#<P>#g")"
done
find "$P" -mindepth 2; rm -rf "$P" "$P.out"
