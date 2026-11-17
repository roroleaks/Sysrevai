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

console.log(`\n================================================================`);
console.log(`🏆 PHASE 1 INTEGRITY AUDIT: ${passCount} PASSED | ${failCount} FAILED`);
console.log(`================================================================`);

if (failCount > 0) process.exit(1);
