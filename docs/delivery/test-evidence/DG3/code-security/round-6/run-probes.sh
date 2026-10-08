#!/usr/bin/env bash
# code-security-reviewer DG3 round 6 (T-DG3-REV-SEC-R6): runs the F-DG3-100 probes VERBATIM from their committed paths
# (sha256 printed) in the DISPOSABLE clone $TMPDIR/review-p3 at 36411df (freeze commit of candidate sha256:7049d793…,
# product tree = source c40232b; deps installed offline --frozen-lockfile, built with pnpm -r build), never the candidate
# tree. Node 22.22.2, as in rounds 3-5. guard-bypass-probe.mjs insists on "review-p2" in its root path, so it runs
# through the symlink $TMPDIR/review-p2 -> review-p3 (the same clone).
#   rethrow-rule-attack-probe.mjs   (round 5: G1 G2 G3 E1 E2 H1 H2 S1 S2)
#   rethrow-rule-attack-probe-2.mjs (round 5: A1 A2 F1 F2 H3 H4)
#   swallow-probe.mjs               (round 4: W1-W6)
#   guard-layers-probe.mjs          (round 3: S1 S2 S3 V1 V2)
#   guard-bypass-probe.mjs          (round 2: 18 forms)
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-6
P5=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-5/probes
P4=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-4/probes
P3=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-3/probes
export PATH=/opt/node22/bin:$PATH
hdr() { echo "# $1; node $(node -v); clone $2 at $(git -C $2 rev-parse HEAD), git status '$(git -C $2 status --porcelain)'; started $(date -u +%FT%TZ)"; }
: > $EV/probes-summary.txt
sha256sum $P5/rethrow-rule-attack-probe.mjs $P5/rethrow-rule-attack-probe-2.mjs $P4/swallow-probe.mjs $P3/guard-layers-probe.mjs $P3/guard-bypass-probe.mjs >> $EV/probes-summary.txt
{ hdr "round-5 rethrow-rule-attack-probe.mjs VERBATIM, G1 G2 G3 E1 E2 H1 H2 S1 S2" $TMPDIR/review-p3; node $P5/rethrow-rule-attack-probe.mjs $TMPDIR/review-p3; echo "# exit_status: $?  finished $(date -u +%FT%TZ)"; } > $EV/rethrow-rule-attack-probe.log 2>&1
echo "rethrow-rule-attack-probe $(tail -1 $EV/rethrow-rule-attack-probe.log)" >> $EV/probes-summary.txt
{ hdr "round-5 rethrow-rule-attack-probe-2.mjs VERBATIM, A1 A2 F1 F2 H3 H4" $TMPDIR/review-p3; node $P5/rethrow-rule-attack-probe-2.mjs $TMPDIR/review-p3; echo "# exit_status: $?  finished $(date -u +%FT%TZ)"; } > $EV/rethrow-rule-attack-probe-2.log 2>&1
echo "rethrow-rule-attack-probe-2 $(tail -1 $EV/rethrow-rule-attack-probe-2.log)" >> $EV/probes-summary.txt
{ hdr "round-4 swallow-probe.mjs VERBATIM, W1-W6" $TMPDIR/review-p3; node $P4/swallow-probe.mjs $TMPDIR/review-p3; echo "# exit_status: $?  finished $(date -u +%FT%TZ)"; } > $EV/swallow-probe.log 2>&1
echo "swallow-probe $(tail -1 $EV/swallow-probe.log)" >> $EV/probes-summary.txt
{ hdr "round-3 guard-layers-probe.mjs VERBATIM, forms S1 S2 S3 V1 V2" $TMPDIR/review-p3; node $P3/guard-layers-probe.mjs $TMPDIR/review-p3 S1 S2 S3 V1 V2; echo "# exit_status: $?  finished $(date -u +%FT%TZ)"; } > $EV/guard-layers-probe.log 2>&1
echo "guard-layers-probe $(tail -1 $EV/guard-layers-probe.log)" >> $EV/probes-summary.txt
{ hdr "round-2 guard-bypass-probe.mjs VERBATIM (18 forms), via symlink review-p2 -> review-p3" $TMPDIR/review-p2; node $P3/guard-bypass-probe.mjs $TMPDIR/review-p2; echo "# exit_status: $?  finished $(date -u +%FT%TZ)"; } > $EV/guard-bypass-probe.log 2>&1
echo "guard-bypass-probe $(tail -1 $EV/guard-bypass-probe.log)" >> $EV/probes-summary.txt
echo "final git status review-p3: '$(git -C $TMPDIR/review-p3 status --porcelain)'" >> $EV/probes-summary.txt
echo DONE >> $EV/probes-summary.txt
