import json,sys
b=json.load(open('docs/source/playbook.blocks.json')); b=b['blocks'] if isinstance(b,dict) else b
bl={x['id']:x for x in b}
for k in sys.argv[1:]: print(k,json.dumps(bl[k].get('rows') or bl[k].get('text'),ensure_ascii=False)[:1500]);print()
