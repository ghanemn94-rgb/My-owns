#!/bin/bash
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-2
until grep -q STATIC-DONE $E/20-contract-pending-graph.log 2>/dev/null; do sleep 5; done
$TMPDIR/scripts/unit.sh /opt/node22/bin 10-unit-node22.log
$TMPDIR/scripts/mut900.sh
$TMPDIR/scripts/probes.sh
echo PIPEA-DONE > $E/.pipeA-done
