#!/usr/bin/env bash
# domain-reviewer DG4 round 8: static source-fidelity re-check (read-only, no stack): every cell of playbook
# B0093 (forum layers), B0095 (T10 areas) appears verbatim in its seed migration in the clone; seeds unchanged since dab4562.
set -u
cd "$TMPDIR/review-dg4r8"
chk() { blk=$1; mig=$2; rows=0; cells=0; miss=0
  while IFS= read -r line; do rows=$((rows+1)); IFS='|' read -ra c <<< "$line"
    for x in "${c[@]}"; do x="$(echo "$x" | sed 's/^ *//;s/ *$//')"; [ -z "$x" ] && continue; cells=$((cells+1)); q="${x//\'/\'\'}"
      grep -qF "'$q'" "$mig" || { miss=$((miss+1)); echo "MISSING [$blk] $x"; }; done
  done < <(awk -v b="<!-- $blk table -->" '$0==b{f=1;next} f&&/^\|/{n++; if(n>2) print; next} f&&n>0{exit}' docs/source/playbook.md)
  echo "$blk: $rows rows, $cells cells checked against $mig: missing=$miss"; }
chk B0093 packages/db/migrations/0044_p4_forums_meetings.sql
chk B0095 packages/db/migrations/0056_p4_dashboards_t10.sql
echo "### seeds/migrations changed dab4562..8553323: $(git diff --name-only dab4562..8553323 -- packages/db/migrations | wc -l)"
echo "### playbook sha256 $(sha256sum docs/source/playbook.md | cut -c1-16)"
