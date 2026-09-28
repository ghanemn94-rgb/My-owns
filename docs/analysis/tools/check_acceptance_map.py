#!/usr/bin/env python3
"""Check docs/analysis/acceptance-map.md against the register, both ways (T-DG0-AN-14, finding F-DG0-235).

Usage (from any directory):
  python3 docs/analysis/tools/check_acceptance_map.py                 # check the repository's map
  python3 docs/analysis/tools/check_acceptance_map.py --map FILE      # check another copy of the map
                                                                      # (for example a pre-fix copy from git show)

The exact rule the map follows (stated in its scope note):
  M1  Citation. A register row cites scenario Ann (A01..A28) when its `acceptance` column contains the token Ann
      as a whole word (regex \\bA(0[1-9]|1\\d|2[0-8])\\b): the same rule as check_counts.py, which derives the
      README "A-citations" counts. A prose range such as 'A01-A27 tests pass' is not expanded; like every other
      token, its two endpoints count as citations (so REQ-DLV-039 is listed under A01 and A27). This is the rule
      the map has followed since AN-04; it is not loosened here.
  M2  "Requirements proved" column. For every scenario row in the main table, the listed IDs (ranges such as
      REQ-PB-001..003 are expanded) are exactly the register rows that cite the scenario, except the
      scenario's own executable-test row REQ-S20-0nn (the scenario's "Executable test req" column), which is
      never repeated. Both directions are checked: a citing row missing from the map, and a listed ID that
      does not cite the scenario (or does not exist in the register), are both mismatches.
  M3  "Gate ordering of scenario suites" table. For every scenario, the rows listed there are exactly the rows of
      M2 whose final_gate is later than the scenario's "Must pass at" gate, each annotated with its register
      final_gate, e.g. 'REQ-DLV-042 (DG1)'. A scenario with no such row has no line in that table.
  M4  Structure: every scenario A01..A28 appears exactly once in the main table, and its executable-test row
      exists in the register.
  M5  Built-in negative control, run every time: a synthetic register row citing A24, and a map with one ID
      removed, must each produce a mismatch; otherwise the checker itself is broken.

Exit status 1 on any mismatch; every mismatch is printed.
"""
import csv, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SCEN = [f'A{i:02d}' for i in range(1, 29)]
CITE = re.compile(r'\bA(0[1-9]|1\d|2[0-8])\b')
ID_ITEM = re.compile(r'^REQ-([A-Z0-9]+)-(\d{3})(?:\.\.(\d{3}))?$')
LATER_ITEM = re.compile(r'^(REQ-[A-Z0-9]+-\d{3}) \((DG[0-7])\)$')


def cited(text):
    return {'A' + m for m in CITE.findall(text)}


def expand(cell, problems, where):
    ids = []
    for item in re.split(r'[;,]', cell):
        item = item.strip()
        if not item:
            continue
        m = ID_ITEM.match(item)
        if not m:
            problems.append(f'{where}: cannot parse item {item!r}')
            continue
        a, lo, hi = m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))
        if hi < lo:
            problems.append(f'{where}: empty range {item!r}')
        ids += [f'REQ-{a}-{n:03d}' for n in range(lo, hi + 1)]
    return ids


def parse_map(text, problems):
    main, later = {}, {}
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if not line.startswith('| A') or not re.fullmatch(r'A\d\d', cells[0]):
            continue
        if len(cells) == 7:
            if cells[0] in main:
                problems.append(f'M4 {cells[0]}: appears more than once in the main table')
            main[cells[0]] = {'test': cells[2], 'gate': cells[5], 'line': line,
                              'ids': expand(cells[6], problems, f'M2 {cells[0]}')}
        elif len(cells) == 3:
            if cells[0] in later:
                problems.append(f'M3 {cells[0]}: appears more than once in the gate-ordering table')
            items = {}
            for item in cells[2].split(','):
                m = LATER_ITEM.match(item.strip())
                if not m:
                    problems.append(f'M3 {cells[0]}: cannot parse item {item.strip()!r}')
                    continue
                items[m.group(1)] = m.group(2)
            later[cells[0]] = {'gate': cells[1], 'items': items}
        else:
            problems.append(f'unrecognised table row: {line[:80]}')
    return main, later


