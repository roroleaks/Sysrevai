/**
 * SysRevAI — "No paper repeated, ever" deduplication & study-linking test suite (spec §3).
 */
const fs = require('fs');
const path = require('path');
const { loadApp, createAsserter } = require('./test-app-harness.js');

console.log('================================================================');
console.log('🧬 SYSREV AI: CLUSTER DEDUPLICATION & STUDY-LINKING TESTS');
console.log('================================================================\n');

const { indexHtml } = loadApp();
const assert = createAsserter();

function freshPool(topic = 'SGLT2 inhibitors in heart failure') {
  resetSourceState();
  STATE.topic = topic;
  STATE.pico = { p: 'heart failure', i: 'SGLT2 inhibitors (empagliflozin, dapagliflozin)', c: 'placebo', o: 'hospitalization', s: 'RCT' };
  STATE.inclusionCriteria = [];
  STATE.exclusionCriteria = [];
  STATE.centralImport = null;
  STATE.centralAck = null;
  STATE.searchStrategy = buildSearchStrategy({ baseQuery: '"heart failure" AND (SGLT2 OR empagliflozin)', topic, yearRange: 99, perSourceLimit: 35 });
}
function okStatus(key, n, hits) {
  STATE.sourceStatus[key] = { status: 'ok', retrievedCount: n, hitCount: hits || n, error: null, reason: null, warnings: [] };
}
const RCT_ABSTRACT = 'Background: SGLT2 inhibitors in heart failure. Methods: In this randomized, double-blind, placebo-controlled trial, 3730 patients with heart failure were randomly assigned to empagliflozin or placebo. Results: Hospitalization for heart failure occurred in 19.4% vs 24.7%.';

// ─────────────────────────────────────────────────────────────
console.log('▶️ 3.3 CLUSTER MATCHING & CONFLICT GUARD');
{
  const X = { sourceKey: 'pubmed', id: 'x', pmid: '1', title: 'Empagliflozin outcomes in chronic heart failure with reduced ejection fraction', year: 2020 };
  const Y = { sourceKey: 'crossref', id: 'y', doi: '10.1000/ABC', title: 'A completely differently worded record of the same paper', year: 2020 };
  const Z = { sourceKey: 's2', id: 'z', pmid: '1', doi: 'https://doi.org/10.1000/abc', title: 'Something else entirely', year: 2020 };
  const r = clusterRecords([X, Y, Z]);
  assert(r.unique.length === 1 && r.removed === 2, 'Transitive X{pmid:1} · Y{doi:A} · Z{pmid:1, doi:A} collapse into ONE record', `unique=${r.unique.length}`);
  assert(r.unique[0].sources.length === 3 && r.unique[0].pmid === '1' && r.unique[0].doi === '10.1000/abc', 'Merged record keeps all 3 sources, PMID and normalised DOI');
  assert(r.unique[0].sourceKey === 'pubmed', 'Primary record chosen by priority (PubMed > Crossref > S2)');

  const P1 = { sourceKey: 'pubmed', id: 'p1', pmid: '111', title: 'Dapagliflozin in heart failure: results of a large randomized trial part 1', year: 2021, authors: 'McMurray JJ' };
  const P2 = { sourceKey: 'epmc', id: 'p2', pmid: '222', title: 'Dapagliflozin in heart failure: results of a large randomized trial part 2', year: 2021, authors: 'McMurray JJ' };
  const g = clusterRecords([P1, P2]);
  assert(g.unique.length === 2 && g.blocked.length >= 1 && g.blocked.every(b => b.reason === 'different PMIDs'), 'Conflict guard: different non-empty PMIDs are never merged on fuzzy title');
  const D1 = { sourceKey: 'crossref', id: 'd1', doi: '10.1/one', title: 'Identical title of two different articles in two journals', year: 2022 };
  const D2 = { sourceKey: 'openalex', id: 'd2', doi: '10.1/two', title: 'Identical title of two different articles in two journals', year: 2022 };
  assert(clusterRecords([D1, D2]).unique.length === 2, 'Conflict guard: different non-empty DOIs are never merged on exact title');
  // cluster-level guard: A{pmid1} ~title~ B{} ~doi~ C{pmid2}
  const A = { sourceKey: 'pubmed', id: 'a', pmid: '10', title: 'Shared title for transitive conflict check here', year: 2020 };
  const B = { sourceKey: 'scholar', id: 'b', doi: '10.9/zz', title: 'Shared title for transitive conflict check here', year: 2020 };
  const C = { sourceKey: 'epmc', id: 'c', pmid: '20', doi: '10.9/zz', title: 'Unrelated', year: 2020 };
  const t = clusterRecords([A, B, C]);
  assert(t.unique.length === 2 && findIdentifierCollisions(t.unique).length === 0, 'Cluster-level guard: a merged cluster never ends up with two distinct PMIDs');

  const S = { sourceKey: 'scholar', id: 'sch1', scholarResultId: 'abc123', title: 'Empagliflozin in Heart Failure with a Preserved Ejection Fraction', year: 2021, authors: 'SD Anker, J Butler', authorObjects: [{ displayName: 'SD Anker', family: 'Anker' }] };
  const PM = { sourceKey: 'pubmed', id: 'pm1', pmid: '34449189', doi: '10.1056/NEJMoa2107038', title: 'Empagliflozin in heart failure with a preserved ejection fraction.', year: 2021, authors: 'Anker SD, Butler J', authorObjects: [{ family: 'Anker', initials: 'SD' }] };
  const sm = clusterRecords([PM, S]);
  assert(sm.unique.length === 1 && sm.unique[0].sources.includes('Google Scholar') && sm.unique[0].scholarResultId === 'abc123', 'Google Scholar record without DOI is matched to PubMed by title/year/author');
  const S2 = Object.assign({}, S, { id: 'sch2', scholarResultId: 'zzz', authors: 'K Other', authorObjects: [{ family: 'Other' }], title: 'Empagliflozin in heart failure with preserved ejection fraction patients' });
  const fm = clusterRecords([PM, S2]);
  assert(fm.unique.length === 2, 'Fuzzy title match is refused when first-author surnames disagree');
}

