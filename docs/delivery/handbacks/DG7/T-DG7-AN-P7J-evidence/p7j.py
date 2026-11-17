"""T-DG7-AN-P7J: qualify old-branch F-DG7-9xx citations and rewrite later clauses (F-DG7-1022).

Usage: python3 -I p7j.py <requirements.csv in> <requirements.csv out>
Changes only the notes column of rows whose notes cite F-DG7-9xx ids.
"""
import csv, io, re, sys

src, dst = sys.argv[1], sys.argv[2]
raw = open(src, 'rb').read().decode('utf-8')
rows = list(csv.reader(io.StringIO(raw, newline='')))
hdr = rows[0]
C = {k: i for i, k in enumerate(hdr)}
MARK = 'completes-after-gate:'
FULL = ' [old-branch record: branch claude/mobily-transformation-platform-dg6-regate at 1612f85fc, D-281/D-282]'
SHORT = ' [old-branch record]'
ID = re.compile(r'F-DG7-9\d\d(?! \[old-branch)')

# Later clauses rewritten (old text must match exactly; text after the marker, to end of notes).
LATER = {
    'REQ-DLV-011': (
        " the release-auditor's decision on the D-270 C2 hits at the DG7 gate, and protocol-audit C2 on the frozen DG7 candidate over every DG7 run's assignment hash (p7-work-split §J.1).",
        " the release-auditor's decision at the DG7 gate on the DG7 C2 hits that 'protocol-audit.mjs --stage DG7' reports on this branch's frozen DG7 candidate (the D-270 assignment-missing-elements hits and the T-DG7-ARCH-R6 assignment-hash mismatch disclosed by D-282 as F-DG7-1001), and protocol-audit C2 on that candidate over every DG7 run's assignment hash (p7-work-split §J.1).",
    ),
    'REQ-DLV-012': (
        " the release-auditor's decision on the DG7 C3 hits (seven: the five D-270 hits plus F-DG7-960's FE-C3 and F-DG7-920's DO-D8 handback) and its reading of progress.md at the DG7 gate, and protocol-audit C3 and C6 on the frozen DG7 candidate (p7-work-split §J.1).",
        " the release-auditor's decision at the DG7 gate on the DG7 C3 hits that 'protocol-audit.mjs --stage DG7' reports on this branch's frozen DG7 candidate (seven handbacks each lacking one section: the five D-270 handbacks T-DG7-AN-P7B, T-DG7-ARCH-R2, T-DG7-ARCH-R5, T-DG7-BE-R5 and T-DG7-DO-A2, plus T-DG7-FE-C3 and T-DG7-DO-D8; known-limitations.md, C3 DG7) and its reading of progress.md at that gate, and protocol-audit C3 and C6 on that candidate (p7-work-split §J.1).",
    ),
    'REQ-DLV-014': (
        " DG7's history reaching VERIFYING and APPROVED, with each DG7 finding (round 2: 915, 935, 960-963) fixed and verified by a non-owner, shown by 'validate.mjs --stage DG7' at the gate.",
        " DG7's history in this branch's stages.json reaching VERIFYING and APPROVED, with every DG7 finding in this branch's docs/delivery/findings.json (the re-gate rounds' findings, F-DG7-1001 onward) fixed and verified by a non-owner before approval (or, for a Low non-mandatory finding, accepted as an observation by a specialist and the release-auditor under the protocol), shown by 'validate.mjs --stage DG7' at the DG7 gate on this branch.",
    ),
    'REQ-DLV-018': (
        " protocol-audit C7 (or the release-auditor's reading of findings.json and progress.md) over the findings of the later DG7 rounds, up to the gate.",
        " protocol-audit C7 on this branch's frozen DG7 candidate (or the release-auditor's reading of this branch's findings.json and progress.md) over this branch's DG7 findings (the re-gate rounds' findings, F-DG7-1001 onward), up to the DG7 gate.",
    ),
}

# Bare numeric lists of old-branch ids (exact replacements).
BARE = {
    'REQ-DLV-014': [(
        'every round-1 finding (913, 914, 953-956) was fixed',
        'every round-1 finding (F-DG7-913, F-DG7-914 and F-DG7-953 to F-DG7-956 [old-branch records]) was fixed',
    )],
    'REQ-DLV-018': [(
        'Each of 913, 914 and 953-956 was verified',
        'Each of F-DG7-913, F-DG7-914 and F-DG7-953 to F-DG7-956 [old-branch records] was verified',
    )],
}

