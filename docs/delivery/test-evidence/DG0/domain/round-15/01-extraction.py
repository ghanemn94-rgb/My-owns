# Independent docx -> text containment check (domain-reviewer round 13).
# Walks word/document.xml and footer*.xml with a regex tokenizer (no python-docx),
# collects every paragraph's text (w:t, w:tab, w:br), normalises whitespace and
# markdown escapes, and checks each paragraph appears in playbook.md in order.
import re, sys, glob, html, unicodedata
root = sys.argv[1]; md = open(sys.argv[2], encoding='utf-8').read()
def norm(s):
    s = html.unescape(s)
    s = unicodedata.normalize('NFKC', s)
    s = s.replace('<br>', ' ')
    s = re.sub(r'<!--|-->', ' ', s)
    s = re.sub(r'[\\*_`|#>]', ' ', s)
    s = s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"')
    return re.sub(r'\s+', ' ', s).strip()
def paras(xml):
    out = []
    for p in re.findall(r'<w:p[ >].*?</w:p>', xml, flags=re.S):
        t = []
        for m in re.finditer(r'<w:t(?: [^>]*)?>(.*?)</w:t>|<w:tab/>|<w:br/>', p, flags=re.S):
            t.append(m.group(1) if m.group(1) is not None else ' ')
        s = norm(''.join(t))
        if s: out.append(s)
    return out
doc = open(root + '/word/document.xml', encoding='utf-8').read()
P = paras(doc)
nmd = norm(md)
pos = 0; missing = []; outoforder = 0
for s in P:
    i = nmd.find(s, pos)
    if i < 0:
        j = nmd.find(s)
        if j < 0: missing.append(s)
        else: outoforder += 1
    else: pos = i + len(s)
tables = re.findall(r'<w:tbl>.*?</w:tbl>', doc, flags=re.S)
rows = sum(len(re.findall(r'<w:tr[ >]', t)) for t in tables)
cells_missing = 0; cells = 0
for t in tables:
    for c in re.findall(r'<w:tc>.*?</w:tc>', t, flags=re.S):
        s = ' '.join(paras(c)); cells += 1
        if s and s not in nmd: cells_missing += 1
foot = [s for f in glob.glob(root + '/word/footer*.xml') for s in paras(open(f, encoding='utf-8').read())]
fmiss = [s for s in foot if s not in nmd]
print(f'paragraphs={len(P)} missing={len(missing)} out_of_order={outoforder}')
print(f'tables={len(tables)} rows={rows} cells={cells} cells_missing={cells_missing}')
print(f'footer_paras={len(foot)} footer_missing={len(fmiss)}')
for s in missing[:20]: print('MISSING:', s[:160])
sys.exit(1 if (missing or cells_missing or fmiss) else 0)
