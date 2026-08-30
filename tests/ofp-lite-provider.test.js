import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { OfpLiteProvider } from '../src/providers/ofp-lite-provider.js';

function makeRelightFixture(path){
  const code=`from PIL import Image,ImageDraw\nimport sys\nim=Image.new('RGBA',(32,32),(0,0,0,0));d=ImageDraw.Draw(im);d.ellipse((4,4,27,27),fill=(150,100,80,255));im.save(sys.argv[1])`;
  const r=spawnSync('python3',['-c',code,path],{encoding:'utf8'}); assert.equal(r.status,0,r.stderr);
}

test('OFP-lite infers a normalized approximate normal field from a raster', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'eve-ofp-normal-'));
  const input=join(dir,'source.png'); const normal=join(dir,'normal.png'); makeRelightFixture(input);
  const p=new OfpLiteProvider();
  const result=await p.execute({operatorId:'visual.op.physical.infer_normal',input,output:normal,params:{strength:2}});
  assert.deepEqual(result.metadata.size,{width:32,height:32});
  assert.equal(result.metadata.channels,'RGB');
  assert.ok(result.metadata.meanNormalZ>0.5);
  assert.ok((await readFile(normal)).length>0);
});

test('OFP-lite relights deterministically while preserving alpha and structure dimensions', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'eve-ofp-relight-'));
  const input=join(dir,'source.png'); const normal=join(dir,'normal.png'); const output=join(dir,'relit.png'); makeRelightFixture(input);
  const p=new OfpLiteProvider();
  await p.execute({operatorId:'visual.op.physical.infer_normal',input,output:normal,params:{strength:2}});
  const result=await p.execute({
    operatorId:'visual.op.physical.relight',input,output,
    params:{normal,keyDirection:[-0.6,-0.4,1],keyColor:[0.65,0.78,1.0],keyIntensity:0.9,fillColor:[1.0,0.55,0.35],fillIntensity:0.25,ambient:0.25}
  });
  assert.equal(result.metadata.inputAlphaHash,result.metadata.outputAlphaHash);
  assert.deepEqual(result.metadata.size,{width:32,height:32});
  assert.notEqual(result.metadata.inputRgbHash,result.metadata.outputRgbHash);
  assert.ok(result.metadata.meanLuminance>0);
});
