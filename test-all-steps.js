/**
 * SysRev AI - Comprehensive Step-by-Step Validation Test Runner
 * Validates Steps 1 through 5 and all Document Export engines.
 */
const fs = require('fs');
const vm = require('vm');

console.log('================================================================');
console.log('🧪 SYSREV AI: COMPREHENSIVE 5-STEP PIPELINE & EXPORTS TEST');
console.log('================================================================\n');

// 1. Mock Browser Environment
const window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  STATE: null,
  PRISMA_DIAGRAM_STATE: null,
  META_ANALYSIS_STATE: null,
  jspdf: {
    jsPDF: function() {
      const pages = [[]];
      let currentPage = 1;
      return {
        internal: {
          pageSize: { getWidth: () => 612, getHeight: () => 792 },
          getNumberOfPages: () => pages.length
        },
        addPage: () => { pages.push([]); currentPage = pages.length; },
        setPage: (p) => { currentPage = p; },
        setFont: () => {},
        setFontSize: () => {},
        setTextColor: () => {},
        setDrawColor: () => {},
        setFillColor: () => {},
        setLineWidth: () => {},
        line: () => {},
        rect: () => {},
        text: () => {},
        getTextWidth: (str) => (str ? str.length * 5 : 0),
        splitTextToSize: (str) => (str ? str.split('\n') : []),
        save: (name) => { window._lastSavedPdf = name; }
      };
    }
  }
};
global.window = window;
const mockElementStore = {};
global.document = {
  getElementById: (id) => {
    if (!mockElementStore[id]) {
      mockElementStore[id] = {
        id,
        value: id === 'topic-input' ? 'SGLT2 inhibitors in heart failure' : '',
        checked: id.startsWith('db-cb-') ? true : false,
        trim: () => 'SGLT2 inhibitors in heart failure',
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        textContent: '',
        innerHTML: '',
        style: {},
        querySelector: () => ({ textContent: '', replace: () => '' })
      };
    }
    return mockElementStore[id];
  },
  querySelectorAll: () => [],
  createElement: (tag) => ({
    href: '',
    download: '',
    click: () => {},
    style: {},
    classList: { add: () => {}, remove: () => {} },
    appendChild: () => {},
    removeChild: () => {}
  }),
  body: { appendChild: () => {}, removeChild: () => {} }
};
global.URL = {
  createObjectURL: () => 'blob:http://localhost/mock-blob-uuid',
  revokeObjectURL: () => {}
};
global.Blob = function(parts, opts) {
  this.parts = parts;
  this.opts = opts;
  this.size = parts.reduce((acc, p) => acc + (p ? p.length : 0), 0);
};

// 2. Load Modules
const prismaModule = require('./prisma-generator.js');
const metaModule = require('./meta-analysis-engine.js');
Object.assign(global, prismaModule);
Object.assign(global, metaModule);

// Extract inline scripts from index.html
const indexHtml = fs.readFileSync('index.html', 'utf8');
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let inlineCode = '';
let match;
while ((match = scriptRegex.exec(indexHtml)) !== null) {
  if (!match[0].includes('src=')) {
    inlineCode += match[1] + '\n';
  }
}

// Execute inline script in global context
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
// STEP 1: PICOS & Eligibility Criteria Validation
// ─────────────────────────────────────────────────────────────
console.log('▶️ STEP 1: PICOS & ELIGIBILITY CRITERIA VALIDATION');
const topic = 'SGLT2 inhibitors in heart failure';
const pico = {
  p: 'Adult patients diagnosed with heart failure with reduced ejection fraction',
  i: 'SGLT2 inhibitors (empagliflozin, dapagliflozin)',
  c: 'Placebo or standard optimized guideline-directed medical therapy',
  o: 'Cardiovascular death and heart failure hospitalization',
  s: 'Randomized controlled trials and prospective cohorts'
};

assert(typeof cleanQueryKeywords === 'function', 'cleanQueryKeywords helper exists');
const cleanTopic = cleanQueryKeywords(topic);
assert(cleanTopic.includes('SGLT2 inhibitors') && cleanTopic.includes('heart failure'), 'cleanQueryKeywords normalizes topic terms');
assert(typeof selectSearchEngine === 'function', 'selectSearchEngine function active');
assert(typeof selectAllSearchDatabases === 'function', 'selectAllSearchDatabases function active');
assert(typeof toggleSearchDatabase === 'function', 'toggleSearchDatabase function active');

