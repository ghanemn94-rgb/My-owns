// T-DG7-SA-ADR72 evidence script (read-only measurement; run from the repository root).
import { readFileSync } from "node:fs";
import { isI18nKey, entropy } from "../../../../../../tools/release/secret-scan.mjs";
const src = readFileSync("tools/release/secret-scan.mjs","utf8");
const SECRET_KEY = "[A-Za-z0-9_.-]*(?:secret(?!ar)|password|passwd|pwd|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|signing[_-]?key)[A-Za-z0-9_.-]*";
if(!src.includes(SECRET_KEY)) throw new Error("SECRET_KEY drift");
const ASSIGNMENT = new RegExp(String.raw`(["']?)(${SECRET_KEY})\1\s*(?:=(?![=>])|:(?!:))\s*(?:"([^"\n]*)"|'([^'\n]*)'|`+"`([^`\\n]*)`"+String.raw`|([^\s'"`+"`"+String.raw`,;)}\]]+))`,"gi");
const PLACEHOLDER=/^(?:%[sd]|\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|<[^>]*>|\*{3,}|\[REDACTED\]|…|\.\.\.|\{\{[^}]*\}\})$|^\$\{|^<.*>$/i;
const T=[[1,v=>v.length<16],[2,v=>/\s/.test(v)],[3,v=>/\$\{|\$[A-Za-z_]/.test(v)],[4,v=>/^[[{]/.test(v)],[5,v=>v.startsWith("mth-canary-")],[6,v=>/synthetic|example|not-a-secret|not-used|dummy|placeholder/i.test(v)],[7,v=>PLACEHOLDER.test(v)],[8,v=>/^process\.env\b|^import\.meta\.env\b|^env\./.test(v)],[9,(v,k)=>/^\/run\/secrets\//.test(v)||/_FILE$|File$/i.test(k)],[10,v=>/^[0-9a-f]{64}$/i.test(v)||/^sha256:[0-9a-f]+$/i.test(v)||/^sha512-[A-Za-z0-9+/=]+$/.test(v)],[11,v=>/^[A-Z][A-Z0-9_]+$/.test(v)],[12,v=>isI18nKey(v)],[13,v=>/^(?:\\0)?[a-z][a-z0-9_-]*(?:[.:/][a-z0-9][a-z0-9_-]*)+$/.test(v)]];
const show=(name,text,code)=>text.split("\n").forEach((l,i)=>{for(const m of l.matchAll(ASSIGNMENT)){const v=(m[3]??m[4]??m[5]??m[6]??"").trim();if(m[6]!==undefined&&code){console.log(name,i+1,"exception1");continue}const t=T.find(([,f])=>f(v,m[2]));console.log(name,i+1,m[2],JSON.stringify(v.slice(0,20)),t?"test "+t[0]:"later/entropy "+entropy(v).toFixed(2))}});
show("fixture",readFileSync("tools/release/tests/fixtures/secrets/non-matches.txt","utf8"),false);
show("code",['const token = request.headers.authorization;','const RESTRICTED_TOKEN_TAG_DOMAIN = "mth.automation.restricted-token.v1";','const secretKeyName = "MTH_S3_SECRET_ACCESS_KEY_NAME";','secretary_user_id: body.secretary_user_id ?? null,'].join("\n"),true);
