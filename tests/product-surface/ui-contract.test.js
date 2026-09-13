import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('static workbench contains every bounded roadmap surface and safe DOM rendering', async () => {
  const root = new URL('../../apps/workbench-ui/', import.meta.url);
  const [html, script, styles] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('app.js', root), 'utf8'),
    readFile(new URL('styles.css', root), 'utf8'),
  ]);
  for (const surface of [
    'intent', 'reference-board', 'canvas', 'candidate-compare', 'history', 'human-review',
  ]) assert.match(html, new RegExp(`data-surface="${surface}"`));
  assert.match(html, /aria-live="polite"/);
  assert.match(script, /\/api\/intents/);
  assert.match(script, /\/api\/reviews/);
  assert.doesNotMatch(script, /innerHTML\s*=\s*(?!['"]{2})/);
  assert.doesNotMatch(script, /providerId|modelId|checkpoint|ComfyUI/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media/);
});