def check(rows, map_text):
    problems = []
    reg = {r['req_id']: r for r in rows}
    cites = {s: set() for s in SCEN}
    for r in rows:
        for s in cited(r['acceptance']):
            cites[s].add(r['req_id'])
    main, later = parse_map(map_text, problems)
    for s in SCEN:
        if s not in main:
            problems.append(f'M4 {s}: missing from the main table')
            continue
        e = main[s]
        if e['test'] not in reg:
            problems.append(f'M4 {s}: executable-test row {e["test"]} is not in the register')
        if not re.fullmatch(r'DG[0-7]', e['gate']):
            problems.append(f'M4 {s}: cannot parse must-pass gate {e["gate"]!r}')
            continue
        listed = e['ids']
        dups = sorted({i for i in listed if listed.count(i) > 1})
        if dups:
            problems.append(f'M2 {s}: listed more than once: {", ".join(dups)}')
        want = cites[s] - {e['test']}
        got = set(listed)
        for i in sorted(want - got):
            problems.append(f'M2 {s}: register row cites {s} but the map omits it: {i}')
        for i in sorted(got - want):
            why = 'is not in the register' if i not in reg else (
                'is the scenario\'s own test row' if i == e['test'] else f'does not cite {s} in its acceptance column')
            problems.append(f'M2 {s}: map lists {i}, which {why}')
        # M3: rows (of the register's citing set) with a final gate later than the scenario's gate
        exp_later = {i: reg[i]['final_gate'] for i in want if reg[i]['final_gate'] > e['gate']}
        got_later = later.get(s, {'items': {}, 'gate': e['gate']})
        if s in later and later[s]['gate'] != e['gate']:
            problems.append(f'M3 {s}: gate-ordering table says must pass at {later[s]["gate"]}, main table says {e["gate"]}')
        for i in sorted(set(exp_later) - set(got_later['items'])):
            problems.append(f'M3 {s}: gate-ordering table omits {i} ({exp_later[i]})')
        for i in sorted(set(got_later['items']) - set(exp_later)):
            problems.append(f'M3 {s}: gate-ordering table lists {i}, which is not a citing row with a final gate after {e["gate"]}')
        for i in sorted(set(got_later['items']) & set(exp_later)):
            if got_later['items'][i] != exp_later[i]:
                problems.append(f'M3 {s}: {i} annotated ({got_later["items"][i]}), register final_gate is {exp_later[i]}')
    for s in sorted(set(later) - set(SCEN)):
        problems.append(f'M3 {s}: not a scenario')
    for s in sorted(set(main) - set(SCEN)):
        problems.append(f'M4 {s}: not a scenario')
    return problems


def main_():
    args = sys.argv[1:]
    map_path = f'{ROOT}/docs/analysis/acceptance-map.md'
    if args[:1] == ['--map'] and len(args) == 2:
        map_path = args[1]
    elif args:
        print(__doc__)
        return 2
    rows = list(csv.DictReader(open(f'{ROOT}/docs/delivery/requirements.csv', newline='', encoding='utf-8')))
    text = open(map_path, encoding='utf-8').read()

    # M5 negative controls, run before the real check so a broken checker cannot report success.
    control_ok = True
    fake = dict(rows[0]); fake['req_id'] = 'REQ-ZZ-999'; fake['acceptance'] = 'A24: synthetic control'
    if not any('REQ-ZZ-999' in p and p.startswith('M2 A24') for p in check(rows + [fake], text)):
        control_ok = False
        print('M5 CONTROL FAILED: a synthetic row citing A24 was not reported as missing from the map')
    # Control 2: rebuild the first scenario row's "proves" cell without its first ID (layout-independent).
    first = next((l for l in text.splitlines() if l.startswith('| A01 |')), None)
    cells = [c.strip() for c in first.strip().strip('|').split('|')] if first else []
    ids = expand(cells[6], [], 'M5') if len(cells) == 7 else []
    if not ids:
        control_ok = False
        print('M5 CONTROL FAILED: the A01 row used by the control cannot be parsed')
    else:
        cut = text.replace(first, '| ' + ' | '.join(cells[:6] + [', '.join(ids[1:])]) + ' |')
        if f'M2 A01: register row cites A01 but the map omits it: {ids[0]}' not in check(rows, cut):
            control_ok = False
            print(f'M5 CONTROL FAILED: removing {ids[0]} from A01 was not reported')

    problems = check(rows, text)
    for p in problems:
        print('MISMATCH', p)
    print(f'checked {len(SCEN)} scenarios against {len(rows)} register rows in {os.path.relpath(map_path, ROOT) if map_path.startswith(ROOT) else map_path}')
    print('ACCEPTANCE MAP', 'MATCHES THE REGISTER' if not problems and control_ok else
          f'MISMATCH ({len(problems)} problem(s){"" if control_ok else ", negative control failed"})')
    return 0 if not problems and control_ok else 1


if __name__ == '__main__':
    sys.exit(main_())