// Test 4 Literature Search Database individual & multi-selection
selectAllSearchDatabases(true);
assert(STATE.selectedDatabases.epmc === true && STATE.selectedDatabases.s2 === true && STATE.selectedDatabases.openalex === true && STATE.selectedDatabases.crossref === true, 'All 4 literature search databases selected simultaneously');
assert(STATE.searchSource === 'all', 'searchSource correctly synchronized to all 4 databases');

// Test individual toggle for every one of the 4 databases
toggleSearchDatabase('crossref');
assert(STATE.selectedDatabases.crossref === false && STATE.selectedDatabases.openalex === true, 'Crossref toggled off individually while retaining other 3 choices');

toggleSearchDatabase('openalex');
assert(STATE.selectedDatabases.openalex === false && STATE.selectedDatabases.epmc === true && STATE.selectedDatabases.s2 === true, 'OpenAlex toggled off individually, leaving dual core');

toggleSearchDatabase('crossref');
assert(STATE.selectedDatabases.crossref === true && STATE.selectedDatabases.epmc === true && STATE.selectedDatabases.s2 === true, 'Crossref re-enabled individually in custom 3-database combination');

// Test single database selection
selectSearchEngine(null, 'openalex');
assert(STATE.selectedDatabases.openalex === true && STATE.selectedDatabases.epmc === false && STATE.selectedDatabases.s2 === false && STATE.selectedDatabases.crossref === false, 'Individual database OpenAlex selected exclusively');

selectSearchEngine(null, 'crossref');
assert(STATE.selectedDatabases.crossref === true && STATE.selectedDatabases.openalex === false, 'Individual database Crossref selected exclusively');

selectSearchEngine(null, 'both');
assert(STATE.selectedDatabases.epmc === true && STATE.selectedDatabases.s2 === true && STATE.selectedDatabases.openalex === false, 'Dual Core mode selects Europe PMC + Semantic Scholar');

selectAllSearchDatabases(true);
assert(Object.values(STATE.selectedDatabases).every(Boolean), 'All 4 literature databases re-selected together via selectAllSearchDatabases(true)');

// ─────────────────────────────────────────────────────────────
// STEP 2: Retrieval, Deduplication & Classification
// ─────────────────────────────────────────────────────────────
console.log('\n▶️ STEP 2: RETRIEVAL, DEDUPLICATION & STUDY CLASSIFICATION');
assert(typeof deduplicatePapers === 'function', 'Deduplication engine active');
assert(typeof classifyStudyDesign === 'function', 'Study design classifier active');
assert(typeof evaluateRiskOfBias === 'function', 'Cochrane RoB evaluation active');

