const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

function handler(req, res) {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/api/s2') {
    const s2Handler = require('./api/s2.js');
    return s2Handler(req, res);
  }
  if (reqPath === '/api/openalex') {
    const openalexHandler = require('./api/openalex.js');
    return openalexHandler(req, res);
  }
  if (reqPath === '/api/crossref') {
    const crossrefHandler = require('./api/crossref.js');
    return crossrefHandler(req, res);
  }
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  
  const rootDir = path.resolve(__dirname);
  const safePath = path.resolve(rootDir, '.' + decodeURIComponent(reqPath));

  if (!safePath.startsWith(rootDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('403 Forbidden');
  }

  const ext = path.extname(safePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(safePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        if (ext === '' || ext === '.html') {
          fs.readFile(path.join(rootDir, 'index.html'), (err2, indexContent) => {
            if (err2) {
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('404 Not Found');
            } else {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(indexContent);
            }
          });
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        }
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Server Error: ' + err.code);
      }
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(content);
    }
  });
}

const server = http.createServer(handler);

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Sysrevai running at http://localhost:${PORT}`);
  });
}

module.exports = handler;
