const https = require('https');

const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || 'LCR4PBZ9z5sTV3HuRDicln';

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  const words = [];
  for (const [w, pos] of Object.entries(invertedIndex)) {
    if (Array.isArray(pos)) {
      for (const i of pos) words[i] = w;
    }
  }
  return words.filter(Boolean).join(' ');
}

function queryOpenAlex(query, pageSize = 30, startYear = null, endYear = new Date().getFullYear()) {
  return new Promise((resolve, reject) => {
    let filter = '';
    if (startYear) {
      filter = `publication_year:${startYear}-${endYear}`;
    }
    const params = new URLSearchParams({
      search: query,
      per_page: String(pageSize),
      api_key: OPENALEX_API_KEY,
      mailto: 'raouf.roshdy@aimed.org'
    });
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
            const rawAuthors = (p.authorships || []).map(a => a.author?.display_name).filter(Boolean);
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
              journal: p.primary_location?.source?.display_name || 'Academic Journal',
              year: p.publication_year || new Date().getFullYear(),
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
    const limit = parseInt(urlObj.searchParams.get('limit') || '30', 10);
    const year = urlObj.searchParams.get('year') || '';

    let startYear = null;
    if (year) {
      const match = year.match(/^(\d{4})/);
      if (match) startYear = parseInt(match[1], 10);
    }

    if (!query) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'Missing query parameter' }));
    }

    const result = await queryOpenAlex(query, limit, startYear);
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
