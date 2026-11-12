import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const root = process.cwd(),
  manifest = JSON.parse(readFileSync('.openai/hosting.json', 'utf8'));
manifest.d1 = 'DB';
manifest.r2 = null;
delete manifest.static;
writeFileSync('.openai/hosting.json', JSON.stringify(manifest, null, 2) + '\n');
const files = ['seed', 'engine', 'security', 'ai', 'reports', 'api'];
let code = files
  .map(name =>
    readFileSync(`src/${name}.mjs`, 'utf8')
      .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
      .replace(/^export /gm, '')
  )
  .join('\n');
const assets = {};
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else assets['/' + relative(resolve(root, 'public'), p).replaceAll('\\', '/')] = readFileSync(p, 'utf8');
  }
};
walk(resolve(root, 'public'));
code += '\nconst STATIC_ASSETS=' + JSON.stringify(assets) + ';\n';
code += `export default {async fetch(request,env){const path=new URL(request.url).pathname;if(path.startsWith('/api/'))return handleApi(request,env);if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});const key=path==='/'?'/index.html':path;const asset=STATIC_ASSETS[key];if(asset===undefined)return new Response('Not found',{status:404});const type=key.endsWith('.html')?'text/html':key.endsWith('.css')?'text/css':key.endsWith('.mjs')||key.endsWith('.js')?'text/javascript':key.endsWith('.svg')?'image/svg+xml':'text/plain';return new Response(request.method==='HEAD'?null:asset,{headers:{...securityHeaders,'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache'}});}};\n`;
mkdirSync('dist/server', { recursive: true });
mkdirSync('dist/.openai', { recursive: true });
writeFileSync('dist/server/index.js', code);
writeFileSync('dist/.openai/hosting.json', JSON.stringify(manifest, null, 2));
console.log(`Worker built: ${(Buffer.byteLength(code) / 1024 / 1024).toFixed(2)} MiB, ${Object.keys(assets).length} embedded assets.`);
