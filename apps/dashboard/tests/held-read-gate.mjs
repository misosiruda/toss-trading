// In-memory test-runner controls on isolated loopback fixture servers only.
// Bind a request generation to one exact child ID and one exact endpoint.
export function createHeldReadGate(){
  const gates=new Map();
  const key=(generation,endpoint,id)=>JSON.stringify([generation,endpoint,id]);
  const view=g=>({generation:g.generation,endpoint:g.endpoint,id:g.id,started:g.started,pending:g.started&&!g.released&&!g.closed,released:g.released,closed:g.closed,finished:g.finished,ageMs:g.startedAt===null?null:Date.now()-g.startedAt});
  return {
    control(req,res,url){
      if(url.pathname!=='/__gate')return false;
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.method!=='GET'||req.headers['x-fixture-gate']!=='synthetic-read-v1'||req.headers.origin||req.headers['sec-fetch-mode']){res.statusCode=403;res.end('{}');return true;}
      const generation=url.searchParams.get('generation'),endpoint=url.searchParams.get('endpoint'),id=url.searchParams.get('id'),op=url.searchParams.get('op');
      if(!generation||!id||!['/batch/replay/runs','/batch/replay/runs/provenance'].includes(endpoint)){res.statusCode=400;res.end('{}');return true;}
      const k=key(generation,endpoint,id);let g=gates.get(k);
      if(op==='arm'){if(g){res.statusCode=409;res.end('{}');return true;}g={generation,endpoint,id,started:false,startedAt:null,released:false,closed:false,finished:false,response:null,send:null};gates.set(k,g);}
      if(!g){res.statusCode=404;res.end('{}');return true;}
      if(op==='release'){g.released=true;if(g.send&&!g.closed)g.send();}
      res.end(JSON.stringify(view(g)));return true;
    },
    hold(url,res,send){
      const id=url.searchParams.get('runId');const g=[...gates.values()].find(g=>g.id===id&&g.endpoint===url.pathname&&!g.started&&!g.released);
      if(!g)return false;
      g.started=true;g.startedAt=Date.now();g.response=res;g.send=send;
      res.on('finish',()=>{g.finished=true;});res.on('close',()=>{g.closed=true;});
      return true;
    }
  };
}
