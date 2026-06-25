/**
 * `make demo` — start the API server + the Vite dev server and open the
 * browser on the rate-limit fixture spine. Ctrl-C stops both.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';

const API_PORT = process.env.PORT ?? '8787';
const WEB_URL = `http://localhost:5173/?fixture=rate-limit`;

const children: ChildProcess[] = [];
function run(cmd: string, args: string[], env: Record<string, string> = {}): ChildProcess {
  const c = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  children.push(c);
  return c;
}

function shutdown(): void {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('demo: starting API server on :' + API_PORT + ' …');
run('npx', ['tsx', 'packages/server/src/main.ts'], { PORT: API_PORT });

console.log('demo: starting web dev server on :5173 …');
run('npm', ['run', 'dev', '--workspace', '@prl/web'], { API_TARGET: `http://127.0.0.1:${API_PORT}` });

// Give the dev server a moment, then open the browser (best-effort).
setTimeout(() => {
  const opener = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
  console.log(`demo: opening ${WEB_URL}`);
  spawn(opener, [WEB_URL], { stdio: 'ignore', detached: true }).unref();
}, 2500);