# Rows whose older notes say an old-branch finding 'stays OPEN until ... verifies it'.
STAYS_OPEN = {
    'REQ-S16-024': 'F-DG7-913',
    'REQ-S17-004': 'F-DG7-914',
    'REQ-S20-026': 'F-DG7-954',
}

PATH = re.compile(r'test-evidence/DG7/(?:qa|domain|code-security|audit)/round-\d+/')

changed = []
for r in rows[1:]:
    rid, n = r[C['req_id']], r[C['notes']]
    if 'F-DG7-9' not in n:
        continue
    k = n.find(MARK)
    head, later = (n[:k], n[k + len(MARK):]) if k >= 0 else (n, None)
    cited = sorted(set(re.findall(r'F-DG7-9\d\d', head + (later or ''))))
    # Inline qualification: first id occurrence in the row gets the full qualifier, the rest the short one.
    state = {'first': True}
    def q(m):
        s = FULL if state['first'] else SHORT
        state['first'] = False
        return m.group(0) + s
    head = ID.sub(q, head)
    for old, new in BARE.get(rid, []):
        assert head.count(old) == 1, (rid, old)
        head = head.replace(old, new)
        cited = sorted(set(cited) | set(re.findall(r'F-DG7-9\d\d', new)))
        if 'F-DG7-953 to F-DG7-956' in new:
            cited = sorted(set(cited) | {'F-DG7-954', 'F-DG7-955'})
    rewritten = False
    if rid in LATER:
        old, new = LATER[rid]
        assert later == old, (rid, later)
        later = new
        rewritten = True
    if later is not None:
        assert 'F-DG7-9' not in later, rid
    note = (
        f"DG7 analyst note (T-DG7-AN-P7J, base 90cbc1c3b, 2026-11-17; F-DG7-1022, D-281, D-282): "
        f"the DG7 finding ids cited in this row ({', '.join(cited)}) are old-branch records. "
        "Their findings.json entries and review records are at commit 1612f85fc on branch "
        "claude/mobily-transformation-platform-dg6-regate, which keeps DG7's history before the clean re-gate (D-281); "
        "there each is CLOSED_VERIFIED (checked with 'git show 1612f85fc:docs/delivery/findings.json'). "
        "This branch's findings.json holds none of them, 'validate.mjs --stage DG7' here cannot show them, "
        "and they are not findings of this gate (D-282). They stay as historical citations and are not conditions of this row."
    )
    if rid in STAYS_OPEN:
        note += (f" The statement above that {STAYS_OPEN[rid]} 'stays OPEN until' a reviewer verifies it is old-branch history: "
                 "it was verified closed there and is not an open condition on this branch.")
    if PATH.search(head):
        note += (" The reviewer evidence paths under docs/delivery/test-evidence/DG7/qa/round-N/ cited above also refer to commit 1612f85fc (D-281); "
                 "on this branch a round directory of the same name, where one exists, holds the re-gate rounds' own, different records.")
    if later is None:
        note += " This row has no later clause."
    elif rewritten:
        note += (" The later clause below is rewritten so that it names only what the DG7 gate on this branch can show; "
                 "the handback of T-DG7-AN-P7J lists the old and new text.")
    else:
        note += (" The later clause below names no old-branch id and a condition shown on this branch "
                 "(at the DG7 gate, or by the seal after it where it says so); it is unchanged.")
    note += (" Status, acceptance and evidence unchanged. This note grants and implies no DG7 approval "
             "and no G1-G6 business approval.")
    sep = '' if head.endswith(' ') or head == '' else ' '
    if later is None:
        new_notes = head + sep + note
    else:
        new_notes = head + sep + note + ' ' + MARK + later
    assert '\n' not in new_notes
    r[C['notes']] = new_notes
    changed.append((rid, rewritten, cited))

o = io.StringIO()
csv.writer(o, lineterminator='\n').writerows(rows)
open(dst, 'wb').write(o.getvalue().encode('utf-8'))
for c in changed:
    print(c[0], 'later-rewritten' if c[1] else '', ' '.join(c[2]))
print('rows changed:', len(changed))