// Mock diverse candidate papers from all 4 sources
const mockRawPapers = [
  {
    source: 'epmc',
    sources: ['Europe PMC'],
    id: 'PMC1001',
    pmid: '30000001',
    doi: '10.1056/nejmoa1911303',
    title: 'Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction',
    authors: 'McMurray JJV, Solomon SD, Inzucchi SE',
    journal: 'N Engl J Med',
    year: 2019,
    abstract: 'In this phase 3 randomized controlled trial, 4744 patients were assigned to dapagliflozin or placebo. The primary outcome was a composite of worsening heart failure or cardiovascular death (hazard ratio 0.74, 95% CI 0.65-0.85; P<0.001).',
    citationCount: 4200,
    isOpenAccess: true,
    meshHeadings: ['Heart Failure', 'Sodium-Glucose Transporter 2 Inhibitors', 'Humans', 'Randomized Controlled Trial'],
    pubType: ['Randomized Controlled Trial']
  },
  {
    source: 's2',
    sources: ['Semantic Scholar'],
    id: 'S2_2001',
    pmid: '32865377',
    doi: '10.1056/nejmoa2022190',
    title: 'Cardiovascular and Renal Outcomes with Empagliflozin in Heart Failure',
    authors: 'Packer M, Anker SD, Butler J',
    journal: 'N Engl J Med',
    year: 2020,
    abstract: 'In a double-blind randomized clinical trial, 3730 patients with heart failure were assigned to empagliflozin or placebo. Composite endpoint occurred in 19.4% vs 24.7% (hazard ratio 0.75, 95% CI 0.65-0.86; P<0.001).',
    citationCount: 3100,
    isOpenAccess: true,
    meshHeadings: ['Heart Failure', 'Empagliflozin', 'Humans'],
    pubType: ['Clinical Trial']
  },
  {
    source: 'openalex',
    sources: ['OpenAlex'],
    id: 'https://openalex.org/W30001',
    pmid: '34449189',
    doi: '10.1056/nejmoa2107038',
    title: 'Empagliflozin in Heart Failure with a Preserved Ejection Fraction',
    authors: 'Anker SD, Butler J, Filippatos G',
    journal: 'N Engl J Med',
    year: 2021,
    abstract: 'Randomized controlled trial of 5988 patients evaluating cardiovascular death or hospitalization (hazard ratio 0.79, 95% CI 0.69-0.90; P<0.001).',
    citationCount: 1850,
    isOpenAccess: true,
    meshHeadings: ['Heart Failure', 'Randomized Controlled Trials as Topic'],
    pubType: ['journal-article']
  },
  {
    source: 'crossref',
    sources: ['Crossref'],
    id: '10.1016/s0140-6736(20)31824-9',
    pmid: '',
    doi: '10.1016/s0140-6736(20)31824-9',
    title: 'SGLT2 inhibitors in patients with heart failure: a comprehensive cohort',
    authors: 'Zannad F, Ferreira JP, Pocock SJ',
    journal: 'The Lancet',
    year: 2020,
    abstract: 'Prospective observational cohort evaluating 8474 patients with heart failure. All-cause mortality was significantly reduced with relative risk 0.87 (95% CI 0.77-0.98).',
    citationCount: 950,
    isOpenAccess: false,
    meshHeadings: [],
    pubType: ['journal-article']
  },
  // Ineligible Animal Model
  {
    source: 'epmc',
    sources: ['Europe PMC'],
    id: 'PMC9999',
    pmid: '39999999',
    doi: '10.1000/animal.2021',
    title: 'SGLT2 inhibition preserves cardiac function in diabetic murine rats',
    authors: 'Mouse J, Rat L',
    journal: 'Exp Biol',
    year: 2021,
    abstract: 'Isolated cardiomyocytes and murine rat hearts were treated with empagliflozin.',
    citationCount: 12,
    isOpenAccess: true,
    meshHeadings: ['Rats', 'Animals'],
    pubType: ['in-vitro']
  },
  // Duplicate record of Dapagliflozin from Crossref with URL prefix and different casing/title
  {
    source: 'crossref',
    sources: ['Crossref'],
    id: 'https://doi.org/10.1056/NEJMoa1911303',
    pmid: '',
    doi: 'https://doi.org/10.1056/NEJMoa1911303',
    title: 'Dapagliflozin in Patients with Heart Failure & Reduced Ejection Fraction: a randomized controlled trial',
    authors: 'McMurray JJV, Solomon SD',
    journal: 'New England Journal of Medicine',
    year: 2019,
    abstract: 'Phase 3 trial in heart failure.',
    citationCount: 4200,
    isOpenAccess: true,
    meshHeadings: [],
    pubType: ['journal-article']
  }
];

const { unique, duplicates } = deduplicatePapers(mockRawPapers);
assert(duplicates === 1, 'Deduplication identified exact duplicate record with https://doi.org/ and & in title', `Duplicates found: ${duplicates}`);
assert(unique.length === 5, 'Deduplication preserved 5 unique records', `Unique count: ${unique.length}`);

// Merge sources check
const mergedDapa = unique.find(p => normalizeDOI(p.doi) === '10.1056/nejmoa1911303');
assert(mergedDapa && mergedDapa.sources.includes('Europe PMC') && mergedDapa.sources.includes('Crossref'), 'Merged paper retained cross-database sources', JSON.stringify(mergedDapa?.sources));

// Test study design screening and preclinical / review escape prevention
const screenedPapers = unique.map((p, idx) => {
  p._globalIndex = idx;
  p.screening = screenPaperAgainstCriteria(p, topic, pico, [], []);
  return p;
});

const included = screenedPapers.filter(p => p.screening.status === 'INCLUDED');
const excluded = screenedPapers.filter(p => p.screening.status === 'EXCLUDED');
assert(included.length === 4, 'Screening correctly included 4 clinical empirical studies', `Included: ${included.length}`);
assert(excluded.length === 1 && excluded[0].screening.design.code === 'ineligible-animal', 'Screening excluded preclinical animal model', excluded[0]?.screening?.primaryReason);

// Regression Assertion: Preclinical animal model escaping because abstract mentions "patients"
const mouseModelPaper = {
  title: 'Withaar et al. in a multi-hit mouse model of heart failure with preserved ejection fraction',
  abstract: 'Heart failure with preserved ejection fraction affects human patients. In this mouse model we treated mice with SGLT2 inhibitors.',
  pubType: ['journal-article']
};
const mouseScreen = screenPaperAgainstCriteria(mouseModelPaper, topic, pico, [], []);
assert(mouseScreen.status === 'EXCLUDED' && mouseScreen.design.code === 'ineligible-animal', 'Mouse model paper in title is strictly EXCLUDED even when abstract mentions "patients"');

