#!/usr/bin/env python3
"""Domain-reviewer round-18 independent extraction-fidelity check (different method from round 17).
Usage: python3 r18-extraction-check.py <repo-clone> <docx-path>
(a) word-token sequence diff (difflib) between the docx body text and playbook.md stripped of markup;
(b) table-by-table, cell-by-cell comparison between every w:tbl in document.xml and the table blocks in playbook.blocks.json."""
import sys,zipfile,re,html,unicodedata,difflib,json,hashlib
R,DOCX=sys.argv[1],sys.argv[2]
raw=open(DOCX,'rb').read(); print('docx sha256',hashlib.sha256(raw).hexdigest())
z=zipfile.ZipFile(DOCX); x=z.read('word/document.xml').decode('utf8')
body=x[x.index('<w:body>'):]
def N(s):
    s=unicodedata.normalize('NFKC',html.unescape(s))
    for a,b in (('’',"'"),('‘',"'"),('“','"'),('”','"'),('–','-'),('—','-'),(' ',' ')): s=s.replace(a,b)
    return s
def ptext(p): return ''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>',re.sub(r'<w:(?:tab|br|cr)/>','<w:t> </w:t>',p)))
dtext=' '.join(ptext(p) for p in re.findall(r'<w:p[ >].*?</w:p>',body,flags=re.S))
md=open(f'{R}/docs/source/playbook.md',encoding='utf8').read()
md=re.sub(r'<!--.*?-->','',md,flags=re.S).replace('<br>',' ')
md=re.sub(r'^\s*\|?[\s|:\-]+\|?\s*$','',md,flags=re.M)      # table separator rows
md=re.sub(r'(?m)[|#>`]|\*\*|^\s*[-*]\s+|^\s*\d+\.\s+(?=\S)','  ',md)
tok=lambda s:[t for t in re.split(r'\s+',N(s)) if t]
dt,mt=tok(dtext),tok(md)
# list numbering in docx is automatic (numPr) so md "1." prefixes were removed above; bullets too.
sm=difflib.SequenceMatcher(None,dt,mt,autojunk=False)
ops=[o for o in sm.get_opcodes() if o[0]!='equal']
print(f'(a) docx tokens={len(dt)} md tokens={len(mt)} ratio={sm.ratio():.5f} non-equal opcodes={len(ops)}')
for o in ops[:40]: print('   ',o[0],'docx:',' '.join(dt[o[1]:o[2]])[:120],'| md:',' '.join(mt[o[3]:o[4]])[:120])
# (b) tables
bl=json.load(open(f'{R}/docs/source/playbook.blocks.json'))
tb=[b for b in bl if b['type']=='table']
dtabs=re.findall(r'<w:tbl>.*?</w:tbl>',body,flags=re.S)
print(f'(b) docx tables={len(dtabs)} table blocks={len(tb)}')
bad=0
for i,(t,b) in enumerate(zip(dtabs,tb)):
    rows=[[N(' '.join(ptext(p) for p in re.findall(r'<w:p[ >].*?</w:p>',c,flags=re.S))).split() for c in re.findall(r'<w:tc>.*?</w:tc>',r,flags=re.S)] for r in re.findall(r'<w:tr[ >].*?</w:tr>',t,flags=re.S)]
    brows=[[N(c).replace('<br>',' ').split() for c in r] for r in b['rows']]
    if rows!=brows:
        bad+=1; print('   MISMATCH',b['id'])
        for a,c in zip(rows,brows):
            if a!=c: print('     docx',a,'\n     md  ',c); break
print(f'(b) tables with any cell mismatch: {bad}')
sys.exit(1 if (ops and sm.ratio()<0.999) or bad or len(dtabs)!=len(tb) else 0)
