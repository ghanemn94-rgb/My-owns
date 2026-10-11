#!/usr/bin/env python3
"""T-DG4-KBE-R7: classifies the A/B transcript differences (KBE-R6's summary.py method). Line i of A and B is the same
request. Classes, each response in the first that applies:
  (1) byte-identical after the shared normalisation (response-transcript.ts placeholders, TX codes);
  (2) differs ONLY by the two members the closing step makes required: `valueBasis` on every DashboardItem (any
      object with recordType/recordId/href/flags) and `currency` on the drill-down body (top level);
  (3) differs only by (2) plus the N4 item 3 href change: `&currency=XXX` appended to a drilldownHref;
  (4) differs only by (2), (3) and the N4 item 1 top-line and non-cash `value.gap` headlines (new; removed from B);
  (5) any other change, printed with every changed member path (A -> B) after removing (2)-(4) from B, with the id
      placeholders renumbered per response (a numbering artefact when B lists fewer ids earlier).
Then every class-(5) path is aggregated into a pattern (array keys dropped) with its response count and one example.
Exit 0 always (the report is the evidence)."""
import json, re, sys
TX = re.compile(r"\bTX[0-9A-F]{6}\b")
ID = re.compile(r"<id\d+>")
CUR = re.compile(r"&currency=[A-Z]{3}")
def load(p):
    seen = {}
    tag = lambda m: seen.setdefault(m.group(0), f"<tx{len(seen)}>")
    return [json.loads(TX.sub(tag, l)) for l in open(p)]
def local(o):
    seen = {}
    return json.loads(ID.sub(lambda m: seen.setdefault(m.group(0), f"<L{len(seen)}>"), json.dumps(o)))
def strip_members(o, top=True, drill=False):
    if isinstance(o, dict):
        out = {}
        for k, v in o.items():
            if k == "valueBasis" and {"recordType", "recordId", "href", "flags"} <= set(o): continue
            if top and drill and k == "currency": continue
            out[k] = strip_members(v, False, drill)
        return out
    if isinstance(o, list): return [strip_members(x, False, drill) for x in o]
    return o
def strip_href(o):
    if isinstance(o, dict): return {k: (CUR.sub("", v) if k == "drilldownHref" and isinstance(v, str) else strip_href(v)) for k, v in o.items()}
    if isinstance(o, list): return [strip_href(x) for x in o]
    return o
def strip_gaps(o):
    if isinstance(o, dict):
        return {k: ([x for x in v if not (isinstance(x, dict) and x.get("metric") == "value.gap" and x.get("headlineBasis") in ("top_line", "non_cash"))]
                    if k == "headlines" and isinstance(v, list) else strip_gaps(v)) for k, v in o.items()}
    if isinstance(o, list): return [strip_gaps(x) for x in o]
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
counts = [0, 0, 0, 0]
other = []
for i, (a, b) in enumerate(zip(A, B)):
    assert a["label"] == b["label"], i
    drill = "dashboard-drilldown" in a["label"]
    if a == b: counts[0] += 1; continue
    sb = strip_members(b, False, False)
    if drill and isinstance(sb.get("body"), dict) and "metric" in sb["body"]:
        sb["body"] = {k: v for k, v in sb["body"].items() if k != "currency"}
    if local(sb) == local(a): counts[1] += 1; continue
    hb = strip_href(sb)
    if local(hb) == local(a): counts[2] += 1; continue
    gb = strip_gaps(hb)
    if local(gb) == local(a): counts[3] += 1; continue
    other.append((i, a["label"], diff(local(a), local(gb))))
print(f"{len(A)} responses: {counts[0]} byte-identical; {counts[1]} differ ONLY by the two required members "
      f"(valueBasis, drill-down currency); {counts[2]} differ only by those and `&currency=` on hrefs; "
      f"{counts[3]} differ only by those and the new top-line/non-cash gap headlines; {len(other)} carry other changes.")
PAT = re.compile(r"\[[^\]]*\]")
agg = {}
for i, label, d in other:
    kind = re.sub(r"<id\d+>|<tx\d+>", "*", re.sub(r"\?.*", "", label))
    for p, x, y in d:
        key = (kind, PAT.sub("[]", p))
        agg.setdefault(key, [0, i, x, y])[0] += 1
print("\nAggregated class-(5) paths: <count> <request kind> <path>  e.g. #<response> A -> B")
for (kind, p), (n, i, x, y) in sorted(agg.items()):
    print(f"{n:4d} {kind} {p}  e.g. #{i} A={json.dumps(x)[:140]} B={json.dumps(y)[:140]}")
print("\nPer response:")
for i, label, d in other:
    print(f"#{i} {label}")
    for p, x, y in d:
        print(f"    {p}: A={json.dumps(x)[:200]} B={json.dumps(y)[:200]}")
