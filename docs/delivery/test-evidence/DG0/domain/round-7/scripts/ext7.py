import re,sys,html,unicodedata,json
D=sys.argv[1]; MD=sys.argv[2]
x=re.sub(r'<w:(br|tab|cr)\b[^>]*/>','<w:t> </w:t>',open(D+'/word/document.xml',encoding='utf8').read())
md=open(MD,encoding='utf8').read()
def norm(s):
    s=html.unescape(s); s=unicodedata.normalize('NFKC',s)
    s=re.sub(r'<br\s*/?>',' ',s); s=re.sub(r'[\*\|#`_\\>]',' ',s)
    s=s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"')
    return re.sub(r'\s+',' ',s).strip()
mdn=norm(md)
paras=re.findall(r'<w:p[ >].*?</w:p>',x,flags=re.S)
segs=[norm(''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>',p))) for p in paras]
segs=[s for s in segs if s]
miss=[s for s in segs if s not in mdn]
print('paragraph segments',len(segs),'missing',len(miss)); [print('  MISSING:',m[:150]) for m in miss[:20]]
tbls=re.findall(r'<w:tbl>.*?</w:tbl>',x,flags=re.S)
rows=0;rowmiss=0
for t in tbls:
  for r in re.findall(r'<w:tr[ >].*?</w:tr>',t,flags=re.S):
    rows+=1
    cells=[norm(''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>',c))) for c in re.findall(r'<w:tc>.*?</w:tc>',r,flags=re.S)]
    if not all(c in mdn for c in cells if c): rowmiss+=1; print('  ROW MISSING:',cells)
print('tables',len(tbls),'rows',rows,'rows with missing cells',rowmiss)
# order check: segments appear in order
pos=0;ooo=0
for s in segs:
  i=mdn.find(s,pos)
  if i<0: ooo+=1
  else: pos=i
print('segments out of order',ooo)
for f in ['header1.xml','header2.xml','footer1.xml','footer2.xml','footnotes.xml','endnotes.xml','comments.xml']:
  try:
    t=norm(' '.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>',open(D+'/word/'+f,encoding='utf8').read())))
    print(f,repr(t[:100]),'present' if (t and t in mdn) else ('empty' if not t else 'ABSENT'))
  except FileNotFoundError: pass
b=json.load(open(MD.replace('playbook.md','playbook.blocks.json'),encoding='utf8'))
bl=b['blocks'] if isinstance(b,dict) else b
ids=[x.get('id') or x.get('block_id') for x in bl]
print('blocks',len(bl),ids[0],ids[-1],'contiguous',ids==[f'B{i:04d}' for i in range(1,166)])
anch=re.findall(r'B\d{4}',md); print('md anchors unique',len(set(anch)))