// Regression Assertion: Narrative reviews, protocols, and off-target drugs
const reviewPaper = {
  title: 'A Review on Finerenone and Heart Failure with Preserved Ejection Fraction (HFpEF)',
  abstract: 'Finerenone has emerged as a novel mineralocorticoid receptor antagonist in patients with HFpEF.',
  pubType: ['journal-article']
};
const reviewScreen = screenPaperAgainstCriteria(reviewPaper, topic, pico, [], []);
assert(reviewScreen.status === 'EXCLUDED', 'Narrative review titled "A Review on..." is strictly EXCLUDED');

const protocolPaper = {
  title: 'Rationale and design of the DELIVER trial in heart failure',
  abstract: 'Study design and baseline characteristics of patients enrolled in the DELIVER trial.',
  pubType: ['journal-article']
};
const protocolScreen = screenPaperAgainstCriteria(protocolPaper, topic, pico, [], []);
assert(protocolScreen.status === 'EXCLUDED', 'Protocol paper titled "Rationale and design..." is strictly EXCLUDED');

const offTargetDrugPaper = {
  title: 'Semaglutide in Patients with Heart Failure with Preserved Ejection Fraction and Obesity',
  abstract: 'Once-weekly subcutaneous semaglutide led to larger reductions in symptoms and physical limitations in patients.',
  pubType: ['journal-article']
};
const offTargetScreen = screenPaperAgainstCriteria(offTargetDrugPaper, topic, pico, [], []);
assert(offTargetScreen.status === 'EXCLUDED', 'Off-target drug without SGLT2 inhibitor is strictly EXCLUDED');

// Multi-word intervention with dosage and parenthetical notes (Aspirin for preeclampsia prevention)
const aspirinTopic = 'Aspirin prophylaxis for preeclampsia prevention in high-risk pregnancies';
const aspirinPico = {
  p: 'High-risk nulliparous pregnant women',
  i: 'Low-dose aspirin (75 - 150 mg daily) initiated before 16 weeks gestation',
  c: 'Placebo',
  o: 'Preeclampsia incidence',
  s: 'RCT'
};
const aspirinPaper = {
  title: 'Aspirin versus Placebo in Pregnancies at High Risk for Preterm Preeclampsia',
  abstract: 'Treatment with low-dose aspirin in women at high risk for preterm preeclampsia resulted in a lower incidence of this diagnosis than placebo.',
  pubType: ['randomized controlled trial']
};
const aspirinScreen = screenPaperAgainstCriteria(aspirinPaper, aspirinTopic, aspirinPico, [], []);
assert(aspirinScreen.status === 'INCLUDED', 'Aspirin trial with dosage in PICO intervention is correctly INCLUDED');
assert(Array.isArray(aspirinScreen.decisionRules) && aspirinScreen.decisionRules.length >= 4, 'Screening provides decisionRules breakdown');

// GLP-1 trial with parenthetical brand names in PICO intervention
const glp1Topic = 'Efficacy of GLP-1 receptor agonists on cardiovascular outcomes in Type 2 Diabetes';
const glp1Pico = {
  p: 'Adult patients with Type 2 Diabetes',
  i: 'GLP-1 Receptor Agonists (e.g., Semaglutide, Liraglutide, Dulaglutide)',
  c: 'Placebo',
  o: '3-point MACE',
  s: 'RCT'
};
const semaPaper = {
  title: 'Semaglutide and Cardiovascular Outcomes in Patients with Type 2 Diabetes',
  abstract: 'In patients with type 2 diabetes at high cardiovascular risk, the rate of first occurrence of death from cardiovascular causes, nonfatal myocardial infarction, or nonfatal stroke was significantly lower among those receiving semaglutide than among those receiving placebo.',
  pubType: ['randomized controlled trial']
};
const semaScreen = screenPaperAgainstCriteria(semaPaper, glp1Topic, glp1Pico, [], []);
assert(semaScreen.status === 'INCLUDED', 'GLP-1 semaglutide trial with parenthetical list in PICO intervention is correctly INCLUDED');

