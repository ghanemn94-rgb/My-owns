#!/bin/bash
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-3
$TMPDIR/scripts/static.sh
$TMPDIR/scripts/unit.sh /opt/node22/bin 10-unit-node22.log
$TMPDIR/scripts/unit.sh /opt/nvm/versions/node/v24.21.0/bin 11-unit-node24.log
echo done > $TMPDIR/pipe1-done
