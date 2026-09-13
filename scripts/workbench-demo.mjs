import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createDemoWorkbenchRuntime } from '../src/product-surface/demo-runtime.js';
import { createHumanWorkbenchHttpServer } from '../src/product-surface/http-server.js';

function parsePort(argv) {
  if (argv.length === 0) return 4175;
  if (argv.length !== 2 || argv[0] !== '--port' || !/^\d+$/.test(argv[1])) {
    throw new Error('usage: npm run workbench:demo -- --port <1-65535>');
  }
  const port = Number(argv[1]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('workbench_demo_port_invalid');
  }
  return port;
}

const port = parsePort(process.argv.slice(2));
const artifactRoot = resolve('artifacts', 'runtime');
await mkdir(artifactRoot, { recursive: true });
const runRoot = await mkdtemp(join(artifactRoot, 'workbench-v05-'));
const runtime = await createDemoWorkbenchRuntime({ root: runRoot });
const host = createHumanWorkbenchHttpServer({ surface: runtime.surface, port });
const listening = await host.listen();

process.stdout.write(`EveAtelier v0.5 Human Workbench\n${listening.baseUrl}\n`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await host.close();
  runtime.close();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await close();
    process.exitCode = 0;
  });
}
