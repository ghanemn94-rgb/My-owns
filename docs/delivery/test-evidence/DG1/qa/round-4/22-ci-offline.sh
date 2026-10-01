#!/usr/bin/env bash
# qa-verifier DG1 round 3: REQ-DLV-025 / A24 offline surface. Runs ONLY in a throwaway clone under $TMPDIR
# (argument 1); every mutation is reverted with git checkout and the control is re-run.
set -u
C="${1:?usage: $0 <throwaway-clone-under-TMPDIR>}"
case "$C/" in "$TMPDIR"/*) ;; *) echo "REFUSED: not under \$TMPDIR"; exit 64 ;; esac
cd "$C" || exit 2
echo "# clone: \$TMPDIR/$(basename "$C") @ $(git rev-parse HEAD); node $(node -v); $(date -u +%FT%TZ)"
echo "## 1. CI workflow copies identical"
sha256sum .github/workflows/ci.yml deploy/ci/ci.yml
if cmp -s .github/workflows/ci.yml deploy/ci/ci.yml; then echo "IDENTICAL exit=0"; else echo "DIFFERENT exit=1"; fi
echo "## 2. check-ci-needs on the candidate"
node deploy/scripts/check-ci-needs.mjs; echo "exit=$?"
echo "## 3. dependency-script unit tests"
node --test deploy/scripts/tests/check-ci-needs.test.mjs 2>&1 | tail -9; echo "exit=${PIPESTATUS[0]}"
echo "## 4. negative mutations of .github/workflows/ci.yml (each must exit non-zero)"
mutate() { # $1 label, $2 perl expression
  echo "### $1"
  perl -0pi -e "$2" .github/workflows/ci.yml
  git diff --stat -- .github/workflows/ci.yml | tail -1
  node deploy/scripts/check-ci-needs.mjs; echo "exit=$? (non-zero expected)"
  git checkout -q -- .github/workflows/ci.yml
}
mutate "a: verify job loses 'needs: delivery-gates'" 's/(\n  verify:\n(?:.*\n)*?)    needs: delivery-gates\n/$1/'
mutate "b: e2e job gets 'if: always()'" 's/(\n  e2e:\n)/$1    if: always()\n/'
mutate "c: delivery-gates job no longer runs validate.mjs --pipeline" 's/run: node tools\/gates\/validate\.mjs --pipeline/run: echo skipped/'
echo "### control (unmodified)"
node deploy/scripts/check-ci-needs.mjs; echo "exit=$? (0 expected)"
echo "## 5. A24 first half, simulated locally: a tampered approved gate record makes the delivery-gates command fail"
printf '\n' >> docs/delivery/gates/DG0.json
node tools/gates/validate.mjs --pipeline 2>&1 | tail -5; echo "validate --pipeline with a tampered DG0 gate record: exit=${PIPESTATUS[0]} (non-zero expected)"
git checkout -q -- docs/delivery/gates/DG0.json
node tools/gates/validate.mjs --pipeline 2>&1 | tail -2; echo "restored: exit=${PIPESTATUS[0]}"
echo "## 6. not reproducible here (residual D-058): a live GitHub-Actions run showing dependent jobs skipped"
