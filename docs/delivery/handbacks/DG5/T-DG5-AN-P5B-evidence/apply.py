import csv,io,os,sys
sys.path.insert(0,os.path.dirname(__file__))
from rows import R,B
P='docs/delivery/requirements.csv'
raw=open(P,newline='').read()
rows=list(csv.reader(io.StringIO(raw,newline='')))
h=rows[0];I={k:i for i,k in enumerate(h)}
missing=[];done=set()
for r in rows[1:]:
  rid=r[0]
  if rid in R:
    st,ev,note=R[rid]
    for e in ev:
      if not os.path.isfile(e): missing.append((rid,e))
    assert r[I['final_gate']]=='DG5'
    r[I['status']]=st
    r[I['evidence']]=';'.join(ev)
    sent=f"DG5 analyst check (T-DG5-AN-P5B, base {B}): {note}"
    r[I['notes']]=(r[I['notes']]+' '+sent).strip() if r[I['notes']] else sent
    done.add(rid)
assert done==set(R), set(R)-done
if missing:
  print("MISSING",missing); sys.exit(1)
o=io.StringIO(newline='');csv.writer(o,lineterminator='\n').writerows(rows)
open(P,'w',newline='').write(o.getvalue())
print("updated",len(done))
