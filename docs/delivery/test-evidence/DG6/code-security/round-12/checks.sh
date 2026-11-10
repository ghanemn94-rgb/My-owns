#!/usr/bin/env bash
# code-security-reviewer, DG6 round 12 (T-DG6-REV-CS-R12). Candidate c05864ba..., source commit 2495e036.
# All execution happens in disposable copies under $TMPDIR/r (never in the candidate tree):
#   $TMPDIR/r/w1  --shared clone of /home/user/My-owns (non-shallow) checked out at the source commit, sparse checkout
#                 omitting only docs/delivery/runs, docs/delivery/test-evidence, earlier stages' handbacks and
#                 trading_agent (not in the manifest; the recomputed candidate ID in the clone proves the product tree is
#                 complete).
# The sandbox's node_modules is read-only and pnpm cannot install offline into a fresh store, so node_modules are
# copied from the repository tree after checking that its lock file equals pnpm-lock.yaml.
# Ports: 32450-32499 (assignment range).
# Usage: checks.sh <step> [args]. Each log starts with a header (node, LANG/LC_ALL, load, commit) and ends "exit=<n>".
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-12
R=$TMPDIR/r
C=2495e036c4d933788044756ab3c41415e3873cf3
N24=/opt/nvm/versions/node/v24.21.0/bin
N22=/opt/node22/bin
export MTH_PORT_POOL=32470-32499 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001
SPARSE=('/*' '!/docs/delivery/runs/' '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '/docs/delivery/handbacks/DG6/' '!/trading_agent/')
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
mkclone() {
  git clone -q --shared --no-checkout /home/user/My-owns "$R/$1"
  cd "$R/$1"
  git rev-parse --is-shallow-repository
  git sparse-checkout set --no-cone "${SPARSE[@]}"
  git checkout -q $C && git rev-parse HEAD && node tools/gates/candidate.mjs --stage DG6
  cmp /home/user/My-owns/pnpm-lock.yaml /home/user/My-owns/node_modules/.pnpm/lock.yaml && echo LOCK-MATCH
  cmp pnpm-lock.yaml /home/user/My-owns/pnpm-lock.yaml && echo CLONE-LOCK-EQUAL
  cd /home/user/My-owns
  for d in node_modules apps/*/node_modules packages/*/node_modules; do
    [ -e "$R/$1/$d" ] || { mkdir -p "$R/$1/$(dirname "$d")"; cp -a "$d" "$R/$1/$d"; }
  done
  cd "$R/$1"
  ls -d node_modules apps/*/node_modules packages/*/node_modules
  [ -n "${SKIPBUILD-}" ] && echo "build skipped (probe clone)" || pnpm -r --workspace-concurrency=2 build
  echo "build-exit=$?"
  git status --short | wc -l
  du -sh "$R/$1"; df -h "$R"
}
case "${1-}" in
  identity)
    export PATH=$N24:$PATH
    {
      set -x
      sha256sum /home/user/My-owns/docs/delivery/assignments/DG6/round-12/code-security-reviewer.md
      (cd /home/user/My-owns && git rev-parse HEAD && git log -1 --format='%H %P %s' HEAD && git merge-base --is-ancestor $C HEAD && echo SOURCE-IS-ANCESTOR-OF-HEAD && git diff --name-only $C HEAD && node tools/gates/candidate.mjs --stage DG6)
      mkdir -p "$R"
      set +x
    } >"$E/$2.log" 2>&1
    echo "exit=$?" >>"$E/$2.log"
    tail -3 "$E/$2.log"
    ;;
  clone)
    export PATH=$N24:$PATH
    mkdir -p "$R"
    { set -x; mkclone "$2"; set +x; } >"$E/05-setup-$2.log" 2>&1
    echo "exit=$?" >>"$E/05-setup-$2.log"
    tail -4 "$E/05-setup-$2.log"
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
    # checks.sh unit <22|24> [w1]
    w "${3-w1}"
    if [ "$2" = 22 ]; then export PATH=$N22:$PATH; n=20; else export PATH=$N24:$PATH; n=21; fi
    unset LANG LC_ALL
    run $n-unit-node$2 pnpm test
    ;;
  unit-one)
    # checks.sh unit-one <log name> <w1> <22|24> <project> <file...>
    name=$2; wd=$3; n=$4; p=$5; shift 5
    w "$wd"
    if [ "$n" = 22 ]; then export PATH=$N22:$PATH; else export PATH=$N24:$PATH; fi
    unset LANG LC_ALL
    run "$name" npx vitest run --configLoader runner --project "$p" "$@"
    ;;
  int4)
    # checks.sh int4 <w1> <unset|cutf8> <k> [suffix]  integration shard k/4, Node 22
    export PATH=$N22:$PATH
    unset LC_ALL
    w "$2"
    if [ "$3" = unset ]; then unset LANG; n=30; o=0; else export LANG=C.UTF-8; n=31; o=5; fi
    export QA_PG_PORT=$((32450 + o + $4))
    run $n-integration-lang-$3-shard$4of4${5-} tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration --shard=$4/4
    ;;
  int-one)
    # checks.sh int-one <log name> <w1> <unset|cutf8> <file...>
    name=$2; wd=$3; loc=$4; shift 4
    w "$wd"
    export PATH=$N22:$PATH
    unset LC_ALL
    if [ "$loc" = unset ]; then unset LANG; else export LANG=C.UTF-8; fi
    export QA_PG_PORT=32462
    run "$name" tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$@"
    ;;
  repro)
    # checks.sh repro <log name> <test file under $E/repro> [w1]  (copied into tests/qa/integration, removed after)
    w "${4-w1}"
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=32465
    cp "$E/repro/$3" "tests/qa/integration/$3"
    run "$2" tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "tests/qa/integration/$3"
    rm -f "tests/qa/integration/$3"
    ;;
  historical)
    export PATH=$N24:$PATH
    cd /home/user/My-owns
    for s in DG5 DG4 DG3 DG2 DG1; do run 02-historical-$s node tools/gates/validate.mjs --historical --stage $s; done
    run 03-register-DG6 node tools/gates/validate.mjs --register DG6
    ;;
  e2e)
    # checks.sh e2e <log name> <spec...>  production-initialized stack (with-stack.sh), in w1 (built)
    name=$2; shift 2
    w w1
    export PATH=$N24:$PATH
    unset LANG LC_ALL
    export E2E_PG_PORT=32466 QA_PG_PORT=32466 E2E_API_PORT=32467 MTH_PORT_POOL=32480-32499 E2E_SCREENSHOT_DIR="$R/shots"
    mkdir -p "$R/shots"
    run "$name" apps/web/e2e/support/with-stack.sh npx playwright test "$@" --workers=1
    ;;
  cleanup)
    { for d in w1; do [ -d "$R/$d" ] && (cd "$R/$d" && echo "$d changed paths: $(git status --short | wc -l)" && git status --short); done; rm -rf "$R"; echo "removed $R"; ls "$R" 2>&1; } >"$E/90-cleanup.log" 2>&1
    cat "$E/90-cleanup.log"
    ;;
esac
