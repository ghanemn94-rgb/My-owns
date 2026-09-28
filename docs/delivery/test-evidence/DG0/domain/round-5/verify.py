import csv,io,subprocess,sys,re
REPO='/home/user/My-owns'
def show(rev,path):
  return subprocess.run(['git','-C',REPO,'show',f'{rev}:{path}'],capture_output=True,text=True).stdout
def reg(rev): return {x['req_id']:x for x in csv.DictReader(io.StringIO(show(rev,'docs/delivery/requirements.csv')))}
def checks(rev):
  r=reg(rev); pm=show(rev,'docs/analysis/permissions-matrix.md'); gl=show(rev,'docs/analysis/glossary.md'); md=show(rev,'docs/source/playbook.md'); ap=show(rev,'docs/delivery/agent-protocol.md'); mc=show(rev,'docs/analysis/master-prompt-coverage.csv')
  out={}
  out['F-DG0-001']= r['REQ-PB-049']['final_gate']=='DG3' and '95%' in r['REQ-PB-049']['acceptance']
  out['F-DG0-002']= 'T11' in r['REQ-PB-020']['procedure']+r['REQ-PB-020']['permissions']+r['REQ-PB-020']['notes'] and 'Rv (RACI C for Target Operating Model)' in pm and 'Go-live / scale' in pm
  n55,n85,n88=r['REQ-PB-055']['notes'],r['REQ-PB-085']['notes'],r['REQ-PB-088']['notes']
  out['F-DG0-003']= not any(n.startswith('Source-grounded; no interpretation') for n in (n55,n85,n88)) and 'Interpretation' in n55
  out['F-DG0-004']= 'PRACTICAL EDITION' in md and '6<br>PHASES' in md
  out['F-DG0-005']= '| Journey | الرحلة' in gl and '| Modular mode | النمط الجزئي المرن' in gl
  m348=[l for l in mc.splitlines() if l.startswith('M0348,')][0]
  out['F-DG0-006']= (('M0348' in r['REQ-PB-088']['source_ref'] and 'REQ-PB-088' in m348) or 'M0348' not in n88) and re.search(r'Master-prompt additions[^.]*M0212|Master-prompt additions[^.]*publication',r['REQ-PB-068']['notes']) is not None
  out['F-DG0-007']= re.search(r'G6[^\n]{0,60}never implies[^\n]{0,20}DG7',ap) is not None
  def interp(x): 
    n=r[x]['notes']; i=n.find('Interpretations'); return n[i:] if i>=0 else ''
  out['F-DG0-008']= ('top three' not in interp('REQ-PB-091').lower() and 'three top actions' not in interp('REQ-PB-091').lower()) and 'rather than copying' not in interp('REQ-PB-078') and 'M0178' in r['REQ-PB-050']['notes'] and 'overlapping' not in interp('REQ-PB-050')
  return out
for rev in sys.argv[1:]:
  print(rev, checks(rev))
