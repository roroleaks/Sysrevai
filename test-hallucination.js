/**
 * SysRevAI Anti-Hallucination, Landmark Isolation, and Statistical Integrity Test Suite
 * Validates PRISMA 2020 Manuscript Generator honesty, RoB calibration, and Cochrane §6.4 compliance.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

console.log('================================================================');
console.log('🛡️ SYSREV AI: ANTI-HALLUCINATION & INTEGRITY TEST SUITE');
console.log('================================================================\n');

// 1. Mock Browser Environment for index.html execution
const mockWindow = {
  addEventListener: () => {},
  removeEventListener: () => {},
  STATE: { papers: [] },
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

// Extract inline script from index.html
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
// SUITE 1: ANTI-HALLUCINATION & CLAIM GROUNDING (TASK 1)
// ─────────────────────────────────────────────────────────────
console.log('▶️ SUITE 1: MANUSCRIPT GENERATOR ANTI-HALLUCINATION AUDIT');

// Test 1: Harmful Studies (RR > 1, p < 0.05) must never claim efficacy or safety
const harmfulMetaResult = {
  isValid: true,
  pooled: {
    pointEstimate: 1.45,
    ciLow: 1.15,
    ciHigh: 1.83,
    pValue: 0.002,
    isRatio: true,
    measure: 'RR',
    I2: 12.0
  }
};

const harmfulPapers = [
  {
    title: 'Trial of Novel Drug vs Placebo in Cardiovascular Disease',
    authors: 'Smith J, Doe A',
    year: 2023,
    abstract: 'Primary composite outcome occurred in 145/1000 patients on active drug vs 100/1000 on placebo (P=0.002).',
    screening: {
      status: 'INCLUDED',
      design: { code: 'rct', name: 'Randomized controlled trials (RCTs)' },
      rob: { overall: 'Some Concerns', domains: { d1: 'Low', d2: 'Some Concerns', d3: 'Low', d4: 'Low', d5: 'Some Concerns' } }
    }
  },
  {
    title: 'Second Multicenter Assessment of Active Agent',
    authors: 'Johnson K, Lee M',
    year: 2024,
    abstract: 'Adverse composite events occurred in 150/1000 vs 105/1000 on control (P=0.004).',
    screening: {
      status: 'INCLUDED',
      design: { code: 'rct', name: 'Randomized controlled trials (RCTs)' },
      rob: { overall: 'Low Risk', domains: { d1: 'Low', d2: 'Low', d3: 'Low', d4: 'Low', d5: 'Low' } }
    }
  }
];

const harmfulGen = new SystematicReviewGenerator(
  'Active Drug in Heart Disease',
  { p: 'Cardiovascular patients', i: 'Active Drug', c: 'Placebo', o: 'Adverse events' },
  harmfulPapers,
  0,
  2,
  harmfulMetaResult
);
const harmfulReview = harmfulGen.generate();

const bannedHarmfulPhrases = [
  'statistically significant clinical improvements',
  'demonstrable clinical efficacy',
  'favorable safety profiles',
  'biological plausibility',
  'mechanistic alignment',
  'concordant therapeutic outcomes'
];

let foundBannedInHarmful = false;
const fullHarmfulText = `${harmfulReview.discussion} ${harmfulReview.conclusions} ${harmfulReview.results} ${JSON.stringify(harmfulReview.abstractObj)}`;
for (const phrase of bannedHarmfulPhrases) {
  if (fullHarmfulText.toLowerCase().includes(phrase.toLowerCase())) {
    foundBannedInHarmful = true;
    console.error(`    Found banned phrase in harmful review: "${phrase}"`);
  }
}
assert(!foundBannedInHarmful, 'Harmful meta-analysis does NOT hallucinate efficacy, safety, or biological plausibility');
assert(harmfulReview.conclusions.includes('increased risk of adverse outcomes') || harmfulReview.discussion.includes('adverse'), 'Harmful review accurately reflects adverse risk direction');

// Test 2: High Risk of Bias & Selective Reporting d5 !== Low
const highRobPaper = {
  title: 'Open Label Study of Therapy in Cardiac Cohort',
  authors: 'Williams T',
  year: 2022,
  abstract: 'Non-blinded evaluation of treatment effects.',
  screening: {
    status: 'INCLUDED',
    design: { code: 'non-rct', name: 'Non-randomized controlled trials' },
    rob: { overall: 'High Risk', domains: { d1: 'High', d2: 'High', d3: 'Low', d4: 'Some Concerns', d5: 'High' } }
  }
};

const highRobGen = new SystematicReviewGenerator(
  'Therapy Cohort Evaluation',
  { p: 'Patients', i: 'Therapy', c: 'Control', o: 'Mortality' },
  [highRobPaper],
  0,
  1,
  null
);
const highRobReview = highRobGen.generate();

assert(!highRobReview.results.includes('high overall methodological rigor'), 'High RoB study suppresses claim of "high overall methodological rigor"');
assert(!highRobReview.results.includes('No major selective reporting biases were detected'), 'Selective reporting domain d5=High suppresses claim of "no major selective reporting"');
assert(highRobReview.results.includes('High Risk of Bias') && highRobReview.results.includes('Selective reporting concerns were identified'), 'Results section accurately flags High RoB and selective reporting concerns');

// Test 3: Empty Paper Cohort (0 studies)
const emptyGen = new SystematicReviewGenerator('Empty Topic', {}, [], 0, 0, null);
const emptyReview = emptyGen.generate();
assert(emptyReview && emptyReview.abstractObj.results.includes('Zero empirical studies met pre-specified PICOS eligibility criteria'), '0-study cohort generates honest calibrated abstract without hallucination');
assert(emptyReview.conclusions.includes('No empirical evidence is available'), '0-study cohort concludes no empirical evidence is available');

// Test 4: manuscriptAssertions audit trail
assert(Array.isArray(harmfulReview.manuscriptAssertions) && harmfulReview.manuscriptAssertions.length > 0, 'manuscriptAssertions audit trail returned with evidence types');
const validAssertionTypes = ['pooledEffect', 'robDomain', 'studyAttribute'];
const allAssertionsValid = harmfulReview.manuscriptAssertions.every(a => validAssertionTypes.includes(a.evidenceType));
assert(allAssertionsValid, 'All manuscript assertions are backed by recognized evidence types (no evidenceType: "none")');

// ─────────────────────────────────────────────────────────────
// SUITE 2: LANDMARK TRIAL LOOKUP TABLE ISOLATION (TASK 2)
// ─────────────────────────────────────────────────────────────
console.log('\n▶️ SUITE 2: LANDMARK TRIAL TABLE ISOLATION & COCHRANE GUARD AUDIT');

// Test 5: Substring matching "deliver" in obstetrics does NOT inject empagliflozin counts
const obstetricsPaper = {
  title: 'Aspirin for preventing preterm delivery in high-risk pregnancies',
  abstract: 'A cohort of high-risk pregnant women evaluated for preterm delivery endpoints.',
  authors: 'Garcia M et al.',
  year: 2022
};
const syncedObstetrics = syncMetaStudiesFromIncluded([obstetricsPaper]);
assert(syncedObstetrics[0].e1 === null && syncedObstetrics[0].n1 === null, 'Preterm delivery paper does NOT match DELIVER trial table (e1 === null, n1 === null)');
assert(syncedObstetrics[0].verified === false && syncedObstetrics[0].includedInPool === false, 'Synced paper is unverified and not auto-included in pool');

// Test 6: Regex fraction does not match calendar dates
const datePaper = {
  title: 'Observational trial cohort report',
  abstract: 'Patients were enrolled 12/2023 through 06/2024 across 4 clinic centers.',
  authors: 'Miller B',
  year: 2024
};
const syncedDate = syncMetaStudiesFromIncluded([datePaper]);
assert(syncedDate[0].e1 === null && syncedDate[0].n1 === null, 'Enrollment date string "12/2023" is NOT parsed as event count (e1 === null)');

// Test 7: Cochrane §6.4.1 Hierarchical / Win Ratio outcome guard
const winRatioPaper = {
  studyId: 'EMPULSE Trial (2022)',
  title: 'Empagliflozin in patients hospitalized for acute heart failure',
  abstract: 'Primary outcome was clinical benefit assessed as a hierarchical composite win ratio of 1.36 (95% CI 1.09 to 1.74).',
  e1: 112,
  n1: 265,
  e2: 148,
  n2: 265,
  includedInPool: true
};
const winRatioCalc = calculateBinaryStudyEffect(winRatioPaper, 'RR', 1.96);
assert(winRatioCalc.valid === false && winRatioCalc.error.includes('Hierarchical/win ratio'), 'calculateBinaryStudyEffect strictly rejects hierarchical win ratio outcomes');

const winRatioPoolRes = executeMetaAnalysis({
  outcomeType: 'binary',
  effectMeasure: 'RR',
  model: 'fixed',
  studies: [
    winRatioPaper,
    { studyId: 'Study 1', e1: 20, n1: 100, e2: 30, n2: 100, includedInPool: true },
    { studyId: 'Study 2', e1: 25, n1: 100, e2: 35, n2: 100, includedInPool: true }
  ]
});
assert(winRatioPoolRes.warnings.some(w => w.includes('Hierarchical/win ratio') && w.includes('Cochrane §6.4.1')), 'executeMetaAnalysis logs Cochrane §6.4.1 warning for hierarchical win ratio paper');
assert(winRatioPoolRes.studiesEvaluated.every(s => s.studyId !== 'EMPULSE Trial (2022)'), 'EMPULSE hierarchical trial is excluded from binary pooling');

// ─────────────────────────────────────────────────────────────
// SUITE 3: HARDENING & STATISTICAL REFERENCE VERIFICATION (TASKS 4, 7)
// ─────────────────────────────────────────────────────────────
console.log('\n▶️ SUITE 3: REPRODUCIBLE STATISTICAL CORE & TYPO ERROR AUDIT');

// Test 8: executeMetaAnalysis throws on modelType
let caughtModelType = false;
try {
  executeMetaAnalysis({
    outcomeType: 'binary',
    effectMeasure: 'RR',
    modelType: 'random',
    studies: [
      { studyId: 'Study 1', e1: 10, n1: 100, e2: 20, n2: 100, includedInPool: true },
      { studyId: 'Study 2', e1: 15, n1: 100, e2: 25, n2: 100, includedInPool: true }
    ]
  });
} catch (e) {
  if (e.message.includes('executeMetaAnalysis: use field "model", not "modelType"')) caughtModelType = true;
}
assert(caughtModelType, 'executeMetaAnalysis strictly throws on modelType typo with descriptive message');

// Test 9: Textbook verification of SGLT2 HF reference set (DAPA-HF, EMPEROR-Reduced, EMPEROR-Preserved)
const landmarkTriad = [
  { studyId: 'DAPA-HF', e1: 386, n1: 2373, e2: 502, n2: 2371, includedInPool: true },
  { studyId: 'EMPEROR-Reduced', e1: 361, n1: 1863, e2: 462, n2: 1867, includedInPool: true },
  { studyId: 'EMPEROR-Preserved', e1: 415, n1: 2997, e2: 511, n2: 2991, includedInPool: true }
];
const triadRes = executeMetaAnalysis({
  outcomeType: 'binary',
  effectMeasure: 'RR',
  model: 'fixed',
  confLevel: 0.95,
  studies: landmarkTriad
});
assert(triadRes.isValid === true, 'Landmark triad pooling executes validly');
const triadRR = triadRes.pooled.pointEstimate;
const triadCiLow = triadRes.pooled.ciLow;
const triadCiHigh = triadRes.pooled.ciHigh;
assert(triadRR.toFixed(4) === '0.7872', `Pooled RR is exactly 0.7872 (got ${triadRR.toFixed(4)})`);
assert(triadCiLow.toFixed(4) === '0.7344' && triadCiHigh.toFixed(4) === '0.8438', `Pooled 95% CI is [0.7344, 0.8438] (got [${triadCiLow.toFixed(4)}, ${triadCiHigh.toFixed(4)}])`);

// Test 10: Cleartext API Key Leaks grep verification
assert(!indexHtml.includes('s2k-0rcC3ztnxRdNGsOKL1SNvwbOPnSaRh4qHBT9qe7A'), 'index.html contains zero leaked S2 API keys');
assert(!indexHtml.includes('LCR4PBZ9z5sTV3HuRDicln'), 'index.html contains zero leaked OpenAlex API keys');

console.log(`\n================================================================`);
console.log(`🏆 HALLUCINATION & INTEGRITY AUDIT: ${passCount} PASSED | ${failCount} FAILED`);
console.log(`================================================================`);

if (failCount > 0) process.exit(1);
