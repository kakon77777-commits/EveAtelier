import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('repository validation runs without platform-specific shell utilities', () => {
  const result = spawnSync(process.execPath, ['scripts/check.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /checked_js=\d+ checked_python=true/);
});
