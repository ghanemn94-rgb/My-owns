#!/usr/bin/env bash
# T-DG3-KBE-H (kpi-benefits-engineer): runs COPIES of the code-security reviewer's F-DG3-100 probes (sha256 printed;
# identical to the reviewer's files) in the DISPOSABLE clone $TMPDIR/review-p3 = HEAD 26c0ea4 + this task's four changed
# files committed in the clone. Never the working tree. guard-bypass-probe.mjs insists on "review-p2" in its root path,
# so it runs through the symlink $TMPDIR/review-p2 -> review-p3, as the reviewer's run-probes.sh does. Node 22.22.2.
EV=/home/user/wt/dg3-kbe-h/docs/delivery/handbacks/DG3/T-DG3-KBE-H-evidence
P=$TMPDIR/probes
C=$TMPDIR/review-p3
export PATH=/opt/node22/bin:$PATH
hdr() { echo "# $1; node $(node -v); clone $2 at $(git -C $2 rev-parse HEAD), git status '$(git -C $2 status --porcelain)'; started $(date -u +%FT%TZ)"; }
: > $EV/probes-summary.txt
sha256sum $P/*.mjs >> $EV/probes-summary.txt
run() { # name, description, root, args...
  local name=$1 what=$2 root=$3; shift 3
  { hdr "$what" $root; node $P/$name.mjs $root "$@"; echo "# exit_status: $?  finished $(date -u +%FT%TZ)"; } > $EV/$name.log 2>&1
  echo "$name $(tail -1 $EV/$name.log)" >> $EV/probes-summary.txt
}
run rethrow-rule-attack-probe "round-5 rethrow-rule-attack-probe.mjs (copy), all forms G1 G2 G3 E1 E2 H1 H2 S1 S2" $C
run rethrow-rule-attack-probe-2 "round-5 rethrow-rule-attack-probe-2.mjs (copy), all forms A1 A2 F1 F2 H3 H4" $C
run swallow-probe "round-4 swallow-probe.mjs (copy), W1-W6" $C
run guard-layers-probe "round-3 guard-layers-probe.mjs (copy), forms S1 S2 S3 V1 V2" $C S1 S2 S3 V1 V2
run guard-bypass-probe "round-2 guard-bypass-probe.mjs (copy, 18 forms), via symlink review-p2 -> review-p3" $TMPDIR/review-p2
echo "final git status review-p3: '$(git -C $C status --porcelain)'" >> $EV/probes-summary.txt
echo DONE >> $EV/probes-summary.txt
