const https = require('https');

const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || '';

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

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  let maxPos = -1;
  for (const pos of Object.values(invertedIndex)) {
    if (Array.isArray(pos)) {
      for (const i of pos) {
        if (typeof i === 'number' && i > maxPos) maxPos = i;
      }
    }
  }
  if (maxPos < 0) return '';
  const words = new Array(maxPos + 1);
  for (const [w, pos] of Object.entries(invertedIndex)) {
    if (Array.isArray(pos)) {
      for (const i of pos) {
        if (typeof i === 'number' && i >= 0) words[i] = w;
      }
    }
  }
  return words.filter(Boolean).join(' ');
}

function queryOpenAlex(query, pageSize = 30, startYear = null, endYear = null, opts = {}) {
  return new Promise((resolve, reject) => {
    let filter = '';
    if (opts.doi) {
      // DOI lookup mode (used to enrich Google Scholar records)
      filter = `doi:https://doi.org/${opts.doi}`;
    } else if (startYear) {
      filter = endYear ? `publication_year:${startYear}-${endYear}` : `publication_year:${startYear}-${new Date().getFullYear()}`;
    }
    const params = new URLSearchParams(opts.doi ? {
      per_page: '1',
      mailto: 'raouf.roshdy@aimed.org'
    } : {
      search: query,
      per_page: String(pageSize),
      mailto: 'raouf.roshdy@aimed.org'
    });
    if (OPENALEX_API_KEY) {
      params.set('api_key', OPENALEX_API_KEY);
    }
    if (filter) params.set('filter', filter);

    const options = {
      hostname: 'api.openalex.org',
      path: `/works?${params.toString()}`,
      method: 'GET',
      timeout: 8000,
      headers: {
        'User-Agent': 'SysRevAI/1.0 (Systematic Review Platform; mailto:raouf.roshdy@aimed.org)'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return resolve({
            statusCode: res.statusCode,
            data: [],
            total: 0
          });
        }
        try {
          const json = JSON.parse(data);
          const results = (json.results || []).map(p => {
            const authorObjects = (p.authorships || []).map(a => ({
              displayName: a.author?.display_name || '',
              orcid: a.author?.orcid || ''
            }));
            const rawAuthors = authorObjects.map(a => a.displayName).filter(Boolean);
            const doi = p.doi ? p.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim() : '';
            const pmid = p.ids?.pmid ? String(p.ids.pmid).replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, '').replace(/^pmid:\s*/i, '').replace(/\/$/, '') : '';
            const pmcid = p.ids?.pmcid ? String(p.ids.pmcid).replace(/^https?:\/\/www\.ncbi\.nlm\.nih\.gov\/pmc\/articles\//i, '').replace(/\/$/, '') : '';
            const abstract = reconstructAbstract(p.abstract_inverted_index);
            const meshHeadings = Array.isArray(p.mesh) ? p.mesh.map(m => m.descriptor_name).filter(Boolean) : [];

            return {
              id: p.id || doi || pmid,
              paperId: p.id,
              openalex_id: p.id,
              title: p.title || 'Untitled Study',
              authors: rawAuthors.length > 0 ? rawAuthors.join(', ') : 'Unknown Authors',
              authorObjects: authorObjects,
              journal: p.primary_location?.source?.display_name || 'Academic Journal',
              volume: p.biblio?.volume || '',
              issue: p.biblio?.issue || '',
              pages: (p.biblio?.first_page && p.biblio?.last_page) ? `${p.biblio.first_page}-${p.biblio.last_page}` : (p.biblio?.first_page || ''),
              year: p.publication_year || null,
              publication_date: p.publication_date || String(p.publication_year || ''),
              abstract: abstract,
              abstract_summary: abstract,
              citationCount: Number(p.cited_by_count || 0),
              citation_count: Number(p.cited_by_count || 0),
              doi: doi,
              pmid: pmid,
              pmcid: pmcid,
              source: 'openalex',
              sources: ['OpenAlex'],
              source_url: p.id || (doi ? `https://doi.org/${doi}` : ''),
              openAccessPdfUrl: p.open_access?.oa_url || (doi ? `https://doi.org/${doi}` : ''),
              isOpenAccess: Boolean(p.open_access?.is_oa),
              meshHeadings: meshHeadings,
              keywords: (p.concepts || []).map(c => c.display_name).filter(Boolean),
              pubType: [p.type || 'journal-article']
            };
          });

          resolve({
            statusCode: 200,
            total: json.meta?.count || results.length,
            meta: json.meta,
            data: results
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 504, data: [], total: 0, error: 'OpenAlex upstream timed out (8s limit reached)' });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
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
    const doi = (urlObj.searchParams.get('doi') || '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
    const rawLimit = parseInt(urlObj.searchParams.get('limit') || '30', 10);
    const limit = Math.min(200, Math.max(1, isNaN(rawLimit) ? 30 : rawLimit));
    const year = urlObj.searchParams.get('year') || '';

    let startYear = null;
    let endYear = null;
    if (year) {
      const rangeMatch = year.match(/^(\d{4})\s*[-–—]\s*(\d{4})/);
      if (rangeMatch) {
        startYear = parseInt(rangeMatch[1], 10);
        endYear = parseInt(rangeMatch[2], 10);
      } else {
        const match = year.match(/^(\d{4})/);
        if (match) startYear = parseInt(match[1], 10);
      }
    }

    if (!query && !doi) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'Missing query parameter' }));
    }

    const result = await queryOpenAlex(query, limit, startYear, endYear, { doi: /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : '' });
    res.statusCode = result.statusCode || 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      statusCode: result.statusCode,
      total: result.total,
      data: result.data,
      papers: result.data,
      meta: result.meta
    }));
  } catch (err) {
    console.error('Sysrevai OpenAlex Proxy Error:', err);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Failed to reach OpenAlex upstream', details: err.message }));
  }
};
