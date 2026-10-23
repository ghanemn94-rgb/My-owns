import re,sys,difflib
def norm(p):
    s=open(p,encoding='utf-8').read()
    s=re.sub(r'\d{4}-\d{2}-\d{2}T[\d:.]+Z','TS',s)
    s=re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','UUID',s)
    s=re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{2}','UUIDP',s)
    s=re.sub(r'(probe|DOM-R6[^"\n]*?) [a-z0-9]{8}\b',r'\1 RAND',s)
    s=re.sub(r'\d{1,2} Oct 2026, \d{1,2}:\d{2}','DT',s)
    s=re.sub(r'[٠-٩0-9]{1,2}[/ ‏]*(?:أكتوبر|[٠-٩0-9]{1,2})[/ ‏]*[٠-٩0-9]{4}[،,]? *[٠-٩0-9]{1,2}:[٠-٩0-9]{2}( ?[صم])?','DT',s)
    s=re.sub(r'"(sizeBytes|bytes|length)": ?\d+','"\\1": N',s)
    return s.splitlines()
a,b=norm(sys.argv[1]),norm(sys.argv[2])
d=[l for l in difflib.unified_diff(a,b,lineterm='',n=0) if not l.startswith(('---','+++','@@'))]
print(f"{sys.argv[3]}: {'ids/timestamps only' if not d else 'OTHER DIFF ('+str(len(d))+' lines)'}")
for l in d[:6]: print('   ',l[:200])
