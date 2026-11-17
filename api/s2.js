const https = require('https');

// Pre-configured Semantic Scholar API Key on server (Environment variable prioritized)
const S2_DEFAULT_KEY = process.env.S2_API_KEY || '';

// Per-IP rate limiting (in-memory sliding window, max 60 req/min)
const ipRequests = new Map();
function checkRateLimit(ip, maxPerMinute = 60) {
  const now = Date.now();
  const record = ipRequests.get(ip) || [];
  const recent = record.filter(t => now - t < 60000);
  if (recent.length >= maxPerMinute) return false;
  recent.push(now);
  ipRequests.set(ip, recent);
  return true;
}

function queryS2(targetPath, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.semanticscholar.org',
      path: targetPath,
      method: 'GET',
      timeout: 6500, // 6.5s strict timeout to prevent hangs
      headers: {
        'User-Agent': 'Sysrevai/1.0 (Systematic Review Platform; mailto:raouf.roshdy@aimed.org)'
      }
    };

    if (apiKey) {
      options.headers['x-api-key'] = apiKey;
    }

    const s2Req = https.request(options, (s2Res) => {
      let data = '';
      s2Res.on('data', chunk => data += chunk);
      s2Res.on('end', () => {
        resolve({
          statusCode: s2Res.statusCode,
          headers: s2Res.headers,
          body: data
        });
      });
    });

    s2Req.on('timeout', () => {
      s2Req.destroy();
      resolve({
        statusCode: 504,
        headers: {},
        body: JSON.stringify({ error: 'Semantic Scholar upstream timed out (6.5s limit reached)' })
      });
    });

    s2Req.on('error', (err) => {
      reject(err);
    });

    s2Req.end();
  });
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  const isAllowedOrigin = !origin || origin.includes('sysrevai.vercel.app') || origin.includes('localhost') || origin.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', isAllowedOrigin ? (origin || '*') : 'https://sysrevai.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp, 60)) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Too Many Requests: rate limit exceeded (60 req/min)' }));
  }

  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const query = urlObj.searchParams.get('query') || '';
    const rawLimit = parseInt(urlObj.searchParams.get('limit') || '30', 10);
    const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 30 : rawLimit));
    const fields = urlObj.searchParams.get('fields') || 'paperId,title,authors,year,abstract,venue,publicationVenue,journal,externalIds,openAccessPdf,citationCount,publicationTypes,fieldsOfStudy';
    const year = urlObj.searchParams.get('year') || '';
    const paperId = urlObj.searchParams.get('paperId') || '';
    // Security: Only accept key from header, never from URL query string
    const userKey = req.headers['x-api-key'] || S2_DEFAULT_KEY;

    let targetPath = '';
    if (paperId) {
      targetPath = `/graph/v1/paper/${encodeURIComponent(paperId)}?fields=${encodeURIComponent(fields)}`;
    } else {
      targetPath = `/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}&fields=${encodeURIComponent(fields)}`;
      if (year) targetPath += `&year=${encodeURIComponent(year)}`;
    }

    let result = await queryS2(targetPath, userKey);
    // If rate-limited or forbidden with API key, retry once in public pool without key
    if ((result.statusCode === 429 || result.statusCode === 403) && userKey) {
      result = await queryS2(targetPath, null);
    }

    res.statusCode = result.statusCode || 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(result.body);
  } catch (err) {
    console.error('Sysrevai S2 Proxy Error:', err);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Failed to reach Semantic Scholar upstream', details: err.message }));
  }
};
