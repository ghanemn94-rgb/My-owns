#!/usr/bin/env bash
# code-security-reviewer DG3 round 6: targeted acceptance supplement (same patterns as round 5), refining the loose clauses
# of requirement-acceptance.log, plus the REQ-S16-016 ERD table check in the disposable clone $TMPDIR/review-p6.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-6
echo "# targeted acceptance supplement $(date -u +%FT%TZ); clone $(git -C $TMPDIR/review-p6 rev-parse HEAD)"
for re in 'score 6 -> 400' 'unknown or retired type is 422' 'A→B→C→A|A→B→A' 'predecessor finishing after the needed-by date is flagged' 'P3 (BE-[A-E]|KBE-[BC]) operations' 'the five system types are listed' 'confidence outside H/M/L' 'six T09 columns' "Selected - unfunded' cannot launch" 'moving the forecast' 'seven T08 columns' 'G4 end to end' '95% and 105%|95%' 'Finance validation'; do
  for l in integration-run1-lang-unset integration-run2-lang-c-utf8; do echo "## [$l] /$re/ passing: $(grep '✓' $EV/$l.log | grep -cE "$re")"; done
  grep '✓' $EV/integration-run1-lang-unset.log | grep -E "$re" | head -3 | cut -c1-260 | sed 's/^/   /'
done
echo "## REQ-S16-016 A01 ERD: CREATE TABLE for the 8 listed entities in migrations (expect each present)"
for t in initiative deliverable milestone roadmap_wave dependency resource_demand capacity funding_decision; do
  printf '  %-18s %s\n' $t "$(grep -lE "CREATE TABLE (IF NOT EXISTS )?(app\.)?$t\b" $TMPDIR/review-p6/packages/db/migrations/*.sql | xargs -n1 basename | paste -sd' ')"
done
