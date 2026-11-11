#!/bin/bash
$TMPDIR/scripts/integ.sh unset 1/2 32450 & $TMPDIR/scripts/integ.sh unset 2/2 32455 & wait
$TMPDIR/scripts/integ.sh cutf8 1/2 32450 & $TMPDIR/scripts/integ.sh cutf8 2/2 32455 & wait
echo done > $TMPDIR/pipe2-done
