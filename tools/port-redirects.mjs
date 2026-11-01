import http from 'node:http';

const ports = [3000, 8000, 8080, 5173];
for (const p of ports) {
  try {
    const s = http.createServer((req, res) => {
      res.writeHead(302, {Location: 'http://localhost:5180' + (req.url || '/')});
      res.end();
    });
    s.on('error', () => {});
    s.listen(p, '0.0.0.0', () => console.log(`Redirecting port ${p} -> http://localhost:5180`));
  } catch (_) {}
}
