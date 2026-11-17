/**
 * PubMed / MEDLINE proxy — NCBI E-utilities (esearch → efetch XML).
 * GET /api/pubmed?term=…&retmax=N&mindate=YYYY&maxdate=YYYY
 * The client sends the fully translated PubMed term; this proxy executes it verbatim.
 */
const { createRateLimiter, createThrottle, sendJson, httpsGet, preamble } = require('./_proxy-utils.js');

const checkRateLimit = createRateLimiter(60);
const throttle = createThrottle();
const EUTILS_HOST = 'eutils.ncbi.nlm.nih.gov';

function ncbiParams() {
  const p = new URLSearchParams({ tool: 'sysrevai' });
  if (process.env.NCBI_EMAIL) p.set('email', process.env.NCBI_EMAIL);
  if (process.env.NCBI_API_KEY) p.set('api_key', process.env.NCBI_API_KEY);
  return p;
}

// NCBI policy: ≤3 requests/s without an API key, ≤10/s with one.
function minInterval() { return process.env.NCBI_API_KEY ? 105 : 340; }

// ─── Minimal, dependency-free PubMed XML extraction ───
function decodeXml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function block(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : '';
}
function blocks(xml, tag) {
  const out = [];
  const rx = new RegExp(`<${tag}((?:\\s[^>]*)?)>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = rx.exec(xml)) !== null) out.push({ attrs: m[1] || '', inner: m[2] });
  return out;
}
function attr(attrs, name) {
  const m = String(attrs).match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : '';
}

function parseArticle(xml) {
  const citation = block(xml, 'MedlineCitation');
  const article = block(citation, 'Article');
  const journal = block(article, 'Journal');
  const issue = block(journal, 'JournalIssue');
  const pubDate = block(issue, 'PubDate');
  const yearStr = block(pubDate, 'Year') || (block(pubDate, 'MedlineDate').match(/(19|20)\d{2}/) || [''])[0] || (block(block(article, 'ArticleDate'), 'Year'));
  // Strip the reference list: it contains nested ArticleIdLists for cited works.
  const pubmedData = block(xml, 'PubmedData').replace(/<ReferenceList[\s\S]*?<\/ReferenceList>/g, '');
  const ids = {};
  blocks(block(pubmedData, 'ArticleIdList'), 'ArticleId').forEach(a => { ids[attr(a.attrs, 'IdType')] = decodeXml(a.inner); });
  const elocDoi = blocks(article, 'ELocationID').find(e => attr(e.attrs, 'EIdType') === 'doi');

  const abstractParts = blocks(block(article, 'Abstract'), 'AbstractText').map(a => {
    const label = attr(a.attrs, 'Label');
    const text = decodeXml(a.inner);
    return label ? `${label.charAt(0) + label.slice(1).toLowerCase()}: ${text}` : text;
  }).filter(Boolean);

  const authorObjects = blocks(block(article, 'AuthorList'), 'Author').map(a => {
    const collective = decodeXml(block(a.inner, 'CollectiveName'));
    const family = decodeXml(block(a.inner, 'LastName'));
    const given = decodeXml(block(a.inner, 'ForeName'));
    const initials = decodeXml(block(a.inner, 'Initials'));
    return collective
      ? { family: collective, given: '', initials: '', displayName: collective }
      : { family, given, initials, displayName: `${family} ${initials}`.trim() };
  }).filter(a => a.displayName);

  const nctIds = [];
  blocks(block(article, 'DataBankList'), 'DataBank').forEach(db => {
    blocks(db.inner, 'AccessionNumber').forEach(n => { const v = decodeXml(n.inner).toUpperCase(); if (/^NCT\d{8}$/.test(v)) nctIds.push(v); });
  });

  const pmid = decodeXml(block(citation, 'PMID')) || ids.pubmed || '';
  return {
    id: pmid,
    pmid,
    doi: ids.doi || (elocDoi ? decodeXml(elocDoi.inner) : ''),
    pmcid: ids.pmc || '',
    title: decodeXml(block(article, 'ArticleTitle')) || decodeXml(block(article, 'VernacularTitle')) || 'Untitled Publication',
    authors: authorObjects.map(a => a.displayName).join(', ') || 'Unknown Authors',
    authorObjects,
    journal: decodeXml(block(journal, 'Title')) || 'Scholarly Journal',
    journalAbbr: decodeXml(block(journal, 'ISOAbbreviation')) || decodeXml(block(block(citation, 'MedlineJournalInfo'), 'MedlineTA')),
    volume: decodeXml(block(issue, 'Volume')),
    issue: decodeXml(block(issue, 'Issue')),
    pages: decodeXml(block(block(article, 'Pagination'), 'MedlinePgn')),
    year: yearStr ? Number(yearStr) : null,
    abstract: abstractParts.join(' '),
    meshHeadings: blocks(block(citation, 'MeshHeadingList'), 'DescriptorName').map(d => decodeXml(d.inner)).filter(Boolean),
    keywords: blocks(block(citation, 'KeywordList'), 'Keyword').map(k => decodeXml(k.inner)).filter(Boolean),
    pubType: blocks(block(article, 'PublicationTypeList'), 'PublicationType').map(p => decodeXml(p.inner).toLowerCase()).filter(Boolean),
    nctIds,
    citationCount: 0,
    isOpenAccess: !!ids.pmc
  };
}

function parsePubmedXml(xml) {
  return blocks(String(xml || ''), 'PubmedArticle').map(a => parseArticle(a.inner));
}

async function eutils(path) {
  await throttle(minInterval());
  return httpsGet(EUTILS_HOST, path, { timeout: 8000 });
}

module.exports = async (req, res) => {
  const url = preamble(req, res, checkRateLimit, '60 req/min');
  if (!url) return;
  const term = (url.searchParams.get('term') || '').trim();
  if (!term) return sendJson(res, 400, { error: 'Missing term parameter' });
  const retmax = Math.min(200, Math.max(1, parseInt(url.searchParams.get('retmax') || '35', 10) || 35));
  const retstart = Math.max(0, parseInt(url.searchParams.get('retstart') || '0', 10) || 0);
  const mindate = (url.searchParams.get('mindate') || '').match(/^\d{4}$/) ? url.searchParams.get('mindate') : '';
  const maxdate = (url.searchParams.get('maxdate') || '').match(/^\d{4}$/) ? url.searchParams.get('maxdate') : '';

  try {
    const sp = ncbiParams();
    sp.set('db', 'pubmed'); sp.set('term', term); sp.set('retmax', String(retmax)); sp.set('retstart', String(retstart));
    sp.set('retmode', 'json'); sp.set('sort', 'relevance');
    if (mindate) { sp.set('datetype', 'pdat'); sp.set('mindate', mindate); sp.set('maxdate', maxdate || String(new Date().getFullYear())); }
    const search = await eutils(`/entrez/eutils/esearch.fcgi?${sp.toString()}`);
    if (search.statusCode !== 200) return sendJson(res, search.statusCode === 429 ? 429 : 502, { error: `PubMed esearch HTTP ${search.statusCode}` });
    let sj;
    try { sj = JSON.parse(search.body); } catch (e) { return sendJson(res, 502, { error: 'PubMed esearch returned invalid JSON' }); }
    if (sj.esearchresult?.ERROR) return sendJson(res, 400, { error: `PubMed: ${sj.esearchresult.ERROR}` });
    const idList = sj.esearchresult?.idlist || [];
    const hitCount = Number(sj.esearchresult?.count || 0);

    const records = [];
    for (let i = 0; i < idList.length; i += 200) {
      const fp = ncbiParams();
      fp.set('db', 'pubmed'); fp.set('id', idList.slice(i, i + 200).join(',')); fp.set('retmode', 'xml');
      const fetchRes = await eutils(`/entrez/eutils/efetch.fcgi?${fp.toString()}`);
      if (fetchRes.statusCode !== 200) return sendJson(res, 502, { error: `PubMed efetch HTTP ${fetchRes.statusCode}` });
      records.push(...parsePubmedXml(fetchRes.body));
    }
    // Keep esearch relevance order
    const order = new Map(idList.map((id, i) => [String(id), i]));
    records.sort((a, b) => (order.get(a.pmid) ?? 1e9) - (order.get(b.pmid) ?? 1e9));
    sendJson(res, 200, { hitCount, retrievedCount: records.length, query: term, idList, records });
  } catch (err) {
    console.error('SysRevAI PubMed proxy error:', err);
    sendJson(res, 502, { error: 'Failed to reach NCBI E-utilities', details: err.message });
  }
};
module.exports.parsePubmedXml = parsePubmedXml;