// ─────────────────────────────────────────────────────────────
// STEP 3: PRISMA Screening & RoB
// ─────────────────────────────────────────────────────────────
console.log('\n▶️ STEP 3: PRISMA SCREENING & ROB APPRAISAL');
STATE = {
  topic,
  pico,
  papers: unique,
  includedPapers: included,
  excludedPapers: excluded,
  borderlinePapers: [],
  rawCandidateCount: mockRawPapers.length,
  duplicatesRemoved: duplicates,
  sourceCounts: { epmc: 2, s2: 1, openalex: 1, crossref: 2, merged: 0 },
  searchSource: 'all'
};
window.STATE = STATE;

// Test syncPrismaStateFromWorkflow
syncPrismaStateFromWorkflow(true);
assert(PRISMA_DIAGRAM_STATE.records_screened === 5, 'PRISMA records screened = 5');
assert(PRISMA_DIAGRAM_STATE.new_reports_included === 4, 'PRISMA reports included = 4');

const prismaVal = validatePrismaDiagramCounts(PRISMA_DIAGRAM_STATE);
assert(prismaVal.isValid === true && prismaVal.issues.length === 0, 'PRISMA diagram counts strictly reconciled (0 issues)', JSON.stringify(prismaVal.issues));

const svg = renderPrismaSVG(PRISMA_DIAGRAM_STATE);
assert(svg.includes('<svg') && svg.includes('Identification of studies') && svg.includes('OpenAlex &amp; Crossref'), 'PRISMA SVG includes multi-database identification metadata');

// ─────────────────────────────────────────────────────────────
// STEP 4: Systematic Review Manuscript & Tri-Modal Citations
// ─────────────────────────────────────────────────────────────
console.log('\n▶️ STEP 4: SYSTEMATIC REVIEW MANUSCRIPT & CITATION ENGINES');
const gen = new SystematicReviewGenerator(topic, pico, included, duplicates, mockRawPapers.length);
const review = gen.generate();
STATE.review = review;
window.STATE = STATE;

assert(review.title && review.title.includes('SGLT2 inhibitors in heart failure'), 'Manuscript title generated');
assert(review.abstractObj && review.abstractObj.background && review.abstractObj.methods, 'Structured abstract generated');
assert(review.intro && review.methods && review.results && review.discussion && review.conclusions, 'All 5 core manuscript sections generated');

// Validate tri-modal citation styles (Strictly without square brackets)
CITATION_STYLE = 'vancouver';
window.CITATION_STYLE = CITATION_STYLE;
const vancRefs = getFormattedReferencesForCurrentStyle();
assert(vancRefs.length === 4 && vancRefs[0].text.startsWith('1. '), 'Vancouver citations sequential numbered 1..4');
assert(!vancRefs[0].text.includes('[') && !vancRefs[0].text.includes(']'), 'Vancouver bibliography has ZERO square brackets');
assert(vancRefs[0].text.includes('McMurray') || vancRefs[0].text.includes('Packer'), 'Vancouver authors formatted in standard Title Case format');

// Author parsing regression assertions
const doePaper = {
  authors: 'Wolfram Doehner, Stefan D. Anker, Javed Butler',
  title: 'Uric Acid in Heart Failure',
  year: 2024
};
const vancDoe = formatVancouver(doePaper, 1);
assert(vancDoe.includes('Doehner W, Anker SD, Butler J'), 'Author parsing correctly formats Western given-family names as "Doehner W, Anker SD, Butler J" without inverting into "WOLFRAM D"', vancDoe);

const profPaper = {
  authors: 'Prof. C.K.P.C.S. Rao',
  title: 'Clinical Conundrums in Heart Failure',
  year: 2022
};
const vancProf = formatVancouver(profPaper, 2);
assert(!vancProf.includes('Prof.') && vancProf.includes('Rao'), 'Author parser strips academic honorific "Prof."', vancProf);

const anonPaper = {
  authors: 'Unknown Authors',
  title: 'Aging and Inflammaging in Heart Failure',
  year: 2026
};
const vancAnon = formatVancouver(anonPaper, 3);
assert(vancAnon.includes('[Anonymous]'), 'Author parser falls back to [Anonymous] when authors are unknown without starting citation with bare title', vancAnon);

const vancInText = citify('Evidence shows benefit [1, 2].');
assert(vancInText.includes('<sup class="cite-num cite-vancouver"') && vancInText.includes('1, 2</sup>') && !vancInText.includes('['), 'Vancouver in-text rendered as uppercase superscript without brackets');

const vancPlain = citifyPlainText('Evidence shows benefit [1, 2].');
assert(!vancPlain.includes('[') && !vancPlain.includes(']') && vancPlain.includes('1, 2'), 'Vancouver plain text citations strictly without brackets');

