#!/usr/bin/env python3
"""Recompute README/stage-plan counts from the merged register and compare.

Usage (from any directory):
  python3 docs/analysis/tools/check_counts.py          # check only; exit 1 on any mismatch
  python3 docs/analysis/tools/check_counts.py --write  # regenerate the stage-plan ID lists, then check

Checks: the per-stage "completing at DGn" and "increment in Pn that complete later"
lists in docs/analysis/stage-plan.md, and the register counts tables in
docs/analysis/README.md. Origin: T-DG0-AN-06 scratch script, promoted in T-DG0-AN-07.
"""
import csv, re, sys, os, collections
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
WRITE = '--write' in sys.argv[1:]
rows = list(csv.DictReader(open(f'{ROOT}/docs/delivery/requirements.csv', newline='', encoding='utf-8')))
G = [f'DG{i}' for i in range(8)]

def area(rid):
    return rid.split('-')[1]

def area_key(a):
    return (0, '') if a == 'PB' else (1, '') if a == 'DLV' else (2, a)

def fmt(ids):
    by = collections.defaultdict(list)
    for r in ids:
        by[area(r)].append(int(r.split('-')[2]))
    groups = []
    for a in sorted(by, key=area_key):
        nums = sorted(by[a]); parts = []; i = 0
        while i < len(nums):
            j = i
            while j + 1 < len(nums) and nums[j + 1] == nums[j] + 1:
                j += 1
            s = f'REQ-{a}-{nums[i]:03d}'
            if j > i:
                s += f'..{nums[j]:03d}'
            parts.append(s); i = j + 1
        groups.append(', '.join(parts))
    return '; '.join(groups)

print('total', len(rows))
print('class', dict(collections.Counter(r['class'] for r in rows)))
print('final_gate', {g: sum(r['final_gate'] == g for r in rows) for g in G})
for c in ('SOURCE', 'USER', 'ENGINEERING'):
    print('class x gate', c, [sum(r['class'] == c and r['final_gate'] == g for r in rows) for g in G])
print('status', dict(collections.Counter(r['status'] for r in rows)))
areas = sorted({area(r['req_id']) for r in rows}, key=area_key)
print('area | SOURCE USER ENG total | DG0..DG7')
for a in areas:
    rs = [r for r in rows if area(r['req_id']) == a]
    cl = [sum(r['class'] == c for r in rs) for c in ('SOURCE', 'USER', 'ENGINEERING')]
    print(a, cl, len(rs), [sum(r['final_gate'] == g for r in rs) for g in G])

# A-scenario citation counts
acnt = collections.Counter()
for r in rows:
    for a in set(re.findall(r'\bA(0[1-9]|1\d|2[0-8])\b', r['acceptance'])):
        acnt['A' + a] += 1
print('A-citations', dict(sorted(acnt.items())))

for mfile in ('source-coverage.csv', 'master-prompt-coverage.csv'):
    cr = list(csv.DictReader(open(f'{ROOT}/docs/analysis/{mfile}', newline='', encoding='utf-8')))
    key = [k for k in cr[0] if 'disposition' in k.lower()]
    print(mfile, len(cr), key and dict(collections.Counter(x[key[0]] for x in cr)))

# stage-plan list comparison (and optional regeneration)
plan_path = f'{ROOT}/docs/analysis/stage-plan.md'
plan = open(plan_path, encoding='utf-8').read()
ok = True
for i, g in enumerate(G):
    comp = [r['req_id'] for r in rows if r['final_gate'] == g]
    later = [r['req_id'] for r in rows if f'P{i}' in r['increments'].split(';') and r['final_gate'] != g]
    for prefix, ids in ((f'Requirements completing at {g} (', comp),
                        (f'Requirements with an increment in P{i} that complete later (', later)):
        want = f'{prefix}{len(ids)}):** ' + (fmt(ids) if ids else 'none')
        pat = re.compile(r'^(- \*\*)' + re.escape(prefix) + r'\d+\):\*\* .*$', re.M)
        hits = pat.findall(plan)
        if WRITE and len(hits) == 1 and want not in plan:
            plan = pat.sub(lambda m: m.group(1) + want, plan)
        found = ('- **' + want + '\n') in plan or plan.endswith('- **' + want)
        ok &= found and len(pat.findall(plan)) == 1
        print(('MATCH ' if found else 'DIFF  ') + want[:90] + ('...' if len(want) > 90 else ''))
        if not found:
            print('   expected:', want)
if WRITE:
    open(plan_path, 'w', encoding='utf-8').write(plan)
print('STAGE-PLAN LISTS', 'ALL MATCH' if ok else 'MISMATCH')

# README count tables
readme = open(f'{ROOT}/docs/analysis/README.md', encoding='utf-8').read()
cls = collections.Counter(r['class'] for r in rows)
exp = [f"| SOURCE | {cls['SOURCE']} |", f"| USER | {cls['USER']} |",
       f"| ENGINEERING | {cls['ENGINEERING']} |", f"| Total | {len(rows)} |",
       '| Rows | ' + ' | '.join(str(sum(r['final_gate'] == g for r in rows)) for g in G) + f' | {len(rows)} |']
for c in ('SOURCE', 'USER', 'ENGINEERING'):
    exp.append(f'| {c} | ' + ' | '.join(str(sum(r['class'] == c and r['final_gate'] == g for r in rows)) for g in G) + ' |')
for a in areas:
    rs = [r for r in rows if area(r['req_id']) == a]
    cl = [sum(r['class'] == c for r in rs) for c in ('SOURCE', 'USER', 'ENGINEERING')]
    gs = [sum(r['final_gate'] == g for r in rs) for g in G]
    exp.append(f'| {a} | ' + ' | '.join(map(str, cl)) + f' | {len(rs)} | ' + ' | '.join(str(x) if x else '' for x in gs) + ' |')
st = collections.Counter(r['status'] for r in rows)
exp += [f'| {k} | {v} |' for k, v in st.items()]
for mfile, label in (('source-coverage.csv', 'Playbook (source-coverage.csv)'),
                     ('master-prompt-coverage.csv', 'Master prompt (master-prompt-coverage.csv)')):
    cr = list(csv.DictReader(open(f'{ROOT}/docs/analysis/{mfile}', newline='', encoding='utf-8')))
    k = [x for x in cr[0] if 'disposition' in x.lower()][0]
    d = collections.Counter(x[k] for x in cr)
    exp.append(f"| {label} | {len(cr)} | {d['REQUIREMENT']} | {d['CONTEXT']} | {d['NON-REQUIREMENT']} |")
for a, n in acnt.items():
    exp.append(re.compile(r'^\| ' + a + r' \|.*\| ' + str(n) + r' \|$', re.M))
rok = True
for e in exp:
    hit = e.search(readme) if hasattr(e, 'search') else (e.replace('|  |', '| |') in readme.replace('|  |', '| |') or e in readme)
    if not hit:
        rok = False
        print('README DIFF, expected:', getattr(e, 'pattern', e))
print('README COUNTS', 'ALL MATCH' if rok else 'MISMATCH')
sys.exit(0 if ok and rok else 1)
