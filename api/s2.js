const https = require('https');

// Pre-configured Semantic Scholar API Key on server (Environment variable prioritized)
const S2_DEFAULT_KEY = process.env.S2_API_KEY || 's2k-0rcC3ztnxRdNGsOKL1SNvwbOPnSaRh4qHBT9qe7A';

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const query = urlObj.searchParams.get('query') || '';
    const limit = urlObj.searchParams.get('limit') || '30';
    const fields = urlObj.searchParams.get('fields') || 'paperId,title,authors,year,abstract,venue,publicationVenue,journal,externalIds,openAccessPdf,citationCount,publicationTypes,fieldsOfStudy';
    const year = urlObj.searchParams.get('year') || '';
    const paperId = urlObj.searchParams.get('paperId') || '';
    const userKey = req.headers['x-api-key'] || urlObj.searchParams.get('key') || S2_DEFAULT_KEY;

    let targetPath = '';
    if (paperId) {
      targetPath = `/graph/v1/paper/${encodeURIComponent(paperId)}?fields=${encodeURIComponent(fields)}`;
    } else {
      targetPath = `/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}&fields=${encodeURIComponent(fields)}`;
      if (year) targetPath += `&year=${encodeURIComponent(year)}`;
    }

    const result = await queryS2(targetPath, userKey);
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