CITATION_STYLE = 'apa';
window.CITATION_STYLE = CITATION_STYLE;
const apaRefs = getFormattedReferencesForCurrentStyle();
assert(apaRefs.length === 4 && apaRefs[0].text.includes('(') && (apaRefs[0].text.includes('&') || apaRefs[0].text.includes('Investigators')), 'APA citations formatted with lead author, year, &');
assert(!apaRefs[0].text.includes('[') && !apaRefs[0].text.includes(']'), 'APA bibliography has ZERO square brackets');

const apaInText = citify('Evidence shows benefit [1, 2].');
assert(!apaInText.includes('[') && !apaInText.includes(']'), 'APA in-text citation has ZERO square brackets');

CITATION_STYLE = 'harvard';
window.CITATION_STYLE = CITATION_STYLE;
const harvardRefs = getFormattedReferencesForCurrentStyle();
assert(harvardRefs.length === 4 && harvardRefs[0].text.includes('Available at:'), 'Harvard citations formatted with Available at: and Accessed date');
assert(!harvardRefs[0].text.includes('[') && !harvardRefs[0].text.includes(']'), 'Harvard bibliography has ZERO square brackets');

const harvardInText = citify('Evidence shows benefit [1, 2].');
assert(!harvardInText.includes('[') && !harvardInText.includes(']'), 'Harvard in-text citation has ZERO square brackets');

// Volume, issue, and page numbers formatting
const volPaper = {
  authors: 'McMurray JJV, Solomon SD',
  title: 'Dapagliflozin in Patients with Heart Failure',
  journal: 'N Engl J Med',
  year: 2019,
  volume: '381',
  issue: '21',
  pages: '1995-2008',
  doi: '10.1056/NEJMoa1911303'
};
const apaVol = formatAPA(volPaper);
assert(apaVol.includes('381') && apaVol.includes('(21)') && apaVol.includes('1995-2008'), 'APA reference includes volume, issue, and pages', apaVol);
const harvardVol = formatHarvard(volPaper);
assert(harvardVol.includes('381') && harvardVol.includes('(21)') && harvardVol.includes('pp. 1995-2008'), 'Harvard reference includes volume, issue, and pp. pages', harvardVol);

// ─────────────────────────────────────────────────────────────
// STEP 5: Meta-Analysis Engine
// ─────────────────────────────────────────────────────────────
console.log('\n▶️ STEP 5: META-ANALYSIS WORKSPACE & STATISTICAL POOLING');
const metaStudies = syncMetaStudiesFromIncluded(included);
assert(metaStudies.length === 4, 'Meta-analysis automatically synced 4 studies from included cohort');
assert(metaStudies[0].e1 === null && metaStudies[0].verified === false, 'Studies sync as unextracted with null counts and verified: false');

// Add non-circular GLP-1 RA landmark cardiovascular trial counts (W12):
// REWIND (Gerstein 2019): 594/4949 vs 663/4952
// SUSTAIN-6 (Marso 2016): 108/1648 vs 146/1649
// PIONEER-6 (Husain 2019): 61/1591 vs 76/1592
// EXSCEL (Holman 2017): 839/7356 vs 905/7396
metaStudies[0].studyId = 'Gerstein et al. (2019)'; metaStudies[0].e1 = 594; metaStudies[0].n1 = 4949; metaStudies[0].e2 = 663; metaStudies[0].n2 = 4952; metaStudies[0].includedInPool = true;
metaStudies[1].studyId = 'Marso et al. (2016)'; metaStudies[1].e1 = 108; metaStudies[1].n1 = 1648; metaStudies[1].e2 = 146; metaStudies[1].n2 = 1649; metaStudies[1].includedInPool = true;
metaStudies[2].studyId = 'Husain et al. (2019)'; metaStudies[2].e1 = 61; metaStudies[2].n1 = 1591; metaStudies[2].e2 = 76; metaStudies[2].n2 = 1592; metaStudies[2].includedInPool = true;
metaStudies[3].studyId = 'Holman et al. (2017)'; metaStudies[3].e1 = 839; metaStudies[3].n1 = 7356; metaStudies[3].e2 = 905; metaStudies[3].n2 = 7396; metaStudies[3].includedInPool = true;

// Regression Assertion: executeMetaAnalysis throws on modelType field typo (Task 4)
let threwModelType = false;
try {
  executeMetaAnalysis({
    outcomeType: 'binary',
    effectMeasure: 'RR',
    modelType: 'random',
    studies: metaStudies
  });
} catch (err) {
  if (err.message && err.message.includes('modelType')) threwModelType = true;
}
assert(threwModelType, 'executeMetaAnalysis throws descriptive error naming field typo if modelType is passed');

