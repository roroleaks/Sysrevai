/**
 * Shared helpers for SysRevAI serverless proxies (Node `https` only, no deps).
 * Files prefixed with "_" inside /api are not exposed as Vercel routes.
 */
const https = require('https');

function createRateLimiter(maxPerMinute) {
  const ipRequests = new Map();
  return function checkRateLimit(ip) {
    const now = Date.now();
    const recent = (ipRequests.get(ip) || []).filter(t => now - t < 60000);
    if (recent.length >= maxPerMinute) return false;
    recent.push(now);
    ipRequests.set(ip, recent);
    return true;
  };
}

/** Upstream throttle: guarantees a minimum interval between upstream calls from this instance. */
function createThrottle() {
  let chain = Promise.resolve();
  let last = 0;
  return function throttle(minIntervalMs) {
    const run = chain.then(async () => {
      const wait = Math.max(0, last + minIntervalMs - Date.now());
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      last = Date.now();
    });
    chain = run.catch(() => {});
    return run;
  };
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const isAllowedOrigin = !origin || origin.includes('sysrevai.vercel.app') || origin.includes('localhost') || origin.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', isAllowedOrigin ? (origin || '*') : 'https://sysrevai.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** GET https://hostname/path with a strict timeout. Resolves {statusCode, body}; 504 on timeout. */
function httpsGet(hostname, path, { timeout = 8000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'GET', timeout,
      headers: Object.assign({ 'User-Agent': 'SysRevAI/1.0 (Systematic Review Platform)', Accept: 'application/json' }, headers)
    }, upstream => {
      let data = '';
      upstream.setEncoding('utf8');
      upstream.on('data', c => { data += c; });
      upstream.on('end', () => resolve({ statusCode: upstream.statusCode, body: data, headers: upstream.headers }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 504, body: JSON.stringify({ error: `${hostname} timed out (${timeout} ms)` }) }); });
    req.on('error', reject);
    req.end();
  });
}

/** Common request preamble: CORS, OPTIONS, rate limit. Returns parsed URL or null if handled. */
function preamble(req, res, checkRateLimit, limitLabel) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return null; }
  if (!checkRateLimit(clientIp(req))) {
    sendJson(res, 429, { error: `Too Many Requests: rate limit exceeded (${limitLabel})` });
    return null;
  }
  return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
}

module.exports = { createRateLimiter, createThrottle, setCors, clientIp, sendJson, httpsGet, preamble };
