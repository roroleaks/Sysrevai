/**
 * SysRevAI Scientific Integrity & Methodology Verification Test Suite
 * Strictly enforces Cochrane Handbook, PRISMA 2020, and RoB 2 / ROBINS-I standards.
 * Verifies ZERO data fabrication, truthful manuscript generation, and statistical precision.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

console.log('================================================================');
console.log('🛡️ SYSREV AI: SCIENTIFIC INTEGRITY AUDIT TEST SUITE');
console.log('================================================================\n');

// 1. Mock Browser Environment
const mockWindow = {
  addEventListener: () => {},
  removeEventListener: () => {},
  STATE: { papers: [], inclusionCriteria: [], exclusionCriteria: [] },
  PRISMA_DIAGRAM_STATE: null,
  META_ANALYSIS_STATE: null,
  jspdf: { jsPDF: function() { return { save: () => {} }; } }
};
global.window = mockWindow;
global.document = {
  getElementById: () => ({ value: '', trim: () => '' }),
  querySelectorAll: () => []
};

const metaModule = require('./meta-analysis-engine.js');
Object.assign(global, metaModule);
// Browser loads these via <script src>; mirror that here
Object.assign(global, require('./dedup.js'), require('./sources.js'));

// Extract inline scripts from index.html
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let inlineCode = '';
let match;
while ((match = scriptRegex.exec(indexHtml)) !== null) {
  if (!match[0].includes('src=')) {
    inlineCode += match[1] + '\n';
  }
}
vm.runInThisContext(inlineCode);

let passCount = 0;
let failCount = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    passCount++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    failCount++;
    console.error(`  ❌ [FAIL] ${testName} - ${details}`);
  }
}

// ─────────────────────────────────────────────────────────────
// PHASE 1 INTEGRITY TESTS
// ─────────────────────────────────────────────────────────────
console.log('▶️ PHASE 1 AUDIT: ZERO FABRICATION & TRUTHFUL REPORTING');

// Test 1: No fabrication when abstracts contain no numbers
const papersWithoutNumbers = [
  {
    id: 'p1',
    title: 'Qualitative analysis of therapy in clinical cohorts',
    authors: 'Miller A et al.',
    year: 2023,
    abstract: 'In this observational cohort, patients were evaluated for clinical outcomes without numerical data reported.',
    screening: { status: 'INCLUDED', design: { name: 'Cohort studies', code: 'cohort' } }
  },
  {
    id: 'p2',
    title: 'Descriptive study of intervention outcomes',
    authors: 'Baker B et al.',
    year: 2024,
    abstract: 'Therapeutic outcomes were observed and described qualitatively across multiple clinic centers.',
    screening: { status: 'INCLUDED', design: { name: 'Cohort studies', code: 'cohort' } }
  },
  {
    id: 'p3',
    title: 'Exploratory investigation of treatment patterns',
    authors: 'Clark C et al.',
    year: 2025,
    abstract: 'Treatment regimens and patient compliance were evaluated narratively throughout follow-up.',
    screening: { status: 'INCLUDED', design: { name: 'Cohort studies', code: 'cohort' } }
  }
];

window.STATE.includedPapers = papersWithoutNumbers;
META_ANALYSIS_STATE.studies = syncMetaStudiesFromIncluded(papersWithoutNumbers);
suggestValuesFromAbstracts();

const allNullCounts = META_ANALYSIS_STATE.studies.every(s => 
  s.e1 === null && s.n1 === null && s.e2 === null && s.n2 === null &&
  s.m1 === null && s.s1 === null && s.m2 === null && s.s2 === null
);
const noneInPool = META_ANALYSIS_STATE.studies.every(s => s.includedInPool === false && s.verified === false);
const emptyPoolResult = executeMetaAnalysis(META_ANALYSIS_STATE);

assert(allNullCounts, 'TEST 1.1: Auto-suggest returns all-null values when abstracts have no numbers');
assert(noneInPool, 'TEST 1.2: Studies with no numbers have includedInPool === false and verified === false');
assert(emptyPoolResult.isValid === false, 'TEST 1.3: executeMetaAnalysis returns isValid: false when no studies are verified in pool');

// Test 2: Correct extraction of percentages with explicit arms
const aganaAbstract = 'Preterm delivery endpoint was pre-eclampsia (10.0% vs. 34.0%… 50 exposed and 50 unexposed).';
const aganaPaper = {
  id: 'p-agana',
  title: 'Trial of Aspirin for Preeclampsia Prevention',
  authors: 'Agana M, Osei K',
  year: 2026,
  abstract: aganaAbstract,
  screening: { status: 'INCLUDED', design: { name: 'Randomized controlled trials (RCTs)', code: 'rct' } }
};

window.STATE.includedPapers = [aganaPaper];
META_ANALYSIS_STATE.studies = syncMetaStudiesFromIncluded([aganaPaper]);
suggestValuesFromAbstracts();

const aganaStudy = META_ANALYSIS_STATE.studies[0];
assert(aganaStudy.suggestedCounts !== null, 'TEST 2.1: Suggested counts found for Agana 2026 abstract');
assert(aganaStudy.suggestedCounts.e1 === 5 && aganaStudy.suggestedCounts.n1 === 50, 'TEST 2.2: Arm 1 (exposed) extracted as 5/50 (10.0% of 50)');
assert(aganaStudy.suggestedCounts.e2 === 17 && aganaStudy.suggestedCounts.n2 === 50, 'TEST 2.3: Arm 2 (unexposed) extracted as 17/50 (34.0% of 50)');
assert(aganaStudy.status === 'suggested' && aganaStudy.verified === false && aganaStudy.includedInPool === false, 'TEST 2.4: Study has status: "suggested" and is NOT pooled until confirmed');

confirmStudyCounts(0);
assert(aganaStudy.verified === true && aganaStudy.includedInPool === true, 'TEST 2.5: Study enters pool and becomes verified upon explicit confirmation');

// Test 3: No invented quote in manuscript generator
const testPapers = [
  {
    id: 'tp1',
    title: 'Trial of Therapy A in High-Risk Cohort',
    authors: 'Johnson T et al.',
    year: 2024,
    abstract: 'In this randomized trial of 200 patients, adverse events were significantly reduced with relative risk 0.72 (95% CI 0.55-0.94).',
    screening: { status: 'INCLUDED', design: { name: 'Randomized controlled trials (RCTs)', code: 'rct' } }
  },
  {
    id: 'tp2',
    title: 'Observational Study Without Effect Sentence',
    authors: 'Davis R et al.',
    year: 2023,
    abstract: 'Demographic patterns of enrolled patients were described across municipal hospitals.',
    screening: { status: 'INCLUDED', design: { name: 'Cohort studies', code: 'cohort' } }
  }
];

const gen = new SystematicReviewGenerator('Therapy Evaluation', { p: 'Patients', i: 'Therapy', c: 'Control', o: 'Adverse events' }, testPapers, 0, 2, null);
const generatedReview = gen.generate();

// Check every occurrence of 'The authors reported: "'
const quoteMatches = [...generatedReview.results.matchAll(/The authors reported:\s*"([^"]+)"/g)];
let allQuotesVerbatim = true;
quoteMatches.forEach(qm => {
  const quoted = qm[1];
  const foundInAbstracts = testPapers.some(p => p.abstract && p.abstract.includes(quoted));
  if (!foundInAbstracts) {
    allQuotesVerbatim = false;
    console.error(`    Found fabricated quote: "${quoted}"`);
  }
});
assert(allQuotesVerbatim, 'TEST 3: Manuscript text never contains "The authors reported: " followed by text absent from abstract');
assert(generatedReview.results.includes('Key finding not extracted; see abstract.'), 'TEST 3.2: Study without extracted finding states "Key finding not extracted; see abstract." without quotes');

// Test 4: No forbidden claims in manuscript
const fullManuscript = `${generatedReview.intro} ${generatedReview.methods} ${generatedReview.results} ${generatedReview.discussion} ${generatedReview.conclusions} ${JSON.stringify(generatedReview.abstractObj)}`;
const forbiddenPhrases = [
  'MeSH',
  'two-stage screening',
  'full-text evaluation',
  '27/27',
  'Clinicians should',
  'substantiate the validity',
  'protocol was pre-specified'
];

let foundForbidden = false;
for (const phrase of forbiddenPhrases) {
  if (fullManuscript.includes(phrase)) {
    foundForbidden = true;
    console.error(`    Found forbidden claim in manuscript: "${phrase}"`);
  }
}
assert(!foundForbidden, 'TEST 4: Manuscript contains none of the forbidden claims (MeSH, two-stage screening, full-text evaluation, 27/27, Clinicians should, substantiate the validity, pre-specified)');

// ─────────────────────────────────────────────────────────────
// PHASE 2 INTEGRITY TESTS: SCREENING, ROB & PRISMA CORRECTNESS
// ─────────────────────────────────────────────────────────────
console.log('\n▶️ PHASE 2 AUDIT: SCREENING, ROB & PRISMA METHODOLOGY');

// Test 5: Unicode hyphen in "meta‐analysis", reviews, commentaries, book chapters, and "nasal spray" vs "ASA"
const metaUnicodePaper = { title: 'SGLT2 inhibitors in heart failure: a meta\u2010analysis', abstract: 'Review of trials.', pubType: ['journal-article'] };
const reviewDashPaper = { title: 'Management of Heart Failure – A Review', abstract: 'Overview of evidence.', pubType: ['journal-article'] };
const commentaryPaper = { title: 'Cardiovascular outcomes in elderly: Invited Commentary', abstract: 'Editorial opinion.', pubType: ['journal-article'] };
const bookChapterPaper = { title: 'SGLT2 Biology and Therapeutics', abstract: 'Comprehensive monograph chapter.', type: 'book-chapter', pubType: [] };

const metaDes = classifyStudyDesign(metaUnicodePaper);
const reviewDes = classifyStudyDesign(reviewDashPaper);
const commDes = classifyStudyDesign(commentaryPaper);
const bookDes = classifyStudyDesign(bookChapterPaper);

assert(metaDes.isEligible === false && metaDes.code === 'ineligible-review', 'TEST 5.1: Unicode hyphen (U+2010) in "meta‐analysis" is recognized and excluded');
assert(reviewDes.isEligible === false && reviewDes.code === 'ineligible-review', 'TEST 5.2: Title ending in "– A Review" (en-dash) is recognized and excluded');
assert(commDes.isEligible === false && commDes.code === 'ineligible-review', 'TEST 5.3: "Invited Commentary" is recognized and excluded');
assert(bookDes.isEligible === false && bookDes.code === 'ineligible-review', 'TEST 5.4: Crossref type: book-chapter is recognized and excluded');

const nasalSprayPaper = {
  title: 'Efficacy of saline nasal spray on allergic rhinitis',
  abstract: 'Patients treated with saline nasal spray showed reduced nasal congestion symptoms over 4 weeks.',
  pubType: ['randomized controlled trial']
};
const nasalScreen = screenPaperAgainstCriteria(nasalSprayPaper, 'Allergic Rhinitis', { i: 'ASA' }, [], []);
assert(nasalScreen.status === 'EXCLUDED' && nasalScreen.decisionRules.some(r => r.rule === 'Target Intervention' && !r.passed), 'TEST 5.5: "nasal spray" does not match intervention "ASA" due to word boundary enforcement');

// Test 6: Risk of Bias correctness
const admittedPaper = {
  title: 'Trial of intensive versus standard therapy in heart failure',
  abstract: 'Patients admitted to the cardiology department were randomized to receive therapy or standard care. Outcomes were recorded.',
  pubType: ['randomized controlled trial']
};
const admittedRoB = evaluateRiskOfBias(admittedPaper);
assert(admittedRoB.domains.d2 !== 'Low', 'TEST 6.1: Abstract containing "admitted" without blinding terms does not get D2 = Low (got: ' + admittedRoB.domains.d2 + ')');

const rctSomeConcerns = {
  title: 'Randomized clinical trial of drug A versus placebo',
  abstract: 'In this double-blind randomized clinical trial, participants were randomly assigned to drug A or placebo. Adjudicated endpoints were measured. Attrition data was not reported.',
  pubType: ['randomized controlled trial']
};
const rctRoB = evaluateRiskOfBias(rctSomeConcerns);
assert(rctRoB.domains.d3 === 'Some Concerns' && rctRoB.overall === 'Some Concerns', 'TEST 6.2: An RCT with one "Some Concerns" domain gets overall "Some Concerns" (overall: ' + rctRoB.overall + ')');

const nonRctPaper = {
  title: 'Prospective observational cohort of surgical outcomes',
  abstract: 'Prospective cohort of 500 patients evaluating postoperative recovery.',
  pubType: ['journal-article']
};
const nonRctRoB = evaluateRiskOfBias(nonRctPaper);
assert(nonRctRoB.tool.includes('ROBINS-I') && nonRctRoB.domains.d1 === 'Not assessed' && nonRctRoB.overall === 'Not assessed', 'TEST 6.3: Non-randomized observational cohort gets ROBINS-I tool and domains "Not assessed"');

// ─────────────────────────────────────────────────────────────
// PHASE 3 INTEGRITY TESTS: STATISTICS, DATA QUALITY & SECURITY
// ─────────────────────────────────────────────────────────────
console.log('\n▶️ PHASE 3 AUDIT: STATISTICS, DATA QUALITY & DEDUPLICATION');

// Test 7: Egger test evaluated strictly with Student's t distribution (df = k - 2)
const eggerStudies = [
  { studyId: 'S1', calc: { logEffect: -0.4, se: 0.15 } },
  { studyId: 'S2', calc: { logEffect: -0.6, se: 0.22 } },
  { studyId: 'S3', calc: { logEffect: -0.3, se: 0.10 } },
  { studyId: 'S4', calc: { logEffect: -0.9, se: 0.35 } },
  { studyId: 'S5', calc: { logEffect: -0.2, se: 0.08 } }
];
const eggerResult = calculateEggerTest(eggerStudies);
const expectedTCdf = metaTCdfTwoTailed(Math.abs(eggerResult.tStat), 3);
assert(eggerResult.applicable === true && eggerResult.k === 5, 'TEST 7.1: Egger regression applicable with k = 5');
assert(eggerResult.pValue.toFixed(3) === expectedTCdf.toFixed(3), 'TEST 7.2: Egger p-value matches Student t (df = 3) distribution to 3 decimals (p = ' + eggerResult.pValue.toFixed(3) + ')');
assert(metaTCdfTwoTailed(2.5, 3).toFixed(3) === '0.088', 'TEST 7.3: Benchmark t = 2.5 with df = 3 evaluates to p = 0.088 (exact Student t vs 0.012 normal)');

// Test 8: Statistics regression (Cochrane benchmark worked example for RR, OR, RD, MD, SMD under FE and DL)
const cochraneBinary = [
  { studyId: 'Study 1', e1: 10, n1: 100, e2: 20, n2: 100 },
  { studyId: 'Study 2', e1: 15, n1: 150, e2: 30, n2: 150 }
];
const pooledRR = executeMetaAnalysis({ outcomeType: 'binary', effectMeasure: 'RR', model: 'fixed', studies: cochraneBinary });
assert(pooledRR.isValid && pooledRR.pooled.pointEstimate.toFixed(3) === '0.500', 'TEST 8.1: Binary RR Fixed-Effect benchmark matches 0.500 (got: ' + pooledRR.pooled.pointEstimate.toFixed(3) + ')');

const pooledOR = executeMetaAnalysis({ outcomeType: 'binary', effectMeasure: 'OR', model: 'fixed', studies: cochraneBinary });
assert(pooledOR.isValid && pooledOR.pooled.pointEstimate.toFixed(3) === '0.444', 'TEST 8.2: Binary OR Fixed-Effect benchmark matches 0.444 (got: ' + pooledOR.pooled.pointEstimate.toFixed(3) + ')');

const pooledRD = executeMetaAnalysis({ outcomeType: 'binary', effectMeasure: 'RD', model: 'fixed', studies: cochraneBinary });
assert(pooledRD.isValid && pooledRD.pooled.pointEstimate.toFixed(3) === '-0.100', 'TEST 8.3: Binary RD Fixed-Effect benchmark matches -0.100 (got: ' + pooledRD.pooled.pointEstimate.toFixed(3) + ')');

const cochraneCont = [
  { studyId: 'Trial 1', m1: 10, s1: 2, n1: 50, m2: 12, s2: 2, n2: 50 },
  { studyId: 'Trial 2', m1: 15, s1: 3, n1: 60, m2: 18, s2: 3, n2: 60 }
];
const pooledMD = executeMetaAnalysis({ outcomeType: 'continuous', effectMeasure: 'MD', model: 'fixed', studies: cochraneCont });
assert(pooledMD.isValid && pooledMD.pooled.pointEstimate.toFixed(3) === '-2.348', 'TEST 8.4: Continuous MD Fixed-Effect benchmark matches -2.348 (got: ' + pooledMD.pooled.pointEstimate.toFixed(3) + ')');

const pooledSMD = executeMetaAnalysis({ outcomeType: 'continuous', effectMeasure: 'SMD', model: 'fixed', studies: cochraneCont });
assert(pooledSMD.isValid && pooledSMD.pooled.pointEstimate.toFixed(3) === '-0.993', 'TEST 8.5: Continuous SMD Fixed-Effect benchmark matches -0.993 (got: ' + pooledSMD.pooled.pointEstimate.toFixed(3) + ')');

// Test 9: Text cleaning preserves < before digits/spaces and handles block tags
const cleanedText = cleanHtmlText('<h4>Results</h4>birth <34 weeks');
assert(cleanedText === 'Results birth <34 weeks', 'TEST 9: cleanHtmlText("<h4>Results</h4>birth <34 weeks") === "Results birth <34 weeks" (got: "' + cleanedText + '")');

// Test 10: XSS prevention (escapeHtml escapes tags)
const xssPayload = '<img src=x onerror=alert(1)>';
const escapedXss = escapeHtml(xssPayload);
assert(!escapedXss.includes('<img') && escapedXss.includes('&lt;img'), 'TEST 10: XSS payload <img tag is safely escaped to &lt;img (got: "' + escapedXss + '")');

// Test 11: PDF Unicode preservation ("Mureșan" and "Lukáčová")
const unicodeRef = 'Mureșan D, Lukáčová M. Aspirin in preeclampsia prevention. 2024.';
const sanitizedPdfRef = sanitizePdfText(unicodeRef);
assert(sanitizedPdfRef.includes('Mureșan') && sanitizedPdfRef.includes('Lukáčová'), 'TEST 11: PDF Unicode characters "Mureșan" and "Lukáčová" preserved without character stripping');

// Test 12: Deduplication: three copies (PMID-only, PMID+DOI, DOI-only) collapse to one
const copy1 = { title: 'Aspirin for Preeclampsia Prevention', pmid: '99887766', source: 'epmc' };
const copy2 = { title: 'Aspirin for Preeclampsia Prevention', pmid: '99887766', doi: '10.1016/j.ajog.2024.01.001', source: 's2' };
const copy3 = { title: 'Aspirin for Preeclampsia Prevention: Secondary Analysis', doi: '10.1016/j.ajog.2024.01.001', source: 'crossref' };
const dedupResult = deduplicatePapers([copy1, copy2, copy3]);
assert(dedupResult.unique.length === 1 && dedupResult.duplicates === 2, 'TEST 12: Three copies (PMID-only, PMID+DOI, DOI-only) collapse into exactly 1 unique record (got unique: ' + dedupResult.unique.length + ', dups: ' + dedupResult.duplicates + ')');

// Test 13: Browser runtime simulation: prisma-generator.js, meta-analysis-engine.js, and index.html co-exist in same global scope
const prismaCode = fs.readFileSync(path.join(__dirname, 'prisma-generator.js'), 'utf8');
const metaCode = fs.readFileSync(path.join(__dirname, 'meta-analysis-engine.js'), 'utf8');
const indexHtmlContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScriptMatch = indexHtmlContent.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/i);

let browserCoexistenceError = null;
const browserSandbox = {
  window: {},
  document: {
    getElementById: () => ({ value: '', classList: { add: () => {}, remove: () => {}, contains: () => false }, style: {}, addEventListener: () => {}, scrollIntoView: () => {} }),
    querySelector: () => ({ style: {} }),
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: { style: {} }
  },
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {} },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  Date, Math, JSON, String, Number, Array, Object, RegExp, Promise, AbortController
};
browserSandbox.window = browserSandbox;
browserSandbox.global = browserSandbox;
browserSandbox.window.addEventListener = browserSandbox.document.addEventListener;
vm.createContext(browserSandbox);

try {
  vm.runInContext(prismaCode, browserSandbox);
  vm.runInContext(metaCode, browserSandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'dedup.js'), 'utf8'), browserSandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'sources.js'), 'utf8'), browserSandbox);
  if (!inlineScriptMatch) throw new Error('Inline script not found in index.html');
  vm.runInContext(inlineScriptMatch[1], browserSandbox);
} catch (e) {
  browserCoexistenceError = e;
}

assert(!browserCoexistenceError && typeof browserSandbox.runPipeline === 'function' && typeof browserSandbox.setExampleTopic === 'function',
  'TEST 13: All browser scripts parse and co-exist in shared global scope without SyntaxError (runPipeline & setExampleTopic active)' + (browserCoexistenceError ? ' Error: ' + browserCoexistenceError.message : ''));

// Test 14: loadProjectState returns false on empty/missing topic to allow default topic hydration
const emptyStorageSandbox = { ...browserSandbox, localStorage: { getItem: () => JSON.stringify({ state: {} }) } };
const restoredEmpty = browserSandbox.loadProjectState.call(emptyStorageSandbox);
assert(restoredEmpty === false, 'TEST 14: loadProjectState safely rejects empty state object to allow default example topic hydration');


// ─────────────────────────────────────────────────────────────
// PHASE 4: TRUTHFUL SOURCE REPORTING (mandatory sources)
// ─────────────────────────────────────────────────────────────
console.log('\n▶️ PHASE 4 AUDIT: TRUTHFUL SOURCE REPORTING & PRISMA TEMPLATE B');
global.document = {
  getElementById: () => ({ value: '', textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, appendChild() {}, scrollIntoView() {} }),
  createElement: () => ({ textContent: '', style: {}, appendChild() {} }),
  querySelectorAll: () => []
};
resetSourceState();
STATE.topic = 'SGLT2 inhibitors in heart failure';
STATE.pico = { p: 'heart failure', i: 'empagliflozin', c: 'placebo', o: 'hospitalization', s: 'RCT' };
STATE.searchDate = '2026-11-17';
STATE.searchStrategy = buildSearchStrategy({ baseQuery: '"heart failure" AND empagliflozin', yearRange: 5, perSourceLimit: 35 });
STATE.searchQuery = STATE.searchStrategy.baseQuery;
STATE.centralImport = null;
STATE.centralAck = null;
const okKeys = ['pubmed', 'cochrane_cdsr', 'ctgov', 'epmc', 'epmc_preprints', 's2', 'openalex', 'crossref'];
okKeys.forEach(k => { STATE.sourceStatus[k] = { status: 'ok', hitCount: 10, retrievedCount: k === 'ctgov' ? 1 : (k === 'pubmed' ? 1 : 0) }; });
STATE.sourceStatus.scholar = { status: 'not_configured', reason: 'SERPAPI_KEY missing', retrievedCount: 0, hitCount: 0 };
STATE.sourceStatus.cochrane_central = { status: 'not_searched', reason: 'CENTRAL export not provided', retrievedCount: 0, hitCount: 0 };
STATE.searchLog = SOURCE_REGISTRY.map(s => ({ sourceKey: s.key, interface: s.interfaceLabel, query: s.translateQuery(STATE.searchStrategy), timestamp: '2026-11-17T10:00:00Z', hitCount: 10, retrievedCount: 1, status: STATE.sourceStatus[s.key].status, error: STATE.sourceStatus[s.key].reason || null }));
addRecordsToPool([{ sourceKey: 'pubmed', id: '1', pmid: '1', title: 'Empagliflozin in heart failure: a randomized placebo-controlled trial', year: 2024, abstract: 'In this randomized, double-blind, placebo-controlled trial, 3730 patients with heart failure received empagliflozin or placebo. Hospitalization was reduced.', pubType: ['randomized controlled trial'] }], { sourceKey: 'pubmed', replace: true, deferRebuild: true });
addRecordsToPool([{ sourceKey: 'ctgov', isRegistryRecord: true, id: 'NCT00000001', nctId: 'NCT00000001', title: 'Unlinked registry record for empagliflozin in heart failure', year: 2023 }], { sourceKey: 'ctgov', replace: true });
const incPaper = STATE.papers.find(p => p.pmid === '1');
incPaper.screening = Object.assign({}, incPaper.screening, { status: 'INCLUDED' });
const gen2 = new SystematicReviewGenerator(STATE.topic, STATE.pico, [incPaper], STATE.duplicatesRemoved, STATE.rawCandidateCount);
const rv = gen2.generate();
const methodsText = rv.methods;
const notOkNames = SOURCE_REGISTRY.filter(s => STATE.sourceStatus[s.key].status !== 'ok');
const leaked = [];
notOkNames.forEach(s => {
  [s.displayName, s.interfaceLabel, ...(s.key === 'scholar' ? ['Google Scholar', 'SerpApi'] : []), ...(s.key === 'cochrane_central' ? ['CENTRAL', 'Central Register'] : [])].forEach(n => { if (methodsText.includes(n)) leaked.push(n); });
});
assert(leaked.length === 0, 'TEST 15: Methods never names a source whose status is not ok (Google Scholar not configured, CENTRAL not searched)' + (leaked.length ? ' leaked: ' + leaked.join(', ') : ''));
assert(gen2.getHarvestedSourcesString().split(', ').length >= 2 && !/Google Scholar|CENTRAL/.test(gen2.getHarvestedSourcesString()) && rv.abstractObj && !/Google Scholar|CENTRAL/.test(JSON.stringify(rv.abstractObj)), 'TEST 16: Abstract / harvested-sources string lists only sources with status ok');
assert(/PubMed via NCBI E-utilities/.test(methodsText) && /ClinicalTrials\.gov API v2/.test(methodsText) && /Table S1\. Information sources and search strategies/.test(methodsText) && methodsText.includes(translators.pubmed(STATE.searchStrategy)), 'TEST 17: Methods include interface labels and Table S1 with the exact executed queries');
assert(/Google Scholar: not configured \(SERPAPI_KEY missing\)/.test(rv.discussion) && /Cochrane Library: CENTRAL: not searched \(CENTRAL export not provided\)/.test(rv.discussion), 'TEST 18: Limitations list Google Scholar and CENTRAL with their reasons');
assert(centralSatisfied() === false, 'TEST 19: Manuscript gate blocks generation while CENTRAL is neither imported nor acknowledged');
onCentralAckChange({ checked: true });
assert(centralSatisfied() === true && /acknowledged before manuscript generation that Cochrane CENTRAL was not searched/.test(new SystematicReviewGenerator(STATE.topic, STATE.pico, [incPaper], 0, 1).generate().discussion), 'TEST 20: Acknowledgement unlocks the gate and is printed in Limitations');
const reg = STATE.papers.find(p => p.isRegistryRecord);
assert(reg && reg.screening.status !== 'INCLUDED', 'TEST 21: Unlinked trial registration is never auto-INCLUDED');
Object.assign(global, require('./prisma-generator.js'));
updatePrismaAndCounters();
syncPrismaStateFromWorkflow(true);
const pv = validatePrismaDiagramCounts(PRISMA_DIAGRAM_STATE);
const svgB = renderPrismaSVG(PRISMA_DIAGRAM_STATE);
assert(PRISMA_DIAGRAM_STATE.template === 'B' && PRISMA_DIAGRAM_STATE.registers_count === 1 && pv.issues.length === 0, 'TEST 22: PRISMA switches to Template B; registers = ClinicalTrials.gov count; counts reconcile', JSON.stringify(pv.issues));
assert(svgB.includes('Registers (n = 1): ClinicalTrials.gov') && svgB.includes('Search engines: Google Scholar') && svgB.includes('PubMed 1') && !svgB.includes('Europe PMC (n ='), 'TEST 23: Template B diagram shows per-database counts, registers and other methods separately');

console.log(`\n================================================================`);
console.log(`🏆 INTEGRITY AUDIT SUMMARY: ${passCount} PASSED | ${failCount} FAILED`);
console.log(`================================================================`);

if (failCount > 0) process.exit(1);
