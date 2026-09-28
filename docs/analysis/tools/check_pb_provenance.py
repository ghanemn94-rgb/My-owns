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
  R5  (T-DG0-AN-09, finding F-DG0-008) the Interpretations clause does not restate a master-prompt block cited in
      source_ref. Both texts are normalised (lower case, punctuation removed, stop words dropped, light suffix
      stemming). A clause is flagged against a cited block when they share 4 or more content words in sequence, or
      4 or more distinct content words, or at least 3 distinct content words making up half or more of the clause's
      distinct content words. Every flag must be reviewed by hand: a real restatement is moved to 'Master-prompt
      additions'; a false positive is recorded in REVIEWED_R5 with the exact shared-word set and a rationale. If the
      clause or block changes so that the shared words differ, the entry no longer matches and the flag reappears;
      unused REVIEWED_R5 entries are also reported, so the allowlist cannot go stale;
  R6  if the notes say 'Master-prompt additions: none', every master-prompt anchor in source_ref (other than
      GATE_ONLY) is still named in the notes, so the row says why a cited block adds nothing (for example, that it
      restates the source);
  R7  where the notes label anchors with a section ('§5 M0130', '§9 M0178, M0180-M0183'), each anchor belongs to
      that section.
References to sections of other files (for example 'permissions-matrix.md §5') are not master-prompt sections.
Exit status 1 if any problem is found.
"""
import csv, os, re, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
GATE_ONLY = {('REQ-PB-049', 'M0406')}
# R5 false positives, reviewed by hand in T-DG0-AN-09: (req_id, anchor) -> (shared normalised words, rationale).
REVIEWED_R5 = {
    ('REQ-PB-015', 'M0124'): ('approv configurabl decision gat scal',
        'M0124 makes conditional approval configurable; it names no default approver and no per-gate approver; the quoted gate decisions are playbook T11 (B0099) text'),
    ('REQ-PB-016', 'M0118'): ('baselin evidenc pool valu',
        'the G1 evidence items are playbook B0023; linking T01, baseline and value-pool records as checklist items is not stated in M0118'),
    ('REQ-PB-024', 'M0147'): ('current sourc target',
        'M0147 asks for current/target design per TOM dimension, not a rating scale for capabilities'),
    ('REQ-PB-025', 'M0147'): ('link pain point',
        'M0147 lists pain points on journey maps; linking them to T01 rows is not stated'),
    ('REQ-PB-029', 'M0146'): ('charter creat nam transformation',
        'the words are the charter field name; the P1/P2 staging of the charter is a delivery plan reading, not in M0146'),
    ('REQ-PB-032', 'M0130'): ('contribution initiativ link outcom',
        'M0130 lists hierarchical links; rejecting an unlinked contribution reads playbook B0048 (each initiative moves one or more outcomes)'),
    ('REQ-PB-047', 'M0134'): ('financial scor valu',
        'M0134 names the criteria only; which roles may score is not stated'),
    ('REQ-PB-066', 'M0200'): ('next rout steerco urgent',
        "the shared words are the quoted playbook SLA 'Next SteerCo / urgent route' (B0099), which M0200 restates; how it resolves to a due date is not stated"),
    ('REQ-PB-072', 'M0216'): ('completion observ proficiency sourc',
        "the shared words are the playbook indicator name (B0112), which M0216 restates, plus 'source'; recording the two parts as separate measures is the analyst reading. M0216's attendance-versus-adoption distinction is under Master-prompt additions"),
    ('REQ-PB-093', 'M0155'): ('approv configur default new transformation',
        'M0155 pins existing transformations to their versions; that the seeded weights become the Studio default for new transformations, and that ADM configures defaults but never approves a transformation weight set (permissions-matrix.md), are not stated in M0155'),
}
STOP = set('''a an the and or of to in on at for by with from as is are be been being was were it its this that these
those which who whom whose what when where how not no nor but if then than so such each every any all both either
neither per via into onto over under within without only also can may must should shall will would do does did has
have had there their they them we our you your he she his her one same other more most less least own up out about
after before between through during against eg ie etc'''.split())

def stem(w):
    for suf in ('ing', 'ed', 'es', 's'):
        if len(w) - len(suf) >= 3 and w.endswith(suf) and not w.endswith('ss'):
            w = w[:-len(suf)]
            break
    if len(w) > 3 and w.endswith('e'):
        w = w[:-1]
    return w

def content_words(text):
    text = text.lower().replace('\u2019', "'")
    return [stem(w) for w in re.findall(r'[a-z0-9]+', text) if w not in STOP]

def ngrams(words, n):
    return {tuple(words[i:i + n]) for i in range(len(words) - n + 1)}

sec = {}
mp_text = {}
for line in open(f'{ROOT}/docs/source/master-prompt.anchored.md', encoding='utf-8'):
    m = re.match(r'#*\s*\[(M\d{4}) §([^\]]+)\]\s*(.*)', line)
    if m:
        mp_text[m.group(1)] = m.group(3)
        top = re.match(r'(\d+)', m.group(2))
        if top:
            sec[m.group(1)] = int(top.group(1))

def anchors(s):
    out = set()
    for a, b in re.findall(r'M(\d{4})(?:\s*[-–]\s*M(\d{4}))?', s):
        out |= {f'M{i:04d}' for i in range(int(a), int(b or a) + 1)}
    return out

cov = {r['block_id']: r for r in csv.DictReader(open(f'{ROOT}/docs/analysis/master-prompt-coverage.csv', newline='', encoding='utf-8'))}
rows = list(csv.DictReader(open(f'{ROOT}/docs/delivery/requirements.csv', newline='', encoding='utf-8')))
problems = []; checked = 0; used_r5 = set()
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
        cw = content_words(clause)
        for a in sorted(x for x in refs if x in mp_text):
            bw = content_words(mp_text[a])
            shared = set(cw) & set(bw)
            seq = ngrams(cw, 4) & ngrams(bw, 4)
            if seq or len(shared) >= 4 or (len(shared) >= 3 and len(shared) * 2 >= len(set(cw))):
                key = ' '.join(sorted(shared))
                reviewed = REVIEWED_R5.get((rid, a))
                if reviewed and reviewed[0] == key:
                    used_r5.add((rid, a))
                    continue
                how = f"sequence '{' '.join(sorted(seq)[0])}'" if seq else f"shared words '{key}'"
                problems.append(f'{rid}: R5 the Interpretations clause may restate {a} ({how}); move it to Master-prompt additions or record a reviewed false positive')
    if re.search(r'Master-prompt additions:\s*none', notes):
        for a in sorted(x for x in refs if x.startswith('M') and x not in anchors(notes) and (rid, x) not in GATE_ONLY):
            problems.append(f"{rid}: R6 notes say 'Master-prompt additions: none' but do not account for cited {a}")
    for label, group in re.findall(r'§\s*(\d+)\s+((?:M\d{4}(?:\s*[-–]\s*M\d{4})?(?:\s*,\s*(?:and\s+)?|\s+and\s+)?)+)', notes):
        for a in sorted(anchors(group)):
            if a in sec and sec[a] != int(label):
                problems.append(f'{rid}: R7 notes label {a} as §{label} but it is in §{sec[a]}')
    for a in sorted(x for x in refs if x.startswith('M')):
        if rid not in (cov.get(a, {}).get('req_ids') or '').split(';'):
            problems.append(f'{rid}: R4 source_ref cites {a} but the coverage row for {a} does not list {rid}')
for k in sorted(set(REVIEWED_R5) - used_r5):
    problems.append(f'{k[0]}: R5 REVIEWED_R5 entry for {k[1]} no longer matches a flag (remove or re-review it)')
print(f'checked {checked} REQ-PB rows; {len(problems)} problem(s); {len(used_r5)} reviewed R5 false positive(s) accepted')
for p in problems:
    print('  -', p)
sys.exit(1 if problems else 0)
