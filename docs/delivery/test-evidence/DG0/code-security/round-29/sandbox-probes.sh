#!/usr/bin/env bash
# code-security-reviewer, DG0 round 29: live, NON-DESTRUCTIVE probes from this agent's own Bash shell.
# Run from the repository root. Every write attempt in section A targets a probe file name that does not exist, and
# would be removed if it were (unexpectedly) created. Section C only opens /proc/sys entries O_WRONLY and closes them:
# a sysctl changes only on write(), so nothing is written.
cd "${1:-.}" || exit 2
echo "# live sandbox probes from the code-security agent's own Bash shell ($(date -u +%FT%TZ))"
echo "# id: $(id)"; echo "# MTH_PROCESS_SANDBOX=${MTH_PROCESS_SANDBOX:-unset} TMPDIR=${TMPDIR:-unset}"
grep -E '^(CapEff|CapBnd|NoNewPrivs|Seccomp)' /proc/self/status
echo "## A. protected / other-role writes (all must fail)"
for p in tools/gates/sec29-probe.txt tools/agents/sec29-probe.txt tools/source/sec29-probe.txt .claude/sec29-probe.txt \
         .claude/agents/sec29-probe.md .github/sec29-probe.txt docs/source/sec29-probe.txt CLAUDE.md.sec29-probe \
         docs/delivery/findings.json.sec29-probe docs/delivery/stages.json.sec29-probe \
         docs/delivery/reviews/DG0/round-29/domain-reviewer.json docs/delivery/reviews/DG0/round-29/qa-verifier.json \
         docs/delivery/reviews/DG0/round-29/code-security-reviewer.sh-probe \
         docs/delivery/test-evidence/DG0/domain/sec29-probe.txt docs/delivery/test-evidence/DG0/qa/sec29-probe.txt \
         docs/delivery/test-evidence/DG0/audit/sec29-probe.txt docs/delivery/gates/DG0.json \
         docs/delivery/runs/DG0/sec29-probe.txt docs/delivery/candidates/DG0/sec29-probe.txt \
         docs/delivery/requirements.csv.sec29-probe .git/sec29-probe src-sec29-probe.txt /tmp/sec29-probe /var/tmp/sec29-probe; do
  if err="$( { : > "$p"; } 2>&1 )"; then echo "WRITABLE  $p  <-- UNEXPECTED"; rm -f "$p"; else echo "refused   $p :: ${err##*: }"; fi
done
# append to an existing protected file (no truncation: >> with empty payload)
for p in tools/gates/lib/rules.mjs docs/delivery/findings.json .git/HEAD; do
  if err="$( { printf '' >> "$p"; } 2>&1 )"; then echo "WRITABLE(append-open) $p  <-- UNEXPECTED"; else echo "refused   append-open $p :: ${err##*: }"; fi
done
echo "## B. own evidence area and TMPDIR writable (expected)"
t="docs/delivery/test-evidence/DG0/code-security/round-29/.probe"; if : > "$t" 2>/dev/null; then echo "writable  own evidence area"; rm -f "$t"; else echo "NOT writable own evidence area"; fi
if : > "$TMPDIR/.probe" 2>/dev/null; then echo "writable  \$TMPDIR"; rm -f "$TMPDIR/.probe"; fi
echo "## C. residual 7: /proc/sys entries openable for WRITE by uid 0 (O_WRONLY open+close; NOTHING written)"
python3 -I -B - <<'PY'
import os
for p in ["/proc/sys/vm/swappiness","/proc/sys/kernel/shmmax","/proc/sys/net/ipv4/ip_forward","/proc/sys/vm/drop_caches",
          "/proc/sys/kernel/panic","/proc/sys/kernel/hostname","/proc/sys/kernel/core_pattern","/proc/sys/fs/file-max"]:
    try:
        fd = os.open(p, os.O_WRONLY); os.close(fd); print("open-for-write OK  ", p)
    except OSError as e:
        print("open-for-write FAIL", p + ":", e.strerror)
PY
echo "## D. residual 8: host PID namespace visibility; IPC ns; cross-run scratch"
echo "visible pids: $(ls -d /proc/[0-9]* 2>/dev/null | wc -l); pid ns: $(readlink /proc/self/ns/pid); ipc ns: $(readlink /proc/self/ns/ipc); pid1 ipc ns: $(readlink /proc/1/ns/ipc 2>&1 | tail -c 60)"
echo "other runs' private scratch visible under /var/tmp: $(ls -d /var/tmp/mth-run.* 2>/dev/null | grep -v "$(dirname "$TMPDIR")" | wc -l)"
for pid in $(ls -d /proc/[0-9]* | sed 's#/proc/##'); do
  [ "$pid" = "$$" ] && continue
  r=$(ls /proc/$pid/root/ 2>&1 | head -1); echo "pid $pid /proc/<pid>/root: ${r:-<empty>}"
done | head -8
echo "## E. secrets surface"
python3 -I -B -c "import json;d=json.load(open('.claude/settings.json'));print('settings allow:',d.get('permissions',{}).get('allow'))"
