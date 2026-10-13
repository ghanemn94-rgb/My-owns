#!/usr/bin/env bash
# Auditor reproduction of pnpm test inside the D-134 load envelope (environment.md limitation 6).
# Clone $TMPDIR/c at 8553323; offline frozen install from a private store copy; pnpm -r build; then pnpm test
# (TZ=UTC CI=1) on Node 24 locale unset and Node 22 C.UTF-8, one after another, sampling the 1-min load every 15 s.
set -u
EV="$1"; C="$TMPDIR/c"; N22=/opt/node22/bin
cp -a /root/.local/share/pnpm/store "$TMPDIR/pstore"
cd "$C"
{ pnpm install --offline --frozen-lockfile --store-dir "$TMPDIR/pstore/v10"; echo "EXIT $?"; } > "$EV/07-install.log" 2>&1
{ pnpm -r build; echo "EXIT $?"; pnpm install --offline --frozen-lockfile --store-dir "$TMPDIR/pstore/v10"; echo "EXIT(install2) $?"; } > "$EV/07-build.log" 2>&1
sample() { while :; do echo "$(date -u +%T) $(cut -d' ' -f1-3 /proc/loadavg)"; sleep 15; done; }
run() { # name, env-prefix...
  local name="$1"; shift
  echo "$(date -u +%T) START $name" >> "$EV/07-unit-samples.log"
  sample >> "$EV/07-unit-samples.log" & local sp=$!
  { echo "# $name start $(date -u +%FT%TZ) load $(cat /proc/loadavg)"; "$@" pnpm test; echo "EXIT $?"; echo "# end $(date -u +%FT%TZ) load $(cat /proc/loadavg)"; } > "$EV/07-unit-$name.log" 2>&1
  kill $sp; wait $sp 2>/dev/null
  echo "$(date -u +%T) END $name" >> "$EV/07-unit-samples.log"
}
run node24-unset env -u LANG -u LC_ALL -u LC_CTYPE TZ=UTC CI=1
run node22-C env LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC CI=1 PATH="$N22:$PATH"
cd "$C" && git status --short > "$EV/07-clone-status.txt"
echo done > "$EV/07-done.txt"
