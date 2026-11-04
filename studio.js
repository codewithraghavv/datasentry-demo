import {parseCSV,numeric,simulate,analyze} from "./checks.js";
const $=id=>document.getElementById(id);
let input,second,mode="single",result,stageFilter="",generation=0;
const specs={drop:["Loss (%)",10,60,5,25],duplicate:["Duplicates (%)",5,40,5,15],value:["Multiplier",2,10,.5,5],stale:["Shift (days)",30,180,15,90]};
const num=n=>n.toLocaleString("en-US",{maximumFractionDigits:2});
const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const show=(id,on)=>$(id).hidden=!on;
function activate(selector,attr,value){document.querySelectorAll(selector).forEach(b=>b.setAttribute("aria-current",String(b.dataset[attr]===value)));}
function step(s){for(const id of ["data","scenario","results"])show(id,s===id);activate("#steps button","step",s);$("notice").textContent="";window.scrollTo(0,0);}
function view(v){for(const id of ["overview","lineage","records","datasets"])show(id,v===id);activate("#tabs button","view",v);}
function stale(){result=null;document.querySelector('[data-step="results"]').disabled=true;}
function table(target,headers,rows){
  const t=document.createElement("table"),head=t.createTHead().insertRow(),body=t.createTBody();
  headers.forEach(h=>head.append(node("th",h)));for(const r of rows){const tr=body.insertRow();r.forEach(v=>tr.insertCell().textContent=v);}
  $(target).replaceChildren(t);
}
function mapping(data,target){
  const box=$(target);box.replaceChildren();data.map={};
  const patterns={id:/^(order[_ ]?id|record[_ ]?id|id)$/i,amount:/^(order[_ ]?amount|amount|value|price|revenue)$/i,date:/^(order[_ ]?date|date|timestamp)$/i};
  for(const [role,regex] of Object.entries(patterns)){
    const label=node("label",{id:"Record ID",amount:"Amount",date:"Date / timestamp"}[role]),s=document.createElement("select");
    s.add(new Option(role==="id"?"Select ID column":"Skip this check","-1"));
    data.headers.forEach((h,i)=>s.add(new Option(h,i)));data.map[role]=data.headers.findIndex(h=>regex.test(h));s.value=data.map[role];
    s.onchange=()=>{data.map[role]=Number(s.value);stale();};label.append(s);box.append(label);
  }
}
function validateMap(d){if(!d||d.map.id<0)throw Error("Choose a record ID for each input file.");
  const chosen=Object.values(d.map).filter(i=>i>=0);if(new Set(chosen).size!==chosen.length)throw Error("Choose a different column for each role.");}
