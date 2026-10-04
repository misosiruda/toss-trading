// Synthetic loopback HTTP gate. No provider calls or credential persistence.
import http from 'node:http';
const gates=new Map(),marker='native-document-fixture-v1';
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:3004');
  if(url.pathname==='/__native_gate'){
    if(req.method!=='GET'||req.headers['x-native-test-runner']!==marker||req.headers.origin||req.headers['sec-fetch-mode']){res.writeHead(403);res.end();return;}
    const generation=url.searchParams.get('generation'),id=url.searchParams.get('id'),op=url.searchParams.get('op');
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(generation??'')||!/^paper_sim_\d{17}_[A-Za-z0-9_-]{1,32}$/.test(id??'')){res.writeHead(400);res.end();return;}
    const key=generation+':'+id;
    if(op==='arm'){const destination=url.searchParams.get('destination');gates.set(key,{id,path:destination==='list'?'/dashboard':destination==='step2'?'/dashboard/experiments/new':'/dashboard/lab/runs/'+id,search:destination==='step2'?'?step=2':null,started:false,released:false,closed:false,finished:false,resume:null});}
    const gate=gates.get(key);if(!gate){res.writeHead(404);res.end();return;}
    if(op==='release'){gate.released=true;gate.resume?.();}
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({id:gate.id,started:gate.started,released:gate.released,closed:gate.closed,finished:gate.finished}));return;
  }
  const forward=()=>{
    if(res.destroyed)return;
    const upstream=http.request({hostname:'127.0.0.1',port:3003,path:req.url,method:req.method,headers:req.headers},response=>{
      res.writeHead(response.statusCode,response.headers);response.pipe(res);
    });upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
    res.on('close',()=>upstream.destroy());req.pipe(upstream);
  };
  const gate=[...gates.values()].find(g=>g.path===url.pathname&&(g.search===null||g.search===url.search)&&!g.started&&!g.released);
  if(gate&&req.method==='GET'&&req.headers.rsc!=='1'&&req.headers.accept?.includes('text/html')){
    gate.started=true;gate.resume=forward;res.on('close',()=>{gate.closed=true;});res.on('finish',()=>{gate.finished=true;});return;
  }
  forward();
});
server.listen(3004,'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
