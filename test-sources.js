/**
 * SysRevAI — Mandatory source proxies & adapters test suite (all network mocked).
 * Covers: PubMed proxy (esearch+efetch, structured abstracts), SerpApi missing-key path,
 * ClinicalTrials.gov proxy + mapping, RIS parser, Scholar enrichment, per-source query
 * translation, and the absence of any cross-source substitution on failure.
 */
const https = require('https');
const { EventEmitter } = require('events');
const { loadApp, createAsserter } = require('./test-app-harness.js');

console.log('================================================================');
console.log('🌐 SYSREV AI: MANDATORY SOURCE PROXIES & ADAPTERS TESTS');
console.log('================================================================\n');

loadApp();
const assert = createAsserter();

// ── https.request mock ───────────────────────────────────────
let httpsCalls = [];
let httpsRoutes = [];
const realRequest = https.request;
https.request = (options, cb) => {
  const url = `https://${options.hostname}${options.path}`;
  httpsCalls.push(url);
  const route = httpsRoutes.find(r => r.match(url));
  const req = new EventEmitter();
  req.end = () => {
    setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = route ? route.status || 200 : 404;
      res.headers = {};
      res.setEncoding = () => {};
      cb(res);
      res.emit('data', route ? route.body(url) : '{}');
      res.emit('end');
    });
  };
  req.destroy = () => {};
  return req;
};

