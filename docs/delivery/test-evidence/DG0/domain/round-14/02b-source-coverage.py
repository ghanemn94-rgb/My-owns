# Source coverage integrity: every B0001-B0165 has one disposition; REQUIREMENT rows map to existing reqs that cite the block;
# every SOURCE row cites >=1 block; prints dispositions and CONTEXT/NON-REQUIREMENT rationales for manual reading.
import csv, re, collections, sys
md = open('docs/source/playbook.md', encoding='utf-8').read()
blocks = sorted(set(re.findall(r'<!-- (B\d{4})', md)))
cov = list(csv.DictReader(open('docs/analysis/source-coverage.csv', encoding='utf-8')))
reg = {r['req_id']: r for r in csv.DictReader(open('docs/delivery/requirements.csv', encoding='utf-8'))}
print('columns', list(cov[0].keys()))
ids = [c['block_id'] for c in cov]
dup = [b for b, n in collections.Counter(ids).items() if n > 1]
print('md blocks', len(blocks), 'coverage rows', len(cov), 'missing', sorted(set(blocks) - set(ids)), 'extra', sorted(set(ids) - set(blocks)), 'dup', dup)
print('dispositions', collections.Counter(c['disposition'] for c in cov))
bad = 0
for c in cov:
    rq = [x for x in re.split(r'[;, ]+', c.get('req_ids', '')) if x]
    if c['disposition'] == 'REQUIREMENT':
        if not rq: print('NO REQ', c['block_id']); bad += 1
        for r in rq:
            if r not in reg: print('DANGLING', c['block_id'], r); bad += 1
            elif c['block_id'] not in reg[r]['source_ref'] and c['block_id'] not in reg[r]['notes']:
                print('REQ DOES NOT CITE', c['block_id'], r)
src = [r for r in reg.values() if r['class'] == 'SOURCE']
nocite = [r['req_id'] for r in src if not re.search(r'B\d{4}', r['source_ref'])]
print('SOURCE rows', len(src), 'without B-cite', nocite); bad += len(nocite)
cited = set(b for r in reg.values() for b in re.findall(r'B\d{4}', r['source_ref']))
print('blocks cited by register', len(cited), 'REQUIREMENT blocks not cited by any row', sorted(b['block_id'] for b in cov if b['disposition']=='REQUIREMENT' and b['block_id'] not in cited))
print('\n# non-REQUIREMENT dispositions (for manual truth check)')
for c in cov:
    if c['disposition'] != 'REQUIREMENT':
        text = re.search(r'([^\n]*)<!-- %s' % c['block_id'], md)
        print(c['block_id'], c['disposition'], '|', (text.group(1) if text else '')[:110], '| RATIONALE:', c.get('rationale', '')[:170])
print('problems', bad); sys.exit(1 if bad else 0)
