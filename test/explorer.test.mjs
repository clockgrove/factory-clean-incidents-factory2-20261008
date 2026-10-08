import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {createServer} from '../app/server.mjs';

const rows=JSON.parse(await readFile(new URL('../.runtime/incidents.json',import.meta.url),'utf8'));
const fields=Object.keys(rows[0]);
const priorities=['critical','high','medium','low'];
// Independent dataset oracle: no application selection or serialization code is reused.
function expected(p={}) {
  const matches=rows.filter(r=>!p.search || `${r.id}\0${r.title}\0${r.description}`.toUpperCase().includes(p.search.toUpperCase())).filter(r=>['service','status','severity'].every(k=>!p[k]?.length||p[k].includes(r[k]))).filter(r=>(!p.from||r.openedAt.substring(0,10)>=p.from)&&(!p.to||r.openedAt.substring(0,10)<=p.to));
  matches.sort((a,b)=>{let comparison=p.sort==='severity'?priorities.indexOf(a.severity)-priorities.indexOf(b.severity):a.openedAt<b.openedAt?-1:a.openedAt>b.openedAt?1:0;if(p.sort==='severity')comparison=-comparison;return (p.direction==='asc'?comparison:-comparison)|| (a.id<b.id?-1:a.id>b.id?1:0);});return matches;
}
function encode(p){const q=new URLSearchParams();for(const [k,v] of Object.entries(p))for(const item of Array.isArray(v)?v:[v])q.append(k,item);return q;}
function parseCsv(text){const records=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if(ch==='\r'&&!quoted&&text[i+1]==='\n'){row.push(cell);records.push(row);row=[];cell='';i++;}else cell+=ch;}assert.equal(quoted,false);return records;}
async function start(options){const server=await createServer(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,url:`http://127.0.0.1:${server.address().port}`};}
async function close(server){server.closeAllConnections();await new Promise(r=>server.close(r));}

test('actual HTTP queries, entire-result summaries, UTC boundaries, deterministic ties and lossless exports',async()=>{
  const {server,url}=await start();
  try{
    const cases=[{}, {search:'inc-000001'}, {search:'RETRY, THEN CONTINUE'}, {search:'slow RESPONSE',service:['Billing','Search'],status:['open','in_progress'],severity:['critical','high']}, {from:'2026-04-01',to:'2026-04-01'}, {from:'2026-04-01',to:'2026-06-29',size:50}, {severity:['critical','high'],service:['Accounts','Uploads'],from:'2026-04-10',to:'2026-05-20'}, {search:'impossible no match'}];
    for(const sort of ['openedAt','severity'])for(const direction of ['asc','desc'])cases.push({sort,direction,size:50,page:2});
    for(const p of cases){const want=expected(p);const response=await fetch(`${url}/api/incidents?${encode(p)}`);assert.equal(response.status,200);const data=await response.json();const size=p.size||25;const pages=Math.max(1,Math.ceil(want.length/size));const page=Math.max(1,Math.min(pages,p.page||1));assert.deepEqual(data.rows,want.slice((page-1)*size,page*size));assert.equal(data.total,want.length);assert.equal(data.pages,pages);assert.equal(data.unresolved,want.reduce((n,r)=>n+(r.status==='resolved'?0:1),0));assert.equal(data.highSeverity,want.filter(r=>priorities.indexOf(r.severity)<2).length);const days=new Map();for(const r of want)days.set(r.openedAt.slice(0,10),(days.get(r.openedAt.slice(0,10))||0)+1);assert.deepEqual(data.daily,[...days].sort().map(([date,count])=>({date,count})));}
    for(const page of [-10,0,999999]){const data=await (await fetch(`${url}/api/incidents?page=${page}`)).json();assert.ok(data.page>=1&&data.page<=data.pages);}
    for(const sort of ['openedAt','severity'])for(const direction of ['asc','desc']){
      const p={sort,direction};const want=expected(p);assert.ok(want.findIndex(r=>r.id===rows[0].id)<want.findIndex(r=>r.id===rows[1].id),'deliberate sort ties use ascending ID');
      const response=await fetch(`${url}/api/export?${encode(p)}`);assert.match(response.headers.get('content-type'),/text\/csv/);const parsed=parseCsv(await response.text());assert.deepEqual(parsed.shift(),fields);assert.deepEqual(parsed,want.map(r=>fields.map(k=>r[k]===null?'':k==='tags'?JSON.stringify(r[k]):String(r[k]))));assert.ok(parsed.some(r=>r[2].includes('\n')&&r[2].includes('"retry, then continue"')));
    }
    const p={service:['Billing','Notifications'],status:['open'],severity:['high','critical'],from:'2026-04-01',to:'2026-05-31',sort:'severity',direction:'asc'};
    const csv=parseCsv(await (await fetch(`${url}/api/export?${encode(p)}`)).text());assert.deepEqual(csv.slice(1).map(r=>r[0]),expected(p).map(r=>r.id));
    assert.deepEqual(await (await fetch(`${url}/api/incidents/${rows[0].id}`)).json(),rows[0]);assert.equal((await fetch(`${url}/api/incidents/unknown`)).status,404);
  }finally{await close(server);}
});

