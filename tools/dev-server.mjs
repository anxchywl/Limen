// Fast local dev server with no-cache headers, correct MIME types, and error reporting.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5180;
const ROOT = process.cwd();

const MIMES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsed.pathname);

  // Diagnostics endpoint
  if (pathname === '/api/error') {
    const msg = parsed.searchParams.get('msg') || '';
    console.error(`\x1b[31m[CLIENT ERROR]\x1b[0m ${msg}`);
    res.writeHead(200, {'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*'});
    res.end('ok');
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  console.log(`[REQ] ${req.method} ${pathname}`);
  const filePath = path.join(ROOT, pathname);

  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIMES[ext] || 'application/octet-stream';
  const data = fs.readFileSync(filePath);

  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': data.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(data);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Limen dev server listening on http://localhost:${PORT} (0.0.0.0) with zero-caching`);
});
