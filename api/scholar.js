/**
 * Google Scholar proxy — via SerpApi (engine=google_scholar). Google Scholar is never scraped.
 * GET /api/scholar?q=…&start=0&num=20&as_ylo=YYYY&as_yhi=YYYY
 * Without SERPAPI_KEY this returns 503 {error:'not_configured'} and makes NO upstream call.
 */
const { createRateLimiter, sendJson, httpsGet, preamble } = require('./_proxy-utils.js');

const checkRateLimit = createRateLimiter(30);

module.exports = async (req, res) => {
  const url = preamble(req, res, checkRateLimit, '30 req/min');
  if (!url) return;
  const key = process.env.SERPAPI_KEY || '';
  if (!key) return sendJson(res, 503, { error: 'not_configured', missing: 'SERPAPI_KEY', message: 'Google Scholar requires a SerpApi key (SERPAPI_KEY) on the server.' });

  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return sendJson(res, 400, { error: 'Missing q parameter' });
  const num = Math.min(20, Math.max(1, parseInt(url.searchParams.get('num') || '20', 10) || 20));
  const start = Math.min(980, Math.max(0, parseInt(url.searchParams.get('start') || '0', 10) || 0));
  const sp = new URLSearchParams({ engine: 'google_scholar', q, num: String(num), start: String(start), as_vis: '1', hl: 'en', api_key: key });
  const ylo = url.searchParams.get('as_ylo'); const yhi = url.searchParams.get('as_yhi');
  if (/^\d{4}$/.test(ylo || '')) sp.set('as_ylo', ylo);
  if (/^\d{4}$/.test(yhi || '')) sp.set('as_yhi', yhi);

  try {
    const up = await httpsGet('serpapi.com', `/search.json?${sp.toString()}`, { timeout: 9000 });
    let json = null;
    try { json = JSON.parse(up.body); } catch (e) { json = null; }
    if (up.statusCode !== 200 || !json || json.error) {
      return sendJson(res, up.statusCode === 200 ? 502 : up.statusCode, { error: `SerpApi: ${(json && json.error) || `HTTP ${up.statusCode}`}` });
    }
    // Never echo search_metadata/search_parameters back to the browser (they can reference the key).
    const organic = (json.organic_results || []).map(r => ({
      position: r.position, title: r.title, result_id: r.result_id, link: r.link, snippet: r.snippet,
      publication_info: r.publication_info, resources: r.resources,
      inline_links: r.inline_links ? { cited_by: r.inline_links.cited_by ? { total: r.inline_links.cited_by.total } : undefined, versions: r.inline_links.versions ? { cluster_id: r.inline_links.versions.cluster_id } : undefined } : undefined
    }));
    sendJson(res, 200, { total_results: json.search_information?.total_results ?? null, start, num, organic_results: organic });
  } catch (err) {
    console.error('SysRevAI Scholar proxy error:', err);
    sendJson(res, 502, { error: 'Failed to reach SerpApi', details: err.message });
  }
};
