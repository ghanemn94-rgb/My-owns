#!/usr/bin/env python3
# qa-verifier DG5 round 3: summarise a Playwright trace.zip extracted into a directory ($1): every test-level API call
# with its start offset and duration (and any call that never finished), then every network request in start order
# (offset from the first request, method, path, status). Used to explain e2e failures (timeouts) in RUN-NOTES.md.
import glob, json, sys, os
from urllib.parse import urlparse
d = sys.argv[1]
ev, net = [], []
for f in glob.glob(os.path.join(d, '*.trace')):
    for line in open(f):
        try: ev.append(json.loads(line))
        except Exception: pass
for f in glob.glob(os.path.join(d, '*.network')):
    for line in open(f):
        try: net.append(json.loads(line))
        except Exception: pass
starts, rows = {}, []
for e in ev:
    if e.get('type') == 'before': starts[e['callId']] = e
    elif e.get('type') == 'after' and e['callId'] in starts:
        b = starts[e['callId']]
        rows.append((b['startTime'], (e['endTime'] - b['startTime']) / 1000, b.get('apiName') or b.get('method'), json.dumps(b.get('params', {}), ensure_ascii=False)[:140], (e.get('error') or {}).get('message', '')[:160]))
done = {e['callId'] for e in ev if e.get('type') == 'after'}
for k, b in starts.items():
    if k not in done: rows.append((b['startTime'], None, 'UNFINISHED ' + str(b.get('apiName') or b.get('method')), json.dumps(b.get('params', {}), ensure_ascii=False)[:140], ''))
rows.sort(key=lambda r: r[0])
t0 = rows[0][0] if rows else 0
print('== test-level calls (pw:api and unfinished), offset from the first call')
for r in rows:
    if r[2] and (r[2].startswith('UNFINISHED') or r[2] == 'pw:api'):
        dur = 'never finished' if r[1] is None else f'{r[1]:6.2f}s'
        print(f"{(r[0]-t0)/1000:7.2f}s {dur} {r[3]} {r[4]}")
print(f'calls: {len(rows)}; longest finished call: {max((r[1] for r in rows if r[1] is not None), default=0):.2f}s')
print('== network requests in start order (offset from the first request)')
items = []
for n in net:
    s = n.get('snapshot', {})
    st = s.get('_monotonicTime') or 0
    items.append((st, s.get('request', {}).get('method'), urlparse(s.get('request', {}).get('url', '')).path + ('?' + urlparse(s.get('request', {}).get('url', '')).query if urlparse(s.get('request', {}).get('url', '')).query else ''), (s.get('response') or {}).get('status')))
items.sort()
n0 = items[0][0] if items else 0
for st, m, p, status in items:
    if '/assets/' in p: continue
    print(f"{(st-n0):8.2f} {m} {p[:110]} -> {status}")
