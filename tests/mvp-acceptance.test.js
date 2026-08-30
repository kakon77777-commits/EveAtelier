import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EveAtelierWorkbench } from '../src/workbench.js';
import {
  runBackgroundRemovalScenario,
  runIdentityPreservingRelightScenario,
  runCharacterRemasterFixtureScenario,
} from '../src/mvp-scenarios.js';
import { PillowRasterProvider } from '../src/providers/deterministic-raster-provider.js';
import { OfpLiteProvider } from '../src/providers/ofp-lite-provider.js';
import { DiffusersProvider } from '../src/providers/diffusers-provider.js';

function fixture(path, kind='subject') {
  const r = spawnSync('python3', ['tests/helpers/fixture-image.py', path, kind], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

function relightFixture(path) {
  const code = `from PIL import Image,ImageDraw\nimport sys\nim=Image.new('RGBA',(32,32),(0,0,0,0));d=ImageDraw.Draw(im);d.ellipse((4,4,27,27),fill=(150,100,80,255));im.save(sys.argv[1])`;
  const r = spawnSync('python3', ['-c', code, path], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

function sha(buffer) { return createHash('sha256').update(buffer).digest('hex'); }

test('background removal runs end-to-end and promotes only after independent alpha validation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eve-mvp-bg-'));
  const source = join(dir, 'source.png');
  fixture(source);
  const before = sha(await readFile(source));
  const workbench = new EveAtelierWorkbench({ projectId: 'project:bg' });
  workbench.createDocument({ documentId: 'doc:bg', sourceAsset: source, promotionPolicy: 'automatic_deterministic' });

  const result = await runBackgroundRemovalScenario({
    workbench,
    provider: new PillowRasterProvider(),
    documentId: 'doc:bg',
    workingDir: dir,
  });

  assert.equal(result.verdict, 'ACCEPT');
  assert.equal(result.promoted, true);
  assert.equal(workbench.getDocument('doc:bg').currentVersionId, result.candidateVersionId);
  assert.equal(before, sha(await readFile(source)), 'source asset must remain unchanged');
  assert.ok(result.validation.transparentPixels > 0);
  assert.ok(result.validation.opaquePixels > 0);
});

test('identity-preserving relight uses OFP-lite prerequisites, validates alpha/dimensions independently, then promotes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eve-mvp-relight-'));
  const source = join(dir, 'source.png');
  relightFixture(source);
  const workbench = new EveAtelierWorkbench({ projectId: 'project:relight' });
  workbench.createDocument({ documentId: 'doc:relight', sourceAsset: source, promotionPolicy: 'automatic_deterministic' });

  const result = await runIdentityPreservingRelightScenario({
    workbench,
    provider: new OfpLiteProvider(),
    documentId: 'doc:relight',
    workingDir: dir,
  });

  assert.equal(result.verdict, 'ACCEPT');
  assert.equal(result.promoted, true);
  assert.equal(result.validation.sameDimensions, true);
  assert.equal(result.validation.sameAlpha, true);
  assert.equal(result.validation.rgbChanged, true);
});

test('character remaster fixture proves candidate staging but cannot self-promote without real identity evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eve-mvp-character-'));
  const source = join(dir, 'source.png');
  fixture(source);
  const workbench = new EveAtelierWorkbench({ projectId: 'project:character' });
  workbench.createDocument({ documentId: 'doc:character', sourceAsset: source, promotionPolicy: 'human_required' });
  const originalVersionId = workbench.getDocument('doc:character').currentVersionId;

  const result = await runCharacterRemasterFixtureScenario({
    workbench,
    provider: new DiffusersProvider({ fixture: true }),
    documentId: 'doc:character',
    workingDir: dir,
    prompt: 'wuxia portrait, low saturation, distinct face',
  });

  assert.equal(result.executionMode, 'fixture');
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.equal(result.promoted, false);
  assert.equal(workbench.getDocument('doc:character').currentVersionId, originalVersionId);
  assert.ok(result.candidateVersionId);
  assert.throws(
    () => workbench.promoteCandidate({ documentId: 'doc:character', versionId: result.candidateVersionId, approvedBy: 'human:test' }),
    /candidate_not_accepted/,
  );
});
