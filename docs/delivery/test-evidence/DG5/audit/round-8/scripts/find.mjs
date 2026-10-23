import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const F=JSON.parse(readFileSync("docs/delivery/findings.json","utf8"));
const arr=Array.isArray(F)?F:(F.findings||[]);
const dg5=arr.filter(f=>/^F-DG5-/.test(f.id||f.finding_id));
console.log("keys sample:",Object.keys(dg5[0]).join(","));
console.log("DG5 findings:",dg5.length);
const st={};const sev={};let bad=[];
const SRC="12dc33e4f9f2f804aeb0a9774a988d699709a235";
for(const f of dg5){st[f.status]=(st[f.status]||0)+1;sev[f.severity]=(sev[f.severity]||0)+1;
 const id=f.id||f.finding_id;
 if(f.status==="CLOSED_VERIFIED"){
   const rev=f.fix_revision; let anc="none", full=/^[0-9a-f]{40}$/.test(rev||"");
   if(rev){try{execFileSync("git",["merge-base","--is-ancestor",rev,SRC]);anc="yes"}catch{anc="NO"}}
   const vb=f.verified_by||f.verification?.verified_by||f.verifications?.map?.(v=>v.reviewer_role||v.role);
   const owner=f.owner||f.owner_role||f.assigned_to;
   const vbs=JSON.stringify(vb);
   const selfv= owner && vbs && vbs.includes(String(owner));
   if(anc!=="yes"||!full||selfv) bad.push(id);
   console.log(id,f.severity,"mand="+f.mandatory_violation,"CLOSED_VERIFIED","fix="+(rev||"").slice(0,12),"full="+full,"ancestor="+anc,"owner="+JSON.stringify(owner),"verified_by="+vbs);
 } else {
   const ok= f.status==="ACCEPTED_OBSERVATION" && f.severity==="Low" && f.mandatory_violation===false;
   if(!ok) bad.push(id);
   console.log(id,f.severity,"mand="+f.mandatory_violation,f.status,"owner="+JSON.stringify(f.owner||f.owner_role),"acceptances="+JSON.stringify(f.acceptances||f.accepted_by||f.verifications||null).slice(0,400));
 }
}
console.log("status",st,"severity",sev);
console.log("non-terminal or defective:",bad);
const open=dg5.filter(f=>!["CLOSED_VERIFIED","ACCEPTED_OBSERVATION"].includes(f.status));
console.log("unresolved Critical/High:",open.filter(f=>/Critical|High/.test(f.severity)).length,"unresolved mandatory:",open.filter(f=>f.mandatory_violation).length);
