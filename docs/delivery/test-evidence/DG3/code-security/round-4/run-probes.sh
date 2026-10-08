#!/usr/bin/env bash
# code-security-reviewer DG3 round-4: runs the F-DG3-100 probes in DISPOSABLE clones at 171a0b57 (never the candidate
# tree). Node 22.22.2, as in round 3. Round-3 and round-2 probe files are run VERBATIM from their committed paths
# (sha256 printed); the round-4 swallow-probe.mjs is new.
#   review-p3: guard-layers-probe.mjs S1 S2 S3 V1 V2 (round 3), exercised-probe.mjs (round 3), swallow-probe.mjs W1-W6
#   review-p2: guard-bypass-probe.mjs (round 2, the 18 earlier forms O1-O6, N1-N12)
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-4
P3=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-3/probes
export PATH=/opt/node22/bin:$PATH
hdr() { echo "# $1; node $(node -v); clone $2 at $(git -C $2 rev-parse HEAD), git status '$(git -C $2 status --porcelain)'; started $(date -u +%FT%TZ)"; }
: > $EV/probes-summary.txt
sha256sum $P3/guard-layers-probe.mjs $P3/exercised-probe.mjs $P3/guard-bypass-probe.mjs $EV/probes/swallow-probe.mjs >> $EV/probes-summary.txt
{ hdr "round-3 guard-layers-probe.mjs VERBATIM, forms S1 S2 S3 V1 V2" $TMPDIR/review-p3; node $P3/guard-layers-probe.mjs $TMPDIR/review-p3 S1 S2 S3 V1 V2; echo "# exit_status: $?  finished $(date -u +%FT%TZ)"; } > $EV/guard-layers-probe.log 2>&1
echo "guard-layers-probe $(tail -1 $EV/guard-layers-probe.log)" >> $EV/probes-summary.txt
{ hdr "round-3 exercised-probe.mjs VERBATIM" $TMPDIR/review-p3; node $P3/exercised-probe.mjs $TMPDIR/review-p3; echo "# exit_status: $?  finished $(date -u +%FT%TZ)"; } > $EV/exercised-probe.log 2>&1
echo "exercised-probe $(tail -1 $EV/exercised-probe.log)" >> $EV/probes-summary.txt
{ hdr "round-2 guard-bypass-probe.mjs VERBATIM (18 forms)" $TMPDIR/review-p2; node $P3/guard-bypass-probe.mjs $TMPDIR/review-p2; echo "# exit_status: $?  finished $(date -u +%FT%TZ)"; } > $EV/guard-bypass-probe.log 2>&1
echo "guard-bypass-probe $(tail -1 $EV/guard-bypass-probe.log)" >> $EV/probes-summary.txt
{ hdr "round-4 swallow-probe.mjs W1-W6" $TMPDIR/review-p3; node $EV/probes/swallow-probe.mjs $TMPDIR/review-p3; echo "# exit_status: $?  finished $(date -u +%FT%TZ)"; } > $EV/swallow-probe.log 2>&1
echo "swallow-probe $(tail -1 $EV/swallow-probe.log)" >> $EV/probes-summary.txt
echo "final git status review-p3: '$(git -C $TMPDIR/review-p3 status --porcelain)' review-p2: '$(git -C $TMPDIR/review-p2 status --porcelain)'" >> $EV/probes-summary.txt
echo DONE >> $EV/probes-summary.txt
