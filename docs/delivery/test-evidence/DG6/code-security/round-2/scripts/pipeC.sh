#!/bin/bash
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-2
until [ -f $E/.pipeA-done ]; do sleep 5; done
$TMPDIR/scripts/unit.sh /opt/nvm/versions/node/v24.21.0/bin 11-unit-node24.log
$TMPDIR/scripts/e2e.sh
echo done > $TMPDIR/pipeC-done
