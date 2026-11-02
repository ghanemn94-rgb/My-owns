#!/usr/bin/env bash
# code-security-reviewer, DG6 round 2 (T-DG6-REV-CS-R2). Candidate cf40705b..., source commit 9bb2207.
# All execution happens in disposable copies under $TMPDIR/r (never in the candidate tree):
#   $TMPDIR/r/c   full clone (git clone --no-local), used for the candidate identity check
#   $TMPDIR/r/w1  --shared clone of c at 9bb2207 (full checkout): install, build, static, unit, integration LANG unset
#   $TMPDIR/r/w2  --shared clone of c at 9bb2207 (full checkout): install, build, integration LANG=C.UTF-8, reproductions
# Dependencies are installed offline (--frozen-lockfile) from a private copy of the local pnpm store, because the
# sandbox's node_modules is read-only. Ports: 28750-28799 (assignment range).
# Usage: checks.sh <step> [args]. Each log starts with a header (node, LANG/LC_ALL, load, commit) and ends with "exit=<status>".
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-2
R=$TMPDIR/r
N24=/opt/nvm/versions/node/v24.21.0/bin
N22=/opt/node22/bin
export MTH_PORT_POOL=28750-28799 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
run() {
  local name=$1
  shift
  {
    echo "# $name  started $(date -u +%FT%TZ)  cwd=$(pwd)  node=$(node -v)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}  load=$(cut -d' ' -f1-3 /proc/loadavg)  commit=$(git rev-parse HEAD 2>/dev/null)"
    echo "\$ $*"
    "$@"
    echo "exit=$?  finished $(date -u +%FT%TZ)  load=$(cut -d' ' -f1-3 /proc/loadavg)"
  } >"$E/$name.log" 2>&1
  tail -1 "$E/$name.log"
}
w() { cd "$R/$1" || exit 2; }
case "${1-}" in
  identity)
    export PATH=$N24:$PATH
    {
      set -x
      sha256sum /home/user/My-owns/docs/delivery/assignments/DG6/round-2/code-security-reviewer.md
      (cd /home/user/My-owns && git rev-parse HEAD && node tools/gates/candidate.mjs --stage DG6)
      mkdir -p "$R"
      # Disk: the shared volume had about 8 GB free after a first attempt filled it (a full checkout of every copy).
      # So: ONE complete clone (--no-local: a full object copy, not shallow, no alternates) with a sparse checkout that omits
      # only docs/delivery/runs, docs/delivery/test-evidence and handbacks of earlier stages (the manifest excludes them; the
      # recomputed ID proves it), and one --shared sparse clone w2 for the second locale and the reproductions.
      git clone --no-local --no-checkout -q /home/user/My-owns "$R/w1"
      cd "$R/w1"
      git rev-parse --is-shallow-repository
      ls .git/objects/info/alternates 2>&1
      git count-objects -vH
      git sparse-checkout set --no-cone '/*' '!/docs/delivery/runs/' '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '/docs/delivery/handbacks/DG6/' '!/trading_agent/'
      git checkout -q e56b3d2fc59611443fdfe273c6a1adc51c234222 && git rev-parse HEAD && node tools/gates/candidate.mjs --stage DG6
      git checkout -q 9bb2207667d8ef68e32e351a3782c4e9dfcdecd1 && git rev-parse HEAD && node tools/gates/candidate.mjs --stage DG6
      git diff --name-only 9bb2207667d8ef68e32e351a3782c4e9dfcdecd1 e56b3d2fc59611443fdfe273c6a1adc51c234222
      git clone -q --shared --no-checkout "$R/w1" "$R/w2"
      cd "$R/w2"
      git sparse-checkout set --no-cone '/*' '!/docs/delivery/runs/' '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '/docs/delivery/handbacks/DG6/' '!/trading_agent/'
      git checkout -q 9bb2207667d8ef68e32e351a3782c4e9dfcdecd1 && git rev-parse HEAD && node tools/gates/candidate.mjs --stage DG6
      du -sh "$R/w1" "$R/w2"
      set +x
    } >"$E/01-candidate-identity.log" 2>&1
    echo "exit=$?" >>"$E/01-candidate-identity.log"
    tail -3 "$E/01-candidate-identity.log"
    ;;
  install)
    export PATH=$N24:$PATH
    mkdir -p "$R/pstore" && cp -a /root/.local/share/pnpm/store/v10 "$R/pstore/v10"
    w w1; run 05-install-w1 pnpm install --offline --frozen-lockfile --store-dir "$R/pstore/v10"
    w w2; run 05-install-w2 pnpm install --offline --frozen-lockfile --store-dir "$R/pstore/v10"
    ;;
  build)
    export PATH=$N24:$PATH
    w w1; run 10-build-w1 pnpm -r --workspace-concurrency=2 build
    w w2; run 10-build-w2 pnpm -r --workspace-concurrency=2 build
    ;;
  static)
    export PATH=$N24:$PATH
    w w1
    run 11-typecheck pnpm -r --workspace-concurrency=1 typecheck
    run 12-lint pnpm lint
    run 13-format-check pnpm format:check
    run 14-openapi-lint pnpm openapi:lint
    run 15-no-cdn pnpm check:no-cdn
    ;;
  unit)
    # checks.sh unit <22|24>
    w w1
    if [ "$2" = 22 ]; then export PATH=$N22:$PATH; else export PATH=$N24:$PATH; fi
    unset LANG LC_ALL
    run 2$([ "$2" = 22 ] && echo 0 || echo 1)-unit-node$2 pnpm test
    ;;
  int)
    # checks.sh int <unset|cutf8> <1|2>   (two vitest shards per locale; a full run exceeds a 2-hour background task here)
    export PATH=$N22:$PATH
    unset LC_ALL
    if [ "$2" = unset ]; then w w1; unset LANG; export QA_PG_PORT=$((28750 + $3)); n=30; else w w2; export LANG=C.UTF-8; export QA_PG_PORT=$((28760 + $3)); n=31; fi
    run $n-integration-lang-$2-shard$3of2 tests/qa/support/with-pg.sh npx vitest run --project integration --shard=$3/2
    ;;
  repro)
    # checks.sh repro <log name> <test file under $E/repro>   (in w2; the file is copied in and removed afterwards)
    w w2
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=28775
    cp "$E/repro/$3" "tests/qa/integration/$3"
    run "$2" tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "tests/qa/integration/$3"
    rm -f "tests/qa/integration/$3"
    ;;
  one)
    # checks.sh one <log name> <w1|w2> <test path...>   a single integration file (or files) alone, LANG unset
    name=$2; shift 2; w "$1"; shift
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=28780
    run "$name" tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$@"
    ;;
  historical)
    export PATH=$N24:$PATH
    cd /home/user/My-owns
    for s in DG5 DG4 DG3 DG2 DG1; do run 02-historical-$s node tools/gates/validate.mjs --historical --stage $s; done
    ;;
