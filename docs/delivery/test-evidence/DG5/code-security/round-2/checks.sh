#!/usr/bin/env bash
# code-security-reviewer, DG5 corrected clean re-gate, round 2 (T-DG5-RG2-SEC-R2; assignment task id T-DG5-REV-SEC-R5).
# Runs the build/static/unit/integration checks in the disposable working copy $TMPDIR/rv (a --shared sparse clone at
# the freeze commit 7a02e7d; candidate 55a411ae..., see 01-candidate-identity.log). Dependencies are installed offline
# (--frozen-lockfile) from a private copy of the local pnpm store, because the sandbox's node_modules is read-only.
# Usage: checks.sh <step>   Each log starts with a header (node, LANG/LC_ALL, load) and ends with "exit=<status>".
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-2
cd "$TMPDIR/rv" || exit 2
N24=/opt/nvm/versions/node/v24.21.0/bin
N22=/opt/node22/bin
export MTH_PORT_POOL=26500-26599 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
run() {
  local name=$1
  shift
  {
    echo "# $name  started $(date -u +%FT%TZ)  node=$(node -v)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}  load=$(cut -d' ' -f1-3 /proc/loadavg)  commit=$(git rev-parse HEAD)"
    echo "\$ $*"
    "$@"
    echo "exit=$?  finished $(date -u +%FT%TZ)  load=$(cut -d' ' -f1-3 /proc/loadavg)"
  } >"$E/$name.log" 2>&1
  tail -1 "$E/$name.log"
}
case "$1" in
  install)
    export PATH=$N24:$PATH
    run 05-install pnpm install --offline --frozen-lockfile --store-dir "$TMPDIR/pstore/v10"
    ;;
  static)
    export PATH=$N24:$PATH
    run 10-build pnpm -r build
    run 11-typecheck pnpm -r typecheck
    run 12-lint pnpm lint
    run 13-format-check pnpm format:check
    run 14-openapi-lint pnpm openapi:lint
    run 15-no-cdn pnpm check:no-cdn
    ;;
  unit22)
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    run 20-unit-node22 pnpm test
    ;;
  unit24)
    export PATH=$N24:$PATH
    unset LANG LC_ALL
    run 21-unit-node24 pnpm test
    ;;
  int-unset)
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=26510
    run 30-integration-lang-unset tests/qa/support/with-pg.sh pnpm test:integration
    ;;
  int-cutf8)
    export PATH=$N22:$PATH
    export LANG=C.UTF-8
    unset LC_ALL
    export QA_PG_PORT=26530
    run 31-integration-lang-c-utf8 tests/qa/support/with-pg.sh pnpm test:integration
    ;;
  sweep)
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=26550
    cp "$E/repro/zz-sec-rg2-p5-role-sweep.test.ts" tests/qa/integration/zz-sec-rg2-p5-role-sweep.test.ts
    run 45-p5-role-sweep tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/zz-sec-rg2-p5-role-sweep.test.ts
    rm -f tests/qa/integration/zz-sec-rg2-p5-role-sweep.test.ts
    ;;
  ooxml)
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=26570
    cp "$E/repro/zz-sec-rg2-ooxml-control-char.test.ts" tests/qa/integration/zz-sec-rg2-ooxml-control-char.test.ts
    run 46-ooxml-control-char tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/zz-sec-rg2-ooxml-control-char.test.ts
    rm -f tests/qa/integration/zz-sec-rg2-ooxml-control-char.test.ts
    ;;
  ooxml2)
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=${QA_PG_PORT:-26572}
    cp "$E/repro/zz-sec-rg2r2-ooxml-control-char.test.ts" tests/qa/integration/zz-sec-rg2r2-ooxml-control-char.test.ts
    run ${LOGNAME_OVERRIDE:-46-ooxml-control-char-e2e} tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa/integration/zz-sec-rg2r2-ooxml-control-char.test.ts
    rm -f tests/qa/integration/zz-sec-rg2r2-ooxml-control-char.test.ts
    ;;
  ooxml2-render)
    export PATH=$N24:$PATH
    unset LANG LC_ALL
    run ${LOGNAME_OVERRIDE:-46b-ooxml-control-chars-renderer} bash -c "node $E/repro/ooxml-control-chars-v2.mjs dist; a=\$?; node $E/repro/ooxml-control-chars-v2.mjs src; b=\$?; echo dist-exit=\$a src-exit=\$b; exit \$((a|b))"
    ;;
esac
