#!/usr/bin/env python3
"""T-DG4-KBE-R8: classifies the A/B transcript differences (KBE-R7's summary.py method, with this change's members).
Line i of A and B is the same request. The id placeholders of response-transcript.ts are numbered by first appearance
over the WHOLE transcript, so once B lists an id A does not (the draft outcome D-124 item 1 makes visible), every later
placeholder number shifts. Each response, label included, is therefore compared with its placeholders renumbered per
response (`local`), which keeps every other byte. Classes, each response in the first that applies:
  (1) byte-identical (after `local`); `strict` counts those also identical without `local`;
  (2) differs ONLY by `kpiUnit: null` added to DashboardValue objects (any object with state/value/unit/currency/
      reasonKey): money, counts, the computed value gap (ADR-0037 N5);
  (3) differs only by `kpiUnit` added to DashboardValue objects, at least one non-null (a KPI's actual), with
      every other byte unchanged; every non-null kpiUnit is listed with its value's `unit`;
  (4) any other change, printed with every changed member path (A -> B) after removing `kpiUnit` from B and replacing
      every id placeholder by `<id>` and every fixture-name placeholder by `<name>` (`anon`; both are opaque and numbered
      over the whole transcript), and, for a list that is longer in B, the items B adds
      (a multiset difference of the anonymised items) printed in full.
Exit 0 always (the report is the evidence)."""
import json, re, sys

TX = re.compile(r"\bTX[0-9A-F]{6}\b")
ID = re.compile(r"<id\d+>")
VALUE = {"state", "value", "unit", "currency", "reasonKey"}


def load(p):
    seen = {}
    tag = lambda m: seen.setdefault(m.group(0), f"<tx{len(seen)}>")
    return [json.loads(TX.sub(tag, l)) for l in open(p)]


def local(o):
    seen = {}
    return json.loads(ID.sub(lambda m: seen.setdefault(m.group(0), f"<L{len(seen)}>"), json.dumps(o)))


def strip(o, only_null):
    """Removes kpiUnit from DashboardValue objects (only the null ones when only_null)."""
    if isinstance(o, dict):
        is_value = VALUE <= set(o)
        return {
            k: strip(v, only_null)
            for k, v in o.items()
            if not (is_value and k == "kpiUnit" and (v is None or not only_null))
        }
    if isinstance(o, list):
        return [strip(x, only_null) for x in o]
    return o


def non_null_units(o, path="", out=None):
    out = [] if out is None else out
    if isinstance(o, dict):
        if VALUE <= set(o) and o.get("kpiUnit") is not None:
            out.append((path, o["kpiUnit"], o["unit"], o["state"]))
        for k, v in o.items():
            non_null_units(v, f"{path}.{k}", out)
    elif isinstance(o, list):
        for i, x in enumerate(o):
            non_null_units(x, f"{path}[{i}]", out)
    return out


def missing_key(o):
    """Count DashboardValue objects WITHOUT a kpiUnit key (must be 0 in B)."""
    if isinstance(o, dict):
        return (1 if VALUE <= set(o) and "kpiUnit" not in o else 0) + sum(missing_key(v) for v in o.values())
    if isinstance(o, list):
        return sum(missing_key(x) for x in o)
    return 0


NAME = re.compile(r"<name\d+>")


def anon(o):
    return json.loads(NAME.sub("<name>", ID.sub("<id>", json.dumps(o))))


def added(a, b):
    """The items of list b not matched by an equal item of list a (multiset difference)."""
    rest = [json.dumps(x, sort_keys=True) for x in a]
    out = []
    for y in b:
        k = json.dumps(y, sort_keys=True)
        if k in rest:
            rest.remove(k)
        else:
            out.append(y)
    return out, rest


def diff(a, b, path=""):
    if type(a) != type(b):
        return [(path, a, b)]
    if isinstance(a, dict):
        out = []
        for k in list(dict.fromkeys(list(a) + list(b))):
            out += diff(a.get(k, "<absent>"), b.get(k, "<absent>"), f"{path}.{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            plus, minus = added(a, b)
            return [(path + "[len]", len(a), len(b))] + [(path + "[+]", "<absent>", y) for y in plus] + [
                (path + "[-]", json.loads(x), "<absent>") for x in minus
            ]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            key = ",".join(
                str(x.get(k)) for k in ("code", "recordType", "metric", "currency") if isinstance(x, dict) and k in x
            )
            out += diff(x, y, f"{path}[{key or i}]")
        return out
    return [] if a == b else [(path, a, b)]


A, B = load(sys.argv[1]), load(sys.argv[2])
assert len(A) == len(B), (len(A), len(B))
counts = [0, 0, 0]
strict = 0
other, kpi_units = [], []
b_missing = sum(missing_key(b) for b in B)
a_values_with_key = sum(1 for a in A for _ in [0] if json.dumps(a).find('"kpiUnit"') >= 0)
for i, (a, b) in enumerate(zip(A, B)):
    la, lb = local(a), local(b)
    assert la["label"] == lb["label"], (i, a["label"], b["label"])
    if a == b:
        strict += 1
    if la == lb:
        counts[0] += 1
        continue
    if local(strip(b, True)) == la:
        counts[1] += 1
        continue
    if local(strip(b, False)) == la:
        counts[2] += 1
        kpi_units += [(i, a["label"], *u) for u in non_null_units(b)]
        continue
    other.append((i, a["label"], diff(anon(a), anon(strip(b, False)))))
    kpi_units += [(i, a["label"], *u) for u in non_null_units(b)]

print(
    f"{len(A)} responses: {counts[0]} byte-identical ({strict} without per-response id renumbering); "
    f"{counts[1]} differ ONLY by kpiUnit: null on DashboardValues; {counts[2]} differ only by kpiUnit "
    f"(at least one non-null); {len(other)} carry other changes."
)
print(f"A transcripts mentioning kpiUnit: {a_values_with_key}. DashboardValue objects in B without a kpiUnit key: {b_missing}.")
print("\nEvery non-null kpiUnit in B: #<response> <label> <path> kpiUnit unit state")
for i, label, p, ku, unit, state in kpi_units:
    print(f"#{i} {label} {p} {json.dumps(ku)} unit={json.dumps(unit)} state={state}")
print("\nClass-(4) responses (kpiUnit removed from B, ids anonymised as <id>):")
for i, label, d in other:
    print(f"#{i} {label}")
    for p, x, y in d:
        print(f"    {p}: A={json.dumps(x)[:400]} B={json.dumps(y)[:400]}")
