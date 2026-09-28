import re,sys,zipfile,unicodedata
from xml.etree import ElementTree as ET
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
S=sys.argv[1]
def norm(s):
    s=unicodedata.normalize('NFKC',s)
    s=s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"')
    return re.sub(r'\s+',' ',s).strip()
def ptext(p):
    out=[]
    for el in p.iter():
        if el.tag==W+'t': out.append(el.text or '')
        elif el.tag in (W+'br',W+'tab',W+'cr'): out.append(' ')
    return ''.join(out)
units=[]
for part in ['word/document.xml']+[f'word/{n}' for n in __import__('os').listdir(S+'/docx/word') if re.match(r'(header|footer)\d*\.xml',n)]:
    root=ET.parse(S+'/docx/'+part).getroot()
    for p in root.iter(W+'p'):
        t=norm(ptext(p))
        if t: units.append((part,t))
md=open(S+'/new/docs/source/playbook.md',encoding='utf-8').read()
# normalize markdown: remove md syntax
m=md
m=re.sub(r'<br\s*/?>',' ',m)
m=re.sub(r'\{#B\d+\}|<a[^>]*></a>|<!--.*?-->',' ',m,flags=re.S)
m=m.replace('\\|','|').replace('**','').replace('\\*','*').replace('\\_','_').replace('\\#','#')
m=re.sub(r'[`]','',m)
m=norm(m.replace('|',' '))
def strip(s): return re.sub(r'[\*_#\\|`]','',s)
mm=re.sub(r'\s+',' ',strip(m))
miss=[]
for part,t in units:
    if re.sub(r'\s+',' ',strip(t)) not in mm: miss.append((part,t))
print('units',len(units),'missing',len(miss))
for x in miss[:40]: print(x)
