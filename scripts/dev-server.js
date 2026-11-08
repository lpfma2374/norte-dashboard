// Servidor local: ficheiros estáticos + /api/* com os handlers das Vercel Functions.
// MOCK_D1=1 usa o mock em memória (scripts/mock-d1.js) em vez da Cloudflare.
const http = require('http');
const fs = require('fs');
const path = require('path');
if (process.env.MOCK_D1 === '1') require('./mock-d1').install();

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const port = Number(process.env.PORT) || 3000;

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice(5).replace(/[^a-z-]/g, '');
    const file = path.join(ROOT, 'api', name + '.js');
    if (!name || name.startsWith('_') || !fs.existsSync(file)) { res.statusCode = 404; return res.end('{}'); }
    return require(file)(req, res);
  }
  let p = path.normalize(path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log('Norte Dashboard em http://localhost:' + port));
