import re,sys,difflib
def norm(p):
    s=open(p,encoding='utf-8').read()
    s=re.sub(r'\d{4}-\d{2}-\d{2}T[\d:.]+Z','TS',s)
    s=re.sub(r'"requestId": "[^"]+"','RID',s)
    s=re.sub(r'\d{1,2} Oct 2026, \d{1,2}:\d{2}','DT',s)
    s=re.sub(r'[٠-٩0-9]{1,2}[/ ‏]*(?:أكتوبر|[٠-٩0-9]{1,2})[/ ‏]*[٠-٩0-9]{4}[،,]? *[٠-٩0-9]{1,2}:[٠-٩0-9]{2}( ?[صم])?','DT',s)
    return s.splitlines()
a,b=norm(sys.argv[1]),norm(sys.argv[2])
d=[l for l in difflib.unified_diff(a,b,lineterm='',n=0) if not l.startswith(('---','+++','@@'))]
print(f"{sys.argv[3]}: {'timestamps only' if not d else 'OTHER DIFF ('+str(len(d))+' lines)'} [{len(a)} vs {len(b)} lines]")
for l in d[:8]: print('   ',l[:160])
