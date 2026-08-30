import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PillowRasterProvider, SharpRasterProvider } from '../src/providers/deterministic-raster-provider.js';

function fixture(path, kind='subject') {
  const r=spawnSync('python3',['tests/helpers/fixture-image.py',path,kind],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
}

test('sharp provider exposes an honest unavailable probe when sharp cannot be imported', async () => {
  const probe = await new SharpRasterProvider().probe();
  assert.equal(typeof probe.available, 'boolean');
  if (!probe.available) assert.equal(probe.reason, 'sharp_not_installed');
});

test('reference deterministic provider crops and resizes without changing the source', async () => {
  const dir=await mkdtemp(join(tmpdir(),'eve-raster-'));
  const input=join(dir,'source.png'); const crop=join(dir,'crop.png'); const resized=join(dir,'resized.png');
  fixture(input);
  const p=new PillowRasterProvider();
  const cropResult=await p.execute({operatorId:'visual.op.raster.crop',input,output:crop,params:{left:4,top:3,width:8,height:10}});
  assert.deepEqual(cropResult.metadata,{width:8,height:10});
  const resizeResult=await p.execute({operatorId:'visual.op.raster.resize',input:crop,output:resized,params:{width:4,height:5}});
  assert.deepEqual(resizeResult.metadata,{width:4,height:5});
  assert.notDeepEqual(await readFile(input),await readFile(resized));
});

test('reference provider creates a mask, applies alpha, and cleans the edge', async () => {
  const dir=await mkdtemp(join(tmpdir(),'eve-alpha-'));
  const input=join(dir,'source.png'); const mask=join(dir,'mask.png'); const alpha=join(dir,'alpha.png'); const clean=join(dir,'clean.png');
  fixture(input);
  const p=new PillowRasterProvider();
  await p.execute({operatorId:'visual.op.raster.create_mask',input,output:mask,params:{background:[255,255,255],tolerance:8}});
  const alphaResult=await p.execute({operatorId:'visual.op.raster.create_alpha',input,output:alpha,params:{mask}});
  assert.equal(alphaResult.metadata.hasAlpha,true);
  const cleanResult=await p.execute({operatorId:'visual.op.raster.edge_cleanup',input:alpha,output:clean,params:{radius:1}});
  assert.equal(cleanResult.metadata.hasAlpha,true);
  assert.ok(cleanResult.metadata.nonTransparentPixels>0);
  assert.ok(cleanResult.metadata.transparentPixels>0);
});

test('reference provider recolors subject pixels and composites an overlay', async () => {
  const dir=await mkdtemp(join(tmpdir(),'eve-color-'));
  const input=join(dir,'source.png'); const recolor=join(dir,'recolor.png'); const overlay=join(dir,'overlay.png'); const composite=join(dir,'composite.png');
  fixture(input); fixture(overlay,'overlay');
  const p=new PillowRasterProvider();
  const rec=await p.execute({operatorId:'visual.op.raster.recolor',input,output:recolor,params:{tint:[0.8,1.0,1.2]}});
  assert.equal(rec.metadata.width,16);
  const comp=await p.execute({operatorId:'visual.op.composite.layer_composite',input:recolor,output:composite,params:{overlay,left:4,top:4}});
  assert.deepEqual(comp.metadata,{width:16,height:16,hasAlpha:true});
});
