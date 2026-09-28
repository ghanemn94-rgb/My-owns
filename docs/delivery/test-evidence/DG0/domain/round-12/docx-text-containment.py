import re,zipfile,sys,html
z=zipfile.ZipFile(sys.argv[1])
def paras(xml):
    out=[]
    for p in re.findall(r'<w:p[ >].*?</w:p>',xml,re.S):
        p=re.sub(r'<w:tab/>',' ',p); p=re.sub(r'<w:br/>',' ',p)
        t=''.join(re.findall(r'<w:t(?: [^>]*)?>(.*?)</w:t>',p,re.S))
        t=html.unescape(t)
        if t.strip(): out.append(t)
    return out
def norm(s):
    s=s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"')
    s=re.sub(r'<br\s*/?>',' ',s)
    s=re.sub(r'[\*\|#`_>\\]',' ',s)
    return re.sub(r'\s+',' ',s).strip().lower()
md=norm(open(sys.argv[2],encoding='utf8').read())
tot=miss=0
for part in ['word/document.xml','word/footer1.xml']:
    for t in paras(z.read(part).decode('utf8')):
        tot+=1
        n=norm(t)
        if n not in md:
            miss+=1; print('MISSING',part,repr(t[:120]))
print('paragraphs',tot,'missing',miss)
x=z.read('word/document.xml').decode('utf8')
print('tables',len(re.findall(r'<w:tbl>',x)),'rows',len(re.findall(r'<w:tr[ >]',x)))
