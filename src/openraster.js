import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const WORKER=resolve('providers/python/openraster_worker.py');
function invoke(payload){
  const r=spawnSync('python3',[WORKER],{input:JSON.stringify(payload),encoding:'utf8',maxBuffer:16*1024*1024});
  let parsed;
  try{parsed=JSON.parse(r.stdout||'{}');}catch{parsed=null;}
  if(r.status!==0||!parsed?.ok) throw new Error(parsed?.error??r.stderr??'openraster_worker_failed');
  return parsed.result;
}
export async function writeOpenRaster({output,width,height,layers,name}){
  return invoke({action:'write',output,width,height,layers,name});
}
export async function inspectOpenRaster(path){return invoke({action:'inspect',path});}
