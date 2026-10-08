const $ = id => document.getElementById(id);
const values = {service:['Accounts','Billing','Search','Uploads','Notifications','Integrations'],status:['open','in_progress','resolved'],severity:['critical','high','medium','low']};
for(const [key,list] of Object.entries(values)) {
  const group=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent=key[0].toUpperCase()+key.slice(1);group.append(legend);
  for(const value of list) {const label=document.createElement('label');label.className='check';const input=document.createElement('input');input.type='checkbox';input.name=key;input.value=value;label.append(input,document.createTextNode(value.replace('_',' ')));group.append(label);} $('filters').append(group);
}
let query={search:'',service:[],status:[],severity:[],from:'',to:'',sort:'openedAt',direction:'desc',size:25,page:1};
let result=null,resultSignature='',queryIntent=0,detailIntent=0,exportIntent=0,queryController,detailController,exportController,retry=null,detailId=null;
function params(){const p=new URLSearchParams();for(const [k,v] of Object.entries(query)) {if(Array.isArray(v)) v.forEach(x=>p.append(k,x));else if(v!=='') p.set(k,v);}return p;}
function signature(){const p=params();p.delete('page');return p.toString();}
function clearError(){$('error').hidden=true;retry=null;}
function showError(message,action){$('errorText').textContent=message;$('error').hidden=false;retry=action;}
$('retry').onclick=()=>retry?.();
function invalidateExport(){exportIntent++;exportController?.abort();$('export').disabled=false;$('export').textContent='Export CSV';}
function cancelDetail(){detailIntent++;detailController?.abort();detailId=null;$('detail').hidden=true;$('results').hidden=false;}
function active(){const parts=[];for(const k of ['search','service','status','severity','from','to']){const v=query[k];if(Array.isArray(v)?v.length:v)parts.push(`${k}: ${Array.isArray(v)?v.join(', '):v}`);} $('active').textContent=parts.join(' · ')||'No active filters';}
async function request(url,controller){const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error(`HTTP ${response.status}`);return response;}
function bounds(){const pages=result?.pages||1;const current=result && resultSignature===signature();$('prev').disabled=!current || query.page<=1;$('next').disabled=!current || query.page>=pages;}
async function load(){
  const requestedSignature=signature();const intent=++queryIntent;queryController?.abort();queryController=new AbortController();const controller=queryController;
  invalidateExport();cancelDetail();clearError();active();$('loading').hidden=false;$('loading').textContent='Loading incidents…';bounds();
  try {const data=await (await request('/api/incidents?'+params(),controller)).json();if(intent!==queryIntent)return;result=data;resultSignature=requestedSignature;query.page=data.page;render();}
  catch(error){if(intent===queryIntent && error.name!=='AbortError')showError('Could not load incidents. Your selections are preserved.',load);}
  finally{if(intent===queryIntent){$('loading').hidden=true;bounds();}}
}
function render(){
  $('total').textContent=result.total;$('unresolved').textContent=result.unresolved;$('high').textContent=result.highSeverity;
  $('rows').replaceChildren();for(const r of result.rows){const tr=document.createElement('tr');const td=document.createElement('td');const button=document.createElement('button');button.textContent=r.id;button.onclick=()=>openDetail(r.id);const title=document.createElement('small');title.textContent=r.title;td.append(button,title);tr.append(td);for(const key of ['service','severity','status','openedAt']){const cell=document.createElement('td');cell.textContent=r[key];tr.append(cell);}$('rows').append(tr);}
  $('empty').hidden=result.total!==0;$('page').textContent=`Page ${result.page} of ${result.pages}`;
  $('daily').replaceChildren();$('bars').replaceChildren();const maximum=Math.max(1,...result.daily.map(d=>d.count));for(const d of result.daily){const tr=document.createElement('tr');for(const v of [d.date,d.count]){const td=document.createElement('td');td.textContent=v;tr.append(td);}$('daily').append(tr);const bar=document.createElement('i');bar.style.height=`${100*d.count/maximum}%`;$('bars').append(bar);} bounds();
}
async function openDetail(id){
  // Details own the screen and its Retry action; older exports lose all authority.
  invalidateExport();queryIntent++;queryController?.abort();const intent=++detailIntent;detailController?.abort();detailController=new AbortController();const controller=detailController;detailId=id;clearError();$('results').hidden=true;$('detail').hidden=false;$('fields').replaceChildren();$('detailTitle').textContent=id;$('loading').hidden=false;$('loading').textContent='Loading incident details…';
  try{const row=await (await request('/api/incidents/'+encodeURIComponent(id),controller)).json();if(intent!==detailIntent)return;for(const [key,value] of Object.entries(row)){const dt=document.createElement('dt');dt.textContent=key;const dd=document.createElement('dd');dd.textContent=value===null?'Not resolved':Array.isArray(value)?value.join(', '):value;$('fields').append(dt,dd);}}
  catch(error){if(intent===detailIntent && error.name!=='AbortError')showError('Could not load this incident.',()=>openDetail(id));}
  finally{if(intent===detailIntent)$('loading').hidden=true;}
}
$('back').onclick=()=>{cancelDetail();invalidateExport();clearError();$('loading').hidden=true;bounds();};
async function exportRows(){
  const intent=++exportIntent;exportController?.abort();exportController=new AbortController();const controller=exportController;clearError();$('export').disabled=true;$('export').textContent='Exporting…';
  try{const blob=await (await request('/api/export?'+params(),controller)).blob();if(intent!==exportIntent)return;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='incidents.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
  catch(error){if(intent===exportIntent && error.name!=='AbortError')showError('Could not export incidents.',exportRows);}
  finally{if(intent===exportIntent){$('export').disabled=false;$('export').textContent='Export CSV';}}
}
$('export').onclick=exportRows;
function change(){query={...query,search:$('search').value,from:$('from').value,to:$('to').value,sort:$('sort').value,direction:$('direction').value,size:Number($('size').value),page:1};for(const k of Object.keys(values))query[k]=[...document.querySelectorAll(`input[name=${k}]:checked`)].map(x=>x.value);load();}
for(const id of ['search','from','to'])$(id).addEventListener('input',change);
for(const id of ['sort','direction','size'])$(id).addEventListener('change',change);
$('filters').addEventListener('change',change);
function sync(){for(const id of ['search','from','to','sort','direction','size'])$(id).value=query[id];for(const k of Object.keys(values))for(const input of document.querySelectorAll(`input[name=${k}]`))input.checked=query[k].includes(input.value);}
$('clear').onclick=()=>{query={...query,search:'',service:[],status:[],severity:[],from:'',to:'',page:1};sync();load();};
for(const [id,step] of [['prev',-1],['next',1]])$(id).onclick=()=>{if(!result || resultSignature!==signature())return;const target=Math.max(1,Math.min(result?.pages||1,query.page+step));if(target!==query.page){query.page=target;load();}};
let views;try{views=JSON.parse(localStorage.getItem('incidentViews')||'[]');if(!Array.isArray(views))views=[];}catch{views=[];}
function saveViews(){try{localStorage.setItem('incidentViews',JSON.stringify(views));renderViews();}catch{showError('Browser storage is unavailable. Try saving again.',saveViews);}}
function renderViews(){$('views').replaceChildren();for(const view of views){const li=document.createElement('li');const open=document.createElement('button');open.textContent=view.name;open.onclick=()=>{query={...view.query,page:1};sync();load();};const remove=document.createElement('button');remove.textContent='Delete';remove.setAttribute('aria-label','Delete '+view.name);remove.onclick=()=>{views=views.filter(v=>v!==view);saveViews();};li.append(open,remove);$('views').append(li);}}
$('save').onclick=()=>{const name=$('viewName').value.trim();if(!name){$('viewName').focus();return;}views=views.filter(v=>v.name!==name);views.push({name,query:structuredClone(query)});saveViews();$('viewName').value='';};
renderViews();load();
