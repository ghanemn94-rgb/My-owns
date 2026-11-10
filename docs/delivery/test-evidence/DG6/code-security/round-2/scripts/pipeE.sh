#!/bin/bash
until [ -f $TMPDIR/pipeB-done ]; do sleep 10; done
touch $TMPDIR/allow-cutf8
$TMPDIR/scripts/integ.sh cutf8 1/2 32650 & $TMPDIR/scripts/integ.sh cutf8 2/2 32655 & wait
echo done > $TMPDIR/pipeE-done
