# T01-T16 columns and value lists: verbatim presence in register rows and field-inventory.md.
import csv, re, sys
md = open('docs/source/playbook.md', encoding='utf-8').read()
fi = open('docs/analysis/field-inventory.md', encoding='utf-8').read()
reg = {r['req_id']: r for r in csv.DictReader(open('docs/delivery/requirements.csv', encoding='utf-8'))}
def header(block):
    m = re.search(r'<!-- %s table -->\n\| (.*?) \|\n' % block, md)
    return [c.strip() for c in m.group(1).split(' | ')]
T = {'T01':('B0031','REQ-PB-026'),'T02':('B0050','REQ-PB-034'),'T03':('B0058','REQ-PB-039'),'T04':('B0065','REQ-PB-043'),
     'T05':('B0072','REQ-PB-045'),'T06':('B0076','REQ-PB-047'),'T07':('B0079','REQ-PB-050'),'T08':('B0081','REQ-PB-051'),
     'T09':('B0087','REQ-PB-056'),'T10':('B0095','REQ-PB-062'),'T11':('B0099','REQ-PB-065'),'T12':('B0101','REQ-PB-067'),
     'T13':('B0107','REQ-PB-070'),'T14':('B0123','REQ-PB-075'),'T15':('B0128','REQ-PB-079'),'T16':('B0130','REQ-PB-081')}
bad = 0
for t,(b,rq) in T.items():
    cols = header(b)
    if t == 'T05':  # field/fill-in table: fields are the first column of each row
        tbl = re.search(r'<!-- B0072 table -->\n(.*?)\n\n', md, re.S).group(1).splitlines()[2:]
        cols = [l.split(' | ')[0].lstrip('| ').strip() for l in tbl]
    inreg = [c for c in cols if c not in reg[rq]['input_fields']]
    infi = [c for c in cols if c not in fi]
    print(f'{t} {b} {rq} cols={len(cols)} missing_in_register={inreg} missing_in_field_inventory={infi}')
    bad += len(inreg) + len(infi)
vals = {'H/M/L (T01)':('REQ-PB-026',['H / M / L']), 'T13 stance/intervention':('REQ-PB-070',['H/M/L','Support / Neutral / Resist','Comms / training / involvement / incentive']),
 'T08 types':('REQ-PB-052',['Decision','Tech','Data','Vendor']), 'T15 types':('REQ-PB-079',['Risk','Assumption','Issue','Dependency','R01','A01','I01','D01']),
 'T12 A/R':('REQ-PB-067',['A/R']), 'T06 weights':('REQ-PB-048',['25%','25%','20%','15%','15%','1-5']),
 'T07 horizons':('REQ-PB-050',['0-6 weeks','1-3 months','3-9 months','6-18 months']),
 'T11 SLAs':('REQ-PB-065',['5 working days','Next SteerCo / urgent route','10 working days','Per release plan']),
 'T10 RAG':('REQ-PB-063',['target trajectory, not activity completion','validated benefit gap','milestone + outcome risk','decision date / critical path','adoption curve']),
 'T10 decisions':('REQ-PB-064',['Red','overdue']),'T14 status':('REQ-PB-075',['R/A/G','B01']),'T16 ids':('REQ-PB-081',['DEC-01','A/B/C']),'T04':('REQ-PB-043',['D-01','A / B / C','Open'])}
for k,(rq,vs) in vals.items():
    row = ' '.join(reg[rq].values())
    miss = [v for v in vs if v not in row]
    print(f'{k} {rq} missing={miss}'); bad += len(miss)
# wave entry/exit and T11 roles verbatim in field inventory
for s in ['Sponsor + charter','Approved case, owners, stage gates','Prioritized initiatives','Measured pilot results','Evidence + capacity','Adoption + KPI movement','Stable solution','Benefits sustained, ownership transferred',
          'Transformation Lead + Finance','Business owners / Finance','Tech / Ops / CX / Finance','Risk / Tech / CX','Design owner','Initiative owner']:
    ok = s in fi
    print(('OK ' if ok else 'MISSING ') + 'field-inventory: ' + s); bad += (not ok)
print('problems', bad); sys.exit(1 if bad else 0)
