import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const dataPath = new URL('../.runtime/incidents.json', import.meta.url);
const fields = ['id','title','description','service','severity','status','openedAt','resolvedAt','team','region','tags'];
const priority = {critical:0,high:1,medium:2,low:3};
export function select(rows, params) {
  const search = (params.get('search') || '').toLowerCase();
  const matches = rows.filter(r => (!search || [r.id,r.title,r.description].some(v=>v.toLowerCase().includes(search))) && ['service','status','severity'].every(k=>!params.getAll(k).length || params.getAll(k).includes(r[k])) && (!params.get('from') || r.openedAt.slice(0,10)>=params.get('from')) && (!params.get('to') || r.openedAt.slice(0,10)<=params.get('to')));
  const sign = params.get('direction')==='asc' ? 1 : -1;
  matches.sort((a,b)=> (params.get('sort')==='severity' ? (priority[b.severity]-priority[a.severity])*sign : a.openedAt.localeCompare(b.openedAt)*sign) || a.id.localeCompare(b.id));
  return matches;
}
export async function createServer({beforeRequest}={}) {
  const rows = JSON.parse(await readFile(dataPath,'utf8'));
  return http.createServer(async (req,res)=> {
    try {
      const url = new URL(req.url,'http://localhost');
      if (beforeRequest) await beforeRequest(req,res,url);
      if (res.destroyed) return;
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Cache-Control','no-store');
        if(url.pathname.startsWith('/api/incidents/')) {
          const row = rows.find(r=>r.id===decodeURIComponent(url.pathname.split('/').pop()));
          res.writeHead(row?200:404,{'Content-Type':'application/json'}); res.end(JSON.stringify(row || {error:'Incident not found'})); return;
        }
        const matches = select(rows,url.searchParams);
        if(url.pathname==='/api/export') {
          const cell = v => '"'+String(v??'').replaceAll('"','""')+'"';
          res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="incidents.csv"'});
          res.end([fields.join(','),...matches.map(r=>fields.map(k=>cell(k==='tags'?JSON.stringify(r[k]):r[k])).join(','))].join('\r\n')+'\r\n'); return;
        }
        if(url.pathname==='/api/incidents') {
          const size = url.searchParams.get('size')==='50'?50:25;
          const pages = Math.max(1,Math.ceil(matches.length/size));
          const page = Math.max(1,Math.min(pages,Math.floor(Number(url.searchParams.get('page')))||1));
          const daily = {};
          for(const row of matches) {const day=row.openedAt.slice(0,10); daily[day]=(daily[day]||0)+1;}
          res.writeHead(200,{'Content-Type':'application/json'});
          res.end(JSON.stringify({rows:matches.slice((page-1)*size,page*size),total:matches.length,page,pages,size,unresolved:matches.filter(r=>r.status!=='resolved').length,highSeverity:matches.filter(r=>['critical','high'].includes(r.severity)).length,daily:Object.entries(daily).sort().map(([date,count])=>({date,count}))})); return;
        }
        res.writeHead(404);res.end();return;
      }
      const files = {'/':'index.html','/client.js':'client.js','/style.css':'style.css'};
      if(!files[url.pathname]) {res.writeHead(404);res.end();return;}
      const content = await readFile(new URL(files[url.pathname],import.meta.url));
      res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'});res.end(content);
    } catch(error) {if(!res.destroyed) {res.writeHead(500);res.end('Request failed');}}
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const server = await createServer();
  server.listen(3000,'127.0.0.1',()=>console.log('Incident explorer: http://127.0.0.1:3000 (Ctrl+C to stop)'));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));
}
