export function parseCSV(text){
  text=text.replace(/^\uFEFF/,"");
  const rows=[];let row=[],field="",quoted=false,closed=false;
  function finish(){row.push(field);if(row.length>1||row[0]!=="")rows.push(row);row=[];field="";closed=false;}
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c!=='"')field+=c;else if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}continue;}
    if(c===","){row.push(field);field="";closed=false;}
    else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;finish();}
    else if(c==='"'&&!field&&!closed)quoted=true;
    else if(closed||c==='"')throw Error("Unexpected quotation mark in CSV record "+(rows.length+1)+".");
    else field+=c;
  }
  if(quoted)throw Error("A quoted field is missing its closing quote.");
  if(row.length||field||closed)finish();
  const headers=(rows.shift()||[]).map(x=>x.trim());
  if(!headers.length||headers.some(h=>!h)||new Set(headers).size!==headers.length)throw Error("Give every column a unique, nonempty header.");
  if(!rows.length)throw Error("Include at least one data row under the headers.");
  const invalid=rows.findIndex(r=>r.length!==headers.length);
  if(invalid>=0)throw Error("Record "+(invalid+2)+" has a different number of fields than the header.");
  return {headers,rows};
}
export const numeric=v=>v!=null&&v.trim()!==""&&Number.isFinite(Number(v))?Number(v):null;
function timestamp(v){
  if(!/^\d{4}-\d{2}-\d{2}(?:$|[ T])/.test(v))return NaN;
  const day=v.slice(0,10),t=Date.parse(day+"T00:00:00Z");
  if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==day)return NaN;
  const normalized=v.replace(" ","T");
  return Date.parse(normalized.length===10?day+"T00:00:00Z":normalized+(/Z$|[+-]\d\d:\d\d$/i.test(normalized)?"":"Z"));
}
export function simulate(input,m,kind,p){
  let seed=42;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  if(kind==="drop")return input.filter(()=>random()>=p/100);
  if(kind==="duplicate"){const pool=input.slice(),count=Math.floor(pool.length*p/100);for(let i=0;i<count;i++){const j=i+Math.floor(random()*(pool.length-i));[pool[i],pool[j]]=[pool[j],pool[i]];}return input.concat(pool.slice(0,count));}
  if(kind==="value"&&m.amount<0||kind==="stale"&&m.date<0)throw Error("Map the "+(kind==="value"?"amount":"date")+" column in Data first.");
  return input.map(r=>{
    if(kind==="value"&&random()<.5&&numeric(r[m.amount])!==null){const out=r.slice();out[m.amount]=(numeric(r[m.amount])*p).toFixed(2);return out;}
    if(kind==="stale"&&Number.isFinite(timestamp(r[m.date]))){const out=r.slice();out[m.date]=new Date(timestamp(r[m.date])-p*86400000).toISOString();return out;}return r;
  });
}
export function analyze(before,after,cutoff){
  const issues=[], counts=new Map();let total=0;
  function add(type,id,column,old,now,source){
    total++;counts.set(type,(counts.get(type)||0)+1);
    issues.push([type,id,column,old,now,source]);
  }
  function scan(data,label){
    const ids=new Map();let sum=0,invalidAmounts=0;
    data.rows.forEach((r,i)=>{
      const id=r[data.map.id].trim(),line="Record "+(i+1),key=id||line;
      if(id){const group=ids.get(id)||[];if(group.length)add("Duplicate ID",id,data.headers[data.map.id],group[0]+1,i+1,label);group.push(i);ids.set(id,group);}
      r.forEach((v,col)=>{if(!v.trim())add("Empty field",key,data.headers[col],"",line,label);});
      if(data.map.amount>=0){const v=r[data.map.amount],n=numeric(v);if(n===null){invalidAmounts++;if(v.trim())add("Invalid amount",key,data.headers[data.map.amount],"Number",v,label);}else sum+=Math.round(n*100);}
      if(data.map.date>=0){const v=r[data.map.date],t=timestamp(v);if(v.trim()&&!Number.isFinite(t))add("Invalid date",key,data.headers[data.map.date],"ISO date",v,label);
        else if(cutoff&&t<timestamp(cutoff))add("Stale date",key,data.headers[data.map.date],cutoff,v,label);}
    });
    return {ids,sum:data.map.amount<0||invalidAmounts?null:sum/100};
  }
  const left=scan(before,after?"Before":"Input");let right;
  if(after){
    right=scan(after,"After");
    const paired=new Map();
    for(const role of ["id","amount","date"])if(before.map[role]>=0&&after.map[role]>=0)paired.set(before.map[role],after.map[role]);
    const used=new Set(paired.values());
    before.headers.forEach((h,i)=>{const j=after.headers.indexOf(h);if(j>=0&&!used.has(j)&&!paired.has(i))paired.set(i,j);});
    for(const [id,indices] of left.ids){
      const next=right.ids.get(id);
      if(!next){for(const i of indices)add("Missing row",id,"Record",i+1,"Absent","Comparison");continue;}
      if(indices.length!==1||next.length!==1){
        if(indices.length>next.length)add("Fewer occurrences",id,"Row count",indices.length,next.length,"Comparison");
        else if(indices.length<next.length)add("Extra occurrences",id,"Row count",indices.length,next.length,"Comparison");
        continue;
      }
      const a=before.rows[indices[0]],b=after.rows[next[0]];
      for(const [i,j] of paired){
        if(i===before.map.id||a[i]===b[j])continue;
        if(i===before.map.amount&&numeric(a[i])!==null&&numeric(a[i])===numeric(b[j]))continue;
        const earlier=i===before.map.date&&timestamp(b[j])<timestamp(a[i]);
        add(earlier?"Date moved back":"Changed value",id,before.headers[i],a[i],b[j],"Comparison");
      }
    }
    for(const [id,idx] of right.ids)if(!left.ids.has(id))for(const i of idx)add("Added row",id,"Record","Absent",i+1,"Comparison");
  }
  return {issues,counts,total,leftSum:left.sum,rightSum:right?.sum};
}
