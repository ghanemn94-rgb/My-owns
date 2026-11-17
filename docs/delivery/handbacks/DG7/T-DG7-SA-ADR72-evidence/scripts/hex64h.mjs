// T-DG7-SA-ADR72 evidence script (read-only measurement; run from the repository root).
import { execFileSync, spawn } from "node:child_process";
const SECRET_KEY = "[A-Za-z0-9_.-]*(?:secret(?!ar)|password|passwd|pwd|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|signing[_-]?key)[A-Za-z0-9_.-]*";
const __src = (await import("node:fs")).readFileSync("tools/release/secret-scan.mjs","utf8"); if (!__src.includes(SECRET_KEY)) throw new Error("SECRET_KEY drift");
const ASSIGNMENT = new RegExp(String.raw`(["']?)(${SECRET_KEY})\1\s*(?:=(?![=>])|:(?!:))\s*(?:"([^"\n]*)"|'([^'\n]*)'|`+"`([^`\\n]*)`"+String.raw`|([^\s'"`+"`"+String.raw`,;)}\]]+))`,"gi");
const objs = execFileSync("git",["rev-list","--objects","HEAD"],{maxBuffer:2e9}).toString().split("\n").filter(Boolean).map(l=>{const i=l.indexOf(" ");return i<0?null:[l.slice(0,i),l.slice(i+1)]}).filter(x=>x&&!x[1].startsWith("trading_agent/"));
const p = spawn("git",["cat-file","--batch"]); let buf=Buffer.alloc(0); const out=[]; let idx=0; const hits=new Map();
p.stdout.on("data",d=>{buf=Buffer.concat([buf,d]); for(;;){const nl=buf.indexOf(10); if(nl<0) return; const h=buf.subarray(0,nl).toString().split(" "); if(h[1]!=="blob"&&h[1]!==undefined&&h.length===3&&h[1]!=="blob"){const n=+h[2]; if(buf.length<nl+1+n+1) return; buf=buf.subarray(nl+1+n+1); idx++; continue;} if(h[1]==="missing"){buf=buf.subarray(nl+1); idx++; continue;} const n=+h[2]; if(buf.length<nl+1+n+1) return; const body=buf.subarray(nl+1,nl+1+n); buf=buf.subarray(nl+1+n+1); const path=objs[idx++][1];
 if(n<20*1024*1024 && !body.subarray(0,8192).includes(0)) for(const l of body.toString("utf8").split("\n")) for(const m of l.matchAll(ASSIGNMENT)){const v=(m[3]??m[4]??m[5]??m[6]??"").trim(); if(/^[0-9a-f]{64}$/i.test(v)) hits.set(path,(hits.get(path)??0)+1);} }});
p.on("close",()=>{console.log("history objects:",objs.length,"paths with a 64-hex S3 value in some blob:",hits.size,"matches:",[...hits.values()].reduce((a,b)=>a+b,0)); console.log([...hits].slice(0,20).map(([f,n])=>f+":"+n).join("\n"));});
for(const [o] of objs) p.stdin.write(o+"\n"); p.stdin.end();