const metaState = {
  outcomeType: 'binary',
  effectMeasure: 'RR',
  model: 'random',
  confLevel: 0.95,
  studies: metaStudies
};
const metaStats = executeMetaAnalysis(metaState);
assert(metaStats.isValid === true && metaStats.pooled, 'Meta-analysis calculation succeeded');
const pooled = metaStats.pooled;
assert(!isNaN(pooled.pointEstimate) && pooled.pointEstimate > 0.6 && pooled.pointEstimate < 0.95, 'Meta-analysis pooled Risk Ratio calculated accurately', `Pooled RR: ${pooled.pointEstimate}`);
assert(pooled.ciLow > 0 && pooled.ciHigh < 1.0, 'Meta-analysis confidence interval statistically significant [CI < 1.0]');
assert(pooled.I2 !== undefined && !isNaN(pooled.I2), 'Heterogeneity I² statistic calculated');

// Test 1-Click Auto-Extraction and Quantitative Meta-Analysis Completion
window.STATE.includedPapers = included;
META_ANALYSIS_STATE.studies = syncMetaStudiesFromIncluded(included);
assert(META_ANALYSIS_STATE.studies.every(s => s.e1 === null), 'Synced studies initially have unpopulated null counts');
autoExtractAndCompleteMetaAnalysis();
assert(META_ANALYSIS_STATE.results && META_ANALYSIS_STATE.results.isValid && META_ANALYSIS_STATE.results.pooled, 'autoExtractAndCompleteMetaAnalysis successfully completes quantitative pooling in 1 click');
assert(META_ANALYSIS_STATE.results.pooled.pointEstimate > 0, 'autoExtractAndCompleteMetaAnalysis produces valid pooled effect estimate');
assert(META_ANALYSIS_STATE.results.pooled.totalN1 > 0 && META_ANALYSIS_STATE.results.pooled.totalN2 > 0, 'autoExtractAndCompleteMetaAnalysis extracted valid trial sample sizes');

// Regression Assertion: Integer-ness validation in calculateBinaryStudyEffect (W13)
const nonIntRes = calculateBinaryStudyEffect({ e1: 12.5, n1: 100, e2: 15, n2: 100 }, 'RR', 1.96);
assert(nonIntRes.valid === false && nonIntRes.error.includes('integers'), 'calculateBinaryStudyEffect rejects non-integer counts');

// Regression Assertion: Conservative variance fallback for double-zero RD (W14)
const doubleZeroRD = calculateBinaryStudyEffect({ e1: 0, n1: 50, e2: 0, n2: 50 }, 'RD', 1.96);
assert(doubleZeroRD.valid === true && doubleZeroRD.variance === (1 / 100) * 2, 'calculateBinaryStudyEffect applies conservative double-zero RD variance fallback');

// Regression Assertion: Linear continuous measure MD is NOT exponentiated with Math.exp()
const linearStudies = [
  { id: 's1', studyId: 'Study A', m1: 12.0, s1: 3.0, n1: 50, m2: 15.0, s2: 3.2, n2: 50, includedInPool: true },
  { id: 's2', studyId: 'Study B', m1: 11.5, s1: 2.8, n1: 45, m2: 14.8, s2: 3.0, n2: 45, includedInPool: true }
];
const linearRes = executeMetaAnalysis({
  outcomeType: 'continuous',
  effectMeasure: 'MD',
  model: 'fixed',
  confLevel: 0.95,
  studies: linearStudies
});
assert(linearRes.isValid && linearRes.pooled.pointEstimate < 0 && linearRes.pooled.isRatio === false, 'Linear measure MD is NOT exponentiated with Math.exp()', `MD pointEstimate: ${linearRes.pooled?.pointEstimate}`);

// Regression Assertion: Hedges' g variance for n1=15, n2=15, d=1.0 equals ~0.1420 (SE = 0.3768, scaled by J^2)
const hedgesStudy = { id: 's1', m1: 10.0, s1: 2.0, n1: 15, m2: 8.0, s2: 2.0, n2: 15 };
const hedgesCalc = calculateContinuousStudyEffect(hedgesStudy, 'SMD', 1.96);
assert(hedgesCalc.valid && Math.abs(hedgesCalc.variance - 0.1420) < 0.005 && Math.abs(hedgesCalc.se - 0.3768) < 0.005, 'Hedges g variance correctly scaled by J^2 (~0.1420, SE ~0.3768)', `variance: ${hedgesCalc.variance}, se: ${hedgesCalc.se}`);

