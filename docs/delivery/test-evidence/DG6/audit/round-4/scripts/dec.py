#!/usr/bin/env python3
"""release-auditor T-DG6-AUDIT-RG-R4: D-193 to D-238 in decisions.md (each with decision, rationale/evidence and
reopen-if columns), quoted verbatim (first 400 characters of the decision, then the rationale column in full up to
600 characters); and the progress.md sections of the clean re-gate, quoted verbatim."""
import re

rows = {}
for line in open("docs/delivery/decisions.md", encoding="utf-8"):
    m = re.match(r"^\| (D-\d{3}) \|", line)
    if not m:
        continue
    # split on unescaped pipes
    cells = [c.strip() for c in re.split(r"(?<!\\)\|", line.strip())[1:-1]]
    rows[m.group(1)] = cells

want = [f"D-{n}" for n in range(193, 239)]
missing = [d for d in want if d not in rows]
print(f"D-193..D-238: {len(want)} expected, {len(want) - len(missing)} present, missing: {missing}")
bad = [d for d in want if d in rows and (len(rows[d]) < 6 or not rows[d][3] or not rows[d][4] or not rows[d][5])]
print(f"rows lacking a separate rationale/evidence or reopen-if cell (table rows with {sorted(set(len(rows[d]) for d in bad))} cells): {bad}")
print("For those rows the decision cell is quoted at greater length (1,600 characters) so that its inline reasons and evidence are visible.")
print()
for d in want:
    c = rows.get(d)
    if not c:
        continue
    print(f"--- {d} | {c[1]} | {c[2]}")
    if len(c) < 6:
        print(f"    DECISION (no separate rationale or reopen-if cell; {len(c)} cells): \"{c[3][:1600]}{'…' if len(c[3]) > 1600 else ''}\"")
        continue
    print(f"    DECISION: \"{c[3][:400]}{'…' if len(c[3]) > 400 else ''}\"")
    print(f"    RATIONALE/EVIDENCE: \"{c[4][:600]}{'…' if len(c[4]) > 600 else ''}\"")
    print(f"    REOPEN IF: \"{c[5][:300]}\"")

print()
print("=== progress.md: the sections of the clean re-gate (verbatim)")
text = open("docs/delivery/progress.md", encoding="utf-8").read()
start = text.find("## D-237 (2026-11-10")
print(text[start:] if start >= 0 else "NOT FOUND")
