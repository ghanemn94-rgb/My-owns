import csv,json,re
A=open('docs/delivery/assignments/DG5/round-5/release-auditor.md').read()
sec=A.split('**The 78 DG5-final requirements:**')[1].split('\n\n')[0]
ids=re.findall(r'`(REQ-[A-Z0-9]+-\d+)`',sec)
rows=[r for r in csv.DictReader(open('docs/delivery/requirements.csv')) if r.get('final_gate')=='DG5']
reg={r['req_id'] for r in rows}
print('assignment ids',len(ids),'unique',len(set(ids)),'register final_gate=DG5',len(reg),'equal',set(ids)==reg)
print('register statuses',sorted({r.get('status') for r in rows}))
def rc(p): return set(json.load(open(p))['requirements_checked'])
qa=rc('docs/delivery/reviews/DG5/round-2/qa-verifier.json'); dom=rc('docs/delivery/reviews/DG5/round-3/domain-reviewer.json'); dom2=rc('docs/delivery/reviews/DG5/round-2/domain-reviewer.json'); sec=rc('docs/delivery/reviews/DG5/round-2/code-security-reviewer.json')
print('coverage qa',len(reg&qa),'domain r3',len(reg&dom),'domain r2',len(reg&dom2),'code-security',len(reg&sec))
bad=[i for i in sorted(reg) if not (i in qa and (i in dom or i in sec))]
print('ids failing qa AND (domain OR code-security):',bad)
