import csv,io,subprocess,re,sys
def show(c,p): return subprocess.run(['git','show',f'{c}:{p}'],capture_output=True,text=True).stdout
def reg(c): return {r['req_id']:r for r in csv.DictReader(io.StringIO(show(c,'docs/delivery/requirements.csv')))}
def cov(c): return {r['block_id']:r for r in csv.DictReader(io.StringIO(show(c,'docs/analysis/master-prompt-coverage.csv')))}
NEW='53f5d176dfaa913baa61b34c0aa4fe5fd9a788b5'
def rep(tag,c):
  R=reg(c); pm=show(c,'docs/analysis/permissions-matrix.md'); md=show(c,'docs/source/playbook.md'); gl=show(c,'docs/analysis/glossary.md'); ap=show(c,'docs/delivery/agent-protocol.md'); C=cov(c)
  g=lambda k,f: R.get(k,{}).get(f,'<absent>')
  print(f'==== {tag} {c[:10]}')
  print('F-001 REQ-PB-049 final_gate',g('REQ-PB-049','final_gate'),'| REQ-PB-093 final_gate',g('REQ-PB-093','final_gate'),'| PB-049 acc has 95%:', '95%' in g('REQ-PB-049','acceptance'))
  print('F-002 PB-020 perms mention T11:', 'T11' in g('REQ-PB-020','permissions')+g('REQ-PB-020','notes'),'| matrix Go-live row:', bool(re.search(r'T11 decision "Go-live / scale"',pm)),'| SP Rv on TOM row:', bool(re.search(r'\| TOM canvas[^|]*\| Rv',pm)))
  print('F-003 boilerplate "no interpretation beyond" in PB-055/085/088:',[k for k in ['REQ-PB-055','REQ-PB-085','REQ-PB-088'] if 'no interpretation beyond' in g(k,'notes')])
  print('F-004 footer in playbook.md:', 'PRACTICAL EDITION' in md,'| <br> present:', md.count('<br>'))
  print('F-005 glossary Journey row:', re.findall(r'\n\| Journey \| ([^|]*)\|',gl)[-1:] ,'| Modular mode:', re.findall(r'\n\| Modular mode \| ([^|]*)\|',gl)[-1:])
  print('F-006 PB-088 cites M0348:', 'M0348' in g('REQ-PB-088','source_ref'),'| M0348 cov lists PB-088:', 'REQ-PB-088' in C.get('M0348',{}).get('req_ids',''),'| PB-068 notes additions has M0212:', bool(re.search(r'Master-prompt additions[^.]*M0212',g('REQ-PB-068','notes'))))
  print('F-007 agent-protocol G6/DG7 sentence:', bool(re.search(r'G6.{0,40}never implies.{0,40}DG7',ap)))
  for k in ['REQ-PB-050','REQ-PB-078','REQ-PB-091']:
    n=g(k,'notes'); i=n.find('Interpretations'); print('F-008',k,'| additions:',n[n.find('Master-prompt additions'):i][:150],'| INTERP:',n[i:i+170])
rep(sys.argv[1],sys.argv[2])
