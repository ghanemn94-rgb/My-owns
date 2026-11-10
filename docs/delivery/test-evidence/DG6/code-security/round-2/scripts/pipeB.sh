#!/bin/bash
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-2
until [ -f $E/.pipeA-done ]; do sleep 5; done
$TMPDIR/scripts/integ.sh unset 1/2 32650 & $TMPDIR/scripts/integ.sh unset 2/2 32655 & wait
$TMPDIR/scripts/integ.sh cutf8 1/2 32650 & $TMPDIR/scripts/integ.sh cutf8 2/2 32655 & wait
echo done > $TMPDIR/pipeB-done
