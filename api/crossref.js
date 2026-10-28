const https = require('https');

function cleanAbstract(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/<jats:[^>]+>/gi, '')
    .replace(/<\/jats:[^>]+>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:Abstract|Summary)\s*[:.-]?\s*/i, '');
}

function extractYear(item) {
  const dateParts = item.published?.['date-parts']?.[0]
    || item['published-print']?.['date-parts']?.[0]
    || item['published-online']?.['date-parts']?.[0]
    || item.created?.['date-parts']?.[0]
    || item.issued?.['date-parts']?.[0];
  if (Array.isArray(dateParts) && dateParts.length > 0 && Number(dateParts[0]) > 1900) {
    return Number(dateParts[0]);
  }
  return null;
}

function queryCrossref(query, pageSize = 30, startYear = null, endYear = null) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      query: query,
      rows: String(pageSize),
      sort: 'relevance',
      order: 'desc'
    });

    const filters = [];
    if (startYear) {
      filters.push(`from-pub-date:${startYear}-01-01`);
    }
    if (endYear) {
      filters.push(`until-pub-date:${endYear}-12-31`);
    }
    if (filters.length > 0) {
      params.set('filter', filters.join(','));
    }

    const options = {
      hostname: 'api.crossref.org',
      path: `/works?${params.toString()}`,
      method: 'GET',
      timeout: 8000,
      headers: {
        'User-Agent': 'SysRevAI/1.0 (Systematic Review Platform; mailto:raouf.roshdy@aimed.org)',
        'Accept': 'application/json'
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
          const items = json.message?.items || [];
          const currentYear = new Date().getFullYear();

          const results = items.map(item => {
            const rawTitle = Array.isArray(item.title) ? item.title[0] : (item.title || 'Untitled Study');
            const cleanTitle = (rawTitle || '').replace(/<[^>]+>/g, '').trim();

            let authorsStr = 'Unknown Authors';
            if (Array.isArray(item.author) && item.author.length > 0) {
              authorsStr = item.author
                .map(a => {
                  if (a.family) {
                    const initials = (a.given || '').split(/[\s.-]+/).filter(Boolean).map(n => n[0].toUpperCase()).join('');
                    return initials ? `${a.family} ${initials}` : a.family;
                  }
                  return a.name || [a.given, a.family].filter(Boolean).join(' ') || '';
                })
                .filter(Boolean)
                .join(', ') || 'Unknown Authors';
            }

            const journal = (Array.isArray(item['container-title']) && item['container-title'][0])
              || (Array.isArray(item['short-container-title']) && item['short-container-title'][0])
              || item.publisher
              || 'Academic Journal';

            const pubYear = extractYear(item);
            const doi = item.DOI ? item.DOI.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim() : '';
            const abstract = cleanAbstract(item.abstract);
            const citations = Number(item['is-referenced-by-count'] || 0);

            return {
              id: doi || item.URL || Math.random().toString(36).substring(7),
              paperId: doi || item.URL || '',
              pmid: '',
              doi: doi,
              pmcid: '',
              title: cleanTitle || 'Untitled Study',
              authors: authorsStr,
              authorObjects: Array.isArray(item.author) ? item.author : [],
              journal: journal,
              volume: item.volume || '',
              issue: item.issue || '',
              pages: item.page || item['article-number'] || '',
              year: pubYear,
              abstract: abstract,
              abstract_summary: abstract,
              citationCount: citations,
              citation_count: citations,
              isOpenAccess: Boolean(item.license && item.license.length > 0),
              openAccessPdfUrl: item.link?.[0]?.URL || (doi ? `https://doi.org/${doi}` : ''),
              source: 'crossref',
              sources: ['Crossref'],
              source_url: item.URL || (doi ? `https://doi.org/${doi}` : ''),
              meshHeadings: [],
              keywords: Array.isArray(item.subject) ? item.subject : [],
              pubType: [item.type || 'journal-article']
            };
          });

          resolve({
            statusCode: 200,
            total: json.message?.['total-results'] || results.length,
            data: results
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 504, data: [], total: 0, error: 'Crossref upstream timed out (8s limit reached)' });
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const query = urlObj.searchParams.get('query') || '';
    const limit = parseInt(urlObj.searchParams.get('limit') || urlObj.searchParams.get('rows') || '30', 10);
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

    if (!query) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'Missing query parameter' }));
    }

    const result = await queryCrossref(query, limit, startYear, endYear);
    res.statusCode = result.statusCode || 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      statusCode: result.statusCode,
      total: result.total,
      data: result.data,
      papers: result.data
    }));
  } catch (err) {
    console.error('Sysrevai Crossref Proxy Error:', err);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Failed to reach Crossref upstream', details: err.message }));
  }
};
