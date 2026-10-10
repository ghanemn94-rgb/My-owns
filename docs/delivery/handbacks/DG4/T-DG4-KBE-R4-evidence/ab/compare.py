# T-DG4-KBE-R4: compares the A (base 48eba10) and B (KBE-R4) transcripts line by line, as JSON, and lists every differing
# member by its path. The common part is A's lines (B records the same requests in the same order, then the K1-only
# value-class hrefs after the separator line). Usage: python3 compare.py A-transcript.jsonl B-transcript.jsonl
import json, re, sys

# Fixture codes made by the harness's uniq() (createTransformationRow: code uniq("TX"), random hex) differ per run, like
# the ids response-transcript.ts already normalizes: replace them by first-appearance placeholders, per transcript.
UNIQ = re.compile(r"\b(TX|ORG|BU)[0-9A-F]{6}\b")
def load(path):
    seen = {}
    def tag(m):
        seen.setdefault(m.group(0), f"<{m.group(1)}code{len(seen)}>")
        return seen[m.group(0)]
    return [json.loads(UNIQ.sub(tag, l)) for l in open(path) if l.strip()]
A = load(sys.argv[1])
B = load(sys.argv[2])

def diff(a, b, path, out):
    if type(a) != type(b):
        out.append((path, a, b)); return
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a: out.append((f"{path}.{k}", "<absent>", b[k]))
            elif k not in b: out.append((f"{path}.{k}", a[k], "<absent>"))
            else: diff(a[k], b[k], f"{path}.{k}", out)
        if a.keys() == b.keys() and list(a) != list(b): out.append((f"{path} (member order)", list(a), list(b)))
    elif isinstance(a, list):
        if len(a) != len(b): out.append((f"{path} (length)", len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)): diff(x, y, f"{path}[{i}]", out)
    elif a != b:
        out.append((path, a, b))

sep = next(i for i, l in enumerate(A) if l["label"].startswith("----"))
print(f"A lines {len(A)}, B lines {len(B)}; common part = A[0:{sep}] vs B[0:{sep}]")
identical = 0
changed_members = {}
for i in range(sep):
    a, b = A[i], B[i]
    assert a["label"] == b["label"], (i, a["label"], b["label"])
    out = []
    diff(a, b, "", out)
    if not out:
        identical += 1
        continue
    print(f"\nline {i+1}: {a['label'][:140]}")
    for p, x, y in out:
        gp = re.sub(r"\[\d+\]", "[*]", p)
        changed_members[gp] = changed_members.get(gp, 0) + 1
        print(f"  {p}: {json.dumps(x)[:160]}  ->  {json.dumps(y)[:200]}")
    # Every changed drilldownHref is a Finance CLASS line's (never gross or net), and only that member of the line changed.
    for p, x, y in out:
        m = re.match(r"^\.body\.lines\[(\d+)\]\.drilldownHref$", p)
        if m:
            line = b["body"]["lines"][int(m.group(1))]
            assert line["valueClass"] not in ("gross", "net"), (i, p)
            assert f"valueClass={line['valueClass']}" in y and f"metric=value.{line['state']}" in y, (i, p, y)
print(f"\nbyte-identical lines in the common part: {identical} of {sep}")
print("changed members (generalized path: count):")
for k, v in sorted(changed_members.items()): print(f"  {k}: {v}")
assert B[sep]["label"].startswith("----")
tail = B[sep + 1:]
allowed = {".body.lines[*].drilldownHref", ".body.evaluations[*].inputs.windowValues", ".body.evaluations[*].inputs.entries[*].windowValues"}
assert set(changed_members) <= allowed, set(changed_members) - allowed
print("every changed member is one of the two stated exceptions (K1 class-line drilldownHref; C5 windowValues): OK")
print(f"\nB-only (K1 value-class drill-downs after the separator): {len(tail)} responses, statuses {sorted(set(l['status'] for l in tail))}")
