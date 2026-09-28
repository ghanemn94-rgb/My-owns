# First-class deliverables: every source cell/line of the listed blocks appears verbatim
# (after <br>/whitespace normalisation) in docs/analysis/field-inventory.md.
import re, sys, json
md = open('docs/source/playbook.md', encoding='utf-8').read()
fi = re.sub(r'\s+', ' ', open('docs/analysis/field-inventory.md', encoding='utf-8').read().replace('<br>', ' '))
def n(s): return re.sub(r'\s+', ' ', s.replace('<br>', ' ').replace('☐', '')).strip()
def table_cells(b):
    t = re.search(r'<!-- %s table -->\n(.*?)\n\n' % b, md, re.S).group(1).splitlines()
    cells = []
    for l in t:
        if set(l) <= set('|-'): continue
        cells += [n(c) for c in l.strip().strip('|').split(' | ') if n(c)]
    return cells
def line(b): return n(re.search(r'\n(.*?) <!-- %s -->' % b, md).group(1))
groups = {
 'modes B0009': table_cells('B0009'), 'roles B0018': table_cells('B0018'), 'phases B0021': table_cells('B0021'),
 'gates B0023': table_cells('B0023'), 'charter B0035': table_cells('B0035'), 'thesis B0037': [n(table_cells('B0037')[0].split('Complete this sentence')[1])],
 'scope checks B0039-43': [line('B00%d' % i) for i in range(39, 44)], 'outcome hierarchy B0048': table_cells('B0048'),
 'TOM B0056': table_cells('B0056'), 'canvas B0062': [p for c in table_cells('B0062') for p in [c.split('[Write')[0].strip()]],
 'workshop B0063': [line('B0063')], 'bizcase B0085': table_cells('B0085'), 'OS layers B0093': table_cells('B0093'),
 'benefits lifecycle B0121': table_cells('B0121'), 'adoption B0109-115': [line('B0%d' % i) for i in range(109, 116)],
 '90-day B0134': table_cells('B0134'), 'Day-90 B0136-141': [line('B0%d' % i) for i in range(136, 142)],
 'health 25 B0150': table_cells('B0150'), 'bands B0152': table_cells('B0152'), 'roaming B0145': table_cells('B0145'),
 'roaming trace B0147': table_cells('B0147'), 'T11 B0099': table_cells('B0099'), 'RACI B0101': table_cells('B0101')}
bad = 0
for g, cells in groups.items():
    miss = [c for c in cells if c not in fi]
    # canvas cells: check box title and prompt separately
    if g.startswith('canvas'):
        miss = [c for c in cells for part in re.split(r'(?<=[A-Z]) (?=[A-Z][a-z])', c, 1) if part not in fi]
    print(f'{g}: items={len(cells)} missing={len(miss)}' + ('' if not miss else ' ' + json.dumps(miss[:6], ensure_ascii=False)))
    bad += len(miss)
print('problems', bad); sys.exit(1 if bad else 0)
