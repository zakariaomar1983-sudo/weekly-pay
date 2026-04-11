const http = require('http');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const port = 4173;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const full = path.normalize(path.join(root, rel));

  if (!full.startsWith(root)) return send(res, 403, 'Forbidden');

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not Found');
    const ext = path.extname(full).toLowerCase();
    const type = mime[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(full).pipe(res);
  });
}).listen(port, () => {
  console.log(`Static server running at http://localhost:${port}`);
});
