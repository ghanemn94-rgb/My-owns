#!/usr/bin/env python3
"""T-DG4-KBE-R6: classifies the A/B transcript differences. Line i of A and B is the same request.
Each response is compared twice:
  strict - byte-identical after the shared normalization (response-transcript.ts placeholders, TX codes);
  local  - the id placeholders (<idN>) renumbered by first appearance WITHIN the response, because B's profit-and-cash
           drill-downs list fewer benefits than A's five-class ones, so an id first seen later gets a different global
           placeholder number in every later response (a numbering artefact, not a byte the product chose).
Classes: (1) identical; (2) differs ONLY by the added members (headlineBasis anywhere, benefits.headlines); (3) any other
change, printed with every changed member path (A -> B), after local renumbering and with the added members removed.
Exit 0 always (the report is the evidence)."""
import json, re, sys
TX = re.compile(r"\bTX[0-9A-F]{6}\b")
ID = re.compile(r"<id\d+>")
def load(p):
    seen = {}
    tag = lambda m: seen.setdefault(m.group(0), f"<tx{len(seen)}>")
    return [json.loads(TX.sub(tag, l)) for l in open(p)]
def local(o):
    seen = {}
    return json.loads(ID.sub(lambda m: seen.setdefault(m.group(0), f"<L{len(seen)}>"), json.dumps(o, sort_keys=False)))
def strip(o, in_benefits=False):
    if isinstance(o, dict):
        return {k: strip(v, k == "benefits") for k, v in o.items() if k != "headlineBasis" and not (in_benefits and k == "headlines")}
    if isinstance(o, list):
        return [strip(x) for x in o]
    return o
def diff(a, b, path=""):
    if type(a) != type(b): return [(path, a, b)]
    if isinstance(a, dict):
        out = []
        for k in list(dict.fromkeys(list(a) + list(b))):
            out += diff(a.get(k, "<absent>"), b.get(k, "<absent>"), f"{path}.{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b): return [(path + "[len]", len(a), len(b))]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            key = ",".join(str(x.get(k)) for k in ("code", "valueClass", "state", "currency", "metric", "headlineBasis") if isinstance(x, dict) and k in x)
            out += diff(x, y, f"{path}[{key or i}]")
        return out
    return [] if a == b else [(path, a, b)]
A, B = load(sys.argv[1]), load(sys.argv[2])
assert len(A) == len(B)
same = strict_new = local_new = 0
other = []
for i, (a, b) in enumerate(zip(A, B)):
    assert a["label"] == b["label"], i
    if a == b: same += 1; continue
    if strip(b) == a: strict_new += 1; continue
    la, lb = local(a), local(strip(b))
    if la == lb: local_new += 1; continue
    other.append((i, a["label"], diff(la, lb)))
print(f"{len(A)} responses: {same} byte-identical; {strict_new} differ ONLY by the added members; {local_new} differ only "
      f"by the added members once id placeholders are numbered per response; {len(other)} carry other changes:")
for i, label, d in other:
    print(f"#{i} {label}")
    for p, x, y in d:
        print(f"    {p}: A={json.dumps(x)[:160]} B={json.dumps(y)[:160]}")
