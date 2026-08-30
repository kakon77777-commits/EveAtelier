import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
export class OfpLiteProvider {
  constructor({python='python3',worker=resolve('providers/python/ofp_lite_worker.py')}={}){
    this.python=python; this.worker=worker; this.providerId='provider:ofp-lite'; this.providerVersion='0.1';
  }
  async execute(request){
    const r=spawnSync(this.python,[this.worker],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:16*1024*1024});
    let parsed; try{parsed=JSON.parse(r.stdout||'{}');}catch{parsed=null;}
    if(r.status!==0||!parsed?.ok) throw new Error(parsed?.error??r.stderr??'ofp_lite_failed');
    return {providerId:this.providerId,providerVersion:this.providerVersion,operatorId:request.operatorId,output:request.output,metadata:parsed.metadata};
  }
}
