#!/usr/bin/env python3
"""T-DG4-KBE-R6 A/B transcript comparison (copied unchanged from T-DG4-KBE-R5): line i of A and B is the same request. Prints, per differing response, every
changed member path with its A and B values; then the counts. Exit 0 always (the report is the evidence)."""
import json, re, sys

TX = re.compile(r"\bTX[0-9A-F]{6}\b")

# The harness's random uniq() transformation codes (TX + 6 hex) become first-appearance placeholders per transcript
# (the KBE-R4 precedent); every other byte is kept.

def diff(a, b, path=""):
    if type(a) != type(b):
        return [(path, a, b)]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            out += diff(a.get(k, "<absent>"), b.get(k, "<absent>"), f"{path}.{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [(path + "[len]", len(a), len(b))]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            # Label array elements by their identifying members where present (lines, headlines).
            key = ",".join(str(x.get(k)) for k in ("valueClass", "state", "currency", "metric") if isinstance(x, dict) and k in x)
            out += diff(x, y, f"{path}[{key or i}]")
        return out
    return [] if a == b else [(path, a, b)]

def load(path):
    seen = {}
    tag = lambda m: seen.setdefault(m.group(0), f"<tx{len(seen)}>")
    return [json.loads(TX.sub(tag, l)) for l in open(path)]

A = load(sys.argv[1])
B = load(sys.argv[2])
assert len(A) == len(B), (len(A), len(B))
same = 0
for i, (a, b) in enumerate(zip(A, B)):
    assert a["label"] == b["label"], (i, a["label"], b["label"])
    if a == b:
        same += 1
        continue
    print(f"#{i} {a['label']}")
    for p, x, y in diff(a, b):
        print(f"    {p}: A={json.dumps(x)} B={json.dumps(y)}")
print(f"\n{len(A)} responses: {same} byte-identical after normalization, {len(A) - same} differ (listed above).")
