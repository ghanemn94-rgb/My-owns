#!/usr/bin/env bash
# code-security-reviewer DG5 RG2 round 2: F-DG5-100 end-to-end mutants. Runs the round-2 e2e probe
# (repro/zz-sec-rg2r2-ooxml-control-char.test.ts) in the disposable working copy $TMPDIR/rv with the fix reverted:
#   M1: packages/reporting/src/docx.ts and pptx.ts restored from the round-1 source 2fe8f85 (no xmlSafe, no package check);
#       expected: the probe FAILS (raw C0 characters in the downloaded charter.docx / roadmap.pptx parts, job succeeded);
#   M2: only the DOCX run text loses xmlSafe (the package check stays); expected: the probe FAILS because the charter DOCX
#       job FAILS with export.render_failed and its download is not 200 (the backstop: a corrupt file is never stored).
# After each mutant the two files are restored with git checkout, and `git status --porcelain` must be empty.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-2
cd "$TMPDIR/rv" || exit 2
export PATH=/opt/node22/bin:$PATH MTH_PORT_POOL=26500-26599
unset LANG LC_ALL
T=tests/qa/integration/zz-sec-rg2r2-ooxml-control-char.test.ts
LOG=$E/46d-ooxml-e2e-mutants.log
probe() {
  cp "$E/repro/zz-sec-rg2r2-ooxml-control-char.test.ts" "$T"
  QA_PG_PORT=$1 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$T" 2>&1 |
    grep -E 'REPRO|"(charter|roadmap|registers)\.|✓|×|Tests  |AssertionError' | cut -c1-420
  local rc=${PIPESTATUS[0]}
  rm -f "$T"
  return "$rc"
}
restore() {
  git checkout -- packages/reporting/src/docx.ts packages/reporting/src/pptx.ts
  echo "restored; git status --porcelain lines: $(git status --porcelain | wc -l)"
}
{
  echo "# 46d F-DG5-100 e2e mutants  $(date -u +%FT%TZ)  node=$(node -v)  commit=$(git rev-parse HEAD)  load=$(cut -d' ' -f1-3 /proc/loadavg)"
  echo
  echo "## M1: docx.ts + pptx.ts from 2fe8f85 (pre-fix)"
  git show 2fe8f853e54ef7ab7b88527f11633c0c3542edd6:packages/reporting/src/docx.ts >packages/reporting/src/docx.ts
  git show 2fe8f853e54ef7ab7b88527f11633c0c3542edd6:packages/reporting/src/pptx.ts >packages/reporting/src/pptx.ts
  echo "xmlSafe occurrences: docx.ts $(grep -c xmlSafe packages/reporting/src/docx.ts) pptx.ts $(grep -c xmlSafe packages/reporting/src/pptx.ts)"
  probe 26580
  echo "probe exit=$? (expect 1: mutant killed)"
  restore
  echo
  echo "## M2: docx.ts 'text: xmlSafe(t),' -> 'text: t,' (package check kept)"
  sed -i 's/text: xmlSafe(t),/text: t,/' packages/reporting/src/docx.ts
  echo "mutated lines: $(grep -c 'text: t,' packages/reporting/src/docx.ts)"
  probe 26584
  echo "probe exit=$? (expect 1: charter.docx job failed export.render_failed, no 200 download)"
  restore
  echo "exit=0  finished $(date -u +%FT%TZ)"
} >"$LOG" 2>&1
tail -3 "$LOG"
