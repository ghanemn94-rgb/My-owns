#!/usr/bin/env python3
"""Domain-reviewer round-19 extraction check (method differs from r17/r18):
every docx paragraph (body text AND each table cell paragraph, footers/headers too) must appear,
whitespace/quote-normalized, as a substring of playbook.md stripped of markdown markup; and reverse:
every non-empty playbook.md line (markup stripped) must occur in the docx text.
Usage: python3 r19-extraction-containment.py <clone>"""
import sys,zipfile,re,html,unicodedata,hashlib
R=sys.argv[1]; D=f'{R}/docs/source/Business_Transformation_Playbook.docx'
print('docx sha256',hashlib.sha256(open(D,'rb').read()).hexdigest())
z=zipfile.ZipFile(D)
def N(s):
    s=unicodedata.normalize('NFKC',html.unescape(s))
    for a,b in (('’',"'"),('‘',"'"),('“','"'),('”','"'),('–','-'),('—','-'),(' ',' ')): s=s.replace(a,b)
    return re.sub(r'\s+',' ',s).strip()
def paras(xml): return [N(''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>',re.sub(r'<w:(?:tab|br|cr)/>','<w:t> </w:t>',p)))) for p in re.findall(r'<w:p[ >].*?</w:p>',xml,flags=re.S)]
parts=[n for n in z.namelist() if re.match(r'word/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$',n)]
print('xml parts',parts)
md=open(f'{R}/docs/source/playbook.md',encoding='utf8').read()
mdc=re.sub(r'<!--.*?-->','',md,flags=re.S).replace('<br>',' ')
mdc=re.sub(r'(?m)^\s*\|?[\s|:\-]+\|?\s*$','',mdc)
mdc=re.sub(r'(?m)\*\*|[|#>`]|^\s*[-*]\s+|^\s*\d+\.\s+(?=\S)',' ',mdc)
mdn=N(mdc)
miss=0; tot=0
for p in parts:
    for t in paras(z.read(p).decode('utf8')):
        if not t: continue
        tot+=1
        if t not in mdn: miss+=1; print('  MISSING in md from',p,':',t[:150])
print(f'docx paragraphs={tot} missing_in_md={miss}')
alld=N(' '.join(t for p in parts for t in paras(z.read(p).decode('utf8'))))
rev=0; lines=0
for L in mdc.splitlines():
    t=N(L)
    if not t or re.fullmatch(r'[\W\d]*',t): continue
    lines+=1
    # table rows: check each cell segment separately
    for seg in [s for s in re.split(r'\s{2,}',re.sub(r'<!--.*?-->','',L)) if N(s)]:
        if N(seg) not in alld: rev+=1; print('  md text not in docx:',N(seg)[:150])
print(f'md lines={lines} md segments not in docx={rev}')
sys.exit(1 if miss or rev else 0)