// ─────────────────────────────────────────────────────────────
console.log('\n▶️ 3.4 STUDY-LEVEL LINKING');
{
  const pre = { sourceKey: 'epmc_preprints', id: 'PPR1', doi: '10.1101/2020.05.01.20087000', title: 'Empagliflozin and cardiovascular outcomes in heart failure: a randomised trial', year: 2020, authors: 'Packer M, Anker SD', peerReviewed: false };
  const pub = { sourceKey: 'pubmed', id: 'pub1', pmid: '32865377', doi: '10.1056/NEJMoa2022190', title: 'Cardiovascular and renal outcomes with empagliflozin in heart failure: a randomised trial', year: 2020, authors: 'Packer M, Anker SD' };
  const r = clusterRecords([pre, pub]);
  assert(r.unique.length === 1 && r.unique[0].doi === '10.1056/nejmoa2022190' && r.unique[0].peerReviewed === true, 'Preprint vs published: one study, published record is primary');
  assert((r.unique[0].relatedReports || []).some(x => x.type === 'preprint' && x.doi === '10.1101/2020.05.01.20087000'), 'Preprint DOI kept under relatedReports (not as the DOI)');
  assert(r.log.some(l => l.matchedOn === 'preprint-published' && l.kind === 'link'), 'Audit log records preprint-published link');

  const reg = { sourceKey: 'ctgov', isRegistryRecord: true, id: 'NCT03057977', nctId: 'NCT03057977', title: 'EMPagliflozin outcomE tRial in Patients With chrOnic heaRt Failure With Reduced Ejection Fraction (EMPEROR-Reduced)', year: 2017, referencePmids: [] };
  const pubN = { sourceKey: 'pubmed', id: 'pn', pmid: '32865377', title: 'Cardiovascular and renal outcomes with empagliflozin in heart failure', year: 2020, abstract: 'Trial registration: ClinicalTrials.gov NCT03057977.' };
  const n = clusterRecords([reg, pubN]);
  assert(n.unique.length === 1 && n.unique[0].pmid === '32865377' && (n.unique[0].registryRecords || [])[0].nctId === 'NCT03057977', 'ClinicalTrials.gov record linked to its publication by NCT ID (publication primary)');
  assert(n.unique[0].sources.includes('ClinicalTrials.gov') && n.log.some(l => l.matchedOn === 'nct'), 'Registry source badge added and nct link logged');

  const reg2 = { sourceKey: 'ctgov', isRegistryRecord: true, id: 'NCT01111111', nctId: 'NCT01111111', title: 'Registry title unrelated to paper title', year: 2015, referencePmids: ['5555'] };
  const pubR = { sourceKey: 'epmc', id: 'e5', pmid: '5555', title: 'Published trial whose abstract omits the NCT number', year: 2018 };
  const rr = clusterRecords([reg2, pubR]);
  assert(rr.unique.length === 1 && rr.log.some(l => l.matchedOn === 'registry-ref-pmid'), 'ClinicalTrials.gov record linked by referencesModule PMID');

  const v2 = { sourceKey: 'cochrane_cdsr', id: 'c2', pmid: '30000002', doi: '10.1002/14651858.CD012345.pub2', title: 'SGLT2 inhibitors for heart failure', year: 2019 };
  const v3 = { sourceKey: 'cochrane_cdsr', id: 'c3', pmid: '30000003', doi: '10.1002/14651858.CD012345.pub3', title: 'SGLT2 inhibitors for heart failure', year: 2023 };
  const cv = clusterRecords([v2, v3]);
  assert(cv.unique.length === 1 && cv.unique[0].doi.endsWith('.pub3') && cv.unique[0].cochraneId === 'CD012345', 'Cochrane CD012345.pub2 vs .pub3 → one review, latest version kept');
  assert(cv.log.some(l => l.matchedOn === 'cochrane-version') && (cv.unique[0].supersededVersions || []).includes('10.1002/14651858.cd012345.pub2'), 'Superseded Cochrane version logged');

  const parent = { sourceKey: 'pubmed', id: 'par', pmid: '777', doi: '10.1/parent', title: 'Effect of dapagliflozin on worsening heart failure in diabetes', year: 2020 };
  const err = { sourceKey: 'crossref', id: 'err', doi: '10.1/erratum', title: 'Erratum: Effect of dapagliflozin on worsening heart failure in diabetes', year: 2021 };
  const e = clusterRecords([parent, err]);
  assert(e.unique.length === 1 && e.unique[0].doi === '10.1/parent' && (e.unique[0].linkedNotices || [])[0].type === 'erratum' && e.unique[0].linkedNotices[0].doi === '10.1/erratum', 'Erratum is linked to its parent, not merged (parent DOI unchanged)');
  assert(!e.unique[0].retracted, 'Erratum does not flag the parent as retracted');

  const retr = { sourceKey: 'epmc', id: 'ret', pmid: '888', title: 'Retraction note: Effect of dapagliflozin on worsening heart failure in diabetes', year: 2022 };
  const rt = clusterRecords([parent, retr]);
  assert(rt.unique.length === 1 && rt.unique[0].retracted === true && rt.log.some(l => l.matchedOn === 'retraction-link'), 'Retraction notice flags its parent retracted: true');
}

