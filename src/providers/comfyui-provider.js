export class ComfyUiProvider {
  constructor({baseUrl='http://127.0.0.1:8188',timeoutMs=1500}={}){
    this.baseUrl=baseUrl.replace(/\/$/,''); this.timeoutMs=timeoutMs;
    this.providerId='provider:comfyui-external';
  }
  async #json(path,options={}){
    const signal=AbortSignal.timeout(this.timeoutMs);
    const r=await fetch(`${this.baseUrl}${path}`,{...options,signal});
    if(!r.ok) throw new Error(`comfyui_http_${r.status}`);
    return r.json();
  }
  async probe(){
    try{
      const info=await this.#json('/system_stats');
      return {available:true,providerId:this.providerId,mode:'external_http',info};
    }catch(error){return {available:false,reason:'comfyui_unavailable',detail:String(error)};}
  }
  async queueWorkflow({workflow,clientId}){
    const body={prompt:workflow}; if(clientId) body.client_id=clientId;
    const result=await this.#json('/prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if(typeof result.prompt_id!=='string') throw new Error('comfyui_missing_prompt_id');
    return {executionId:result.prompt_id,status:'running',providerId:this.providerId,queueNumber:result.number??null};
  }
}
