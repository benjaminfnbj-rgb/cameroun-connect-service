'use strict';
// Serveur local qui reproduit les routes de vercel.json pour tester le site avant déploiement.
// Usage : node tests/local-server.js [port]
// MOCK_RESEND=ok|fail : simule l'API Resend (aucun e-mail réel). Sans MOCK_RESEND, la vraie API est appelée
// si RESEND_API_KEY est définie.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const contact = require('../api/contact.js');

const ROOT = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };

function mockFetch() {
  const mode = process.env.MOCK_RESEND;
  if (!mode) return undefined;
  return async () => mode === 'ok'
    ? { ok: true, status: 200, json: async () => ({ id: 'mock' }) }
    : { ok: false, status: 403, json: async () => ({ message: 'mock failure' }) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/contact') {
    return contact.handler(req, res, { fetch: mockFetch() });
  }
  let p = url.pathname;
  if (p === '/en' || p === '/en/') p = '/en/index.html';
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

const port = Number(process.argv[2] || 3000);
server.listen(port, () => console.log('http://localhost:' + port));
