#!/usr/bin/env bash
# code-security-reviewer, DG6 round 5: fix-reverting mutants for F-DG6-300 (BE-Z5) and F-DG6-301 (FE-Z3), run ONLY in
# the disposable clone $TMPDIR/r/w2 (never in the candidate tree). Each mutant is applied, its tests run, and the clone
# is restored (git checkout + clean) and its candidate ID recomputed.
# Usage: mutants.sh <be-z5|fe-z3>
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-5
W=$TMPDIR/r/w2
R4=654e39d89b66c0975ebef293d607f480f58408e3
C=d7b21bad306f6aacf10eaea5848d5449dbc4043e
N22=/opt/node22/bin
N24=/opt/nvm/versions/node/v24.21.0/bin
export MTH_PORT_POOL=30050-30099
cd "$W" || exit 2
restore() {
  git checkout -q -- . && git clean -fdq -- apps packages tests
  echo "restored: changed paths=$(git status --short | wc -l)"
  PATH=$N24:$PATH node tools/gates/candidate.mjs --stage DG6
}
case "$1" in
  be-z5)
    {
      echo "# mutant be-z5 started $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg)"
      FILES="apps/api/src/modules/access/sensitive-reach.ts apps/api/src/modules/benefits/gate-facts.ts apps/api/src/modules/governance/blocker-escalation.ts apps/api/src/modules/governance/escalations.ts apps/api/src/modules/governance/executive-decisions.ts apps/api/src/modules/reporting/modular.ts apps/api/src/modules/reporting/reports/restricted.ts apps/api/src/modules/reporting/reports/routes.ts apps/api/src/modules/reporting/traceability.ts apps/api/src/modules/workflows/g4.ts apps/api/src/modules/workflows/g6.ts apps/api/src/modules/workflows/impact.ts"
      echo "\$ git diff $R4..$C -- <BE-Z5 API source files> | git apply -R"
      git diff $R4..$C -- $FILES | git apply -R && echo "mutant applied: $(git status --short | tr '\n' ' ')"
      export PATH=$N22:$PATH QA_PG_PORT=30066
      unset LANG LC_ALL
      cp $E/repro/zz-cs-r4-sens-title.test.ts $E/repro/zz-cs-r4-sens-title2.test.ts tests/qa/integration/
      echo "\$ with-pg.sh npx vitest run --configLoader runner --project integration <round-4 repros> sensitive-reach-derived.test.ts"
      tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa/integration/zz-cs-r4-sens-title.test.ts tests/qa/integration/zz-cs-r4-sens-title2.test.ts apps/api/test/integration/access/sensitive-reach-derived.test.ts
      echo "mutant tests exit=$? (non-zero expected: the tests must catch the reverted fix)"
      rm -f tests/qa/integration/zz-cs-r4-sens-title*.test.ts
      restore
      echo "exit=0  finished $(date -u +%FT%TZ)"
    } >"$E/50-mutant-be-z5.log" 2>&1
    tail -3 "$E/50-mutant-be-z5.log"
    ;;
  fe-z3)
    {
      echo "# mutant fe-z3 started $(date -u +%FT%TZ)"
      export PATH=$N24:$PATH
      unset LANG LC_ALL
      python3 -I - <<'PY'
import json
for lang in ("en", "ar"):
    p = f"apps/web/src/i18n/{lang}/problems.json"
    d = json.load(open(p))
    removed = d.pop("validation__credential_refs", None)
    json.dump(d, open(p, "w"), ensure_ascii=False, indent=2)
    print(lang, "removed validation__credential_refs:", removed is not None)
PY
      echo "\$ npx vitest run --configLoader runner --project unit-web apps/web/src/i18n/problems-all.test.ts"
      npx vitest run --configLoader runner --project unit-web apps/web/src/i18n/problems-all.test.ts
      echo "mutant tests exit=$? (non-zero expected)"
      restore
      echo "\$ (restored) npx vitest run --configLoader runner --project unit-web apps/web/src/i18n/problems-all.test.ts"
      npx vitest run --configLoader runner --project unit-web apps/web/src/i18n/problems-all.test.ts
      echo "restored tests exit=$?"
      echo "exit=0  finished $(date -u +%FT%TZ)"
    } >"$E/51-mutant-fe-z3.log" 2>&1
    tail -3 "$E/51-mutant-fe-z3.log"
    ;;
esac