// ─────────────────────────────────────────────────────────────
console.log('\n▶️ 3.1 / 3.7 POOL ENTRY POINT, IDEMPOTENCY & INVARIANTS');
{
  freshPool();
  const pubmedBatch = [
    { sourceKey: 'pubmed', id: '32865377', pmid: '32865377', doi: '10.1056/NEJMoa2022190', title: 'Cardiovascular and Renal Outcomes with Empagliflozin in Heart Failure', year: 2020, abstract: RCT_ABSTRACT, authors: 'Packer M', pubType: ['randomized controlled trial'] },
    { sourceKey: 'pubmed', id: '31535829', pmid: '31535829', doi: '10.1056/NEJMoa1911303', title: 'Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction', year: 2019, abstract: RCT_ABSTRACT.replace(/empagliflozin/g, 'dapagliflozin'), authors: 'McMurray JJV', pubType: ['randomized controlled trial'] },
    { sourceKey: 'pubmed', id: '777', pmid: '777', doi: '10.1/parent', title: 'Effect of dapagliflozin on worsening heart failure in diabetes', year: 2020, abstract: RCT_ABSTRACT, authors: 'Smith A' }
  ];
  const epmcBatch = [
    { sourceKey: 'epmc', id: 'E1', pmid: '32865377', title: 'Cardiovascular and renal outcomes with empagliflozin in heart failure.', year: 2020, sources: ['Europe PMC'] },
    { sourceKey: 'epmc', id: 'E2', pmid: '888', title: 'Retraction note: Effect of dapagliflozin on worsening heart failure in diabetes', year: 2022, sources: ['Europe PMC'] }
  ];
  const scholarBatch = [
    { sourceKey: 'scholar', id: 'sc1', scholarResultId: 'sc1', title: 'An obscure conference paper on gliflozins and cardiac remodelling', year: 2022, abstract: '', abstractSource: 'none', scholarSnippet: 'Snippet text only…', authors: 'B Nobody' }
  ];
  const ctgovBatch = [
    { sourceKey: 'ctgov', isRegistryRecord: true, id: 'NCT03036124', nctId: 'NCT03036124', title: 'Study to Evaluate the Effect of Dapagliflozin on the Incidence of Worsening Heart Failure (DAPA-HF)', year: 2017, referencePmids: ['31535829'] }
  ];
  okStatus('pubmed', 3); okStatus('epmc', 2); okStatus('scholar', 1); okStatus('ctgov', 1);
  addRecordsToPool(pubmedBatch, { sourceKey: 'pubmed', replace: true, deferRebuild: true });
  addRecordsToPool(epmcBatch, { sourceKey: 'epmc', replace: true, deferRebuild: true });
  addRecordsToPool(scholarBatch, { sourceKey: 'scholar', replace: true, deferRebuild: true });
  addRecordsToPool(ctgovBatch, { sourceKey: 'ctgov', replace: true });

  const uniqueAfterFirst = STATE.papers.length;
  assert(STATE.rawCandidateCount === 7 && uniqueAfterFirst === 4, `7 raw records → 4 unique studies (got ${STATE.rawCandidateCount} → ${uniqueAfterFirst})`);
  assert(STATE.rawCandidateCount === STATE.papers.length + STATE.duplicatesRemoved, 'Invariant: identified = unique + removed');
  const sumRetrieved = Object.values(STATE.sourceRecords).reduce((a, l) => a + l.length, 0);
  assert(sumRetrieved === STATE.rawCandidateCount, 'Invariant: Σ retrieved per source = identified');
  assert(verifyPoolInvariants().length === 0, 'verifyPoolInvariants() reports no errors', JSON.stringify(STATE.poolInvariantErrors));
  assert(findIdentifierCollisions(STATE.papers).length === 0, 'No two pool records share any identifier (PMID, PMCID, DOI, OpenAlex, S2, Scholar, Cochrane, CENTRAL)');

  const emp = STATE.papers.find(p => p.pmid === '32865377');
  assert(emp.sources.includes('PubMed') && emp.sources.includes('Europe PMC'), 'Multi-source study carries every source badge');
  const dapa = STATE.papers.find(p => p.pmid === '31535829');
  assert((dapa.registryRecords || []).some(r => r.nctId === 'NCT03036124') && dapa.sources.includes('ClinicalTrials.gov'), 'Registry record attached to DAPA-HF publication via reference PMID');
  const retracted = STATE.papers.find(p => p.pmid === '777');
  assert(retracted.retracted && retracted.screening.status === 'EXCLUDED' && retracted.screening.primaryReason === 'Retracted publication', 'Retracted parent forced to EXCLUDED: "Retracted publication"');
  const sch = STATE.papers.find(p => p.scholarResultId === 'sc1');
  assert(sch && sch.abstract === '' && sch.screening.status === 'BORDERLINE' && /Google Scholar record: abstract unavailable/.test(sch.screening.primaryReason), 'Unmatched Google Scholar record: empty abstract, forced BORDERLINE');
  assert(sch.scholarSnippet === 'Snippet text only…' && sch.abstract !== sch.scholarSnippet, 'Scholar snippet stored in scholarSnippet, never in abstract');
  sch.screening.status = 'INCLUDED';
  applySourceScreeningRules(sch);
  assert(sch.screening.status === 'BORDERLINE', 'Google Scholar no-abstract record can never be auto-INCLUDED');

  // Idempotent re-add of the same batch
  addRecordsToPool(pubmedBatch, { sourceKey: 'pubmed', replace: true });
  assert(STATE.papers.length === uniqueAfterFirst && STATE.rawCandidateCount === 7, 'Re-running a source (replace) does not increase unique or raw counts');
  addRecordsToPool(pubmedBatch.map(r => Object.assign({}, r, { _rid: `pubmed:${r.id}` })), { sourceKey: 'pubmed' });
  assert(STATE.papers.length === uniqueAfterFirst && STATE.rawCandidateCount === 7, 'Appending already-present raw records (same _rid) is a no-op');

  // CENTRAL RIS import of records already present
  const ris = [
    'TY  - JOUR', 'ID  - CN-02164488', 'TI  - Cardiovascular and Renal Outcomes with Empagliflozin in Heart Failure', 'AU  - Packer, M', 'PY  - 2020',
    'JO  - New England journal of medicine', 'AN  - PUBMED 32865377', 'DO  - 10.1056/NEJMoa2022190', 'ER  - ',
    'TY  - JOUR', 'ID  - CN-02000001', 'TI  - Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction', 'AU  - McMurray, JJV', 'PY  - 2019',
    'AN  - PUBMED 31535829', 'UR  - https://www.cochranelibrary.com/central/doi/10.1002/central/CN-02000001/full', 'ER  - '
  ].join('\n');
  importCentralRisText(ris, 'central.ris');
  STATE.searchStrategy = STATE.searchStrategy || readStrategyInputs();
  return Promise.resolve().then(async () => {
    await runSourceSearch('cochrane_central', null);
    assert(STATE.sourceStatus.cochrane_central.status === 'ok' && STATE.sourceStatus.cochrane_central.retrievedCount === 2, 'CENTRAL status ok after RIS import (2 records)');
    assert(STATE.papers.length === uniqueAfterFirst && STATE.rawCandidateCount === 9, 'RIS import of records already present adds 0 unique studies (raw 9, unique unchanged)');
    assert(STATE.papers.find(p => p.pmid === '32865377').sources.includes('Cochrane CENTRAL'), 'Imported CENTRAL record adds its badge to the existing study');
    importCentralRisText(ris, 'central.ris');
    await runSourceSearch('cochrane_central', null);
    assert(STATE.papers.length === uniqueAfterFirst && STATE.rawCandidateCount === 9, 'Re-importing the same RIS is idempotent');
    assert(verifyPoolInvariants().length === 0, 'Invariants still hold after RIS import', JSON.stringify(STATE.poolInvariantErrors));

    // Project save → reload never increases unique count
    saveProjectState();
    const saved = JSON.parse(localStorage.getItem('SYSREVAI_PROJECT_STATE'));
    const beforeReload = STATE.papers.length;
    STATE.papers = [];
    applyProjectData(saved);
    assert(STATE.papers.length === beforeReload && STATE.rawCandidateCount === 9, 'Reloading a saved project does not change unique or raw counts');
    assert(STATE.papers.find(p => p.pmid === '777').screening.status === 'EXCLUDED', 'Screening decisions carried over on reload');

    // Legacy project (no per-source records) containing duplicates is cleaned on load
    applyProjectData({ state: { topic: 'x', papers: [
      { source: 'epmc', sources: ['Europe PMC'], pmid: '1', title: 'Legacy duplicated record title here', year: 2020 },
      { source: 'both', sources: ['Europe PMC', 'Semantic Scholar'], pmid: '1', title: 'Legacy duplicated record title here', year: 2020 }
    ] } });
    assert(STATE.papers.length === 1, 'Legacy project with duplicated records loads as 1 unique study');
    assert(!JSON.stringify(STATE.papers).includes('"source":"both"'), "Legacy source: 'both' is replaced by the sources[] array");

    // Split override
    freshPool();
    okStatus('pubmed', 1); okStatus('openalex', 1);
    addRecordsToPool([{ sourceKey: 'pubmed', id: 'a', title: 'Heart failure outcomes with empagliflozin in older adults a cohort', year: 2021, authors: 'Lee K' }], { sourceKey: 'pubmed', replace: true, deferRebuild: true });
    addRecordsToPool([{ sourceKey: 'openalex', id: 'W123', openalexId: 'W123', title: 'Heart failure outcomes with empagliflozin in older adults: a cohort', year: 2021, authors: 'Lee K' }], { sourceKey: 'openalex', replace: true });
    assert(STATE.papers.length === 1 && STATE.duplicatesRemoved === 1, 'Fuzzy duplicate merged before reviewer override');
    const idx = STATE.dedupLog.findIndex(l => l.kind === 'duplicate');
    splitDuplicate(idx);
    assert(STATE.papers.length === 2 && STATE.duplicatesRemoved === 0 && STATE.dedupOverrides.length === 1, '"Not a duplicate — split" override splits the pair and recomputes counts');
    syncPrismaStateFromWorkflow(true);
    assert(PRISMA_DIAGRAM_STATE.duplicates_removed === 0 && PRISMA_DIAGRAM_STATE.records_screened === 2, 'PRISMA counts update immediately after split');
    undoSplit(0);
    assert(STATE.papers.length === 1, 'Undo split re-merges the pair');

    // Grep: nothing pushes to STATE.papers directly
    const files = ['index.html', 'meta-analysis-engine.js', 'prisma-generator.js', 'sources.js', 'dedup.js'];
    const offenders = [];
    files.forEach(f => {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      const lines = src.split('\n');
      lines.forEach((ln, i) => {
        if (/STATE\.papers\s*\.\s*(push|unshift|splice|fill|copyWithin)\s*\(/.test(ln)) offenders.push(`${f}:${i + 1}: ${ln.trim()}`);
        const asg = ln.match(/STATE\.papers\s*=(?!=)\s*([^;]+)/);
        if (asg && !/^(result\.unique|\[\]|s\.papers)\s*$/.test(asg[1].trim())) offenders.push(`${f}:${i + 1}: ${ln.trim()}`);
      });
    });
    assert(offenders.length === 0, 'No code pushes/splices/assigns STATE.papers outside addRecordsToPool/rebuildPool', offenders.join(' | '));
    const loadIdx = indexHtml.indexOf('STATE.papers = s.papers;');
    assert(loadIdx > 0 && /rebuildPool\(\)/.test(indexHtml.slice(loadIdx, loadIdx + 80)), 'Project load assigns saved papers only to seed carry-over, then rebuilds the pool');

    // Reference lists: no repeated entries in any citation style
    const dupRefPapers = [
      { title: 'A unique reference paper title one', doi: '10.1/r1', authors: 'A B', year: 2020, journal: 'J' },
      { title: 'A unique reference paper title one', doi: '10.1/R1', authors: 'A B', year: 2020, journal: 'J' },
      { title: 'Second reference', pmid: '99', authors: 'C D', year: 2021, journal: 'K' }
    ];
    ['vancouver', 'apa', 'harvard'].forEach(style => {
      window.CITATION_STYLE = style;
      STATE.includedPapers = dupRefPapers;
      STATE.review = null;
      const refs = getFormattedReferencesForCurrentStyle();
      assert(refs.length === 2 && new Set(refs.map(r => r.text)).size === refs.length, `Reference list (${style}) has no repeated entries`);
    });
    window.CITATION_STYLE = 'vancouver';

    assert.summary('DEDUP & LINKING SUITE');
  });
}
