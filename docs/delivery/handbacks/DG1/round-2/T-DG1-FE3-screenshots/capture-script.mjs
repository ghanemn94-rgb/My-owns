import { chromium } from "@playwright/test";
const ORG="01920000-0000-7000-9000-000000000001",BU="01920000-0000-7000-9000-000000000101",U="01920000-0000-7000-9000-000000000201",TR="01920000-0000-7000-9000-000000000301";
const out=process.argv[2];
const me=(loc)=>({user:{id:U,organizationId:ORG,displayName:"Synthetic Test User",email:"synthetic.user@example.invalid",preferredLocale:loc,timezone:null,status:"active",identities:[],version:3,createdAt:"2026-09-01T08:00:00Z",updatedAt:"2026-09-01T08:00:00Z"},authMode:"dev",csrfToken:"c".repeat(43),productName:"Mobily Transformation Hub",organization:{id:ORG,code:"SYN-DEV",nameEn:"Synthetic Organization",nameAr:"جهة اصطناعية",defaultTimezone:"Asia/Riyadh",defaultCurrency:"SAR",defaultLocale:loc,status:"active",version:1,createdAt:"2026-09-01T08:00:00Z",updatedAt:"2026-09-01T08:00:00Z"},assignments:[],effectivePermissions:[{scope:{type:"organization",id:ORG},inheritsDownward:true,permissions:["organization.read","business_unit.read","role.read","transformation.read","transformation.create","transformation.update","transformation.archive","audit.read"]}]});
const tr=(status)=>({id:TR,organizationId:ORG,businessUnitId:BU,code:"TR-0001",name:"Synthetic retail journey",description:null,mode:"modular",entryPhase:"design",standaloneDeliverableType:null,status,currentPhase:"design",sponsorUserId:null,leadUserId:null,timezone:"Asia/Riyadh",currency:"SAR",archivedAt:null,archiveReason:null,version:4,createdAt:"2026-09-30T09:00:00Z",createdBy:U,updatedAt:"2026-09-30T09:00:00Z",updatedBy:U});
const bu={id:BU,organizationId:ORG,parentBusinessUnitId:null,code:"SYN-OPS",nameEn:"Synthetic Operations",nameAr:"العمليات (اصطناعي)",status:"active",version:1,createdAt:"2026-09-01T08:00:00Z",updatedAt:"2026-09-01T08:00:00Z"};
const browser=await chromium.launch();
for (const loc of ["en","ar"]) for (const status of ["active","on_hold"]) {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.addInitScript((l)=>localStorage.setItem("mth.locale",l),loc);
  await page.route("**/api/v1/**",(r)=>{const u=new URL(r.request().url()).pathname;let b;
    if(u.endsWith("/me"))b=me(loc);else if(u.includes("/business-units"))b={items:[bu],nextCursor:null};else if(u.includes("/users"))b={items:[],nextCursor:null};
    else if(u.includes("/audit"))b={items:[],nextCursor:null};else if(/\/transformations\/[^/]+$/.test(u))b=tr(status);else b={items:[],nextCursor:null};
    r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(b)});});
  await page.goto(`http://127.0.0.1:4179/transformations/${TR}/edit`);
  const sel=page.locator("select").first();
  await sel.waitFor();
  const opts=await sel.locator("option").allTextContents();
  const vals=await sel.locator("option").evaluateAll(os=>os.map(o=>o.value));
  const dir=await page.evaluate(()=>document.documentElement.dir);
  // keyboard focus check: tab to the status select
  await sel.focus();
  const focused=await page.evaluate(()=>document.activeElement?.tagName+" "+(document.activeElement?.getAttribute("aria-describedby")??""));
  const path=`${out}/T-DG1-FE3-edit-status-${status}-${loc}.png`;
  await page.screenshot({path,fullPage:true});
  console.log(JSON.stringify({loc,status,dir,values:vals,labels:opts,focused,path}));
  await page.close();
}
await browser.close();