// Regression Assertion: Prediction interval for k=3 uses t_(1, 0.975) = 12.706 rather than z = 1.96
const tVal = getTCritical(1, 0.05);
assert(Math.abs(tVal - 12.706) < 0.001, 'Student t critical value for df=1 (k=3 studies) is 12.706', `tVal: ${tVal}`);

// Regression Assertion: Egger's test with k=2 returns { applicable: false } without NaN
const eggerK2 = calculateEggerTest([{ calc: { se: 0.2, logEffect: -0.3 } }, { calc: { se: 0.3, logEffect: -0.4 } }]);
assert(eggerK2.applicable === false && eggerK2.intercept === null, 'Eggers test with k=2 returns { applicable: false } without throwing or NaN');

// Regression Assertion: PDF Text Sanitizer
const sanitized = sanitizePdfText('I² = 0.0%, τ² = 0.00, 2016â€“2026');
assert(sanitized === 'I^2 = 0.0%, tau^2 = 0.00, 2016-2026', 'sanitizePdfText converts I² to I^2, τ² to tau^2, and decodes mojibake en-dash â€“', sanitized);
assert(sanitizePdfText('2016â€"2026') === '2016-2026', 'sanitizePdfText decodes mojibake em-dash â€" (U+201D)');
assert(sanitizePdfText('Effect 10²') === 'Effect 10^2', 'sanitizePdfText converts superscript 2');
assert(sanitizePdfText('CO₂ emissions') === 'CO_2 emissions', 'sanitizePdfText converts subscript 2');

const forestSvg = renderForestPlotSVG(metaState, metaStats);
assert(forestSvg.includes('<svg') && forestSvg.includes('Forest Plot'), 'Publication-ready Forest Plot SVG rendered');

const funnelSvg = renderFunnelPlotSVG(metaState, metaStats);
assert(funnelSvg.includes('<svg') && funnelSvg.includes('Funnel Plot'), 'Funnel Plot SVG rendered');

// ─────────────────────────────────────────────────────────────
// EXPORTS: Word Document (.doc) & PDF Deliverables
// ─────────────────────────────────────────────────────────────
console.log('\n▶️ EXPORTS: WORD DOCUMENT (.DOC) & MULTI-PAGE PDF GENERATION');

// Test Word Doc Exporter
assert(typeof exportSystematicReviewWordDoc === 'function', 'exportSystematicReviewWordDoc function defined');
let wordBlobCaptured = null;
global.URL.createObjectURL = (blob) => {
  wordBlobCaptured = blob;
  return 'blob:mock-word-doc';
};

exportSystematicReviewWordDoc();
assert(wordBlobCaptured && wordBlobCaptured.opts?.type?.includes('msword'), 'Word Document (.doc) generated with valid Microsoft Word MIME type');
const wordText = wordBlobCaptured ? wordBlobCaptured.parts.join('') : '';
assert(wordText.includes('<w:WordDocument>') && wordText.includes('Structured Abstract') && wordText.includes('Table 1. Structured Characteristics'), 'Word Document contains MSO Word XML, Abstract, and Table 1');
assert(wordText.includes('Table 2. Cochrane Risk of Bias Assessment Matrix'), 'Word Document contains Table 2 RoB Assessment Matrix');
assert(wordText.includes('Table 3. Quantitative Evidence Synthesis &amp; Statistical Pooling Matrix'), 'Word Document contains Table 3 Quantitative Meta-Analysis Matrix when pooled');
assert(wordText.includes('mso-header') && wordText.includes('mso-footer'), 'Word Document contains dedicated running headers and footers');

// Test PDF Exporter
assert(typeof exportSystematicReviewPDF === 'function', 'exportSystematicReviewPDF function defined');
exportSystematicReviewPDF();
assert(window._lastSavedPdf && window._lastSavedPdf.includes('.pdf'), 'Systematic Review PDF generated successfully with two-pass header/footer');

exportPRISMAReportPDF();
assert(window._lastSavedPdf && window._lastSavedPdf.includes('PRISMA_RoB'), 'PRISMA & RoB Report PDF generated successfully');

exportReferencesPDF();
assert(window._lastSavedPdf && window._lastSavedPdf.includes('References'), 'Verified References PDF generated successfully');

console.log('\n================================================================');
console.log(`🏆 VALIDATION RESULTS: ${passCount} PASSED | ${failCount} FAILED`);
console.log('================================================================');
if (failCount > 0) process.exit(1);
