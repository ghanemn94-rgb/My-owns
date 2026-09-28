#!/usr/bin/env python3
"""Check that each REQ-PB row's provenance notes agree with its source_ref (T-DG0-AN-08, finding F-DG0-006).

Rules, applied to the merged register docs/delivery/requirements.csv:
  R1  every master-prompt anchor named anywhere in the notes (Mxxxx, or a range Mxxxx-Myyyy) is in source_ref,
      except anchors listed in GATE_ONLY (cited only to justify a final-gate assignment, not as a requirement source);
  R2  every master-prompt section (§n) named in the notes has at least one anchor of that section in source_ref;
  R3  the Interpretations clause cites no master-prompt section or anchor: anything the master prompt states
      is a master-prompt addition and must be labelled as one (history annotations such as '(AN-05 ...)' or
      'AN-04 consolidation: ...' after the clause are ignored);
  R4  every master-prompt anchor in a REQ-PB source_ref is mapped back to that requirement in
      docs/analysis/master-prompt-coverage.csv.
References to sections of other files (for example 'permissions-matrix.md §5') are not master-prompt sections.
Exit status 1 if any problem is found.
"""
import csv, os, re, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
GATE_ONLY = {('REQ-PB-049', 'M0406')}
sec = {}
for line in open(f'{ROOT}/docs/source/master-prompt.anchored.md', encoding='utf-8'):
    m = re.match(r'\[(M\d{4}) §(\d+)\]', line)
    if m:
        sec[m.group(1)] = int(m.group(2))

def anchors(s):
    out = set()
    for a, b in re.findall(r'M(\d{4})(?:\s*[-–]\s*M(\d{4}))?', s):
        out |= {f'M{i:04d}' for i in range(int(a), int(b or a) + 1)}
    return out

cov = {r['block_id']: r for r in csv.DictReader(open(f'{ROOT}/docs/analysis/master-prompt-coverage.csv', newline='', encoding='utf-8'))}
rows = list(csv.DictReader(open(f'{ROOT}/docs/delivery/requirements.csv', newline='', encoding='utf-8')))
problems = []; checked = 0
for r in rows:
    rid = r['req_id']
    if not rid.startswith('REQ-PB-'):
        continue
    checked += 1
    refs = set(x.strip() for x in r['source_ref'].split(';') if x.strip())
    ref_secs = {sec[x] for x in refs if x in sec}
    notes = re.sub(r'[\w./-]+\.md\s*§\s*\d+', '', r['notes'])
    for a in sorted(anchors(notes) - refs):
        if (rid, a) not in GATE_ONLY:
            problems.append(f'{rid}: R1 notes name {a} (§{sec.get(a)}) but source_ref does not cite it')
    for s in sorted({int(x) for x in re.findall(r'§\s*(\d+)', notes)}):
        if s not in ref_secs:
            problems.append(f'{rid}: R2 notes name §{s} but source_ref has no §{s} anchor')
    interp = re.search(r'Interpretations:(.*)', notes, re.S)
    if interp:
        clause = re.split(r'\(AN-\d|\bAN-\d\d (?:consolidation|resolution|split)|\bAN-\d\d:', interp.group(1))[0]
        if re.search(r'master prompt|§|\bM\d{4}\b', clause, re.I):
            problems.append(f'{rid}: R3 the Interpretations clause cites the master prompt (label it as a master-prompt addition)')
    for a in sorted(x for x in refs if x.startswith('M')):
        if rid not in (cov.get(a, {}).get('req_ids') or '').split(';'):
            problems.append(f'{rid}: R4 source_ref cites {a} but the coverage row for {a} does not list {rid}')
print(f'checked {checked} REQ-PB rows; {len(problems)} problem(s)')
for p in problems:
    print('  -', p)
sys.exit(1 if problems else 0)
