import re,glob,sys,collections
cols=collections.defaultdict(set)
for f in sorted(glob.glob(sys.argv[1]+'/*.sql')):
    s=open(f).read()
    for m in re.finditer(r'CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\((.*?)\n\);',s,re.S|re.I):
        for c in re.finditer(r'^\s*(\w+)\s',m.group(2),re.M): cols[m.group(1)].add(c.group(1))
    for m in re.finditer(r'ALTER TABLE\s+(?:ONLY\s+)?(?:IF EXISTS\s+)?(\w+)([^;]*);',s,re.S|re.I):
        for c in re.finditer(r'ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)',m.group(2),re.I): cols[m.group(1)].add(c.group(1))
for t in sorted(cols):
    out=[]
    for k in ('name','label'):
        en=[c for c in (k+'_en','source_'+k+'_en') if c in cols[t]]
        if en and k+'_ar' in cols[t]: out.append(en[0]+'/'+k+'_ar')
    if out: print(t, ' '.join(out))
