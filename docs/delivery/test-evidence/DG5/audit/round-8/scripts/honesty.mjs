import {readFileSync,existsSync,statSync} from "node:fs";
const recs=["round-7/domain-reviewer.json","round-7/code-security-reviewer.json","round-8/qa-verifier.json","round-7/qa-verifier.json"];
const pat=/(EXIT [1-9]\d*|exit[_ =:]+[1-9]\d*|rc=[1-9]|\b[1-9]\d* failed\b|✘|Timeout \d+ms exceeded|TimeoutError|ELIFECYCLE|Command failed|exit code [1-9]|status [1-9]\d*\b(?! ?\/)|BLOCKED)/i;
for(const p of recs){const path="docs/delivery/reviews/DG5/"+p;const r=JSON.parse(readFileSync(path,"utf8"));const txt=JSON.stringify(r);
 const ev=new Set([...(r.evidence_paths||[]),...r.checks_run.flatMap(c=>c.evidence||[])].map(e=>e.split("#")[0]));
 let missing=0,files=0,hitFiles=[];
 for(const e of ev){ if(!existsSync(e)||!statSync(e).isFile()){missing++;console.log("  MISSING evidence:",e);continue;} files++;
  if(!/\.(log|txt|rc)$/.test(e)) continue;
  const lines=readFileSync(e,"utf8").split("\n");const hits=lines.map((l,i)=>[i+1,l]).filter(([,l])=>pat.test(l));
  if(hits.length){const base=e.split("/").pop();hitFiles.push({e,base,n:hits.length,mentioned:txt.includes(base),sample:hits.slice(0,3).map(([n,l])=>n+":"+l.trim().slice(0,160))});}
 }
 console.log("=== "+p+": evidence entries "+ev.size+", existing files "+files+", missing "+missing+", logs with failure-pattern hits "+hitFiles.length);
 for(const h of hitFiles){console.log(" * "+h.e+" hits="+h.n+" basename_cited_in_record_text="+h.mentioned);for(const s of h.sample)console.log("     "+s);}
}