// Gates delay actual backend handling. Failures destroy real TCP connections;
// no browser routing, response replacement, or fake incident responses are used.
function gates(){
  const pending=[];const requests=[];const failures=new Set();
  function hold(path){let enter,release;const entered=new Promise(r=>enter=r);const released=new Promise(r=>release=r);const gate={path,enter,entered,released,release,fail:false};pending.push(gate);return gate;}
  return {hold,requests,clearFailures(){failures.clear();},async beforeRequest(req,res,url){const key=url.pathname+url.search;requests.push(key);if(failures.has(key)){req.socket.destroy();return;}const i=pending.findIndex(g=>typeof g.path==='function'?g.path(url):g.path===url.pathname);if(i<0)return;const gate=pending.splice(i,1)[0];gate.enter();await gate.released;if(gate.fail){failures.add(key);req.socket.destroy();}},releaseAll(){for(const g of pending)g.release();}};
}
const alias=execFileSync('bash',['-c','command -v qualification-chromium'],{encoding:'utf8'}).trim();
const toolDir=dirname(alias);
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve(toolDir,'../browsers');
const browserTemp='.runtime/browser-tmp';await mkdir(browserTemp,{recursive:true});
const {chromium}=await import('playwright');

test('real browser journeys and overlapping current-intent ownership', {timeout:120000},async()=>{
  const gate=gates();const {server,url}=await start({beforeRequest:gate.beforeRequest});let browser;const held=[];
  const hold=path=>{const g=gate.hold(path);held.push(g);return g;};
  const evidence=[];
  try{
    browser=await chromium.launch({channel:'chromium',headless:true,chromiumSandbox:true,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH,LD_LIBRARY_PATH:resolve(toolDir,'../host-libs/usr/lib/x86_64-linux-gnu'),ALSA_CONFIG_PATH:resolve(toolDir,'../host-libs/usr/share/alsa/alsa.conf'),TMPDIR:browserTemp,TMP:browserTemp,TEMP:browserTemp}});
    const page=await browser.newPage({viewport:{width:1280,height:900},acceptDownloads:true});
    const visible=async id=>page.locator('#'+id).isVisible();
    const wait=async()=>{await page.waitForFunction(()=>document.getElementById('loading').hidden);};
    const total=async count=>{await page.waitForFunction(n=>document.getElementById('total').textContent===String(n),count);await wait();};
    const ids=()=>page.locator('#rows tr td:first-child button').allTextContents();
    const first=expected()[0].id;
    await page.goto(url);await total(2400);assert.equal(await page.locator('#search').inputValue(),'');assert.equal(await page.locator('#size').inputValue(),'25');assert.equal(await page.locator('input:checked').count(),0);assert.deepEqual(await ids(),expected().slice(0,25).map(r=>r.id));assert.equal(await page.locator('#daily tr').count(),90);
    assert.equal(await page.locator('#unresolved').textContent(),String(rows.filter(r=>r.status!=='resolved').length));assert.equal(await page.locator('#high').textContent(),String(rows.filter(r=>priorities.indexOf(r.severity)<2).length));
    const daily=await page.locator('#daily tr').evaluateAll(trs=>trs.map(tr=>[tr.cells[0].textContent,Number(tr.cells[1].textContent)]));for(const [date,count] of daily)assert.equal(count,rows.filter(r=>r.openedAt.startsWith(date)).length);
    await page.locator('#search').focus();assert.equal(await page.locator('#search').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');await page.keyboard.type('INC-000001');await total(1);assert.match(await page.locator('#active').textContent(),/INC-000001/);await page.locator('#clear').click();await total(2400);
    await page.getByLabel('Billing',{exact:true}).check();await wait();await page.getByLabel('Search',{exact:true}).check();await wait();await page.getByLabel('open',{exact:true}).check();await wait();await page.getByLabel('high',{exact:true}).check();await wait();await page.locator('#from').fill('2026-04-10');await wait();await page.locator('#to').fill('2026-05-20');const combined={service:['Billing','Search'],status:['open'],severity:['high'],from:'2026-04-10',to:'2026-05-20'};await total(expected(combined).length);assert.deepEqual(await ids(),expected(combined).slice(0,25).map(r=>r.id));assert.match(await page.locator('#active').textContent(),/Billing, Search/);
    await page.locator('#clear').click();await total(2400);await page.locator('#from').fill('2026-04-01');await wait();await page.locator('#to').fill('2026-04-01');await total(expected({from:'2026-04-01',to:'2026-04-01'}).length);await page.locator('#clear').click();await total(2400);
    for(const sort of ['openedAt','severity'])for(const direction of ['asc','desc']){await page.locator('#sort').selectOption(sort);await wait();await page.locator('#direction').selectOption(direction);await wait();assert.deepEqual(await ids(),expected({sort,direction}).slice(0,25).map(r=>r.id));}
    await page.locator('#size').selectOption('50');await wait();assert.equal((await ids()).length,50);await page.locator('#next').focus();await page.keyboard.press('Enter');await wait();assert.match(await page.locator('#page').textContent(),/Page 2 of 48/);const savedIds=await ids();await page.locator('#rows button').first().click();await wait();const detailRow=rows.find(r=>r.id===savedIds[0]);assert.deepEqual(await page.locator('#fields dt').allTextContents(),fields);assert.deepEqual(await page.locator('#fields dd').allTextContents(),fields.map(k=>detailRow[k]===null?'Not resolved':Array.isArray(detailRow[k])?detailRow[k].join(', '):detailRow[k]));await page.locator('#back').click();assert.deepEqual(await ids(),savedIds);assert.match(await page.locator('#page').textContent(),/Page 2/);
    await page.locator('#search').fill('timeout');await wait();assert.match(await page.locator('#page').textContent(),/Page 1/);await page.getByLabel('Billing',{exact:true}).check();await wait();await page.locator('#viewName').fill('Timeout triage');await page.locator('#save').click();await page.reload();await total(2400);await page.getByRole('button',{name:'Timeout triage',exact:true}).click();await total(expected({search:'timeout',service:['Billing']}).length);assert.ok(await page.getByLabel('Billing',{exact:true}).isChecked());assert.equal(await page.locator('#size').inputValue(),'50');assert.equal(await page.locator('#sort').inputValue(),'severity');assert.equal(await page.locator('#direction').inputValue(),'desc');await page.getByRole('button',{name:'Delete Timeout triage'}).click();await page.reload();await total(2400);assert.equal(await page.getByRole('button',{name:'Timeout triage',exact:true}).count(),0);
    const downloadWait=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadWait;const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);assert.deepEqual(parseCsv(Buffer.concat(chunks).toString()).slice(1).map(r=>r[0]),expected().map(r=>r.id));
    await page.locator('#search').fill('no such fictional record');await total(0);assert.ok(await visible('empty'));assert.ok(await page.locator('#next').isDisabled());await page.locator('#clear').click();await total(2400);
    // A genuine current query failure preserves controls; Retry issues that query.
    let g=hold('/api/incidents');g.fail=true;await page.locator('#search').fill('timeout');await g.entered;assert.ok(await visible('loading'));g.release();await page.locator('#error').waitFor();assert.equal(await page.locator('#search').inputValue(),'timeout');gate.clearFailures();await page.locator('#retry').click();await total(expected({search:'timeout'}).length);
    await page.locator('#clear').click();await total(2400);
    // Earlier query success/failure cannot replace newer rows, summaries, loading or Retry.
    for(const fail of [false,true]){g=hold('/api/incidents');g.fail=fail;await page.locator('#search').fill('timeout');await g.entered;await page.locator('#search').fill('INC-000001');await total(1);g.release();await page.waitForTimeout(80);assert.equal(await page.locator('#total').textContent(),'1');assert.deepEqual(await ids(),['INC-000001']);assert.ok(!await visible('error'));assert.ok(!await visible('loading'));gate.clearFailures();}
    await page.locator('#clear').click();await total(2400);
    // Detail results/failures and their cleanup cannot reopen a closed screen or replace reentry.
    for(const fail of [false,true]){g=hold('/api/incidents/'+first);g.fail=fail;await page.getByRole('button',{name:first,exact:true}).click();await g.entered;await page.locator('#back').click();const second=(await ids())[1];await page.getByRole('button',{name:second,exact:true}).click();await wait();g.release();await page.waitForTimeout(80);assert.equal(await page.locator('#detailTitle').textContent(),second);assert.ok(!await visible('error'));assert.ok(!await visible('loading'));await page.locator('#back').click();gate.clearFailures();}
    g=hold('/api/incidents/'+first);await page.getByRole('button',{name:first,exact:true}).click();await g.entered;await page.locator('#back').click();g.release();await page.waitForTimeout(80);assert.ok(!await visible('detail'));
    // Export-to-details regression: fail A, then finish the older export. Retry must retrieve A.
    let downloads=0;page.on('download',()=>downloads++);
    const oldExport=hold('/api/export');oldExport.fail=true;await page.locator('#export').click();await oldExport.entered;const failedDetail=hold('/api/incidents/'+first);failedDetail.fail=true;await page.getByRole('button',{name:first,exact:true}).click();await failedDetail.entered;failedDetail.release();await page.locator('#error').waitFor();oldExport.release();await page.waitForTimeout(100);assert.match(await page.locator('#errorText').textContent(),/this incident/);gate.clearFailures();const before=gate.requests.length;await page.locator('#retry').click();await wait();assert.deepEqual(gate.requests.slice(before),['/api/incidents/'+first]);assert.deepEqual(await page.locator('#fields dt').allTextContents(),fields);assert.equal((await page.locator('#fields dd').allTextContents())[0],first);assert.equal(downloads,0);await page.locator('#back').click();
    // Older successful export and finally cleanup during pending, displayed, and closed details.
    for(const stage of ['pending','displayed','closed']){
      const exp=hold('/api/export');await page.locator('#export').click();await exp.entered;const detail=hold('/api/incidents/'+first);await page.getByRole('button',{name:first,exact:true}).click();await detail.entered;
      if(stage!=='pending'){detail.release();await wait();if(stage==='closed')await page.locator('#back').click();}
      exp.release();await page.waitForTimeout(100);assert.equal(downloads,0);assert.equal(await page.locator('#export').textContent(),'Export CSV');assert.ok(!await visible('error'));
      if(stage==='pending'){assert.ok(await visible('loading'));assert.ok(await visible('detail'));assert.equal(await page.locator('#fields dt').count(),0);detail.release();await wait();}
      if(stage==='closed')assert.ok(!await visible('detail'));else {assert.equal(await page.locator('#detailTitle').textContent(),first);assert.deepEqual(await page.locator('#fields dt').allTextContents(),fields);await page.locator('#back').click();}
    }
    // Export superseded by a search must also lose error/download authority.
    g=hold('/api/export');g.fail=true;await page.locator('#export').click();await g.entered;await page.locator('#search').fill('INC-000001');await total(1);g.release();await page.waitForTimeout(80);assert.ok(!await visible('error'));gate.clearFailures();
    // New filters must not borrow the previous query's page bounds while pending.
    await page.locator('#clear').click();await total(2400);
    g=hold('/api/incidents');await page.locator('#search').fill('INC-000001');await g.entered;
    assert.ok(await page.locator('#next').isDisabled());assert.ok(await page.locator('#prev').isDisabled());
    const pendingRequests=gate.requests.length;await page.locator('#next').click({force:true});
    await page.locator('#next').focus();await page.keyboard.press('Enter');assert.equal(gate.requests.length,pendingRequests);
    g.release();await total(1);assert.equal(await page.locator('#page').textContent(),'Page 1 of 1');
    // Repeated pointer and keyboard pagination is clamped even with requests overlapping.
    await page.locator('#clear').click();await total(2400);await page.locator('#size').selectOption('50');await wait();await page.locator('#from').fill('2026-04-01');await wait();await page.locator('#to').fill('2026-04-05');await wait();const count=expected({from:'2026-04-01',to:'2026-04-05'}).length;assert.ok(count>100&&count<200);
    g=hold('/api/incidents');await page.locator('#next').click();await g.entered;for(let i=0;i<5;i++)await page.locator('#next').click({force:true});g.release();await wait();assert.ok(gate.requests.filter(r=>r.startsWith('/api/incidents?')&&r.includes('to=2026-04-05')).some(r=>r.includes('page=3')));const pages=Math.ceil(count/50);assert.equal(await page.locator('#page').textContent(),`Page ${pages} of ${pages}`);await page.locator('#next').focus();for(let i=0;i<6;i++)await page.keyboard.press('Enter');assert.equal(await page.locator('#page').textContent(),`Page ${pages} of ${pages}`);
    g=hold('/api/incidents');await page.locator('#prev').click();await g.entered;await page.locator('#prev').focus();for(let i=0;i<8;i++)await page.keyboard.press('Enter');g.release();await wait();assert.equal(await page.locator('#page').textContent(),`Page 1 of ${pages}`);assert.ok(await page.locator('#prev').isDisabled());
    await page.locator('#direction').selectOption('asc');await wait();assert.match(await page.locator('#page').textContent(),/Page 1/);await page.locator('#clear').click();await total(2400);
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('summary').click();assert.ok(await page.locator('#daily').isVisible());await page.locator('#search').focus();await page.keyboard.type('INC-000001');await total(1);await page.locator('#rows button').first().focus();await page.keyboard.press('Enter');await wait();assert.ok(await visible('fields'));await page.locator('#back').focus();await page.keyboard.press('Enter');assert.ok(await visible('results'));
    await page.screenshot({path:'.runtime/explorer-mobile.png',fullPage:true});
    evidence.push({httpBackend:url,browserVersion:browser.version(),realConnectionFailures:true,exportToDetailsRetry:true,lateExportStages:['pending','displayed','closed'],boundedOverlappingPagination:true,narrowWidth:390});
    await writeFile('.runtime/explorer-browser-evidence.json',JSON.stringify(evidence,null,2)+'\n');
  }finally{for(const g of held)g.release();if(browser)await browser.close();await close(server);}
});
