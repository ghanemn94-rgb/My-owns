import csv,io,subprocess,sys,re
REPO='/home/user/My-owns'
def show(c,p):
  r=subprocess.run(['git','-C',REPO,'show',f'{c}:{p}'],capture_output=True,text=True); return r.stdout if r.returncode==0 else None
def reg(c): return {r['req_id']:r for r in csv.DictReader(io.StringIO(show(c,'docs/delivery/requirements.csv')))}
def cov(c,f): return {r['block_id']:r for r in csv.DictReader(io.StringIO(show(c,f)))}
NEW='e11b5f08dfa8b6cbe8716964e3412e17697234aa'
def f001(c):
  r=reg(c)['REQ-PB-049']; return r['final_gate']=='DG3' and '95%' in r['acceptance']
def f002(c):
  r=reg(c)['REQ-PB-020']; m=show(c,'docs/analysis/permissions-matrix.md')
  tom=[l for l in m.split('\n') if l.startswith('| TOM canvas')][0]
  return ('Go-live / scale' in r['acceptance']+r['notes']) and tom.split('|')[2].strip().startswith('Rv') and 'T11 decision "Go-live / scale"' in m
def f003(c):
  R=reg(c); return all('no interpretation beyond the cited blocks' not in R[k]['notes'] for k in ['REQ-PB-055','REQ-PB-085','REQ-PB-088'])
def f004(c):
  md=show(c,'docs/source/playbook.md'); return 'PRACTICAL EDITION' in md and '<br>' in md
def f005(c):
  g=show(c,'docs/analysis/glossary.md')
  j=[l for l in g.split('\n') if l.startswith('| Journey |')]; mm=[l for l in g.split('\n') if l.startswith('| Modular mode |')]
  return any('الرحلة (رحلة العميل أو رحلة العمل)' in l for l in j) and any('النمط الجزئي المرن' in l for l in mm)
def f006(c):
  R=reg(c); cv=cov(c,'docs/analysis/master-prompt-coverage.csv')
  a='M0348' in R['REQ-PB-088']['source_ref'] and 'REQ-PB-088' in cv['M0348']['req_ids']
  n=R['REQ-PB-068']['notes']; b=re.search(r'Master-prompt additions \(§10 M0212\)',n) is not None and 'Interpretations: none' in n
  return a and b
def f007(c):
  p=show(c,'docs/delivery/agent-protocol.md'); return re.search(r'G6.{0,40}never implies.{0,30}DG7',p) is not None
def f008(c):
  R=reg(c)
  a='M0288' in R['REQ-PB-091']['notes'].split('Interpretations')[0]
  b='M0178' in R['REQ-PB-050']['notes'].split('Interpretations')[0] and 'Master-prompt additions: none' not in R['REQ-PB-050']['notes']
  cc='canonical dependency record' in R['REQ-PB-078']['notes'].split('Interpretations')[0]
  return a and b and cc
checks=[('F-DG0-001',f001,'6c67698'),('F-DG0-002',f002,'6c67698'),('F-DG0-003',f003,'6c67698'),('F-DG0-004',f004,'8c8757a'),('F-DG0-005',f005,'6c67698'),('F-DG0-006',f006,'18588e7'),('F-DG0-007',f007,'eaef1d0'),('F-DG0-008',f008,'f0335fa')]
for fid,fn,old in checks:
  try: o=fn(old)
  except Exception as e: o=f'ERR {e}'
  print(f'{fid}: fixed-at-parent-of-fix({old})={o}  fixed-at-candidate(e11b5f0)={fn(NEW)}')
