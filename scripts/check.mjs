import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function sourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    if (entry.isFile() && (path.endsWith('.js') || path.endsWith('.mjs'))) files.push(path);
  }
  return files.sort();
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  });
}

const roots = ['src', 'scripts'].map(path => resolve(path));
const files = roots.flatMap(sourceFiles);

for (const file of files) {
  const result = run(process.execPath, ['--check', file]);
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `syntax_check_failed:${file}\n`);
    process.exit(result.status ?? 1);
  }
}

const configuredPython = process.env.PYTHON?.trim();
const pythonCandidates = configuredPython ? [configuredPython] : ['python3', 'python'];
let pythonChecked = false;

for (const python of pythonCandidates) {
  const result = run(python, ['-m', 'compileall', '-q', 'providers/python']);
  if (result.error?.code === 'ENOENT') continue;
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `python_compile_failed:${python}\n`);
    process.exit(result.status ?? 1);
  }
  pythonChecked = true;
  break;
}

if (!pythonChecked) {
  process.stderr.write('python_interpreter_not_found\n');
  process.exit(1);
}

process.stdout.write(`checked_js=${files.length} checked_python=true\n`);
