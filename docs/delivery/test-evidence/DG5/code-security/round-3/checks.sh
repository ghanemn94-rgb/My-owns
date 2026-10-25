#!/usr/bin/env bash
# code-security-reviewer DG5 round 3 (clean re-gate; candidate d8d83181, source 54e02b6, freeze bd2e7f9).
# Runs in the disposable complete clone $TMPDIR/rv checked out at bd2e7f9 (= 54e02b6 + docs/delivery records only).
# node_modules copied with cp -a from the repository tree, so the clone's node_modules is writable and the default
# Vitest config loader works there (--configLoader runner is only needed in the read-only repo tree, not used here).
# Usage: checks.sh <step>   (logs to the evidence dir; each log ends with "exit=<status>")
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-3
cd "$TMPDIR/rv"
N24=/opt/nvm/versions/node/v24.21.0/bin; N22=/opt/node22/bin
export MTH_PORT_POOL=26500-26599 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
run() { local name=$1; shift; { echo "# $name  $(date -u +%FT%TZ)  node=$(node -v)  commit=$(git rev-parse HEAD)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}  load=$(cut -d' ' -f1-3 /proc/loadavg)"; echo "\$ $*"; "$@"; echo "exit=$?  finished=$(date -u +%FT%TZ)  load=$(cut -d' ' -f1-3 /proc/loadavg)"; } > "$E/$name.log" 2>&1; tail -1 "$E/$name.log"; }
case "$1" in
  static)
    export PATH=$N24:$PATH
    run 10-build pnpm -r build
    run 11-typecheck pnpm -r typecheck
    run 12-lint pnpm lint
    run 13-format-check pnpm format:check
    run 14-openapi-lint pnpm openapi:lint
    run 15-no-cdn pnpm check:no-cdn ;;
  unit22) export PATH=$N22:$PATH; unset LANG LC_ALL; run 20-unit-node22 pnpm test ;;
  unit24) export PATH=$N24:$PATH; unset LANG LC_ALL; run 21-unit-node24 pnpm test ;;
  int-unset) export PATH=$N22:$PATH; unset LANG LC_ALL; export QA_PG_PORT=26510; run 30-integration-lang-unset tests/qa/support/with-pg.sh pnpm test:integration ;;
  int-cutf8) export PATH=$N22:$PATH; export LANG=C.UTF-8; unset LC_ALL; export QA_PG_PORT=26530; run 31-integration-lang-c-utf8 tests/qa/support/with-pg.sh pnpm test:integration ;;
  validators)
    export PATH=$N24:$PATH; cd /home/user/My-owns
    { for s in DG4 DG3 DG2 DG1; do echo "\$ node tools/gates/validate.mjs --historical --stage $s"; node tools/gates/validate.mjs --historical --stage $s 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"; done
      echo "\$ node tools/gates/validate.mjs --register DG5"; node tools/gates/validate.mjs --register DG5 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
      echo "\$ node tools/gates/candidate.mjs --stage DG5 (repo tree)"; node tools/gates/candidate.mjs --stage DG5; echo "exit=$?"; } > "$E/16-validators.log" 2>&1; grep -c 'exit=0' "$E/16-validators.log" ;;
esac
