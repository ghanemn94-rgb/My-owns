# domain-reviewer DG5 round-1: offline comparison of the probe's API dumps against docs/source (playbook.blocks.json,
# playbook.md). Usage: python3 -I compare.py <repo> <dumpdir>. Prints PASS/FAIL lines; exit 1 if any FAIL.
import json, re, sys, os
repo, d = sys.argv[1], sys.argv[2]
blocks = {b['id']: b for b in json.load(open(os.path.join(repo, 'docs/source/playbook.blocks.json')))}
md = open(os.path.join(repo, 'docs/source/playbook.md'), encoding='utf-8').read()
fails = 0
def check(name, ok, detail=''):
    global fails
    print(('PASS ' if ok else 'FAIL ') + name + (f' :: {detail}' if detail else ''))
    if not ok: fails += 1
def load(n):
    return json.load(open(os.path.join(d, 'api', n + '.json')))
# 1. all 165 blocks: textEn verbatim from playbook.md
bl = load('blocks')
check('blocks: 165 returned', len(bl) == 165, str(len(bl)))
mism = [b['blockRef'] for b in bl if b['textEn'].strip() not in md]
check('blocks: every textEn is a verbatim substring of docs/source/playbook.md', not mism, ','.join(mism[:10]))
refs = [b['blockRef'] for b in bl]
check('blocks: source order B0001..B0165', refs == [f'B{i:04d}' for i in range(1, 166)])
paras = [b for b in bl if blocks[b['blockRef']]['type'] == 'para']
pm = [b['blockRef'] for b in paras if b['textEn'].strip() != blocks[b['blockRef']]['text'].strip()]
check('blocks: every paragraph block equals playbook.blocks.json text exactly', not pm, ','.join(pm[:10]))
tabs = [b for b in bl if blocks[b['blockRef']]['type'] == 'table']
tm = []
for b in tabs:
    for row in blocks[b['blockRef']]['rows']:
        for cell in row:
            for part in cell.split('\n'):
                if part.strip() and part.strip() not in b['textEn']:
                    tm.append((b['blockRef'], part[:40]))
check('blocks: every table cell of playbook.blocks.json appears in the block textEn', not tm, str(tm[:5]))
noar = [b['blockRef'] for b in bl if not b['textAr'].strip()]
check('blocks: every block has an Arabic text', not noar, ','.join(noar[:10]))
# 2. provenance
p = load('provenance')['body']
check('provenance: statement == B0004 verbatim', p['statement']['textEn'] == blocks['B0004']['text'])
check('provenance: realizeNote == B0124 (table text)', 'aligns with PMI Benefits Realization Management logic' in p['realizeNote']['textEn'], p['realizeNote']['textEn'][:120])
check('provenance: customExtensions are B0157..B0162', [x['blockRef'] for x in p['customExtensions']] == ['B0157','B0158','B0159','B0160','B0161','B0162'])
check('provenance: foundations 3 rows', len(p['foundations']) == 3)
allp = json.dumps(p)
check('provenance: no official/certified claim', not re.search(r'(?i)official PMI|PMI[- ]certified|certified by PMI', allp))
# 3. guiding questions
g = load('guiding-questions')['body']['items']
want = ['Why change?', 'What must become different?', 'How will we execute?', 'How will we prove value?']
check('guiding questions: four verbatim B0016 in order', [x['textEn'] for x in sorted(g, key=lambda x: x['ordinal'])] == want, str([x['textEn'] for x in g]))
check('guiding questions: each has Arabic', all(x['textAr'].strip() for x in g))
# 4. elements: provenance + one question per template
e = load('elements')
check('elements: 200', e['status'] == 200, str(e['status']))
items = e['body']['items'] if isinstance(e['body'], dict) and 'items' in e['body'] else []
print('INFO elements total', len(items), 'keys', list(items[0].keys()) if items else None)
import collections
print('INFO element kinds', collections.Counter(x.get('elementKind', x.get('kind')) for x in items))
print('INFO provenance values', collections.Counter(x.get('provenance') for x in items))
tm = [x for x in items if x.get('elementKind', x.get('kind')) == 'template']
check('elements: 16 templates, each custom_extension with exactly one question tag', len(tm) == 16 and all(x.get('provenance') == 'custom_extension' and x.get('questionTag') for x in tm), json.dumps([(x.get('key', x.get('code')), x.get('provenance'), x.get('questionTag')) for x in tm])[:900])
check('elements: nothing labelled a PMI standard', not re.search(r'(?i)PMI standard|certified', json.dumps(items)))
# 5. health questions
h = load('health-questions')['body']['items']
src = []
for row in blocks['B0150']['rows']:
    for cell in row:
        m = re.match(r'☐ (\d+)\. (.*)', cell)
        if m: src.append((int(m.group(1)), m.group(2)))
src.sort()
got = sorted((x['ordinal'], x['textEn']) for x in h)
check('health check: 25 questions verbatim B0150 in order', got == src, str([a for a in got if a not in src][:3]))
# 6. launch template
lt = load('launch-template')['body']
rows = blocks['B0134']['rows'][1:]
ok = True; det = []
for w, r in zip(sorted(lt['windows'], key=lambda x: x['ordinal']), rows):
    if (w['labelEn'], w['objectiveEn'], w['actionsSourceEn'], w['outputsSourceEn']) != tuple(r): ok = False; det.append((w['labelEn'], r[0]))
check('launch plan: three B0134 windows verbatim (label, objective, actions, outputs)', ok and len(lt['windows']) == 3, str(det)[:300])
print('INFO launch template keys', list(lt.keys()))
# 7. branding
b = load('branding')['body']
check('branding: default name Mobily Transformation Hub', b['productNameEn'] == 'Mobily Transformation Hub', b['productNameEn'])
check('branding: colours provisional + wordmark provisional + primary #0078FF', b['coloursProvisional'] and b['wordmarkProvisional'] and b['primaryColour'] == '#0078FF', f"{b['primaryColour']} {b['coloursProvisional']} {b['wordmarkProvisional']}")
# 8. search
s = load('search-value-pools')
print('INFO search status', s['status'], json.dumps(s['body'])[:400])
# 9. navigation
for u in ['dev.admin', 'dev.office', 'dev.lead', 'dev.auditor', 'dev.nobody']:
    n = load('navigation-' + u)
    codes = [a['code'] for a in n['body']['areas']] if n['body'] else None
    print(f'INFO navigation {u}: status {n["status"]} areas {len(codes) if codes else 0}: {codes}')
# 10. environment
for n in ['environment-admin', 'walkthrough-office', 'health-schemes-admin', 'health-schemes-office', 'b0031-links', 't01-source-links']:
    x = load(n); print('INFO', n, x['status'], json.dumps(x['body'], ensure_ascii=False)[:500])
print('FAILS', fails)
sys.exit(1 if fails else 0)
