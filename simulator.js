"use strict";
const el = id => document.getElementById(id);
const money = cents => (cents / 100).toLocaleString("en-US", {style:"currency", currency:"USD"});
const formats = {
  drop:["Order loss (%)",10,60,5,25], value:["Amount multiplier",2,10,.5,5],
  duplicate:["Duplicate orders (%)",5,40,5,15], stale:["Age shift (days)",30,180,15,90]
};
function options(select,min,max,step,value){
  select.replaceChildren();
  for(let n=min;n<=max;n+=step) select.add(new Option(String(n),String(n)));
  select.value=String(value);
}
options(el("size"),1000,10000,1000,10000);
function parameters(){
  const spec=formats[el("scenario").value];
  el("parameter").style.display=spec?"grid":"none";
  if(spec){el("parameterLabel").textContent=spec[0];options(el("amount"),...spec.slice(1));}
}
el("scenario").onchange=parameters;
parameters();
let source=[], lastRun;
function randomGenerator(){
  let state=42;
  return ()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
}
function aggregate(rows){
  const daily=new Map(), customers=new Map();
  let revenue=0;
  for(const r of rows){
    const date=r.order_date.slice(0,10);
    const customer=customers.get(r.customer_id) || {customer_id:r.customer_id,total_orders:0,completed:0,cancelled:0,pending:0,spend:0};
    customer.total_orders++;customer[r.status]++;
    if(r.status==="completed"){
      const cents=Math.round(Number(r.order_amount)*100);
      revenue+=cents;customer.spend+=cents;
      const day=daily.get(date)||{date,completed_orders:0,cents:0};
      day.completed_orders++;day.cents+=cents;daily.set(date,day);
    }
    customers.set(r.customer_id,customer);
  }
  return {revenue,daily:Array.from(daily.values(),d=>({date:d.date,completed_orders:d.completed_orders,total_revenue:money(d.cents)})).sort((a,b)=>a.date.localeCompare(b.date)),
    customers:Array.from(customers.values(),c=>({customer_id:c.customer_id,total_orders:c.total_orders,completed:c.completed,cancelled:c.cancelled,pending:c.pending,completed_spend:money(c.spend)}))};
}
function applyFault(input,kind,param){
  const random=randomGenerator();
  let ingestion=input, cleaning=input;
  if(kind==="drop") cleaning=input.filter(()=>random()>=param/100);
  if(kind==="value") cleaning=input.map(r=>random()<.5?{...r,order_amount:(Number(r.order_amount)*param).toFixed(2)}:r);
  if(kind==="duplicate"){
    const pool=input.slice(), count=Math.floor(input.length*param/100);
    for(let i=0;i<count;i++){const j=i+Math.floor(random()*(pool.length-i));[pool[i],pool[j]]=[pool[j],pool[i]];}
    cleaning=input.concat(pool.slice(0,count));
  }
  if(kind==="stale"){
    ingestion=input.map(r=>({...r,order_date:new Date(Date.parse(r.order_date.replace(" ","T")+"Z")-param*86400000).toISOString().slice(0,19).replace("T"," ")}));
    cleaning=ingestion;
  }
  return {ingestion,cleaning};
}
function table(target,rows){
  const container=el(target);container.replaceChildren();
  if(!rows.length)return;
  const table=document.createElement("table"),keys=Object.keys(rows[0]);
  const header=table.createTHead().insertRow();
  for(const key of keys){const th=document.createElement("th");th.textContent=key.replaceAll("_"," ");header.append(th);}
  const body=table.createTBody();
  for(const row of rows){const tr=body.insertRow();for(const key of keys)tr.insertCell().textContent=row[key];}
  container.append(table);
}
function inspect(){
  const rows=lastRun.datasets[el("dataset").value];
  el("count").textContent="Showing "+Math.min(rows.length,100)+" of "+rows.length.toLocaleString()+" rows";
  table("preview",rows.slice(0,100));
}
function run(kind,size,param,recovery=false){
  const input=source.slice(0,size);
  const {ingestion,cleaning}=applyFault(input,kind,param);
  const base=aggregate(input), observed=aggregate(cleaning), difference=observed.revenue-base.revenue;
  const expected=new Map(input.map(r=>[r.order_id,r])), seen=new Set(), duplicates=[],changed=[];
  let exampleShift;
  for(const r of cleaning){
    if(seen.has(r.order_id)) duplicates.push(r.order_id);
    seen.add(r.order_id);
    const before=expected.get(r.order_id);
    if(before.order_amount!==r.order_amount && Number(before.order_amount)!==Number(r.order_amount))changed.push(r.order_id);
    if(before.order_date!==r.order_date)exampleShift={before,after:r};
  }
  const missing=input.filter(r=>!seen.has(r.order_id)).map(r=>r.order_id);
  let finding="All reference checks passed.", evidence="Row count, IDs, order amounts and timestamps match the healthy input.", origin="", remedy="All downstream outputs can be released.";
  if(missing.length){finding=missing.length+" valid orders disappeared during cleaning.";evidence="Missing IDs: "+missing.slice(0,5).join(", ");origin="Cleaning";remedy="Restore the cleaning filter and rebuild both outputs.";}
  else if(duplicates.length){finding=duplicates.length+" duplicate order IDs after cleaning.";evidence="Repeated IDs: "+duplicates.slice(0,5).join(", ");origin="Cleaning";remedy="Remove duplicate records before publishing the aggregates.";}
  else if(changed.length){finding=changed.length+" order amounts differ from their reference values.";const id=changed[0];evidence=id+" changed from "+money(Number(expected.get(id).order_amount)*100)+" to "+money(Number(cleaning.find(r=>r.order_id===id).order_amount)*100)+".";origin="Cleaning";remedy="Correct the conversion multiplier and recalculate downstream revenue.";}
  else if(exampleShift){finding="Order timestamps are stale relative to the reference.";evidence=exampleShift.before.order_id+" moved from "+exampleShift.before.order_date+" to "+exampleShift.after.order_date+".";origin="Ingestion";remedy="Refresh the source batch and rebuild the date-based outputs.";}
  lastRun={size,datasets:{ingestion,cleaning,daily:observed.daily,customers:observed.customers}};
  el("results").hidden=false;el("restore").hidden=!origin;
  const label=el("scenario").querySelector('option[value="'+kind+'"]').textContent;
  el("status").textContent=(recovery?"Recovery verified · ":label+(formats[kind]?" ("+formats[kind][0]+": "+param+")":"")+" · ")+size.toLocaleString()+" input orders · Pipeline succeeded · Data quality "+(origin?"failed":"passed");
  el("gapLabel").textContent=difference<0?"UNDERREPORTED REVENUE":difference>0?"OVERREPORTED REVENUE":"REVENUE DIFFERENCE";
  el("gap").textContent=money(Math.abs(difference));el("gap").classList.toggle("bad",difference!==0);
  el("comparison").textContent="Expected "+money(base.revenue)+" · Reported "+money(observed.revenue);
  el("finding").textContent=finding;el("evidence").textContent=evidence;
  el("path").textContent=origin?(origin==="Ingestion"?"Ingestion → ":"")+"Cleaning → daily revenue → executive dashboard. Cleaning → customer features → analytics dashboard and scoring model.":"No affected downstream assets.";
  el("remedy").textContent=remedy;
  table("stages",[{stage:"Ingestion",input:size,output:ingestion.length},{stage:"Cleaning",input:ingestion.length,output:cleaning.length},{stage:"Daily revenue",input:cleaning.length,output:observed.daily.length},{stage:"Customer features",input:cleaning.length,output:observed.customers.length}]);
  inspect();
}
el("controls").onsubmit=e=>{e.preventDefault();run(el("scenario").value,Number(el("size").value),Number(el("amount").value));};
el("restore").onclick=()=>run("healthy",lastRun.size,0,true);el("dataset").onchange=inspect;
async function initialize(){
  const response=await fetch("orders.csv");if(!response.ok)throw Error("Missing fixture");
  const [header,...lines]=(await response.text()).trim().split(/\r?\n/);
  const keys=header.split(",");
  source=lines.map(line=>Object.fromEntries(line.split(",").map((v,i)=>[keys[i],v])));
  run("healthy",source.length,0);el("run").disabled=false;
}
initialize().catch(()=>{el("status").textContent="The synthetic orders could not be loaded. Refresh to retry.";});
