# §21 staging spot-check: template rows, product gates G1-G6, Studio, reports, health check, demo, handover.
import csv, re, collections
reg = {r['req_id']: r for r in csv.DictReader(open('docs/delivery/requirements.csv', encoding='utf-8'))}
exp = {}
for r in reg.values():
    t = r['template_id']
    if re.fullmatch(r'T0[1-4]', t): exp.setdefault(r['req_id'], 'DG2')
    if re.fullmatch(r'T0[5-9]', t): exp.setdefault(r['req_id'], 'DG3')
    if re.fullmatch(r'T1[0-6]', t): exp.setdefault(r['req_id'], 'DG4')
bad = 0
for k, g in sorted(exp.items()):
    fg = reg[k]['final_gate']
    ok = fg == g or (fg > g and 'Studio' in reg[k]['title'])
    if fg != g: print(('NOTE ' if ok else 'MISMATCH ') + k, reg[k]['template_id'], 'final_gate', fg, 'expected', g, '|', reg[k]['title'][:110]); bad += (not ok)
print('template rows checked', len(exp))
for k in ['REQ-PB-016','REQ-PB-017','REQ-PB-018','REQ-PB-019','REQ-PB-020','REQ-PB-021','REQ-PB-091','REQ-PB-092','REQ-PB-088','REQ-PB-090','REQ-PB-093','REQ-S13-005','REQ-DLV-032','REQ-DLV-039','REQ-S19-001']:
    r = reg[k]; print(k, r['final_gate'], r['increments'], '|', r['title'][:120])
print('final_gate distribution', sorted(collections.Counter(r['final_gate'] for r in reg.values()).items()))
empty_acc = [k for k, r in reg.items() if len(r['acceptance'].strip()) < 25]
print('rows with empty/trivial acceptance', empty_acc); bad += len(empty_acc)
print('problems', bad)
