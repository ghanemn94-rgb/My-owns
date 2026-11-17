// T-DG7-SA-ADR72 evidence script (read-only measurement; run from the repository root).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const SECRET_KEY = "[A-Za-z0-9_.-]*(?:secret(?!ar)|password|passwd|pwd|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|signing[_-]?key)[A-Za-z0-9_.-]*";
const __src = (await import("node:fs")).readFileSync("tools/release/secret-scan.mjs","utf8"); if (!__src.includes(SECRET_KEY)) throw new Error("SECRET_KEY drift");
const ASSIGNMENT = new RegExp(String.raw`(["']?)(${SECRET_KEY})\1\s*(?:=(?![=>])|:(?!:))\s*(?:"([^"\n]*)"|'([^'\n]*)'|`+"`([^`\\n]*)`"+String.raw`|([^\s'"`+"`"+String.raw`,;)}\]]+))`,"gi");
const files = execFileSync("git",["ls-files","-z"],{maxBuffer:1e9}).toString().split("\0").filter(f=>f&&!f.startsWith("trading_agent/"));
const byFile = new Map(); const keys=new Map();
for (const f of files) { let t; try { t = readFileSync(f); } catch { continue; } if (t.subarray(0,8192).includes(0)) continue;
  for (const l of t.toString("utf8").split("\n")) for (const m of l.matchAll(ASSIGNMENT)) { const v=(m[3]??m[4]??m[5]??m[6]??"").trim();
    if (/^[0-9a-f]{64}$/i.test(v)) { byFile.set(f,(byFile.get(f)??0)+1); keys.set(m[2],(keys.get(m[2])??0)+1); } } }
console.log("files with an S3 match whose value is exactly 64 hex:", byFile.size, "matches:", [...byFile.values()].reduce((a,b)=>a+b,0));
const top=[...byFile.entries()].sort((a,b)=>b[1]-a[1]);
const dirs=new Map(); for(const [f,n] of top){const d=f.split("/").slice(0,3).join("/"); dirs.set(d,(dirs.get(d)??0)+n);} console.log("by top dirs:", JSON.stringify([...dirs].sort((a,b)=>b[1]-a[1]).slice(0,12)));
console.log("keys:", JSON.stringify([...keys].sort((a,b)=>b[1]-a[1]).slice(0,15)));
console.log("outside docs/delivery:", top.filter(([f])=>!f.startsWith("docs/delivery/")).map(([f,n])=>f+":"+n).join(" "));
