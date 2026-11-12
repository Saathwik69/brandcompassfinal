import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDB } from './src/local-db.mjs';
import { handleApi } from './src/api.mjs';
import { securityHeaders } from './src/security.mjs';

const root = fileURLToPath(new URL('.', import.meta.url)),
  publicRoot = resolve(root, 'public');

// Load .env if present (supported Node.js 24 runtime)
const envPath = resolve(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const db = openDB(process.env.DB_PATH || resolve(root, 'data/brandcompass.sqlite'));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`);
    let response;
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2500000) {
          res.writeHead(413, { 'Content-Type': 'application/json', ...securityHeaders });
          res.end(JSON.stringify({ error: 'Request is too large.' }));
          return;
        }
        chunks.push(chunk);
      }
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {})
      });
      response = await handleApi(request, { ...process.env, DB: db });
    } else {
      const path = resolve(publicRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(publicRoot + sep)) throw new Error('not_found');
      if (!(await stat(path)).isFile()) throw new Error('not_found');
      response = new Response(await readFile(path), {
        headers: { ...securityHeaders, 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }
      });
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...securityHeaders });
    res.end('Not found');
  }
});

const option = name => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const port = Number(option('--port') || process.env.PORT || 3000),
  host = option('--host') || process.env.HOST || (process.env.SITES_MANAGED_LINUX_CONTAINER === '1' ? '0.0.0.0' : '127.0.0.1');
server.listen(port, host, () =>
  console.log(`BrandCompass is ready: http://localhost:${port}\nNode ${process.version} | SQLite persistence (AES-256-GCM encrypted) | Press Ctrl+C to stop`)
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    })
  );