function use(data,name){
  input={...data,name};second=null;stale();$("after").value="";$("afterName").textContent="";$("afterMapping").replaceChildren();
  $("filename").textContent=name+" · "+num(input.rows.length)+" records";mapping(input,"mapping");show("setup",true);
  table("inputPreview",input.headers,input.rows.slice(0,5));$("limit").max=input.rows.length;$("limit").value=input.rows.length;
  $("context").textContent=$("filename").textContent;document.querySelector('[data-step="scenario"]').disabled=false;
  $("notice").textContent="";$("setup").scrollIntoView({block:"nearest"});
}
function guard(fn){return async()=>{try{await fn();}catch(e){$("notice").textContent=e.message;$("notice").scrollIntoView({block:"nearest"});}};}
async function fileData(file){if(!file||file.size>10*1024*1024)throw Error("Choose a CSV smaller than 10 MB.");return parseCSV(await file.text());}
$("upload").onchange=guard(async()=>{const f=$("upload").files[0];if(!f)return;const g=++generation;const d=await fileData(f);if(g===generation)use(d,f.name);$("upload").value="";});
$("sample").onclick=guard(async()=>{const g=++generation;const r=await fetch("orders.csv");if(!r.ok)throw Error("Sample orders could not be loaded. Retry or upload a CSV.");const d=parseCSV(await r.text());if(g===generation){use(d,"Sample orders");setMode("simulate");}});
$("after").onchange=guard(async()=>{const f=$("after").files[0];second=null;stale();$("afterName").textContent="";$("afterMapping").replaceChildren();if(!f)return;const d=await fileData(f);second={...d,name:f.name};mapping(second,"afterMapping");$("afterName").textContent=f.name+" · "+num(d.rows.length)+" records";});
function choose(){validateMap(input);step("scenario");}
$("next").onclick=guard(choose);$("again").onclick=choose;
document.querySelectorAll("#steps button").forEach(b=>b.onclick=guard(()=>b.dataset.step==="scenario"?choose():step(b.dataset.step)));
function setMode(m){mode=m;for(const id of ["single","compare","simulate"])show(id,id===m);document.querySelectorAll("#modes button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.mode===m)));}
document.querySelectorAll("#modes button").forEach(b=>b.onclick=()=>setMode(b.dataset.mode));setMode(mode);
function parameters(){const spec=specs[$("fault").value];show("paramLabel",!!spec);if(!spec)return;$("paramLabel").firstElementChild.textContent=spec[0];$("param").replaceChildren();for(let i=spec[1];i<=spec[2];i+=spec[3])$("param").add(new Option(i,i));$("param").value=spec[4];}
$("fault").onchange=parameters;parameters();
function execute(recovery=false){
  if(recovery)mode=result.mode;validateMap(input);let before=input,after,kind,cutoff="",title;
  if(mode==="single"){cutoff=$("cutoff").value;if(cutoff&&input.map.date<0)throw Error("Map a date column before setting a freshness cutoff.");title="File inspection";}
  if(mode==="compare"){if(!second)throw Error("Upload the after snapshot to compare records.");validateMap(second);after=second;title="Snapshot comparison";}
  if(mode==="simulate"){
    const n=recovery?result.before.rows.length:Number($("limit").value);if(!Number.isInteger(n)||n<1||n>input.rows.length)throw Error("Choose a row count between 1 and "+input.rows.length+".");
    before={...input,rows:input.rows.slice(0,n)};kind=recovery?"healthy":$("fault").value;
    after={...before,name:"Simulated output",rows:simulate(before.rows,before.map,kind,Number($("param").value))};
    title=recovery?"Restored baseline":$("fault").selectedOptions[0].text+" simulation";
  }
  const audit=analyze(before,after,cutoff);result={before,after,kind,mode,title,...audit};
  document.querySelector('[data-step="results"]').disabled=false;step("results");view("overview");
  $("summary").textContent=title+" · "+before.name+(mode==="compare"?" → "+after.name:"")+" · "+num(audit.total)+" finding"+(audit.total===1?"":"s");
  const delta=after&&audit.leftSum!=null&&audit.rightSum!=null?audit.rightSum-audit.leftSum:null;
  const metrics=[["Input records",num(before.rows.length)], [after?"Output records":"Findings",num(after?after.rows.length:audit.total)], [after?"Amount change · after − before":"Mapped amount total",after?(delta==null?"Unavailable":num(delta)):(audit.leftSum==null?"Unavailable":num(audit.leftSum))]];
  $("metrics").replaceChildren(...metrics.map(([label,value])=>{const d=node("div","");d.className="metric";d.append(node("small",label),node("strong",value));return d;}));
  const counts=[...audit.counts].sort((a,b)=>b[1]-a[1]);$("bars").replaceChildren();if(!counts.length)$("bars").textContent="No findings for the configured checks.";
  $("filter").replaceChildren(new Option("All findings",""));for(const [type,count] of counts){
    $("filter").add(new Option(type,type));const b=node("button","");b.className="bar";const bar=node("i","");bar.style.width=Math.max(2,count/counts[0][1]*100)+"%";b.append(node("span",type),bar,node("strong",num(count)));b.onclick=()=>evidence(type);$("bars").append(b);
  }
  $("search").value="";stageFilter="";$("dataset").replaceChildren(new Option(before.name,"before"));if(after)$("dataset").add(new Option(after.name,"after"));
  const current=after||before;
  if(current.headers.includes("customer_id")&&current.headers.includes("status")&&current.map.amount>=0&&current.map.date>=0){
    const day=new Map(),customers=new Map(),ci=current.headers.indexOf("customer_id"),si=current.headers.indexOf("status");
    for(const row of current.rows){const customer=row[ci],value=numeric(row[current.map.amount]);const completed=row[si].toLowerCase()==="completed";
      const c=customers.get(customer)||[0,0];c[0]++;if(completed&&value!==null){c[1]+=Math.round(value*100);const date=row[current.map.date].slice(0,10);day.set(date,(day.get(date)||0)+Math.round(value*100));}customers.set(customer,c);}
    result.daily={headers:["Date","Completed-order amount"],rows:[...day].sort().map(([d,v])=>[d,v/100])};
    result.customers={headers:["Customer ID","Orders","Completed-order amount"],rows:[...customers].map(([id,[n,v]])=>[id,n,v/100])};
    $("dataset").add(new Option("Daily revenue","daily"));$("dataset").add(new Option("Customer features","customers"));
  }
  show("volumePanel",!!after);
  $("volume").replaceChildren();
  if(after){
    const peak=Math.max(before.rows.length,after.rows.length,1);
    for(const [key,d] of [["before",before],["after",after]]){
      const b=node("button","");b.className="bar";
      const bar=node("i","");bar.style.width=(d.rows.length/peak*100)+"%";
      b.append(node("span",key==="before"?"Before":"After"),bar,node("strong",num(d.rows.length)));
      b.onclick=()=>{view("datasets");$("dataset").value=key;inspect();};$("volume").append(b);
    }
  }
  show("recover",mode==="simulate"&&kind!=="healthy");drawLineage();inspect();records();
}
$("analyze").onclick=guard(()=>execute());$("recover").onclick=guard(()=>execute(true));
function evidence(type="",stage=""){stageFilter=stage;$("filter").value=type;$("search").value="";view("records");records();}
function drawLineage(){
  const {before,after,mode,kind}=result;
  $("lineageText").textContent=mode==="compare"?"Only the supplied snapshots were observed. Differences are localized to the interval between them.":mode==="simulate"?"The highlighted processing boundary is the configured fault injection point.":"Only the uploaded input was observed. Select it to inspect data-quality findings.";
  const steps=mode==="single"?[[before.name,"Input"]]:mode==="compare"?[["Before snapshot","Before"],["Snapshot differences","Comparison"],["After snapshot","After"]]:[["Original input","Before"],[kind==="stale"?"Ingestion · timestamp shift":kind==="healthy"?"Healthy processing":"Cleaning · injected fault","Comparison"],["Processed output","After"]];
  $("nodes").replaceChildren();steps.forEach(([label,s],i)=>{if(i)$("nodes").append(node("span","→"));const b=node("button",label);const n=result.issues.reduce((v,r)=>v+(r[5]===s),0);b.textContent+=" · "+num(n);if(n)b.className="impacted";b.onclick=()=>evidence("",s);$("nodes").append(b);});
  $("nodeText").textContent="Select a stage to see its record evidence. Duplicate IDs are flagged separately because repeated records cannot be matched one-to-one.";
}
let recordPage=0,dataPage=0;
function paged(target,headers,rows,page,change){
  const max=Math.max(0,Math.ceil(rows.length/50)-1);page=Math.min(page,max);const start=page*50;
  table(target,headers,rows.slice(start,start+50));const nav=node("div","");nav.className="actions";for(const [label,p] of [["Previous",page-1],["Next",page+1]]){const b=node("button",label);b.className="secondary";b.disabled=p<0||p>max;b.onclick=()=>change(p);nav.append(b);}
  nav.prepend(node("span",rows.length?num(start+1)+"–"+num(Math.min(start+50,rows.length))+" of "+num(rows.length):"No matching records"));$(target).prepend(nav);
}
function records(page=0){recordPage=page;const rows=result.issues.filter(r=>(!stageFilter||r[5]===stageFilter)&&(!$("filter").value||r[0]===$("filter").value)&&r[1].toLowerCase().includes($("search").value.toLowerCase()));paged("evidence",["Finding","Record ID","Field","Expected / before","Observed / after","Scope"],rows,recordPage,records);if(stageFilter)$("evidence").prepend(node("p","Scope: "+stageFilter+" · Select Records above to see all stages."));}
function inspect(page=0){dataPage=page;const d=result[$("dataset").value];paged("datasetTable",d.headers,d.rows,dataPage,inspect);}
$("dataset").onchange=()=>inspect();$("filter").onchange=()=>records();$("search").oninput=()=>records();
document.querySelectorAll("#tabs button").forEach(b=>b.onclick=()=>{if(b.dataset.view==="records")evidence();else view(b.dataset.view);});step("data");


