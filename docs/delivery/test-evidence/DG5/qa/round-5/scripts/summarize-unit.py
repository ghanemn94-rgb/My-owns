# qa-verifier DG5 r4: per unit log: totals, the full-tree boundary walk's duration against its 150 s budget, the guard
# test's duration against 30 s, the peak 1-min load from the samples file, failing/timeout lines, and the stderr
# histogram per test file. python3 -I summarize-unit.py <log>...
import re, sys, collections, os
for p in sys.argv[1:]:
    t = re.sub(r"\x1b\[[0-9;]*m", "", open(p, encoding="utf8").read())
    walk = re.search(r"every import respects dependsOn, public surfaces and allowed packages\s+(\d+)ms", t)
    guard = re.search(r"rule 4 reports exactly the diagnostics.*?\s(\d+)ms", t)
    s = p.replace(".log", "-samples.log")
    loads = [float(l.split()[1]) for l in open(s)] if os.path.exists(s) and os.path.getsize(s) else []
    hist = collections.Counter(m.split(" > ")[0] for m in re.findall(r"^stderr \| (\S+ > [^\n]*)", t, re.M))
    fails = [l for l in t.splitlines() if re.search(r"(^\s*×|FAIL |Test timed out|Hook timed out|Unhandled)", l)]
    totals = re.findall(r"^\s+Tests\s+(.*)$", t, re.M)
    w = int(walk.group(1)) if walk else None
    exits = re.findall(r'^EXIT \d+', t, re.M)
    print(f"{os.path.basename(p)}: {' / '.join(totals)}; {exits}; full walk {w} ms"
          + (f" (budget 150000 ms, headroom {150000 - w} ms, {150000 / w:.1f}x)" if w else " (not listed: under the slow threshold or absent)")
          + f"; guard test {guard.group(1) if guard else '-'} ms of 30000; peak load1 {max(loads) if loads else '-'} over {len(loads)} samples;"
          + f" fail/timeout lines {len(fails)}; stderr blocks {sum(hist.values())}: {dict(sorted(hist.items()))}")
    for l in fails[:5]: print("   ", l.strip()[:200])