esac
# --- appended: mutants that revert each round-1 repair in the disposable copy w2 (never the candidate tree). Each applies
# one textual change, runs the candidate's own regression test and my reproduction, then restores w2 with git checkout.
#   checks.sh mutant <120|121|122|123>
case "${1-}" in
  mutant)
    w w2
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=28776
    case "$2" in
      120) f=apps/api/src/modules/platform/secrets.ts
           sed -i 's#^const ENV_SECRET_NAME = /^MTH_SECRET_\[A-Z0-9\]\[A-Z0-9_\]{0,116}\$/;#const ENV_SECRET_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;#' $f
           tests="apps/api/test/integration/integrations/secret-namespace.test.ts tests/qa/integration/zz-cs-r2-env-secret.test.ts"; repro=zz-cs-r2-env-secret.test.ts ;;
      121) f=apps/api/src/modules/transformations/routes.ts
           sed -i 's#^      if (restricted.size === 0) return page;#      if (restricted.size >= 0) return page; // MUTANT 121#' $f
           tests="apps/api/test/integration/access/sensitive-reach.test.ts tests/qa/integration/zz-cs-r2-sens-reach.test.ts"; repro=zz-cs-r2-sens-reach.test.ts ;;
      122) f=apps/api/src/modules/access/sensitive-reach.ts
           sed -i 's#= new Map(Object.entries(SENSITIVE_CHILD_SOURCES));#= new Map(); // MUTANT 122#' $f
           tests="apps/api/test/integration/access/sensitive-reach.test.ts tests/qa/integration/zz-cs-r2-sens-reach.test.ts"; repro=zz-cs-r2-sens-reach.test.ts ;;
      123) f=apps/api/src/modules/forms/record-types.ts
           sed -i 's#^  await requireRecordReach(db, principalOf(request), recordType.table_name!, recordId, target);#  void requireRecordReach; void target; // MUTANT 123#' $f
           tests="apps/api/test/integration/access/sensitive-reach.test.ts tests/qa/integration/zz-cs-r2-sens-reach.test.ts"; repro=zz-cs-r2-sens-reach.test.ts ;;
    esac
    cp "$E/repro/$repro" "tests/qa/integration/$repro"
    {
      echo "# mutant $2: git diff of the disposable copy w2"
      git diff --stat; git diff
    } >"$E/50-mutant-$2.diff.txt"
    run 50-mutant-$2 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $tests
    rm -f "tests/qa/integration/$repro"
    git checkout -- "$f"
    git status --short >>"$E/50-mutant-$2.log"
    echo "restored: $(git status --short | wc -l) changed paths" >>"$E/50-mutant-$2.log"
    ;;
