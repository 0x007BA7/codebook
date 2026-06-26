import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { escapeHtml } from './render.js';

// Injected so the page reloads itself when the watcher rebuilds.
const RELOAD_SNIPPET =
  `<script>try{new EventSource('/__reload').onmessage=function(){location.reload();};}catch(e){}</script>`;

/**
 * Serve a live-reloading view: render once, open the browser, then re-render on
 * any file change under `watchDir` and tell the page to reload. Reused for the
 * working/staged/tree/PR modes — re-ingest is fast because sem's index stays warm.
 */
export async function runWatch(
  makeHtml: () => Promise<string>,
  watchDir: string,
  port: number,
  openBrowser = true,
): Promise<void> {
  const clients: ServerResponse[] = [];
  let html = '';
  const rebuild = async (): Promise<void> => {
    try {
      html = (await makeHtml()).replace('</body>', RELOAD_SNIPPET + '</body>');
    } catch (err) {
      const msg = escapeHtml(err instanceof Error ? err.message : String(err));
      html = `<body><pre style="color:#b3261e;white-space:pre-wrap">${msg}</pre>${RELOAD_SNIPPET}</body>`;
    }
  };
  await rebuild();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/__reload') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write('\n');
      clients.push(res);
      req.on('close', () => {
        const i = clients.indexOf(res);
        if (i >= 0) clients.splice(i, 1);
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(html);
  });

  // Bind to localhost only — the page can contain your uncommitted/private code.
  let attempt = 0;
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      attempt++;
      server.listen(port + attempt, '127.0.0.1'); // port busy — try the next one
    } else {
      console.error(`watch server error: ${err.message}`);
      process.exit(1);
    }
  });
  server.on('listening', () => {
    const addr = server.address();
    const p = typeof addr === 'object' && addr ? addr.port : port;
    const url = `http://localhost:${p}/`;
    console.error(`watching ${watchDir}\nserving ${url}  (Ctrl-C to stop)`);
    if (openBrowser) {
      const opener = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
      spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
    }
  });
  server.listen(port, '127.0.0.1');

  // Debounce bursts of FS events; ignore noise (.git, node_modules, the output).
  let timer: ReturnType<typeof setTimeout> | null = null;
  const ignore = /(^|\/)(\.git|node_modules|\.worktree)(\/|$)|\.html$/;
  const watcher = watch(watchDir, { recursive: true }, (_event, file) => {
    if (file && ignore.test(String(file))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void (async () => {
        console.error('change detected — rebuilding…');
        await rebuild();
        for (const c of clients) c.write('data: reload\n\n');
      })();
    }, 350);
  });

  const shutdown = (): void => {
    watcher.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
