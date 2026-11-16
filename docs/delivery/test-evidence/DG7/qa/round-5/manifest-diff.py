import json,sys
a=json.load(open(sys.argv[1]));b=json.load(open(sys.argv[2]))
def m(x):
    e=x['entries']
    return {(i['path'] if isinstance(i,dict) else i[0]):json.dumps(i,sort_keys=True) for i in e}
A,B=m(a),m(b)
print("old",a['candidate_id'],len(A));print("new",b['candidate_id'],len(B))
print("added",sorted(set(B)-set(A)));print("removed",sorted(set(A)-set(B)))
ch=sorted(k for k in A if k in B and A[k]!=B[k]);print("changed",len(ch),ch)
