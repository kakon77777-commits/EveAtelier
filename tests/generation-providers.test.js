import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComfyUiProvider } from '../src/providers/comfyui-provider.js';
import { DiffusersProvider } from '../src/providers/diffusers-provider.js';

async function withServer(handler, fn) {
  const server=http.createServer(handler);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const {port}=server.address();
  try{return await fn(`http://127.0.0.1:${port}`);}finally{await new Promise(r=>server.close(r));}
}

test('ComfyUI adapter probes and maps workflow submission without importing ComfyUI code', async () => {
  let submitted=null;
  await withServer((req,res)=>{
    if(req.method==='GET'&&req.url==='/system_stats'){
      res.setHeader('content-type','application/json'); res.end(JSON.stringify({system:{os:'linux'}})); return;
    }
    if(req.method==='POST'&&req.url==='/prompt'){
      let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
        submitted=JSON.parse(body); res.setHeader('content-type','application/json'); res.end(JSON.stringify({prompt_id:'p-1',number:1}));
      }); return;
    }
    res.statusCode=404; res.end();
  },async baseUrl=>{
    const p=new ComfyUiProvider({baseUrl});
    assert.equal((await p.probe()).available,true);
    const receipt=await p.queueWorkflow({workflow:{'1':{class_type:'CheckpointLoaderSimple',inputs:{}}},clientId:'eve'});
    assert.equal(receipt.executionId,'p-1');
    assert.deepEqual(submitted,{prompt:{'1':{class_type:'CheckpointLoaderSimple',inputs:{}}},client_id:'eve'});
  });
});

test('ComfyUI adapter fails soft when external server is absent', async () => {
  const p=new ComfyUiProvider({baseUrl:'http://127.0.0.1:9',timeoutMs:100});
  const probe=await p.probe();
  assert.equal(probe.available,false);
  assert.equal(probe.reason,'comfyui_unavailable');
});

test('Diffusers adapter uses a JSON subprocess boundary and fixture generation can produce an artifact', async () => {
  const dir=await mkdtemp(join(tmpdir(),'eve-diffusers-'));
  const output=join(dir,'generated.png');
  const p=new DiffusersProvider({fixture:true});
  const probe=await p.probe();
  assert.equal(probe.available,true);
  assert.equal(probe.mode,'fixture');
  const receipt=await p.generate({prompt:'red geometric character',output,width:32,height:32,seed:7});
  assert.equal(receipt.status,'completed');
  assert.equal(receipt.output,output);
  assert.ok((await stat(output)).size>0);
});

test('Diffusers real probe reports capability honestly', async () => {
  const p=new DiffusersProvider();
  const probe=await p.probe();
  assert.equal(typeof probe.available,'boolean');
  if(!probe.available) assert.equal(probe.reason,'diffusers_not_installed');
});
