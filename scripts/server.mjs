import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import {
  validateTemplate,
  deriveFields,
  appendEntry,
  formatImportResult,
  SiteEntryError,
} from './lib/site-entry.mjs';

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 3210);

const mimes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function serveStatic(res, absPath) {
  try {
    const data = await readFile(absPath);
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    const html = await readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (req.method === 'POST' && url.pathname === '/api/import') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const signupUrl = validateTemplate(data);
        const { entry, inviteCode, statusApi, base } = deriveFields(signupUrl, data);
        const { warns } = await appendEntry(entry, data.id);
        const text = formatImportResult(entry, inviteCode, statusApi, base, warns);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(text);
      } catch (error) {
        if (error instanceof SiteEntryError) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end(`✘ ${error.message}`);
        }
        console.error(error);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`✘ 服务器错误：${error.message}`);
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
    const safe = path.normalize(url.pathname).replace(/^(\.\.(\/)?)+/, '');
    const absPath = path.join(__dirname, safe);
    return serveStatic(res, absPath);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`🚀 新增平台可视化页面已启动：http://localhost:${PORT}`);
});
