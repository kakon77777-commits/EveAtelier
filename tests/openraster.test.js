import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeOpenRaster, inspectOpenRaster } from '../src/openraster.js';

function fixture(path, kind) {
  const r=spawnSync('python3',['tests/helpers/fixture-image.py',path,kind],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
}

test('writes and reads a minimal OpenRaster 0.0.6 layer stack', async () => {
  const dir=await mkdtemp(join(tmpdir(),'eve-ora-'));
  const base=join(dir,'base.png'); const overlay=join(dir,'overlay.png'); const ora=join(dir,'test.ora');
  fixture(base,'subject'); fixture(overlay,'overlay');
  const written=await writeOpenRaster({
    output:ora,
    width:16,
    height:16,
    layers:[
      {name:'Base',src:base,opacity:1,visible:true},
      {name:'Overlay',src:overlay,opacity:0.5,visible:true,x:4,y:4},
    ],
  });
  assert.equal(written.layerCount,2);
  const info=await inspectOpenRaster(ora);
  assert.equal(info.mimetype,'image/openraster');
  assert.equal(info.version,'0.0.6');
  assert.deepEqual(info.size,{width:16,height:16});
  assert.deepEqual(info.layers.map(x=>x.name),['Base','Overlay']);
  assert.equal(info.mimetypeFirst,true);
  assert.equal(info.mimetypeStored,true);
});
