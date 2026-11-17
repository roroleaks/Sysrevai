/**
 * ClinicalTrials.gov proxy — API v2 (no key required).
 * GET /api/ctgov?term=…&cond=…&intr=…&startFrom=YYYY&pageSize=N&pageToken=…
 */
const { createRateLimiter, sendJson, httpsGet, preamble } = require('./_proxy-utils.js');

const checkRateLimit = createRateLimiter(60);

module.exports = async (req, res) => {
  const url = preamble(req, res, checkRateLimit, '60 req/min');
  if (!url) return;
  const term = (url.searchParams.get('term') || '').trim();
  const cond = (url.searchParams.get('cond') || '').trim();
  const intr = (url.searchParams.get('intr') || '').trim();
  if (!term && !cond && !intr) return sendJson(res, 400, { error: 'Missing term / cond / intr parameter' });
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '35', 10) || 35));
  const sp = new URLSearchParams({ pageSize: String(pageSize), countTotal: 'true', format: 'json' });
  if (term) sp.set('query.term', term);
  if (cond) sp.set('query.cond', cond);
  if (intr) sp.set('query.intr', intr);
  const startFrom = url.searchParams.get('startFrom') || '';
  if (/^\d{4}$/.test(startFrom)) sp.set('filter.advanced', `AREA[StartDate]RANGE[${startFrom}-01-01,MAX]`);
  const pageToken = url.searchParams.get('pageToken');
  if (pageToken) sp.set('pageToken', pageToken);

  try {
    const up = await httpsGet('clinicaltrials.gov', `/api/v2/studies?${sp.toString()}`, { timeout: 9000 });
    let json = null;
    try { json = JSON.parse(up.body); } catch (e) { json = null; }
    if (up.statusCode !== 200 || !json) return sendJson(res, up.statusCode === 200 ? 502 : up.statusCode, { error: `ClinicalTrials.gov HTTP ${up.statusCode}` });
    sendJson(res, 200, { totalCount: json.totalCount ?? null, nextPageToken: json.nextPageToken || null, studies: json.studies || [] });
  } catch (err) {
    console.error('SysRevAI ClinicalTrials.gov proxy error:', err);
    sendJson(res, 502, { error: 'Failed to reach ClinicalTrials.gov', details: err.message });
  }
};
