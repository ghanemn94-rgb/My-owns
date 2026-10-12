#!/usr/bin/env bash
[ -f "$TMPDIR/load.pids" ] && while read -r p; do kill "$p" 2>/dev/null; done <"$TMPDIR/load.pids"; : >"$TMPDIR/load.pids"
