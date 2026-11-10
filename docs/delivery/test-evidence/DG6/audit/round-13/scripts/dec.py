# Auditor T-DG6-AUDIT-R13: D-193..D-236 in decisions.md and D-237 in progress.md, quoted verbatim (headline + reopen column).
import re
rows = {}
for line in open("docs/delivery/decisions.md", encoding="utf-8"):
    m = re.match(r"\| (D-(\d+)) \| ([^|]+) \| ([^|]+) \| (.*)$", line.rstrip("\n"))
    if m: rows[int(m.group(2))] = (m.group(1), m.group(3).strip(), m.group(4).strip(), m.group(5))
missing = [n for n in range(193, 237) if n not in rows]
print("D-193..D-236 present:", 44 - len(missing), "of 44; missing:", missing)
for n in range(193, 237):
    if n not in rows: continue
    did, date, by, rest = rows[n]
    cols = [c.strip() for c in rest.split(" | ")]
    text = cols[0]
    head = re.match(r"\*\*(.+?)\*\*", text)
    body = len(text) - (len(head.group(0)) if head else 0)
    print(f"\n{did} ({date}, {by})\n  headline: \"{head.group(1) if head else text[:200]}\"\n  rationale text after headline: {body} chars; evidence column: \"{cols[1][:160] if len(cols) > 1 else ''}\"; reopen: \"{cols[2].rstrip(' |')[:160] if len(cols) > 2 else ''}\"")
print("\n== D-237 (progress.md), verbatim")
t = open("docs/delivery/progress.md", encoding="utf-8").read()
i = t.index("## D-237"); j = t.find("\n## ", i + 5)
print(t[i: j if j > 0 else None].strip())
