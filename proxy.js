/* ============================================================
   proxy.js — 本地跨域代理（零依赖，Node.js 内置模块）
   用途：部分 AI 服务商不允许浏览器直接调用接口时，用它中转
   启动：node proxy.js
   前端接口地址填：http://localhost:8787/proxy/<服务商域名>/v1
   例如：http://localhost:8787/proxy/api.deepseek.com/v1
   ============================================================ */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 8787;

// 白名单：只允许代理这些域名，避免变成开放代理
const ALLOWED_HOSTS = [
  'dashscope.aliyuncs.com',
  'api.deepseek.com',
  'api.moonshot.cn',
  'open.bigmodel.cn',
  'api.openai.com',
  'api.siliconflow.cn',
  'ark.cn-beijing.volces.com'
];

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
}

const server = http.createServer((req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('OK — 代理已启动。前端接口地址示例：http://localhost:' + PORT + '/proxy/api.deepseek.com/v1');
    return;
  }

  // 解析 /proxy/<host>/<path...>
  const m = req.url.match(/^\/proxy\/([^/]+)(\/.*)?$/);
  if (!m) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '路径格式应为 /proxy/<host>/<path>' } }));
    return;
  }

  const host = m[1];
  const path = m[2] || '/';

  if (!ALLOWED_HOSTS.includes(host)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '域名不在白名单：' + host } }));
    return;
  }

  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    const payload = Buffer.concat(body);

    const options = {
      hostname: host,
      port: 443,
      path: path,
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Authorization': req.headers['authorization'] || '',
        'Accept': 'application/json',
        'Content-Length': payload.length
      },
      timeout: 120000
    };

    console.log('[proxy]', req.method, host + path, payload.length + 'B');

    const upstream = https.request(options, upRes => {
      res.writeHead(upRes.statusCode, {
        'Content-Type': upRes.headers['content-type'] || 'application/json; charset=utf-8'
      });
      upRes.pipe(res);
    });

    upstream.on('timeout', () => {
      upstream.destroy();
      res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: '上游接口超时' } }));
    });

    upstream.on('error', err => {
      console.error('[proxy] error:', err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: { message: '上游请求失败：' + err.message } }));
    });

    if (payload.length) upstream.write(payload);
    upstream.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  高考英语应用文改卷 — 本地代理已启动');
  console.log('  地址：http://localhost:' + PORT);
  console.log('');
  console.log('  把前端「AI 设置」里的接口地址改成：');
  console.log('  http://localhost:' + PORT + '/proxy/api.deepseek.com/v1');
  console.log('  （域名换成你实际用的服务商，如 dashscope.aliyuncs.com）');
  console.log('');
  console.log('  按 Ctrl+C 停止。');
  console.log('');
});