esac
# --- appended: typecheck re-run (11-typecheck was OOM-killed, exit 137, in apps/api's tsc while three reviews and four
# integration forks shared the 16 GB host). Same command, one package at a time, after lint/format finished.
case "${1-}" in
  typecheck-rerun)
    export PATH=$N24:$PATH
    w w1
    run "11${TC_SUFFIX:-b}-typecheck-rerun" pnpm -r --workspace-concurrency=1 typecheck
    ;;
esac
# --- appended: a unit file that timed out under load, re-run ALONE (in w2, so it never overlaps the full run in w1).
#   checks.sh unit-one <log name> <22|24> <project> <file...>
case "${1-}" in
  unit-one)
    name=$2; n=$3; p=$4; shift 4
    w w2
    if [ "$n" = 22 ]; then export PATH=$N22:$PATH; else export PATH=$N24:$PATH; fi
    unset LANG LC_ALL
    run "$name" npx vitest run --configLoader runner --project "$p" "$@"
    ;;
esac
# --- appended: an integration file that timed out under load in a C.UTF-8 shard, re-run ALONE with LANG=C.UTF-8.
#   checks.sh one-cutf8 <log name> <w1|w2> <test path...>
case "${1-}" in
  one-cutf8)
    name=$2; shift 2; w "$1"; shift
    export PATH=$N22:$PATH
    export LANG=C.UTF-8
    unset LC_ALL
    export QA_PG_PORT=28781
    run "$name" tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$@"
    ;;
esac
# --- appended: the e2e specs that requirement notes defer to the freeze verification (REQ-S12-019: A17 failing
# connector; REQ-S17-007: A12-5 assistant scope), on the production-initialized stack (with-stack.sh), in w1 (built).
#   checks.sh e2e <log name> <spec...>
case "${1-}" in
  e2e)
    name=$2; shift 2
    w w1
    export PATH=$N24:$PATH
    unset LANG LC_ALL
    export E2E_PG_PORT=28790 E2E_API_PORT=28792 E2E_SCREENSHOT_DIR="$R/shots"
    mkdir -p "$R/shots"
    run "$name" apps/web/e2e/support/with-stack.sh npx playwright test "$@" --workers=1
    ;;
esac
