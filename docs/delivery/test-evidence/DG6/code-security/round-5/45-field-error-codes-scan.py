import re,os,json,glob
root='/home/user/My-owns'
def keys(lang):
    ks=set()
    def flat(d,p=''):
        for k,v in d.items():
            if isinstance(v,dict): flat(v,p+k+'.')
            else: ks.add(p+k)
    for f in glob.glob(root+f'/apps/web/src/i18n/{lang}/*.json'):
        flat({os.path.basename(f)[:-5]:json.load(open(f))})
    return ks
en,ar=keys('en'),keys('ar')
CODE=r'[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)+'
out={}
for dp,dn,fn in os.walk(root+'/apps/api/src/modules'):
    for n in fn:
        if not n.endswith('.ts') or n.endswith('.test.ts'): continue
        p=os.path.join(dp,n); t=open(p).read()
        for m in re.finditer(r'problems\.validation\(\s*\[',t):
            w=t[m.end():m.end()+1500]
            # cut at matching "])"
            e=w.find('])'); w=w[:e if e>0 else len(w)]
            for c in re.finditer(r'\bcode:\s*["\'](%s)["\']'%CODE,w):
                ln=t[:m.start()].count('\n')+1
                out.setdefault(c.group(1),f'{os.path.relpath(p,root)}:{ln}')
miss=[(c,f) for c,f in sorted(out.items()) if 'problems.'+c.replace('.','__') not in en]
print(len(out),'field-error codes inside problems.validation([...]);',len(miss),'with no problems.<key> in en (fieldErrorMessage falls back to problems.validation__invalid):')
for c,f in miss: print(' ',c,f, '| ar:', 'problems.'+c.replace('.','__') in ar)
