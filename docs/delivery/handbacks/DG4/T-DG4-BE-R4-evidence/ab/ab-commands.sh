#!/usr/bin/env bash
# A/B recorded-response comparison (T-DG4-BE-R4; the BE-M2 method, apps/api/test/support/response-transcript.ts).
# Run from the worktree root. "after" = this task's source; "before" = the same tree with the six API source files this
# task changed replaced by `git show HEAD:<file>` (the integrated base 48eba10), then restored and checked with sha256sum.
# Test files are the same on both sides; the -t filter selects only tests that hold on both sides.
set -u
T=${T:-$TMPDIR/be-r4-ab}
OUT=${OUT:-docs/delivery/handbacks/DG4/T-DG4-BE-R4-evidence/ab}
mkdir -p "$T/mine"
PAT='waivers \(End-to-End|inherited approvals \(Modular|the gate list and gate view|End-to-End G1-G4: unaffected|every other Modular waiver keeps|A/B transcript: the row|A/B transcript \(T-DG4-BE-R4\)'
FILES="apps/api/src/modules/platform/problem.ts apps/api/src/modules/workflows/gates.ts apps/api/src/modules/governance/minutes.ts apps/api/src/modules/portfolio/schedule-network.ts apps/api/src/modules/workflows/scale.ts apps/api/src/modules/adoption/assessments.ts"
TESTS="apps/api/test/integration/portfolio/dispensations.test.ts apps/api/test/integration/workflows/modular-precondition.test.ts apps/api/test/integration/workflows/modular-waiver.test.ts apps/api/test/integration/governance/meeting-action-follow.test.ts apps/api/test/integration/workflows/be-r4-ab-transcript.test.ts"
KINDS="dispensations modular-refusals meeting-action e2e-gates waiver-refusals touched-modules"
run() {
  side=$1
  MTH_BE_R3_DISPENSATION_TRANSCRIPT=$OUT/$side-dispensations.jsonl \
  MTH_BE_R3_MODULAR_REFUSAL_TRANSCRIPT=$OUT/$side-modular-refusals.jsonl \
  MTH_BE_R3_MEETING_ACTION_TRANSCRIPT=$OUT/$side-meeting-action.jsonl \
  MTH_BE_M2_TRANSCRIPT=$OUT/$side-e2e-gates.jsonl \
  MTH_BE_R4_WAIVER_REFUSAL_TRANSCRIPT=$OUT/$side-waiver-refusals.jsonl \
  MTH_BE_R4_TRANSCRIPT=$OUT/$side-touched-modules.jsonl \
  QA_PG_PORT=25950 MTH_PORT_POOL=25951-25999 tests/qa/support/with-pg.sh \
    pnpm vitest run --reporter=verbose --project integration $TESTS -t "$PAT" > "$OUT/ab-run-$side.log" 2>&1
  echo "EXIT=$?" >> "$OUT/ab-run-$side.log"
}
for f in $FILES; do cp "$f" "$T/mine/$(basename "$f")"; done
sha256sum $FILES > "$T/mine.sha256"
run after
for f in $FILES; do git show "HEAD:$f" > "$f"; done
run before
for f in $FILES; do cp "$T/mine/$(basename "$f")" "$f"; done
sha256sum -c "$T/mine.sha256"
for k in $KINDS; do
  if cmp -s "$OUT/before-$k.jsonl" "$OUT/after-$k.jsonl"; then
    echo "$k BYTE-IDENTICAL $(wc -l < "$OUT/after-$k.jsonl") lines sha256 $(sha256sum "$OUT/after-$k.jsonl" | cut -c1-64)"
  else
    echo "$k DIFFERS ($(wc -l < "$OUT/before-$k.jsonl") / $(wc -l < "$OUT/after-$k.jsonl") lines)"
    diff "$OUT/before-$k.jsonl" "$OUT/after-$k.jsonl" > "$OUT/$k.diff"
  fi
done
# The expected differences only: remove the `params` member of the two Modular waiver refusals (ADR-0038 Q1) and the
# `forumAr` message parameter (ADR-0032 G3) from the "after" transcript; the rest must equal "before" byte for byte.
for k in $KINDS; do
  sed -E -e 's/,"params":\{"date":"[0-9]{4}-[0-9]{2}-[0-9]{2}"\}//g' -e 's/,"forumAr":"[^"]*"//g' \
    "$OUT/after-$k.jsonl" > "$T/after-$k.stripped.jsonl"
  if cmp -s "$OUT/before-$k.jsonl" "$T/after-$k.stripped.jsonl"; then echo "$k without params/forumAr: BYTE-IDENTICAL"
  else echo "$k without params/forumAr: DIFFERS"; fi
done
