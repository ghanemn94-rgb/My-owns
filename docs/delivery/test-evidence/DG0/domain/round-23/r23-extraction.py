import zipfile,re,sys,html,difflib,unicodedata
z=zipfile.ZipFile('docs/source/Business_Transformation_Playbook.docx')
names=[n for n in z.namelist() if re.match(r'word/(document|footer\d*|header\d*)\.xml$',n)]
md=open('docs/source/playbook.md',encoding='utf-8').read()
def norm(s):
    s=unicodedata.normalize('NFKC',html.unescape(s.replace('<br>',' ')))
    s=s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"')
    s=re.sub(r'[*_`#|>\\]',' ',s)
    return re.sub(r'\s+',' ',s).strip()
mdn=norm(md)
paras=[];cells=[]
for n in names:
    x=z.read(n).decode('utf-8')
    for p in re.findall(r'<w:p[ >].*?</w:p>',x,re.S):
        t=''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>',re.sub(r'<w:(br|tab|cr)\b[^>]*/>','<w:t> </w:t>',p)))
        t=norm(t)
        if t: paras.append((n,t))
    for tc in re.findall(r'<w:tc>.*?</w:tc>',x,re.S):
        t=norm(' '.join(''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>',re.sub(r'<w:(br|tab|cr)\b[^>]*/>','<w:t> </w:t>',p))) for p in re.findall(r'<w:p[ >].*?</w:p>',tc,re.S)))
        if t: cells.append(t)
miss=[(n,t) for n,t in paras if t not in mdn]
cmiss=[t for t in cells if t not in mdn]
print('parts',names); print('paragraphs',len(paras),'missing',len(miss)); print('table cells',len(cells),'missing',len(cmiss))
for m in miss[:20]: print('  MISSING P',m)
for m in cmiss[:20]: print('  MISSING C',m)
# token diff whole body
body=norm(' '.join(t for n,t in paras if n=='word/document.xml')).split()
mdt=mdn.split()
sm=difflib.SequenceMatcher(None,body,mdt,autojunk=False)
dels=[(i1,i2) for op,i1,i2,j1,j2 in sm.get_opcodes() if op in('delete','replace')]
print('docx tokens',len(body),'md tokens',len(mdt),'docx tokens not matched in order',sum(i2-i1 for i1,i2 in dels))
for i1,i2 in dels[:15]: print('  ',' '.join(body[i1:i2])[:150])
sys.exit(1 if miss or cmiss else 0)
