#!/usr/bin/env bash
# CPU load generator: N busy loops, each bounded by `timeout`, PIDs written to $TMPDIR/load.pids. Stop: load-stop.sh.
# usage: load.sh <n-loops> <seconds>
n=$1; secs=$2; : >"$TMPDIR/load.pids"
for i in $(seq 1 "$n"); do
  timeout "$secs" bash -c 'while :; do :; done' &
  echo $! >>"$TMPDIR/load.pids"
done
