'use strict';

// Static server for the viewport spike. Only reason it exists: ES modules and
// a 132 MB payload need an origin, and file:// gives neither. THROWAWAY.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8181);
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.bin': 'application/octet-stream', '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = rel.startsWith('vendor/')
    ? path.join(__dirname, 'node_modules', rel.slice('vendor/'.length))
    : path.join(__dirname, rel);

  if (!file.startsWith(__dirname)) {
    res.writeHead(403).end('no');
    return;
  }

  fs.stat(file, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'content-length': stats.size,
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`spike on http://127.0.0.1:${PORT}/`));
