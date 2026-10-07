# domain-reviewer DG2 round 16: static invariants and delta, run in the disposable clone at the candidate.
cd $TMPDIR/review-dom-r16
echo "### manifest delta vs round-15 candidate 3f01c610 (files whose sha differs / added / removed):"
node -e '
const a=require("/home/user/My-owns/docs/delivery/candidates/DG2/3f01c61090435f11.manifest.json"), b=require("/home/user/My-owns/docs/delivery/candidates/DG2/0cab0a8c37924ead.manifest.json");
const m=(x)=>{const f=x.files||x.entries||x; const o={}; for(const e of (Array.isArray(f)?f:Object.entries(f).map(([path,sha])=>({path,sha})))) o[e.path]=e.sha256||e.sha||e.hash; return o;};
const A=m(a),B=m(b); for(const k of new Set([...Object.keys(A),...Object.keys(B)])) if(A[k]!==B[k]) console.log((A[k]?(B[k]?"changed ":"removed "):"added   ")+k);'
echo "### product (non-docs) files changed ed80b234 (round-15 source)..e3b2375a (round-16 source):"; git diff --name-only ed80b234 e3b2375a -- . ':!docs'
echo "### non-web product changes (expect none):"; git diff --name-only ed80b234 e3b2375a -- . ':!docs' ':!apps/web'; echo "(end)"
echo "### i18n changes (expect none):"; git diff --name-only ed80b234 e3b2375a -- apps/web/src/i18n; echo "(end)"
echo "### migrations / methodology catalogue changes (expect none):"; git diff --name-only ed80b234 e3b2375a -- packages/db apps/api packages/shared; echo "(end)"
echo "### i18n keys parity EN vs AR:"
node -e '
const fs=require("fs"),p="apps/web/src/i18n/";const flat=(o,pre="")=>Object.entries(o).flatMap(([k,v])=>typeof v==="object"&&v?flat(v,pre+k+"."):[pre+k]);
let miss=[],extra=[];for(const f of fs.readdirSync(p+"en")){const e=flat(JSON.parse(fs.readFileSync(p+"en/"+f))),a=new Set(flat(JSON.parse(fs.readFileSync(p+"ar/"+f))));for(const k of e)if(!a.has(k))miss.push(f+":"+k);}
console.log("EN keys missing in AR:",miss.length,JSON.stringify(miss));'
echo "### certification/official claims in user-facing i18n (expect only negations):"; grep -rniE "certif|official|PMI" apps/web/src/i18n | cut -c1-260
echo "### float/real/double columns in migrations (expect 0):"; grep -ciE "\b(real|double precision|float)\b" packages/db/migrations/*.sql | awk -F: '{s+=$2} END {print s}'
echo "### provisional brand token:"; grep -n "0078FF\|provisional" packages/design-tokens/src/tokens.json | head -4 | cut -c1-220
echo "### DG0-DG7 mentions in product source outside comments asserting separation (excluding F-DGx-/T-DGx- ids):"; grep -rnE "\bDG[0-7]\b" apps packages --include=*.ts --include=*.tsx --include=*.sql --exclude-dir=node_modules --exclude-dir=dist | grep -vE "[FT]-DG[0-7]-|\.test\.tsx?:|/test/" | cut -c1-220
echo "### DG references in user-facing i18n (expect none):"; grep -rnE "\bDG[0-7]\b" apps/web/src/i18n; echo "(end)"
echo "### apiRequest generation check on every exit path (client.ts):"; grep -n "SessionChangedError(sentGeneration" apps/web/src/api/client.ts
