#!/usr/bin/env bash
# qa-verifier DG7 round 3: re-run of the round-2 probe of backup.sh's backup-root check (F-DG7-1053 verification), plus
# new cases: a chain of two links, a dangling link, a link to a regular file, a relative link from another cwd, a link
# to a 0750 dir, a link whose target is owner-only but whose PARENT is world-writable (informational). No database: a
# root that passes the check stops later at "DATABASE_URL ... not set" (or the Compose-file check).
# Expected (backup-restore.md §3.3 as amended): a link is judged by its resolved target; owner-only accepted; a target
# writable by group or others refused naming the target; dangling / not-a-directory refused; nothing created.
set -u
P=$TMPDIR/qa-root-probe; rm -rf "$P"; mkdir -p "$P" && cd "$P" || exit 2
mkdir -m 0700 real700; mkdir -m 1777 shared1777; mkdir -m 0777 open777; mkdir -m 0750 grp750; mkdir -m 0770 grp770
ln -s real700 link-to-700; ln -s shared1777 link-to-1777; ln -s grp770 link-to-770; ln -s grp750 link-to-750
ln -s link-to-700 chain-to-700; ln -s missing dangling; touch afile; chmod 600 afile; ln -s afile link-to-file
mkdir -m 1777 wwparent; mkdir -m 0700 wwparent/inner700; ln -s wwparent/inner700 link-under-ww
for r in shared1777 open777 grp770 link-to-1777 link-to-770 link-to-700 chain-to-700 link-to-750 dangling link-to-file afile grp750 real700 link-under-ww; do
  env -u DATABASE_URL -u DATABASE_OWNER_URL -u DATABASE_URL_FILE EVIDENCE_STORAGE_PATH="$P" bash "$TMPDIR/rv/deploy/scripts/backup.sh" --out "$P/$r" --label qa-probe --operator qa >"$P.out" 2>&1
  echo "$r exit=$?: $(head -1 "$P.out" | sed "s#$P#<P>#g")"
done
echo "## relative link given from another cwd"
(cd "$P/real700" && env -u DATABASE_URL EVIDENCE_STORAGE_PATH="$P" bash "$TMPDIR/rv/deploy/scripts/backup.sh" --out ../link-to-700 --label qa-probe --operator qa 2>&1 | head -1 | sed "s#$P#<P>#g"; echo "exit=${PIPESTATUS[0]}")
echo "## anything created inside the probe roots (expected: nothing)"; find "$P" -mindepth 2 | sed "s#$P#<P>#g"
rm -rf "$P" "$P.out"
