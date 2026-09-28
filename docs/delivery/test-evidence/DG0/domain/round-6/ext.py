import re,sys,html,json,unicodedata
x=re.sub(r'<w:(br|tab|cr)\b[^>]*/>','<w:t> </w:t>',open('word/document.xml',encoding='utf8').read())
md=open('../wt/docs/source/playbook.md',encoding='utf8').read()
def norm(s):
    s=html.unescape(s); s=unicodedata.normalize('NFKC',s)
    s=re.sub(r'<br\s*/?>',' ',s)
    s=re.sub(r'[\*\|#`_\\]',' ',s)
    return re.sub(r'\s+',' ',s).strip()
mdn=norm(md)
# paragraphs
paras=re.findall(r'<w:p[ >].*?</w:p>',x,flags=re.S)
segs=[]
for p in paras:
    t=''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>',p))
    t=norm(t)
    if t: segs.append(t)
miss=[s for s in segs if s not in mdn]
print('paragraph segments',len(segs),'missing',len(miss))
for m in miss[:20]: print(' MISSING:',m[:120])
tbls=re.findall(r'<w:tbl>.*?</w:tbl>',x,flags=re.S)
rows=sum(len(re.findall(r'<w:tr[ >]',t)) for t in tbls)
print('tables',len(tbls),'rows',rows)
# table rows presence: each row's cells in order within md
bad=0
for t in tbls:
  for r in re.findall(r'<w:tr[ >].*?</w:tr>',t,flags=re.S):
    cells=[norm(''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>',c))) for c in re.findall(r'<w:tc>.*?</w:tc>',r,flags=re.S)]
    pat=' '.join(c for c in cells if c)
    if pat not in mdn: bad+=1; print(' ROW NOT CONTIGUOUS:',pat[:150])
print('rows not contiguous',bad)
for f in ['word/footer1.xml','word/header1.xml','word/footnotes.xml']:
  try:
    t=norm(' '.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>',open(f,encoding='utf8').read())))
    print(f,repr(t[:100]),'in md:',t in mdn if t else None)
  except FileNotFoundError: print(f,'absent')
