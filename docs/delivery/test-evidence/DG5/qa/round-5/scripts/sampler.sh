#!/usr/bin/env bash
# load/disk sampler: $1 = samples file, $2 = stop-flag file. Every 15 s.
while [ ! -f "$2" ]; do echo "$(date -u +%T) $(cut -d' ' -f1-3 /proc/loadavg) disk_avail=$(df --output=avail -h $TMPDIR | tail -1)" >> "$1"; sleep 15; done
