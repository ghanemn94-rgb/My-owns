import csv,io,os,subprocess,sys
sys.path.insert(0,os.path.dirname(__file__))
from rows import R
P='docs/delivery/requirements.csv'
cur=open(P,newline='').read()
base=subprocess.run(['git','show','HEAD:'+P],capture_output=True,text=True,check=True).stdout
def parse(t): return list(csv.reader(io.StringIO(t,newline='')))
c,b=parse(cur),parse(base)
print("CSV parse: rows",len(c),"column counts",sorted(set(map(len,c))),"header unchanged",c[0]==b[0])
o=io.StringIO(newline='');csv.writer(o,lineterminator='\n').writerows(c);print("re-serialises byte-identically:",o.getvalue()==cur)
bi={r[0]:r for r in b[1:]};ci={r[0]:r for r in c[1:]}
print("same req_id set and order:",[r[0] for r in b]==[r[0] for r in c])
h=c[0];changed=[k for k in ci if ci[k]!=bi[k]]
print("rows changed:",len(changed),"all mine:",set(changed)==set(R))
keep=['req_id','class','title','source_ref','acceptance','increments','final_gate']
bad=[(k,f) for k in changed for i,f in enumerate(h) if f in keep and ci[k][i]!=bi[k][i]]
print("protected columns changed:",bad)
cols=set(f for k in changed for i,f in enumerate(h) if ci[k][i]!=bi[k][i]);print("columns touched:",sorted(cols))
pre=[k for k in changed if not ci[k][h.index('notes')].startswith(bi[k][h.index('notes')])];print("notes not preserved as prefix:",pre)
n=0;miss=[]
for k in R:
  for e in ci[k][h.index('evidence')].split(';'):
    n+=1
    if not os.path.isfile(e): miss.append((k,e))
print("evidence paths checked:",n,"missing:",miss)
from collections import Counter
print("status of my rows:",Counter(ci[k][h.index('status')] for k in R))