function callHandler(handler, url) {
  return new Promise(resolve => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      end: (body) => resolve({ status: res.statusCode, headers, body: body ? JSON.parse(body) : null })
    };
    handler({ url, method: 'GET', headers: { host: 'localhost', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` }, socket: {} }, res);
  });
}

// ── global.fetch mock for browser adapters ───────────────────
let fetchCalls = [];
let fetchRoutes = [];
global.fetch = async (url) => {
  fetchCalls.push(String(url));
  const route = fetchRoutes.find(r => r.match(String(url)));
  if (!route) return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({ error: 'unmocked' }) };
  const status = route.status || 200;
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => route.json(String(url)) };
};

const PUBMED_XML = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation Status="MEDLINE"><PMID Version="1">32865377</PMID>
<Article PubModel="Print-Electronic"><Journal><JournalIssue CitedMedium="Internet"><Volume>383</Volume><Issue>15</Issue><PubDate><Year>2020</Year><Month>Oct</Month></PubDate></JournalIssue><Title>The New England journal of medicine</Title><ISOAbbreviation>N Engl J Med</ISOAbbreviation></Journal>
<ArticleTitle>Cardiovascular and Renal Outcomes with Empagliflozin in Heart Failure.</ArticleTitle><Pagination><MedlinePgn>1413-1424</MedlinePgn></Pagination>
<ELocationID EIdType="doi" ValidYN="Y">10.1056/NEJMoa2022190</ELocationID>
<Abstract><AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">SGLT2 inhibitors reduce &lt;i&gt;risk&lt;/i&gt; of hospitalization.</AbstractText><AbstractText Label="METHODS" NlmCategory="METHODS">In this double-blind trial, 3730 patients were randomly assigned.</AbstractText><AbstractText Label="RESULTS">Primary outcome 19.4% vs 24.7%.</AbstractText></Abstract>
<AuthorList CompleteYN="Y"><Author ValidYN="Y"><LastName>Packer</LastName><ForeName>Milton</ForeName><Initials>M</Initials></Author><Author ValidYN="Y"><CollectiveName>EMPEROR-Reduced Trial Investigators</CollectiveName></Author></AuthorList>
<DataBankList CompleteYN="Y"><DataBank><DataBankName>ClinicalTrials.gov</DataBankName><AccessionNumberList><AccessionNumber>NCT03057977</AccessionNumber></AccessionNumberList></DataBank></DataBankList>
<PublicationTypeList><PublicationType UI="D016449">Randomized Controlled Trial</PublicationType><PublicationType UI="D016428">Journal Article</PublicationType></PublicationTypeList></Article>
<MeshHeadingList><MeshHeading><DescriptorName UI="D006333" MajorTopicYN="Y">Heart Failure</DescriptorName></MeshHeading></MeshHeadingList></MedlineCitation>
<PubmedData><ArticleIdList><ArticleId IdType="pubmed">32865377</ArticleId><ArticleId IdType="doi">10.1056/NEJMoa2022190</ArticleId><ArticleId IdType="pmc">PMC1234567</ArticleId></ArticleIdList>
<ReferenceList><Reference><Citation>Other paper</Citation><ArticleIdList><ArticleId IdType="doi">10.9999/WRONG</ArticleId><ArticleId IdType="pubmed">1</ArticleId></ArticleIdList></Reference></ReferenceList></PubmedData></PubmedArticle></PubmedArticleSet>`;

const CTGOV_STUDY = {
  hasResults: true,
  protocolSection: {
    identificationModule: { nctId: 'NCT03057977', briefTitle: 'EMPEROR-Reduced', officialTitle: 'EMPagliflozin outcomE tRial in Patients With chrOnic heaRt Failure With Reduced Ejection Fraction', secondaryIdInfos: [{ id: '2016-002280-34' }] },
    statusModule: { overallStatus: 'COMPLETED', startDateStruct: { date: '2017-03-06' }, completionDateStruct: { date: '2020-05-28' } },
    descriptionModule: { briefSummary: 'Evaluate empagliflozin vs placebo in HFrEF.' },
    conditionsModule: { conditions: ['Heart Failure'] },
    armsInterventionsModule: { interventions: [{ name: 'Empagliflozin' }, { name: 'Placebo' }] },
    designModule: { studyType: 'INTERVENTIONAL', phases: ['PHASE3'], designInfo: { allocation: 'RANDOMIZED' }, enrollmentInfo: { count: 3730 } },
    sponsorCollaboratorsModule: { leadSponsor: { name: 'Boehringer Ingelheim' } },
    referencesModule: { references: [{ pmid: '32865377', type: 'RESULT' }, { pmid: '11111111', type: 'BACKGROUND' }] }
  }
};

(async () => {
  const strategy = buildSearchStrategy({ baseQuery: '("heart failure" OR HFrEF) AND (SGLT2 OR empagliflozin)', yearRange: 5, perSourceLimit: 35 });

  console.log('▶️ SHARED STRATEGY → NATIVE QUERY TRANSLATION');
  assert(translators.pubmed(strategy) === '(("heart failure"[tiab] OR HFrEF[tiab]) AND (SGLT2[tiab] OR empagliflozin[tiab])) NOT (review[pt] OR editorial[pt] OR letter[pt] OR comment[pt])', 'PubMed: [tiab] terms, Boolean blocks, review/editorial/letter/comment exclusion');
  assert(/"Cochrane Database Syst Rev"\[ta\]$/.test(translators.cochrane_cdsr_pubmed(strategy)) && !/NOT \(review/.test(translators.cochrane_cdsr_pubmed(strategy)), 'Cochrane CDSR PubMed query uses [ta] filter and NO review exclusion');
  assert(/JOURNAL:"Cochrane Database Syst Rev"/.test(translators.cochrane_cdsr_epmc(strategy)), 'Cochrane CDSR Europe PMC query uses JOURNAL filter');
  assert(/AND SRC:PPR$/.test(translators.epmc_preprints(strategy)) && /\(SRC:MED OR SRC:PMC\)/.test(translators.epmc(strategy)), 'Europe PMC (MED/PMC) and preprints (SRC:PPR) are separate queries');
  const ct = translators.ctgov(strategy);
  assert(ct.cond === '"heart failure" OR HFrEF' && ct.intr === 'SGLT2 OR empagliflozin', 'ClinicalTrials.gov: query.cond / query.intr from PICO concept blocks');
  assert(!/\bAND\b/.test(translators.scholar(strategy)) && /OR/.test(translators.scholar(strategy)), 'Google Scholar: implicit AND, OR kept');
  const cl = buildCochraneLibrarySearch(strategy);
  assert(/#1\t\("heart failure":ti,ab,kw OR HFrEF:ti,ab,kw\)/.test(cl.searchManager) && /#3\t#1 AND #2/.test(cl.searchManager), 'Copy-ready Cochrane Library search-manager strategy generated');
  assert(SOURCE_REGISTRY.every(s => typeof s.translateQuery(strategy) === 'string' && s.translateQuery(strategy).length > 0), 'Every registry source produces a query string to log');

  console.log('\n▶️ PUBMED PROXY (api/pubmed.js)');
  process.env.NCBI_EMAIL = 'test@example.org';
  process.env.NCBI_API_KEY = 'ncbi-test-key';
  httpsCalls = [];
  httpsRoutes = [
    { match: u => u.includes('/esearch.fcgi'), body: () => JSON.stringify({ esearchresult: { count: '1318', idlist: ['32865377'] } }) },
    { match: u => u.includes('/efetch.fcgi'), body: () => PUBMED_XML }
  ];
  const pubmedHandler = require('./api/pubmed.js');
  const pm = await callHandler(pubmedHandler, '/api/pubmed?term=' + encodeURIComponent('heart failure[tiab]') + '&retmax=35&mindate=2021&maxdate=2026');
  const rec = pm.body.records[0];
  assert(pm.status === 200 && pm.body.hitCount === 1318 && pm.body.records.length === 1, 'esearch count → hitCount, efetch → records');
  assert(/tool=sysrevai/.test(httpsCalls[0]) && /email=test%40example.org/.test(httpsCalls[0]) && /api_key=ncbi-test-key/.test(httpsCalls[0]), 'E-utilities calls carry tool, email and api_key');
  assert(/datetype=pdat&mindate=2021&maxdate=2026/.test(httpsCalls[0]) && /sort=relevance/.test(httpsCalls[0]), 'Publication-date limits and relevance sort sent to esearch');
  assert(rec.abstract === 'Background: SGLT2 inhibitors reduce risk of hospitalization. Methods: In this double-blind trial, 3730 patients were randomly assigned. Results: Primary outcome 19.4% vs 24.7%.', 'Structured abstract sections joined with their labels', rec.abstract);
  assert(rec.doi === '10.1056/NEJMoa2022190' && rec.pmcid === 'PMC1234567' && rec.pmid === '32865377', 'DOI / PMCID from ArticleIdList (reference-list IDs ignored)');
  assert(rec.journalAbbr === 'N Engl J Med' && rec.volume === '383' && rec.issue === '15' && rec.pages === '1413-1424' && rec.year === 2020, 'Journal, volume, issue, pages, year mapped');
  assert(rec.authorObjects.length === 2 && rec.authorObjects[0].family === 'Packer' && rec.authorObjects[1].displayName === 'EMPEROR-Reduced Trial Investigators', 'Authors incl. collective name mapped');
  assert(rec.meshHeadings[0] === 'Heart Failure' && rec.pubType.includes('randomized controlled trial') && rec.nctIds[0] === 'NCT03057977', 'MeSH, publication types and DataBank NCT IDs mapped');
  const pmBad = await callHandler(pubmedHandler, '/api/pubmed?term=');
  assert(pmBad.status === 400, 'Missing term → 400');

  console.log('\n▶️ GOOGLE SCHOLAR PROXY (api/scholar.js, SerpApi)');
  delete process.env.SERPAPI_KEY;
  httpsCalls = [];
  const scholarHandler = require('./api/scholar.js');
  const nk = await callHandler(scholarHandler, '/api/scholar?q=heart');
  assert(nk.status === 503 && nk.body.error === 'not_configured' && nk.body.missing === 'SERPAPI_KEY', 'Missing SERPAPI_KEY → 503 not_configured');
  assert(httpsCalls.length === 0, 'Missing SERPAPI_KEY → NO network call (no scraping, no fallback)');
  process.env.SERPAPI_KEY = 'serp-secret';
  httpsRoutes = [{ match: u => u.startsWith('https://serpapi.com/search.json'), body: () => JSON.stringify({ search_metadata: { json_endpoint: 'x' }, search_parameters: { api_key: 'serp-secret' }, search_information: { total_results: 5400 }, organic_results: [{ position: 0, title: 'Empagliflozin in heart failure', result_id: 'R1', link: 'https://x', snippet: 'snip', publication_info: { summary: 'M Packer, SD Anker - New England Journal of Medicine, 2020 - Mass Medical Soc', authors: [{ name: 'M Packer' }] }, inline_links: { cited_by: { total: 3000 }, versions: { cluster_id: 'C9' } } }] }) }];
  const sk = await callHandler(scholarHandler, '/api/scholar?q=heart&start=0&num=20&as_ylo=2021&as_yhi=2026');
  assert(sk.status === 200 && sk.body.total_results === 5400 && sk.body.organic_results.length === 1, 'SerpApi results forwarded');
  assert(/engine=google_scholar/.test(httpsCalls[0]) && /as_vis=1/.test(httpsCalls[0]) && /as_ylo=2021/.test(httpsCalls[0]) && /hl=en/.test(httpsCalls[0]), 'engine=google_scholar, as_vis=1, year limits and hl=en sent');
  assert(!JSON.stringify(sk.body).includes('serp-secret'), 'SerpApi key never echoed to the browser');
  delete process.env.SERPAPI_KEY;

  console.log('\n▶️ CLINICALTRIALS.GOV PROXY & MAPPING (api/ctgov.js)');
  httpsCalls = [];
  httpsRoutes = [{ match: u => u.startsWith('https://clinicaltrials.gov/api/v2/studies'), body: () => JSON.stringify({ totalCount: 57, studies: [CTGOV_STUDY] }) }];
  const ctHandler = require('./api/ctgov.js');
  const ctr = await callHandler(ctHandler, '/api/ctgov?cond=' + encodeURIComponent('"heart failure"') + '&intr=SGLT2&startFrom=2021&pageSize=35');
  assert(ctr.status === 200 && ctr.body.totalCount === 57 && ctr.body.studies.length === 1, 'CT.gov v2 studies forwarded with totalCount');
  assert(/query.cond=/.test(httpsCalls[0]) && /query.intr=SGLT2/.test(httpsCalls[0]) && /countTotal=true/.test(httpsCalls[0]) && decodeURIComponent(httpsCalls[0]).includes('AREA[StartDate]RANGE[2021-01-01,MAX]'), 'query.cond / query.intr / countTotal / StartDate range sent');
  const m = mapCtgovStudy(CTGOV_STUDY);
  assert(m.nctId === 'NCT03057977' && m.isRegistryRecord && m.sourceKey === 'ctgov' && m.abstract === 'Evaluate empagliflozin vs placebo in HFrEF.', 'nctId, registry flag and briefSummary-as-abstract mapped');
  assert(m.allocation === 'RANDOMIZED' && m.pubType.includes('randomized controlled trial') && m.enrollment === 3730 && m.phases[0] === 'PHASE3' && m.hasResults === true && m.year === 2017, 'Allocation feeds study design; enrollment, phases, hasResults, start year mapped');
  assert(m.referencePmids.length === 1 && m.referencePmids[0] === '32865377', 'Only RESULT/DERIVED reference PMIDs are used for linking');

  console.log('\n▶️ COCHRANE CENTRAL RIS PARSER');
  const ris = `TY  - JOUR\nID  - CN-02164488\nTI  - Cardiovascular and renal outcomes with empagliflozin\n      in heart failure\nAU  - Packer, M\nAU  - Anker, SD\nPY  - 2020\nJO  - New England journal of medicine\nVL  - 383\nIS  - 15\nSP  - 1413\nEP  - 1424\nDO  - 10.1056/NEJMoa2022190\nAN  - PUBMED 32865377\nAB  - Background text.\nKW  - Heart Failure\nKW  - SGLT2\nER  - \nTY  - JOUR\nID  - CN-01600000\nTI  - Empagliflozin in HFrEF (EMPEROR-Reduced)\nJO  - https://clinicaltrials.gov/show/NCT03057977\nPY  - 2017\nUR  - https://www.cochranelibrary.com/central/doi/10.1002/central/CN-01600000/full\nER  - \n`;
  const parsed = parseRIS(ris);
  assert(parsed.length === 2, 'Two RIS records parsed');
  assert(parsed[0].title === 'Cardiovascular and renal outcomes with empagliflozin in heart failure' && parsed[0].pmid === '32865377' && parsed[0].centralId === 'CN-02164488', 'Multi-line TI joined; PMID from AN; CENTRAL accession from ID');
  assert(parsed[0].pages === '1413-1424' && parsed[0].authors === 'Packer, M, Anker, SD' && parsed[0].keywords.length === 2 && parsed[0].doi === '10.1056/NEJMoa2022190' && parsed[0].year === 2020, 'SP/EP, AU, KW, DO, PY mapped');
  assert(parsed[1].isRegistryRecord && parsed[1].nctIds[0] === 'NCT03057977', 'Registry record in CENTRAL export detected, NCT extracted');
  assert(parsed.every(r => r.sources[0] === 'Cochrane CENTRAL' && r.sourceKey === 'cochrane_central'), "Imported records marked sources: ['Cochrane CENTRAL']");

  console.log('\n▶️ BROWSER ADAPTERS (mocked fetch)');
  fetchCalls = [];
  fetchRoutes = [{ match: u => u.startsWith('/api/pubmed?'), json: () => ({ hitCount: 1318, records: [Object.assign({}, rec)] }) }];
  const pmRes = await getSource('pubmed').fetch(strategy, {}, null);
  assert(pmRes.status === 'ok' && pmRes.retrievedCount === 1 && pmRes.hitCount === 1318 && pmRes.records[0].sources[0] === 'PubMed', 'PubMed adapter: ok, hits vs retrieved reported');
  assert(pmRes.searches[0].query.startsWith(translators.pubmed(strategy)) && pmRes.searches[0].timestamp && pmRes.searches[0].interface === 'PubMed via NCBI E-utilities', 'Exact executed PubMed query, interface and timestamp logged');

  fetchCalls = [];
  fetchRoutes = [{ match: u => u.startsWith('/api/scholar?'), status: 503, json: () => ({ error: 'not_configured', missing: 'SERPAPI_KEY' }) }];
  const schRes = await getSource('scholar').fetch(strategy, {}, null);
  assert(schRes.status === 'not_configured' && schRes.records.length === 0 && /SERPAPI_KEY/.test(schRes.reason), 'Scholar adapter: not_configured with reason, zero records');
  assert(fetchCalls.length === 1 && fetchCalls.every(u => u.startsWith('/api/scholar')), 'Scholar not_configured → no other source queried instead');

  // No cross-source substitution on failure, for every automatic source
  const ownEndpoint = {
    pubmed: /^\/api\/pubmed/, epmc: /europepmc/, epmc_preprints: /europepmc/, cochrane_cdsr: /^\/api\/pubmed|europepmc/,
    s2: /^\/api\/s2/, openalex: /^\/api\/openalex/, crossref: /^\/api\/crossref/, ctgov: /^\/api\/ctgov/, scholar: /^\/api\/scholar/
  };
  for (const src of SOURCE_REGISTRY.filter(s => s.key !== 'cochrane_central')) {
    fetchCalls = [];
    fetchRoutes = [];
    const r = await src.fetch(strategy, {}, null);
    const foreign = fetchCalls.filter(u => !ownEndpoint[src.key].test(u));
    assert(r.status === 'failed' && r.records.length === 0 && r.retrievedCount === 0 && foreign.length === 0, `${src.displayName}: HTTP 503 → status failed, 0 records, no substitute source called`, `status=${r.status} foreign=${foreign.join(',')}`);
  }

  // 429 is retried within the same source only
  fetchCalls = [];
  let n429 = 0;
  fetchRoutes = [{ match: u => u.startsWith('/api/s2?'), get status() { return n429++ < 1 ? 429 : 200; }, json: () => ({ total: 1, data: [{ paperId: 'a'.repeat(40), title: 'T', externalIds: {} }] }) }];
  const s2r = await getSource('s2').fetch(strategy, {}, null);
  assert(s2r.status === 'ok' && fetchCalls.length === 2 && fetchCalls.every(u => u.startsWith('/api/s2')), 'HTTP 429 retried with backoff within the same source');

  const cen = await getSource('cochrane_central').fetch(strategy, {}, null);
  assert(cen.status === 'not_searched' && cen.reason === 'CENTRAL export not provided' && cen.records.length === 0, 'CENTRAL without RIS → not_searched ("CENTRAL export not provided")');

  console.log('\n▶️ GOOGLE SCHOLAR ENRICHMENT');
  const scholarRec = mapScholarResult({ title: 'Empagliflozin in Heart Failure with a Preserved Ejection Fraction', result_id: 'R2', snippet: 'A snippet', publication_info: { summary: 'SD Anker, J Butler - New England Journal of Medicine, 2021 - Mass Medical Soc', authors: [{ name: 'SD Anker' }] } });
  assert(scholarRec.year === 2021 && scholarRec.journal === 'New England Journal of Medicine' && scholarRec.abstract === '' && scholarRec.scholarSnippet === 'A snippet', 'SerpApi result mapped; snippet kept out of abstract');
  fetchCalls = [];
  fetchRoutes = [
    { match: u => u.startsWith('/api/crossref?') && u.includes('bibliographic='), json: () => ({ data: [{ title: 'Empagliflozin in Heart Failure with a Preserved Ejection Fraction', doi: '10.1056/NEJMoa2107038', year: 2021 }] }) },
    { match: u => u.includes('europepmc') && u.includes('DOI%3A'), json: () => ({ resultList: { result: [{ pmid: '34449189', pmcid: 'PMC9', abstractText: 'Real abstract from Europe PMC.', title: 'x', pubType: 'randomized controlled trial; journal article' }] } }) }
  ];
  const enriched = await enrichScholarRecord(scholarRec, null);
  assert(enriched.doi === '10.1056/NEJMoa2107038' && enriched.pmid === '34449189' && enriched.abstract === 'Real abstract from Europe PMC.' && enriched.abstractSource === 'europepmc-enrichment', 'Crossref match (Jaccard ≥ 0.90, |Δyear| ≤ 1) → DOI → Europe PMC abstract + PMID');
  assert(enriched.sources.length === 1 && enriched.sources[0] === 'Google Scholar', 'Enriched record is still credited only to Google Scholar');
  fetchRoutes = [{ match: u => u.startsWith('/api/crossref?'), json: () => ({ data: [{ title: 'Empagliflozin in Heart Failure with a Preserved Ejection Fraction', doi: '10.1/x', year: 2017 }] }) }];
  const unmatched = await enrichScholarRecord(Object.assign({}, scholarRec), null);
  assert(!unmatched.doi && unmatched.abstract === '' && unmatched.abstractSource === 'none' && unmatched.scholarSnippet === 'A snippet', 'Year off by >1 → no DOI accepted; abstract empty, abstractSource none, snippet kept separately');

  https.request = realRequest;
  assert.summary('SOURCES & PROXIES SUITE');
})().catch(err => { console.error(err); process.exit(1); });
