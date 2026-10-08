#!/usr/bin/env bash
# code-security-reviewer DG3 round 5: maps each clause of the binding acceptance texts (requirements.csv, final_gate DG3)
# of the 16 assigned requirements to PASSING test lines (✓) in this round's four logs (both integration runs, both
# `pnpm test` runs). A clause with 0 passing lines in any integration run is reported MISSING. Failing (×) and skipped (↓)
# markers are counted per log.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-5
L="integration-run1-lang-unset.log integration-run2-lang-c-utf8.log unit-node22.log unit-node24.log"
echo "# requirement acceptance $(date -u +%FT%TZ)"
for l in $L; do echo "# $l: ✓=$(grep -c '✓' $EV/$l) ×=$(grep -c ' × ' $EV/$l) ↓=$(grep -c ' ↓ ' $EV/$l) FAIL-lines=$(grep -cE '^\s*FAIL\b' $EV/$l)"; done
missing=0
clause() { # req label regex
  local req=$1 label=$2 re=$3 c=""
  for l in $L; do c="$c $(grep '✓' $EV/$l | grep -cE "$re")"; done
  set -- $c
  local flag=OK; { [ "$1" -eq 0 ] || [ "$2" -eq 0 ]; } && [ "$3" -eq 0 ] && flag=MISSING
  [ $flag = MISSING ] && missing=$((missing+1))
  echo "$req | $label | int-run1=$1 int-run2=$2 unit-n22=$3 unit-n24=$4 | $flag"
  grep '✓' $EV/integration-run1-lang-unset.log | grep -E "$re" | head -2 | cut -c1-240 | sed 's/^/      /'
}
clause REQ-S16-016 "each P3 entity created+read through the API with authz (contract seams)" "p3-exercises|every operation, validated against the contract"
clause REQ-S16-016 "ERD/migrations: entities with PKs, owner, status" "migrations? .*(0020|0022)|schema.*(initiative|deliverable|milestone|roadmap|dependency|resource|capacity|funding)"
clause REQ-S09-008 "A->B->C->A rejected naming the cycle" "A→B→C→A|A->B->C->A"
clause REQ-S09-008 "late predecessor flagged" "late|needed-by|needed by"
clause REQ-DLV-035 "5,4,3,2,1 gives 3.30" "5,4,3,2,1|3\.30"
clause REQ-DLV-035 "weights totalling 95% rejected" "95%"
clause REQ-DLV-035 "G4 approval end to end" "G4 end to end"
clause REQ-S08-007 "monthly ARPU x annual population rejected" "period_mismatch|period = month|period mismatch"
clause REQ-S08-007 "100000 SAR exactly" "100000"
clause REQ-PB-004 "E2E launch 422 North Star…; succeeds after G2+G3" "REQ-PB-004|North Star, outcomes and target state"
clause REQ-PB-007 "pre-G1 cannot leave Draft (422)" "before G1 -> 422|REQ-PB-007"
clause REQ-PB-007 "readiness lists missing diagnostic dimensions" "readiness|g1\.diagnostic"
clause REQ-PB-022 "G1 approval without three agreements rejected" "g1_agreements_required|three B0032 leadership agreements"
clause REQ-PB-022 "pre-G1 add to portfolio 422" "before G1|pre-G1|REQ-PB-022"
clause REQ-S04-006 "G4 submission names missing funding/capacity" "G4 submission refused with the missing items"
clause REQ-S04-006 "403 non-approver / submitter, 409 superseded" "403/403/409|submitter cannot decide G4|409 superseded"
clause REQ-PB-048 "5,4,3,2,1 -> 3.30" "5,4,3,2,1"
clause REQ-PB-048 "score 6 rejected" "score of 6|6 is|-> 6|out of range|1\.\.5|1–5|1-5"
clause REQ-PB-048 "missing score 'incomplete'" "incomplete"
clause REQ-PB-049 "95%/105% rejected" "95% and 105%|95%"
clause REQ-PB-049 "v2 accepted; rescoring uses it; v1 scores keep v1" "version 2|v2 "
clause REQ-PB-049 "ranking history names weight version" "weight version|weight_version|ranking history"
clause REQ-PB-051 "T08 persists 7 columns" "seven T08 columns"
clause REQ-PB-051 "From accepts initiative or External" "external"
clause REQ-PB-051 "cycle A->B->A reported" "A→B→A|A->B->A"
clause REQ-PB-052 "source types present, undeletable" "system types are listed|system type DELETE"
clause REQ-PB-052 "unknown type rejected" "unknown type|unknown dependency type|type .*400|REQ-PB-052"
clause REQ-PB-055 "G4 refused listing Finance validation" "Finance validation"
clause REQ-PB-056 "T09 persists 6 columns" "six T09 columns"
clause REQ-PB-056 "confidence outside H/M/L rejected" "confidence outside H/M/L"
clause REQ-PB-056 "undefined variable rejected" "undefined_variable|undefined variable|Undefined variable"
clause REQ-S09-003 "'Selected - unfunded' cannot launch" "Selected - unfunded' cannot launch|selected-unfunded|Selected - unfunded"
clause REQ-S09-006 "milestone move (If-Match), concurrent conflict 409" "moving the forecast|milestone.*(If-Match|409|conflict)|conflict"
echo "# clauses MISSING in an integration run and in unit-node22: $missing"
