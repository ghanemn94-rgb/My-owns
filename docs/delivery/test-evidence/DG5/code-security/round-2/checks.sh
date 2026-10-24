#!/usr/bin/env bash
# code-security-reviewer DG5 round 2 (T-DG5-RG-SEC-R2): static/build/unit/integration checks, run in the disposable
# clone $TMPDIR/rv (freeze commit 7144a19 = source edbf5ce + delivery records; node_modules copied with cp -a, so the
# clone's node_modules is writable and Vitest's default config loader works; --configLoader runner is not needed there).
# Usage: checks.sh <step>   (logs to the evidence dir; each log ends with "exit=<status>")
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-2
cd "$TMPDIR/rv"
N24=/opt/nvm/versions/node/v24.21.0/bin; N22=/opt/node22/bin
export MTH_PORT_POOL=26500-26599 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
run() { local name=$1; shift; { echo "# $name  $(date -u +%FT%TZ)  node=$(node -v)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}"; echo "\$ $*"; "$@"; echo "exit=$?"; } > "$E/$name.log" 2>&1; tail -1 "$E/$name.log"; }
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
esac
