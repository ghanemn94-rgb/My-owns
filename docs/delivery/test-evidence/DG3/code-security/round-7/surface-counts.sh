#!/usr/bin/env bash
# code-security-reviewer DG3 round 7: P3 surface counts. Passing (✓) test lines per pattern in this round's two
# integration runs vs round 5's, absent test names, and per-file unit counts (Node 22, both invocations) vs round 5.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-7
R5=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-6   # (variable name kept from round 6; it holds the PREVIOUS round, round 6)
echo "# P3 surface counts: passing (✓) test lines per pattern, round 7 vs round 6 ($(date -u +%FT%TZ))"
for p in 'commit-time|BE18A' 'aud-write-deny' 'g1-agreements' 'submitter|on behalf|on-behalf|proposer' 'cycle|advisory lock|concurren' 'inherited' 'decimal|exact' 'If-Match' 'audited'; do
  printf '%-40s r7-run1=%s r7-run2=%s r6-run1=%s r6-run2=%s\n' "/$p/" \
    "$(grep '✓' $EV/integration-run1-lang-unset.log | grep -cE "$p")" "$(grep '✓' $EV/integration-run2-lang-c-utf8.log | grep -cE "$p")" \
    "$(grep '✓' $R5/integration-run1-lang-unset.log | grep -cE "$p")" "$(grep '✓' $R5/integration-run2-lang-c-utf8.log | grep -cE "$p")"
done
names() { grep '✓' "$1" | sed -E 's/ [0-9]+ms$//; s/\s+$//' | sort -u; }
echo "## integration test names (run 1) in round 6 not in round 7 (expect none; durations stripped)"
comm -23 <(names $R5/integration-run1-lang-unset.log) <(names $EV/integration-run1-lang-unset.log) | sed 's/^/  /'; echo "  (end)"
echo "## integration test names (run 1) in round 7 not in round 6"
comm -13 <(names $R5/integration-run1-lang-unset.log) <(names $EV/integration-run1-lang-unset.log) | sed 's/^/  /'; echo "  (end)"
filecounts() { grep -E '^ ✓ \|[a-z-]+\| .*\([0-9]+ tests' "$1" | sed -E 's/ [0-9]+ms$//; s/\s+$//' | sort; }
echo "## per-file test counts, Node 22 'pnpm test' (both invocations): round 6 vs round 7 differences (expect only fuzz.test.ts)"
diff <(filecounts $R5/unit-node22.log) <(filecounts $EV/unit-node22.log) | sed 's/^/  /'; echo "  (end)"
echo "## totals"
for f in $R5/unit-node22.log $EV/unit-node22.log $EV/unit-node24.log; do echo "  ${f#/home/user/My-owns/}: $(grep -E '^\s+Tests\s' $f | tr -s ' ' | paste -sd ';')"; done
