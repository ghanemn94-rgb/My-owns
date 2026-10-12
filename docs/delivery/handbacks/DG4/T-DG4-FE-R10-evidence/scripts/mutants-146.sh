#!/usr/bin/env bash
# F-DG4-146 mutation check. Applies a mutant to apps/web/src/api/client.ts IN PLACE, runs the given vitest command,
# and always restores the original bytes (checked by SHA-256) on exit.
# usage: mutants-146.sh <M4|M4a|M4b> <log> -- <vitest args...>
set -u
cd "$(git rev-parse --show-toplevel)"
F=apps/web/src/api/client.ts
mut=$1; log=$2; shift 3
orig_sha=$(sha256sum "$F" | cut -d' ' -f1)
cp "$F" "$TMPDIR/client.ts.orig"
restore() { cp "$TMPDIR/client.ts.orig" "$F"; [ "$(sha256sum "$F" | cut -d' ' -f1)" = "$orig_sha" ] && echo "restored $F sha256=$orig_sha" >>"$log" || echo "RESTORE FAILED" >>"$log"; }
trap restore EXIT
case "$mut" in
  M4)  node -e 'const fs=require("fs");const f=process.argv[1];let s=fs.readFileSync(f,"utf8");const a="    if (pendingCheck) await pendingCheck;\n    if (probesIdle) await probesIdle;\n";if(!s.includes(a))process.exit(3);fs.writeFileSync(f,s.replace(a,"    void probesIdle;\n"))' "$F" || exit 3;;
  M4a) node -e 'const fs=require("fs");const f=process.argv[1];let s=fs.readFileSync(f,"utf8");const a="    if (pendingCheck) await pendingCheck;\n";if(!s.includes(a))process.exit(3);fs.writeFileSync(f,s.replace(a,""))' "$F" || exit 3;;
  M4b) node -e 'const fs=require("fs");const f=process.argv[1];let s=fs.readFileSync(f,"utf8");const a="    if (probesIdle) await probesIdle;\n";if(!s.includes(a))process.exit(3);fs.writeFileSync(f,s.replace(a,""))' "$F" || exit 3;;
  *) echo "unknown mutant"; exit 2;;
esac
{ echo "mutant $mut applied; diff vs candidate:"; diff "$TMPDIR/client.ts.orig" "$F"; echo "--- uptime: $(uptime)"; echo "--- command: npx vitest $*"; } >"$log"
TZ=UTC CI=1 npx vitest "$@" >>"$log" 2>&1
rc=$?
echo "vitest exit=$rc" >>"$log"
exit $rc
