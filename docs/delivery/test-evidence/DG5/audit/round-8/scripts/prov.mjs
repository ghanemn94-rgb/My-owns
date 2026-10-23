import {readFileSync,readdirSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
const sha=f=>createHash("sha256").update(readFileSync(f)).digest("hex");
const base="docs/delivery/runs/DG5";
const recs={dom:"docs/delivery/reviews/DG5/round-7/domain-reviewer.json",sec:"docs/delivery/reviews/DG5/round-7/code-security-reviewer.json",qa8:"docs/delivery/reviews/DG5/round-8/qa-verifier.json",qa7:"docs/delivery/reviews/DG5/round-7/qa-verifier.json"};
const sess=new Set();
for(const [k,p] of Object.entries(recs)){const r=JSON.parse(readFileSync(p));const d=`${base}/${r.invocation_reference.run_id}`;const m=JSON.parse(readFileSync(d+"/meta.json"));
 const sb=sha(d+"/sandbox.json"), tr=sha(d+"/transcript.jsonl.gz"), rs=sha(d+"/result.json");
 const recsha=sha(p);
 console.log(k,JSON.stringify({run:m.run_id,role:m.role,task:m.task,sess_match:m.invocation_reference.session_id===r.invocation_reference.session_id&&m.result_session_id===r.invocation_reference.session_id,exit:m.exit_code,is_error:m.is_error,subtype:m.subtype,bash_sb:m.bash_sandbox,proc_sb:m.process_sandbox,sandbox_sha_match:sb===m.process_sandbox_sha256,transcript_match:tr===m.transcript_sha256,result_match:rs===m.result_sha256,record_in_tool_authored:m.tool_authored?.[p]===recsha,ext:m.external_config_changed,discarded:m.process_sandbox_discarded,start:m.started_at,end:m.finished_at,resumes:m.classifier_outage_resumes,assignment:m.assignment,assign_sha_ok:existsSync(m.assignment)&&sha(m.assignment)===m.assignment_sha256}));
 sess.add(r.invocation_reference.session_id);}
console.log("distinct sessions:",sess.size);
console.log("\nAll DG5 review/audit runs (D-082 external_config_changed):");
for(const d of readdirSync(base).sort()){ if(!/REV|AUDIT/.test(d))continue; const f=`${base}/${d}/meta.json`; if(!existsSync(f)){console.log(d,"NO meta.json", readdirSync(`${base}/${d}`).join(","));continue;}
 const m=JSON.parse(readFileSync(f)); const sbf=`${base}/${d}/sandbox.json`;
 console.log(d.replace(/-\d{8}T.*?Z-/,"-…-"),"exit="+m.exit_code,"sub="+m.subtype,"ext="+JSON.stringify(m.external_config_changed),"sb="+(existsSync(sbf)?sha(sbf)===m.process_sandbox_sha256:"nofile"),"proc_sb="+m.process_sandbox);}
