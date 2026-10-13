#!/usr/bin/env bash
# domain-reviewer DG4 round 9: check D-136's factual claims (B1-B4) against the records at the freeze commit (repo working tree, read-only).
set -u
cd /home/user/My-owns; export PATH=/opt/nvm/versions/node/v24.21.0/bin:/usr/bin:/bin
echo "### HEAD $(git rev-parse HEAD)"
node - <<'JS'
const fs=require('fs');const st=JSON.parse(fs.readFileSync('docs/delivery/stages.json','utf8'));
const stages=Array.isArray(st.stages)?st.stages:Object.values(st.stages);const s=stages.find(x=>(x.id||x.stage_id)==='DG4');
console.log('### B4: review_rounds frozen_at vs manifest');
for(const r of (s.review_rounds||[])){let m=null;const p=`docs/delivery/candidates/DG4/${(r.candidate_id||'').replace('sha256:','').slice(0,16)}.manifest.json`;
 if(fs.existsSync(p)){m=JSON.parse(fs.readFileSync(p,'utf8'));}
 console.log(` round ${r.round} cand ${(r.candidate_id||'').slice(7,15)} src ${(r.source_commit||'').slice(0,7)} frozen_at ${r.frozen_at} manifest ${m?m.frozen_at||m.created_at:'(no manifest)'} ${m&&(m.frozen_at||m.created_at)===r.frozen_at?'EQUAL':'DIFF'} records=${(r.records||[]).length}${r.round===8?' '+JSON.stringify(r.records):''}`);}
if(s.candidate) console.log(' stage candidate',JSON.stringify({id:s.candidate.candidate_id||s.candidate.id,frozen_at:s.candidate.frozen_at,src:s.candidate.source_commit}));
const f=JSON.parse(fs.readFileSync('docs/delivery/findings.json','utf8'));const a=f.findings||f;
const dg4=a.filter(x=>x.stage_id==='DG4');const by={};for(const x of dg4){by[x.status]=(by[x.status]||[]);by[x.status].push(x.id)}
console.log('### B2: DG4 findings by status');for(const k in by)console.log(' ',k,by[k].length,by[k].join(','));
const fp=dg4.filter(x=>x.status==='FIXED_PENDING_VERIFICATION');
console.log('  FPV with full 40-hex fix_revision:',fp.filter(x=>/^[0-9a-f]{40}$/.test(x.fix_revision||'')).length,'of',fp.length);
const crit=dg4.filter(x=>['Critical','High'].includes(x.severity)||x.mandatory_violation);console.log('  Critical/High/mandatory:',crit.map(x=>x.id+':'+x.status).join(' '));
JS
echo "### B1: decisions.md in round-9 manifest includes D-135 and D-136"
grep -c "^| D-135 \|^| D-136 " docs/delivery/decisions.md
node -e 'const m=require("./docs/delivery/candidates/DG4/18c18fe4eda7cbc1.manifest.json");const f=m.files||m.entries;const e=Array.isArray(f)?f.find(x=>(x.path||x[0])==="docs/delivery/decisions.md"):f["docs/delivery/decisions.md"];console.log(" manifest decisions.md entry",JSON.stringify(e))'
echo " sha256 at f2ae717: $(git show f2ae717:docs/delivery/decisions.md | sha256sum | cut -c1-64)"
echo "### B3: write-once runs present at HEAD for the 33 restored paths"
miss=0; while read -r oc mode blob path; do [ "$oc" = "#" ] && continue; [ "$(git rev-parse HEAD:"$path" 2>/dev/null)" = "$blob" ] || { miss=$((miss+1)); echo " MISSING/CHANGED $path"; }; done < <(grep -v '^#' docs/delivery/test-evidence/DG4/history-rewrite-D-136.restored-paths.txt); echo " restored paths not at their original blob at HEAD: $miss"
echo "### DG0-DG3 untouched: DG3 gate commit bc8f455 is ancestor of eda5588's new id and of HEAD"
git merge-base --is-ancestor bc8f455 69d2704187eaee18c76e7f43e17d2f5f8254bae1 && echo " bc8f455 ancestor of new eda5588 (69d2704): yes"
git merge-base --is-ancestor bc8f455 origin/backup/pre-dg4-writeonce-repair-72c0e653a3 2>/dev/null || git merge-base --is-ancestor bc8f455 backup/pre-dg4-writeonce-repair-72c0e653a3 && echo " bc8f455 ancestor of backup ref: yes (shared, unrewritten)"
