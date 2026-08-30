import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
export class DiffusersProvider {
  constructor({python='python3',worker=resolve('providers/python/diffusers_worker.py'),fixture=false}={}){
    this.python=python; this.worker=worker; this.fixture=fixture; this.providerId='provider:diffusers-python';
  }
  #invoke(payload){
    const args=[this.worker]; if(this.fixture) args.push('--fixture');
    const r=spawnSync(this.python,args,{input:JSON.stringify(payload),encoding:'utf8',maxBuffer:16*1024*1024});
    let parsed; try{parsed=JSON.parse(r.stdout||'{}');}catch{parsed=null;}
    if(r.status!==0||!parsed?.ok) throw new Error(parsed?.error??r.stderr??'diffusers_worker_failed');
    return parsed.result;
  }
  async probe(){return this.#invoke({action:'probe'});}
  async generate({prompt,output,width=64,height=64,seed=0}){
    const result=this.#invoke({action:'generate',prompt,output,width,height,seed});
    if(result.status!=='completed') throw new Error(result.reason??'diffusers_unavailable');
    return {providerId:this.providerId,providerVersion:'0.1',operatorId:'visual.op.generative.generate',status:'completed',...result};
  }
}
