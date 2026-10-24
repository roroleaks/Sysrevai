/**
 * SysRevAI — Publication-Quality PRISMA 2020 Flow Diagram Generator
 * Compliant with PRISMA 2020 Statement (Page MJ, et al. BMJ 2021;372:n71)
 * Supports Templates A, B, C, D with Mathematical Accounting Validation,
 * Live Interactive Editing, 300-DPI PNG, Pure Vector SVG, and PDF Exports.
 * Author: Dr. Raouf Roshdy (AIMed Initiative)
 */
'use strict';

// ═══════════════════════════════════════════════════════════════
// GLOBAL PRISMA DIAGRAM STATE
// ═══════════════════════════════════════════════════════════════
let PRISMA_DIAGRAM_STATE = {
  template: 'A', // 'A' (Databases & Registers), 'B' (+ Other), 'C' (Updated), 'D' (Updated + Other)
  orientation: 'portrait', // 'portrait' | 'landscape'
  reviewTitle: 'Systematic Review and Evidence Synthesis',
  isModifiedFromWorkflow: false,
  zoomLevel: 1.0,

  // Database & Register Pathway
  db_epmc: 0,
  db_s2: 0,
  db_other_name: 'Other Databases',
  db_other_count: 0,
  registers_count: 0,

  duplicates_removed: 0,
  automation_ineligible: 0,
  other_removed_before_screening: 0,

  records_screened: 0,
  records_excluded_screening: 0,
  records_excluded_human: 0,
  records_excluded_automation: 0,

  reports_sought: 0,
  reports_not_retrieved: 0,

  reports_assessed: 0,
  reports_excluded: 0,
  exclusion_reasons: [
    { reason: 'Ineligible study design (non-empirical / review)', count: 0 },
    { reason: 'Off-target clinical intervention / comparator', count: 0 },
    { reason: 'Pre-clinical animal or in-vitro experimental model', count: 0 },
    { reason: 'Irrelevant clinical endpoints or missing data', count: 0 }
  ],

  new_studies_included: 0,
  new_reports_included: 0,

  // Other Methods Pathway (Templates B & D)
  other_sources: {
    websites: 0,
    organisations: 0,
    citation_searching: 0,
    other: 0,
    reports_sought: 0,
    reports_not_retrieved: 0,
    reports_assessed: 0,
    reports_excluded: 0,
    exclusion_reasons: [
      { reason: 'Did not meet PICOS eligibility criteria', count: 0 }
    ],
    studies_included: 0,
    reports_included: 0
  },

  // Previous Studies Pathway (Templates C & D)
  previous_studies: {
    studies_included: 0,
    reports_included: 0
  },

  // Reconciled Totals (Templates B, C, D)
  total_studies_included: 0,
  total_reports_included: 0
};

// ═══════════════════════════════════════════════════════════════
// STRING ESCAPING & UTILITIES
// ═══════════════════════════════════════════════════════════════
function escapeXml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeFileName(str) {
  if (!str) return 'Systematic_Review';
  return str.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').substring(0, 45);
}

// ═══════════════════════════════════════════════════════════════
// MATHEMATICAL ACCOUNTING & VALIDATION ENGINE
// ═══════════════════════════════════════════════════════════════
function validatePrismaDiagramCounts(s) {
  const issues = [];
  const warnings = [];

  const totalDb = Number(s.db_epmc || 0) + Number(s.db_s2 || 0) + Number(s.db_other_count || 0);
  const totalId = totalDb + Number(s.registers_count || 0);
  const totalRemovedBefore = Number(s.duplicates_removed || 0) + Number(s.automation_ineligible || 0) + Number(s.other_removed_before_screening || 0);

  // 1. Identification Check
  const expectedScreened = totalId - totalRemovedBefore;
  if (totalId > 0 && Number(s.records_screened) !== expectedScreened) {
    const diff = Number(s.records_screened) - expectedScreened;
    issues.push({
      phase: 'Identification',
      title: 'Identification Phase Discrepancy',
      equation: `Records Screened (${s.records_screened}) ≠ Total Identified (${totalId}) − Removed Before Screening (${totalRemovedBefore})`,
      expected: expectedScreened,
      diff: diff > 0 ? `+${diff}` : `${diff}`,
      hint: `Expected ${expectedScreened} records screened. Adjust Records Screened or records removed before screening.`
    });
  }

  // 2. Screening Check
  const expectedSought = Number(s.records_screened || 0) - Number(s.records_excluded_screening || 0);
  if (Number(s.records_screened || 0) > 0 && Number(s.reports_sought) !== expectedSought) {
    const diff = Number(s.reports_sought) - expectedSought;
    issues.push({
      phase: 'Screening',
      title: 'Screening Phase Discrepancy',
      equation: `Reports Sought (${s.reports_sought}) ≠ Records Screened (${s.records_screened}) − Records Excluded (${s.records_excluded_screening})`,
      expected: expectedSought,
      diff: diff > 0 ? `+${diff}` : `${diff}`,
      hint: `Expected ${expectedSought} reports sought for retrieval. Adjust Reports Sought or Records Excluded.`
    });
  }

  // Automation vs Human breakdown
  const subEx = Number(s.records_excluded_automation || 0) + Number(s.records_excluded_human || 0);
  if (subEx > 0 && subEx !== Number(s.records_excluded_screening || 0)) {
    warnings.push({
      phase: 'Screening',
      title: 'Exclusion Sub-breakdown Mismatch',
      equation: `Human (${s.records_excluded_human}) + Automation (${s.records_excluded_automation}) = ${subEx} ≠ Total Excluded (${s.records_excluded_screening})`,
      hint: `Sum of human and automated screening exclusions does not equal total screening exclusions.`
    });
  }

  // 3. Retrieval Check
  const expectedAssessed = Number(s.reports_sought || 0) - Number(s.reports_not_retrieved || 0);
  if (Number(s.reports_sought || 0) > 0 && Number(s.reports_assessed) !== expectedAssessed) {
    const diff = Number(s.reports_assessed) - expectedAssessed;
    issues.push({
      phase: 'Retrieval',
      title: 'Retrieval Phase Discrepancy',
      equation: `Reports Assessed (${s.reports_assessed}) ≠ Reports Sought (${s.reports_sought}) − Reports Not Retrieved (${s.reports_not_retrieved})`,
      expected: expectedAssessed,
      diff: diff > 0 ? `+${diff}` : `${diff}`,
      hint: `Expected ${expectedAssessed} reports assessed for eligibility.`
    });
  }

  // 4. Eligibility Check
  const expectedNewReports = Number(s.reports_assessed || 0) - Number(s.reports_excluded || 0);
  if (Number(s.reports_assessed || 0) > 0 && Number(s.new_reports_included) !== expectedNewReports) {
    const diff = Number(s.new_reports_included) - expectedNewReports;
    issues.push({
      phase: 'Eligibility',
      title: 'Eligibility Phase Discrepancy',
      equation: `Reports of New Included Studies (${s.new_reports_included}) ≠ Reports Assessed (${s.reports_assessed}) − Reports Excluded (${s.reports_excluded})`,
      expected: expectedNewReports,
      diff: diff > 0 ? `+${diff}` : `${diff}`,
      hint: `Expected ${expectedNewReports} reports of included studies.`
    });
  }

  // Exclusion reasons sum check
  const sumReasons = (s.exclusion_reasons || []).reduce((acc, r) => acc + Number(r.count || 0), 0);
  if (s.exclusion_reasons && s.exclusion_reasons.length > 0 && sumReasons !== Number(s.reports_excluded || 0)) {
    warnings.push({
      phase: 'Eligibility',
      title: 'Detailed Exclusion Reasons Sum Mismatch',
      equation: `Sum of Detailed Reasons (${sumReasons}) ≠ Total Reports Excluded (${s.reports_excluded})`,
      hint: `The individual exclusion category counts total ${sumReasons}, whereas Total Reports Excluded is set to ${s.reports_excluded}.`
    });
  }

  // 5. Studies vs Reports Relationship
  if (Number(s.new_studies_included || 0) > Number(s.new_reports_included || 0)) {
    issues.push({
      phase: 'Included',
      title: 'Studies Exceed Reports',
      equation: `Unique Studies (${s.new_studies_included}) > Reports of Studies (${s.new_reports_included})`,
      expected: `≤ ${s.new_reports_included}`,
      diff: `+${Number(s.new_studies_included) - Number(s.new_reports_included)}`,
      hint: `A clinical study may have multiple published reports, but the number of unique studies cannot logically exceed total reports.`
    });
  }

  // 6. Other Methods Validation (Templates B & D)
  if (s.template === 'B' || s.template === 'D') {
    const o = s.other_sources || {};
    const otherId = Number(o.websites || 0) + Number(o.organisations || 0) + Number(o.citation_searching || 0) + Number(o.other || 0);
    const expectedOtherAssessed = Number(o.reports_sought || 0) - Number(o.reports_not_retrieved || 0);
    if (Number(o.reports_sought || 0) > 0 && Number(o.reports_assessed) !== expectedOtherAssessed) {
      issues.push({
        phase: 'Other Methods',
        title: 'Other Methods Retrieval Discrepancy',
        equation: `Assessed (${o.reports_assessed}) ≠ Sought (${o.reports_sought}) − Not Retrieved (${o.reports_not_retrieved})`,
        expected: expectedOtherAssessed,
        diff: '',
        hint: `Adjust other methods reports assessed or not retrieved.`
      });
    }
  }

  // 7. Combined Totals Validation (Templates B, C, D)
  if (s.template === 'B' || s.template === 'C' || s.template === 'D') {
    let expectedTotStudies = Number(s.new_studies_included || 0);
    let expectedTotReports = Number(s.new_reports_included || 0);

    if (s.template === 'C' || s.template === 'D') {
      expectedTotStudies += Number(s.previous_studies?.studies_included || 0);
      expectedTotReports += Number(s.previous_studies?.reports_included || 0);
    }
    if (s.template === 'B' || s.template === 'D') {
      expectedTotStudies += Number(s.other_sources?.studies_included || 0);
      expectedTotReports += Number(s.other_sources?.reports_included || 0);
    }

    if (Number(s.total_studies_included) !== expectedTotStudies) {
      warnings.push({
        phase: 'Totals',
        title: 'Total Studies Reconciliation',
        equation: `Total Studies (${s.total_studies_included}) ≠ Sum Across Pathways (${expectedTotStudies})`,
        hint: `Total studies entered does not equal the arithmetic sum across new, previous, and other methods pathways.`
      });
    }
    if (Number(s.total_reports_included) !== expectedTotReports) {
      warnings.push({
        phase: 'Totals',
        title: 'Total Reports Reconciliation',
        equation: `Total Reports (${s.total_reports_included}) ≠ Sum Across Pathways (${expectedTotReports})`,
        hint: `Total reports entered does not equal the arithmetic sum across all included pathways.`
      });
    }
  }

  return {
    isValid: issues.length === 0,
    hasWarnings: warnings.length > 0,
    issues,
    warnings,
    isPartialReview: totalId === 0 || Number(s.records_screened || 0) === 0
  };
}

// ═══════════════════════════════════════════════════════════════
// WORKFLOW STATE SYNCHRONIZATION
// ═══════════════════════════════════════════════════════════════
function syncPrismaStateFromWorkflow(force = false) {
  if (PRISMA_DIAGRAM_STATE.isModifiedFromWorkflow && !force) {
    return; // Preserve manual reviewer customizations
  }

  PRISMA_DIAGRAM_STATE.reviewTitle = STATE.topic || 'Systematic Review and Evidence Synthesis';
  PRISMA_DIAGRAM_STATE.isModifiedFromWorkflow = false;

  // Databases & Registers
  PRISMA_DIAGRAM_STATE.db_epmc = Number(STATE.sourceCounts?.epmc || 0);
  PRISMA_DIAGRAM_STATE.db_s2 = Number(STATE.sourceCounts?.s2 || 0);
  const otherCount = Number(STATE.sourceCounts?.openalex || 0) + Number(STATE.sourceCounts?.crossref || 0);
  if (otherCount > 0) {
    const names = [];
    if (STATE.sourceCounts?.openalex > 0) names.push('OpenAlex');
    if (STATE.sourceCounts?.crossref > 0) names.push('Crossref');
    PRISMA_DIAGRAM_STATE.db_other_name = names.join(' & ');
    PRISMA_DIAGRAM_STATE.db_other_count = otherCount;
  } else {
    PRISMA_DIAGRAM_STATE.db_other_count = 0;
  }
  PRISMA_DIAGRAM_STATE.registers_count = 0;

  // Pre-screening
  PRISMA_DIAGRAM_STATE.duplicates_removed = Number(STATE.duplicatesRemoved || 0);
  PRISMA_DIAGRAM_STATE.automation_ineligible = 0;
  PRISMA_DIAGRAM_STATE.other_removed_before_screening = 0;

  // Screening
  const screenedCount = Array.isArray(STATE.papers) ? STATE.papers.length : 0;
  const excludedPapers = Array.isArray(STATE.excludedPapers) ? STATE.excludedPapers : [];
  const includedPapers = Array.isArray(STATE.includedPapers) ? STATE.includedPapers : [];
  const borderlinePapers = Array.isArray(STATE.borderlinePapers) ? STATE.borderlinePapers : [];

  PRISMA_DIAGRAM_STATE.records_screened = screenedCount;
  PRISMA_DIAGRAM_STATE.records_excluded_screening = excludedPapers.length;
  PRISMA_DIAGRAM_STATE.records_excluded_human = excludedPapers.length;
  PRISMA_DIAGRAM_STATE.records_excluded_automation = 0;

  // Retrieval
  const sought = screenedCount - excludedPapers.length;
  PRISMA_DIAGRAM_STATE.reports_sought = Math.max(0, sought);
  PRISMA_DIAGRAM_STATE.reports_not_retrieved = 0;

  // Eligibility
  const ftExclusions = borderlinePapers.length;
  PRISMA_DIAGRAM_STATE.reports_assessed = Math.max(0, sought);
  PRISMA_DIAGRAM_STATE.reports_excluded = ftExclusions;

  // Build full-text exclusion reasons matching reports_excluded
  if (ftExclusions > 0) {
    PRISMA_DIAGRAM_STATE.exclusion_reasons = [
      { reason: 'Unverified / Borderline eligibility criteria', count: ftExclusions }
    ];
  } else {
    PRISMA_DIAGRAM_STATE.exclusion_reasons = [
      { reason: 'Ineligible study design / non-empirical', count: 0 },
      { reason: 'Off-target clinical intervention or comparator', count: 0 },
      { reason: 'Pre-clinical animal or in-vitro model', count: 0 }
    ];
  }

  // Included
  const incCount = includedPapers.length;
  PRISMA_DIAGRAM_STATE.new_studies_included = incCount;
  PRISMA_DIAGRAM_STATE.new_reports_included = incCount;
  PRISMA_DIAGRAM_STATE.total_studies_included = incCount;
  PRISMA_DIAGRAM_STATE.total_reports_included = incCount;
}

// Automatic Arithmetic Reconciliation Helper
function autoReconcilePrismaCounts() {
  const s = PRISMA_DIAGRAM_STATE;
  const totalDb = Number(s.db_epmc || 0) + Number(s.db_s2 || 0) + Number(s.db_other_count || 0);
  const totalId = totalDb + Number(s.registers_count || 0);
  const totalRemovedBefore = Number(s.duplicates_removed || 0) + Number(s.automation_ineligible || 0) + Number(s.other_removed_before_screening || 0);

  s.records_screened = Math.max(0, totalId - totalRemovedBefore);
  s.reports_sought = Math.max(0, Number(s.records_screened) - Number(s.records_excluded_screening || 0));
  s.reports_assessed = Math.max(0, Number(s.reports_sought) - Number(s.reports_not_retrieved || 0));
  
  // Balance exclusion reasons with reports excluded
  const sumReasons = (s.exclusion_reasons || []).reduce((acc, r) => acc + Number(r.count || 0), 0);
  if (sumReasons > 0 && Number(s.reports_excluded) === 0) {
    s.reports_excluded = sumReasons;
  }
  
  s.new_reports_included = Math.max(0, Number(s.reports_assessed) - Number(s.reports_excluded || 0));
  if (Number(s.new_studies_included) > Number(s.new_reports_included) || Number(s.new_studies_included) === 0) {
    s.new_studies_included = s.new_reports_included;
  }

  // Totals for Templates B, C, D
  let totS = Number(s.new_studies_included);
  let totR = Number(s.new_reports_included);
  if (s.template === 'C' || s.template === 'D') {
    totS += Number(s.previous_studies?.studies_included || 0);
    totR += Number(s.previous_studies?.reports_included || 0);
  }
  if (s.template === 'B' || s.template === 'D') {
    totS += Number(s.other_sources?.studies_included || 0);
    totR += Number(s.other_sources?.reports_included || 0);
  }
  s.total_studies_included = totS;
  s.total_reports_included = totR;

  s.isModifiedFromWorkflow = true;
  refreshPrismaEditor();
}

// ═══════════════════════════════════════════════════════════════
// SVG DIAGRAM RENDERING ENGINE
// ═══════════════════════════════════════════════════════════════
function renderPrismaSVG(s) {
  const tmpl = s.template || 'A';
  const isLandscape = s.orientation === 'landscape';

  // Base dimensions
  let svgW = 940;
  if (tmpl === 'B' || tmpl === 'D') svgW = 1320;
  else if (isLandscape) svgW = 1120;

  // Box heights and dynamic spacing
  const reasons = Array.isArray(s.exclusion_reasons) ? s.exclusion_reasons : [];
  const box8H = Math.max(90, 52 + reasons.length * 18);
  const box9Y = 475 + box8H + 35;
  const totalSvgH = box9Y + (tmpl === 'B' || tmpl === 'C' || tmpl === 'D' ? 240 : 180);

  // Totals calculation
  const totalDb = Number(s.db_epmc || 0) + Number(s.db_s2 || 0) + Number(s.db_other_count || 0);
  const totalId = totalDb + Number(s.registers_count || 0);
  const totalRemovedBefore = Number(s.duplicates_removed || 0) + Number(s.automation_ineligible || 0) + Number(s.other_removed_before_screening || 0);

  // SVG Markup Header
  let svg = `
<svg id="prisma-svg-canvas" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${totalSvgH}" width="${svgW}" height="${totalSvgH}" style="background:#ffffff;font-family:Arial,Helvetica,sans-serif">
  <defs>
    <!-- Official PRISMA Arrowhead Marker -->
    <marker id="prisma-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#1e293b"/>
    </marker>
    <!-- Crisp Vector Styling Embedded -->
    <style>
      .p-box { fill: #ffffff; stroke: #1e293b; stroke-width: 1.5px; }
      .p-header { font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; fill: #0f172a; }
      .p-title { font-family: Arial, Helvetica, sans-serif; font-size: 12.5px; font-weight: bold; fill: #0f172a; }
      .p-text { font-family: Arial, Helvetica, sans-serif; font-size: 11.5px; fill: #1e293b; }
      .p-subtext { font-family: Arial, Helvetica, sans-serif; font-size: 11px; fill: #475569; }
      .p-num { font-family: Arial, Helvetica, sans-serif; font-size: 12px; font-weight: bold; fill: #0f172a; }
      .p-arrow { stroke: #1e293b; stroke-width: 1.5px; fill: none; marker-end: url(#prisma-arrow); }
      .p-phase-bg { fill: #f8fafc; stroke: #94a3b8; stroke-width: 1.2px; }
      .p-phase-text { font-family: Arial, Helvetica, sans-serif; font-size: 12px; font-weight: bold; fill: #334155; letter-spacing: 2px; }
      .p-footnote { font-family: Arial, Helvetica, sans-serif; font-size: 10px; fill: #64748b; line-height: 1.4; }
      .p-doc-title { font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: bold; fill: #0f172a; text-anchor: middle; }
      .p-doc-sub { font-family: Arial, Helvetica, sans-serif; font-size: 11px; fill: #64748b; text-anchor: middle; }
    </style>
  </defs>

  <!-- Document Title & Review Context -->
  <text x="${svgW / 2}" y="22" class="p-doc-title">${escapeXml(s.reviewTitle || 'PRISMA 2020 Flow Diagram')}</text>
  <text x="${svgW / 2}" y="38" class="p-doc-sub">PRISMA 2020 Flow Diagram for Systematic Review · Template ${escapeXml(tmpl)} · Sysrevai Evidence Synthesis</text>
  `;

  // ─────────────────────────────────────────────────────────────
  // 1. LEFT VERTICAL PHASE RAILS
  // ─────────────────────────────────────────────────────────────
  const phaseRailW = 75;
  const phaseRailX = 20;

  // Identification Phase Bar
  svg += `
  <g class="p-phase">
    <rect x="${phaseRailX}" y="60" width="${phaseRailW}" height="145" rx="3" class="p-phase-bg"/>
    <text x="${phaseRailX + 37}" y="132" transform="rotate(-90, ${phaseRailX + 37}, 132)" text-anchor="middle" class="p-phase-text">IDENTIFICATION</text>
  </g>
  `;

  // Screening Phase Bar
  const screenH = (475 + box8H) - 230;
  svg += `
  <g class="p-phase">
    <rect x="${phaseRailX}" y="230" width="${phaseRailW}" height="${screenH}" rx="3" class="p-phase-bg"/>
    <text x="${phaseRailX + 37}" y="${230 + screenH / 2}" transform="rotate(-90, ${phaseRailX + 37}, ${230 + screenH / 2})" text-anchor="middle" class="p-phase-text">SCREENING</text>
  </g>
  `;

  // Included Phase Bar
  const incH = (tmpl === 'B' || tmpl === 'C' || tmpl === 'D') ? 180 : 95;
  svg += `
  <g class="p-phase">
    <rect x="${phaseRailX}" y="${box9Y}" width="${phaseRailW}" height="${incH}" rx="3" class="p-phase-bg"/>
    <text x="${phaseRailX + 37}" y="${box9Y + incH / 2}" transform="rotate(-90, ${phaseRailX + 37}, ${box9Y + incH / 2})" text-anchor="middle" class="p-phase-text">INCLUDED</text>
  </g>
  `;

  // ─────────────────────────────────────────────────────────────
  // 2. PRIMARY PATHWAY: DATABASES & REGISTERS
  // ─────────────────────────────────────────────────────────────
  const b1X = 115, b1W = 345, b1Y = 60, b1H = 145;
  const b2X = 505, b2W = 395, b2Y = 60, b2H = 145;

  // Box 1: Records Identified
  svg += `
  <g class="prisma-box-group">
    <rect x="${b1X}" y="${b1Y}" width="${b1W}" height="${b1H}" class="p-box"/>
    <text x="${b1X + 14}" y="${b1Y + 20}" class="p-header">Identification of studies via databases and registers</text>
    <text x="${b1X + 14}" y="${b1Y + 38}" class="p-text">Records identified from*:</text>
    <text x="${b1X + 14}" y="${b1Y + 56}" class="p-num">Databases (n = ${totalDb}):</text>
    <text x="${b1X + 24}" y="${b1Y + 74}" class="p-subtext">• Europe PMC (n = ${s.db_epmc})</text>
    <text x="${b1X + 24}" y="${b1Y + 92}" class="p-subtext">• Semantic Scholar (n = ${s.db_s2})</text>
    ${s.db_other_count > 0 ? `<text x="${b1X + 24}" y="${b1Y + 110}" class="p-subtext">• ${escapeXml(s.db_other_name)} (n = ${s.db_other_count})</text>` : ''}
    <text x="${b1X + 14}" y="${b1Y + (s.db_other_count > 0 ? 128 : 114)}" class="p-num">Registers (n = ${s.registers_count}):</text>
  </g>
  `;

  // Box 2: Records Removed Before Screening
  svg += `
  <g class="prisma-box-group">
    <rect x="${b2X}" y="${b2Y}" width="${b2W}" height="${b2H}" class="p-box"/>
    <text x="${b2X + 14}" y="${b2Y + 20}" class="p-header">Records removed before screening:</text>
    <text x="${b2X + 14}" y="${b2Y + 44}" class="p-text">Duplicate records removed (n = ${s.duplicates_removed})</text>
    <text x="${b2X + 14}" y="${b2Y + 70}" class="p-text">Records marked as ineligible by automation</text>
    <text x="${b2X + 14}" y="${b2Y + 86}" class="p-text">tools (n = ${s.automation_ineligible})</text>
    <text x="${b2X + 14}" y="${b2Y + 114}" class="p-text">Records removed for other reasons (n = ${s.other_removed_before_screening})</text>
  </g>
  `;

  // Connector Box 1 -> Box 2 (Horizontal Arrow)
  svg += `<path d="M ${b1X + b1W} ${b1Y + b1H / 2} L ${b2X} ${b2Y + b2H / 2}" class="p-arrow"/>`;

  // Connector Box 1 -> Box 3 (Vertical Arrow)
  const b3Y = 230, b3H = 70;
  const col1MidX = b1X + b1W / 2;
  svg += `<path d="M ${col1MidX} ${b1Y + b1H} L ${col1MidX} ${b3Y}" class="p-arrow"/>`;

  // Box 3: Records Screened
  svg += `
  <g class="prisma-box-group">
    <rect x="${b1X}" y="${b3Y}" width="${b1W}" height="${b3H}" class="p-box"/>
    <text x="${b1X + 14}" y="${b3Y + 28}" class="p-header">Records screened</text>
    <text x="${b1X + 14}" y="${b3Y + 50}" class="p-num">(n = ${s.records_screened})</text>
  </g>
  `;

  // Box 4: Records Excluded (Screening)
  svg += `
  <g class="prisma-box-group">
    <rect x="${b2X}" y="${b3Y}" width="${b2W}" height="${b3H}" class="p-box"/>
    <text x="${b2X + 14}" y="${b3Y + 26}" class="p-header">Records excluded**:</text>
    <text x="${b2X + 14}" y="${b3Y + 46}" class="p-num">(n = ${s.records_excluded_screening})</text>
    ${(s.records_excluded_human > 0 || s.records_excluded_automation > 0) ? `
      <text x="${b2X + 14}" y="${b3Y + 62}" class="p-subtext">Human: ${s.records_excluded_human} · Automation: ${s.records_excluded_automation}</text>
    ` : ''}
  </g>
  `;

  // Connector Box 3 -> Box 4 (Horizontal Arrow)
  svg += `<path d="M ${b1X + b1W} ${b3Y + b3H / 2} L ${b2X} ${b3Y + b3H / 2}" class="p-arrow"/>`;

  // Connector Box 3 -> Box 5 (Vertical Arrow)
  const b5Y = 340, b5H = 70;
  svg += `<path d="M ${col1MidX} ${b3Y + b3H} L ${col1MidX} ${b5Y}" class="p-arrow"/>`;

  // Box 5: Reports Sought for Retrieval
  svg += `
  <g class="prisma-box-group">
    <rect x="${b1X}" y="${b5Y}" width="${b1W}" height="${b5H}" class="p-box"/>
    <text x="${b1X + 14}" y="${b5Y + 28}" class="p-header">Reports sought for retrieval</text>
    <text x="${b1X + 14}" y="${b5Y + 50}" class="p-num">(n = ${s.reports_sought})</text>
  </g>
  `;

  // Box 6: Reports Not Retrieved
  svg += `
  <g class="prisma-box-group">
    <rect x="${b2X}" y="${b5Y}" width="${b2W}" height="${b5H}" class="p-box"/>
    <text x="${b2X + 14}" y="${b5Y + 28}" class="p-header">Reports not retrieved</text>
    <text x="${b2X + 14}" y="${b5Y + 50}" class="p-num">(n = ${s.reports_not_retrieved})</text>
  </g>
  `;

  // Connector Box 5 -> Box 6 (Horizontal Arrow)
  svg += `<path d="M ${b1X + b1W} ${b5Y + b5H / 2} L ${b2X} ${b5Y + b5H / 2}" class="p-arrow"/>`;

  // Connector Box 5 -> Box 7 (Vertical Arrow)
  const b7Y = 450, b7H = 70;
  svg += `<path d="M ${col1MidX} ${b5Y + b5H} L ${col1MidX} ${b7Y}" class="p-arrow"/>`;

  // Box 7: Reports Assessed for Eligibility
  svg += `
  <g class="prisma-box-group">
    <rect x="${b1X}" y="${b7Y}" width="${b1W}" height="${b7H}" class="p-box"/>
    <text x="${b1X + 14}" y="${b7Y + 28}" class="p-header">Reports assessed for eligibility</text>
    <text x="${b1X + 14}" y="${b7Y + 50}" class="p-num">(n = ${s.reports_assessed})</text>
  </g>
  `;

  // Box 8: Reports Excluded with Reasons
  let reasonsMarkup = '';
  reasons.forEach((r, idx) => {
    const ry = b7Y + 48 + idx * 18;
    reasonsMarkup += `<text x="${b2X + 22}" y="${ry}" class="p-subtext">• ${escapeXml(r.reason)} (n = ${r.count})</text>`;
  });

  svg += `
  <g class="prisma-box-group">
    <rect x="${b2X}" y="${b7Y}" width="${b2W}" height="${box8H}" class="p-box"/>
    <text x="${b2X + 14}" y="${b7Y + 22}" class="p-header">Reports excluded:</text>
    <text x="${b2X + 14}" y="${b7Y + 38}" class="p-text">Total reports excluded (n = ${s.reports_excluded})</text>
    ${reasonsMarkup}
  </g>
  `;

  // Connector Box 7 -> Box 8 (Horizontal Arrow)
  svg += `<path d="M ${b1X + b1W} ${b7Y + 35} L ${b2X} ${b7Y + 35}" class="p-arrow"/>`;

  // Connector Box 7 -> Box 9 (Vertical Arrow)
  svg += `<path d="M ${col1MidX} ${b7Y + b7H} L ${col1MidX} ${box9Y}" class="p-arrow"/>`;

  // Box 9: Studies & Reports Included
  svg += `
  <g class="prisma-box-group">
    <rect x="${b1X}" y="${box9Y}" width="${b1W}" height="95" class="p-box"/>
    <text x="${b1X + 14}" y="${box9Y + 22}" class="p-header">New studies included in review</text>
    <text x="${b1X + 14}" y="${box9Y + 40}" class="p-num">(n = ${s.new_studies_included})</text>
    <text x="${b1X + 14}" y="${box9Y + 62}" class="p-header">Reports of new included studies</text>
    <text x="${b1X + 14}" y="${box9Y + 80}" class="p-num">(n = ${s.new_reports_included})</text>
  </g>
  `;

  // ─────────────────────────────────────────────────────────────
  // 3. TEMPLATES B, C, D SPECIFIC BRANCHES
  // ─────────────────────────────────────────────────────────────
  if (tmpl === 'C') {
    // Template C: Updated review using databases & registers
    const prev = s.previous_studies || {};
    const pBoxX = b2X;
    const pBoxY = box9Y;
    const pBoxW = b2W;
    const pBoxH = 95;

    svg += `
    <g class="prisma-box-group">
      <rect x="${pBoxX}" y="${pBoxY}" width="${pBoxW}" height="${pBoxH}" class="p-box"/>
      <text x="${pBoxX + 14}" y="${pBoxY + 22}" class="p-header">Previous studies</text>
      <text x="${pBoxX + 14}" y="${pBoxY + 42}" class="p-text">Studies included in previous review (n = ${prev.studies_included || 0})</text>
      <text x="${pBoxX + 14}" y="${pBoxY + 64}" class="p-text">Reports of studies in previous review</text>
      <text x="${pBoxX + 14}" y="${pBoxY + 82}" class="p-num">(n = ${prev.reports_included || 0})</text>
    </g>
    `;

    // Total Combined Studies Included Box
    const totBoxY = box9Y + 125;
    const totBoxW = 440;
    const totBoxX = svgW / 2 - totBoxW / 2;

    svg += `
    <g class="prisma-box-group">
      <rect x="${totBoxX}" y="${totBoxY}" width="${totBoxW}" height="85" class="p-box" style="stroke-width:2px;stroke:#0f6b6b"/>
      <text x="${totBoxX + 16}" y="${totBoxY + 22}" class="p-header" style="fill:#0f6b6b">Total studies included in review</text>
      <text x="${totBoxX + 16}" y="${totBoxY + 38}" class="p-num">(n = ${s.total_studies_included})</text>
      <text x="${totBoxX + 16}" y="${totBoxY + 58}" class="p-header" style="fill:#0f6b6b">Total reports of included studies</text>
      <text x="${totBoxX + 16}" y="${totBoxY + 74}" class="p-num">(n = ${s.total_reports_included})</text>
    </g>
    <!-- Converging Arrows into Combined Box -->
    <path d="M ${col1MidX} ${box9Y + 95} L ${col1MidX} ${totBoxY + 40} L ${totBoxX} ${totBoxY + 40}" class="p-arrow"/>
    <path d="M ${pBoxX + pBoxW / 2} ${box9Y + 95} L ${pBoxX + pBoxW / 2} ${totBoxY + 40} L ${totBoxX + totBoxW} ${totBoxY + 40}" class="p-arrow"/>
    `;
  }

  if (tmpl === 'B' || tmpl === 'D') {
    // Other Methods Branch (Right Column)
    const oX = 920, oW = 370;
    const o = s.other_sources || {};
    const oReasons = Array.isArray(o.exclusion_reasons) ? o.exclusion_reasons : [];
    const oBox8H = Math.max(80, 48 + oReasons.length * 18);

    // Other Methods Identification Box
    svg += `
    <g class="prisma-box-group">
      <rect x="${oX}" y="${b1Y}" width="${oW}" height="${b1H}" class="p-box"/>
      <text x="${oX + 14}" y="${b1Y + 20}" class="p-header">Identification of studies via other methods</text>
      <text x="${oX + 14}" y="${b1Y + 38}" class="p-text">Records identified from:</text>
      <text x="${oX + 24}" y="${b1Y + 56}" class="p-subtext">• Websites (n = ${o.websites || 0})</text>
      <text x="${oX + 24}" y="${b1Y + 74}" class="p-subtext">• Organisations (n = ${o.organisations || 0})</text>
      <text x="${oX + 24}" y="${b1Y + 92}" class="p-subtext">• Citation searching (n = ${o.citation_searching || 0})</text>
      <text x="${oX + 24}" y="${b1Y + 110}" class="p-subtext">• Other sources (n = ${o.other || 0})</text>
    </g>
    `;

    // Arrow to Other Reports Sought
    const oMidX = oX + oW / 2;
    svg += `<path d="M ${oMidX} ${b1Y + b1H} L ${oMidX} ${b5Y}" class="p-arrow"/>`;

    // Other Reports Sought Box
    svg += `
    <g class="prisma-box-group">
      <rect x="${oX}" y="${b5Y}" width="${oW / 2 - 10}" height="${b5H}" class="p-box"/>
      <text x="${oX + 10}" y="${b5Y + 26}" class="p-title">Reports sought</text>
      <text x="${oX + 10}" y="${b5Y + 48}" class="p-num">(n = ${o.reports_sought || 0})</text>
    </g>
    <g class="prisma-box-group">
      <rect x="${oX + oW / 2 + 10}" y="${b5Y}" width="${oW / 2 - 10}" height="${b5H}" class="p-box"/>
      <text x="${oX + oW / 2 + 18}" y="${b5Y + 26}" class="p-title">Not retrieved</text>
      <text x="${oX + oW / 2 + 18}" y="${b5Y + 48}" class="p-num">(n = ${o.reports_not_retrieved || 0})</text>
    </g>
    <path d="M ${oX + oW / 2 - 10} ${b5Y + 35} L ${oX + oW / 2 + 10} ${b5Y + 35}" class="p-arrow"/>
    <path d="M ${oX + (oW / 4)} ${b5Y + b5H} L ${oX + (oW / 4)} ${b7Y}" class="p-arrow"/>
    `;

    // Other Reports Assessed Box
    let oReasMarkup = '';
    oReasons.forEach((r, idx) => {
      oReasMarkup += `<text x="${oX + oW / 2 + 18}" y="${b7Y + 44 + idx * 16}" class="p-subtext">• ${escapeXml(r.reason)} (${r.count})</text>`;
    });

    svg += `
    <g class="prisma-box-group">
      <rect x="${oX}" y="${b7Y}" width="${oW / 2 - 10}" height="${b7H}" class="p-box"/>
      <text x="${oX + 10}" y="${b7Y + 26}" class="p-title">Reports assessed</text>
      <text x="${oX + 10}" y="${b7Y + 48}" class="p-num">(n = ${o.reports_assessed || 0})</text>
    </g>
    <g class="prisma-box-group">
      <rect x="${oX + oW / 2 + 10}" y="${b7Y}" width="${oW / 2 - 10}" height="${oBox8H}" class="p-box"/>
      <text x="${oX + oW / 2 + 18}" y="${b7Y + 24}" class="p-title">Excluded (n = ${o.reports_excluded || 0})</text>
      ${oReasMarkup}
    </g>
    <path d="M ${oX + oW / 2 - 10} ${b7Y + 35} L ${oX + oW / 2 + 10} ${b7Y + 35}" class="p-arrow"/>
    <path d="M ${oX + (oW / 4)} ${b7Y + b7H} L ${oX + (oW / 4)} ${box9Y}" class="p-arrow"/>
    `;

    // Other Studies Included Box
    svg += `
    <g class="prisma-box-group">
      <rect x="${oX}" y="${box9Y}" width="${oW}" height="95" class="p-box"/>
      <text x="${oX + 14}" y="${box9Y + 22}" class="p-header">Studies included from other methods</text>
      <text x="${oX + 14}" y="${box9Y + 40}" class="p-num">(n = ${o.studies_included || 0})</text>
      <text x="${oX + 14}" y="${box9Y + 62}" class="p-header">Reports included from other methods</text>
      <text x="${oX + 14}" y="${box9Y + 80}" class="p-num">(n = ${o.reports_included || 0})</text>
    </g>
    `;

    // Total Combined Studies Included Box
    const totBoxY = box9Y + 120;
    const totBoxW = 440;
    const totBoxX = svgW / 2 - totBoxW / 2;

    svg += `
    <g class="prisma-box-group">
      <rect x="${totBoxX}" y="${totBoxY}" width="${totBoxW}" height="85" class="p-box" style="stroke-width:2px;stroke:#0f6b6b"/>
      <text x="${totBoxX + 16}" y="${totBoxY + 22}" class="p-header" style="fill:#0f6b6b">Total studies included in review</text>
      <text x="${totBoxX + 16}" y="${totBoxY + 38}" class="p-num">(n = ${s.total_studies_included})</text>
      <text x="${totBoxX + 16}" y="${totBoxY + 58}" class="p-header" style="fill:#0f6b6b">Total reports of included studies</text>
      <text x="${totBoxX + 16}" y="${totBoxY + 74}" class="p-num">(n = ${s.total_reports_included})</text>
    </g>
    <!-- Converging Arrows into Combined Box -->
    <path d="M ${col1MidX} ${box9Y + 95} L ${col1MidX} ${totBoxY + 40} L ${totBoxX} ${totBoxY + 40}" class="p-arrow"/>
    <path d="M ${oMidX} ${box9Y + 95} L ${oMidX} ${totBoxY + 40} L ${totBoxX + totBoxW} ${totBoxY + 40}" class="p-arrow"/>
    `;
  }

  // ─────────────────────────────────────────────────────────────
  // 4. FOOTNOTES & OFFICIAL PRISMA CITATION
  // ─────────────────────────────────────────────────────────────
  const footY = (tmpl === 'B' || tmpl === 'C' || tmpl === 'D') ? (box9Y + 215) : (box9Y + 115);
  svg += `
  <g class="p-footnotes">
    <text x="20" y="${footY}" class="p-footnote">*Consider, if feasible to do so, reporting the number of records identified from each database or register searched (rather than the total number across all databases/registers).</text>
    <text x="20" y="${footY + 15}" class="p-footnote">**If automation tools were used, indicate how many records were excluded by a human and how many by automation tools.</text>
    <text x="20" y="${footY + 30}" class="p-footnote">From: Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ 2021;372:n71. doi: 10.1136/bmj.n71</text>
    <text x="20" y="${footY + 44}" class="p-footnote">Generated via Sysrevai (Dr. Raouf Roshdy, AIMed Platform) · Publication-Grade Vector Architecture · http://www.prisma-statement.org/</text>
  </g>
</svg>
`;

  return svg.trim();
}

// ═══════════════════════════════════════════════════════════════
// EXPORT ENGINES: PNG (300 DPI), SVG & PDF
// ═══════════════════════════════════════════════════════════════
function downloadPrismaPNG(scale = 3) {
  const svgEl = document.getElementById('prisma-svg-canvas');
  if (!svgEl) {
    alert('PRISMA diagram canvas is not ready for export.');
    return;
  }

  // Clone SVG to isolate XML
  const svgClone = svgEl.cloneNode(true);
  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const svgData = new XMLSerializer().serializeToString(svgClone);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const URLObj = window.URL || window.webkitURL || window;
  const blobURL = URLObj.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = function() {
    const origW = svgEl.viewBox?.baseVal?.width || svgEl.clientWidth || 940;
    const origH = svgEl.viewBox?.baseVal?.height || svgEl.clientHeight || 1100;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(origW * scale);
    canvas.height = Math.round(origH * scale);
    const ctx = canvas.getContext('2d');

    // Fill crisp white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw scaled vector
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URLObj.revokeObjectURL(blobURL);

    // Generate PNG download
    const pngUrl = canvas.toDataURL('image/png');
    const safeTopic = sanitizeFileName(PRISMA_DIAGRAM_STATE.reviewTitle);
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = `PRISMA2020_Flow_Diagram_${safeTopic}_Template_${PRISMA_DIAGRAM_STATE.template}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  img.onerror = function() {
    alert('Failed to render PNG image from SVG. You can download the vector SVG directly.');
    URLObj.revokeObjectURL(blobURL);
  };

  img.src = blobURL;
}

function downloadPrismaSVG() {
  const svgEl = document.getElementById('prisma-svg-canvas');
  if (!svgEl) return;

  const svgClone = svgEl.cloneNode(true);
  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const rawXml = new XMLSerializer().serializeToString(svgClone);
  const completeSvg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${rawXml}`;

  const blob = new Blob([completeSvg], { type: 'image/svg+xml;charset=utf-8' });
  const safeTopic = sanitizeFileName(PRISMA_DIAGRAM_STATE.reviewTitle);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `PRISMA2020_Flow_Diagram_${safeTopic}_Template_${PRISMA_DIAGRAM_STATE.template}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function copyPrismaSVGToClipboard() {
  const svgEl = document.getElementById('prisma-svg-canvas');
  if (!svgEl) return;

  const svgClone = svgEl.cloneNode(true);
  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const rawXml = new XMLSerializer().serializeToString(svgClone);
  const completeSvg = `<?xml version="1.0" encoding="UTF-8"?>\n${rawXml}`;

  navigator.clipboard.writeText(completeSvg).then(() => {
    alert('✔ PRISMA 2020 Flow Diagram SVG copied to clipboard!');
  }).catch(() => {
    alert('Clipboard copy denied. Please use the Download SVG button.');
  });
}

function downloadPrismaPDF() {
  const svgEl = document.getElementById('prisma-svg-canvas');
  if (!svgEl || !window.jspdf) return;

  const { jsPDF } = window.jspdf;
  const isLandscape = PRISMA_DIAGRAM_STATE.orientation === 'landscape' || PRISMA_DIAGRAM_STATE.template === 'B' || PRISMA_DIAGRAM_STATE.template === 'D';
  const doc = new jsPDF({
    unit: 'pt',
    format: 'letter',
    orientation: isLandscape ? 'landscape' : 'portrait'
  });

  const svgClone = svgEl.cloneNode(true);
  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const svgData = new XMLSerializer().serializeToString(svgClone);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const blobURL = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = function() {
    const scale = 2.5;
    const origW = svgEl.viewBox?.baseVal?.width || 940;
    const origH = svgEl.viewBox?.baseVal?.height || 1100;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(origW * scale);
    canvas.height = Math.round(origH * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(blobURL);

    const imgData = canvas.toDataURL('image/png');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 28;

    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2;
    const imgRatio = origW / origH;
    const pageRatio = availW / availH;

    let finalW, finalH;
    if (imgRatio > pageRatio) {
      finalW = availW;
      finalH = availW / imgRatio;
    } else {
      finalH = availH;
      finalW = availH * imgRatio;
    }

    const posX = margin + (availW - finalW) / 2;
    const posY = margin + (availH - finalH) / 2;

    doc.addImage(imgData, 'PNG', posX, posY, finalW, finalH, undefined, 'FAST');
    const safeTopic = sanitizeFileName(PRISMA_DIAGRAM_STATE.reviewTitle);
    doc.save(`PRISMA2020_Flow_Diagram_${safeTopic}.pdf`);
  };
  img.src = blobURL;
}

// ═══════════════════════════════════════════════════════════════
// MODAL UI CONTROLLER & INTERACTIVE EDITING
// ═══════════════════════════════════════════════════════════════
function openPrismaDiagramEditor() {
  syncPrismaStateFromWorkflow(false);
  const modal = document.getElementById('prisma-editor-modal');
  if (modal) {
    modal.classList.remove('hidden');
    refreshPrismaEditor();
    fitPrismaDiagramToScreen();
  }
}

function closePrismaDiagramEditor() {
  const modal = document.getElementById('prisma-editor-modal');
  if (modal) modal.classList.add('hidden');
  
  // Also update Step 4 tab if active
  if (typeof renderStep4Prisma === 'function') {
    renderStep4Prisma();
  }
}

function setPrismaTemplate(t) {
  PRISMA_DIAGRAM_STATE.template = t;
  PRISMA_DIAGRAM_STATE.isModifiedFromWorkflow = true;
  refreshPrismaEditor();
}

function setPrismaOrientation(o) {
  PRISMA_DIAGRAM_STATE.orientation = o;
  refreshPrismaEditor();
}

function zoomPrismaDiagram(delta) {
  if (delta === 0) {
    PRISMA_DIAGRAM_STATE.zoomLevel = 1.0;
  } else {
    PRISMA_DIAGRAM_STATE.zoomLevel = Math.max(0.3, Math.min(2.5, PRISMA_DIAGRAM_STATE.zoomLevel + delta));
  }
  applyPrismaZoom();
}

function fitPrismaDiagramToScreen() {
  const viewport = document.getElementById('prisma-canvas-viewport');
  const svg = document.getElementById('prisma-svg-canvas');
  if (!viewport || !svg) return;

  const viewW = viewport.clientWidth - 40;
  const viewH = viewport.clientHeight - 40;
  const svgW = svg.viewBox?.baseVal?.width || 940;
  const svgH = svg.viewBox?.baseVal?.height || 1100;

  const ratioW = viewW / svgW;
  const ratioH = viewH / svgH;
  const fitRatio = Math.max(0.4, Math.min(1.2, Math.min(ratioW, ratioH)));

  PRISMA_DIAGRAM_STATE.zoomLevel = fitRatio;
  applyPrismaZoom();
}

function applyPrismaZoom() {
  const wrapper = document.getElementById('prisma-svg-canvas-wrapper');
  const zoomLabel = document.getElementById('prisma-zoom-label');
  if (wrapper) {
    wrapper.style.transform = `scale(${PRISMA_DIAGRAM_STATE.zoomLevel})`;
    wrapper.style.transformOrigin = 'top center';
  }
  if (zoomLabel) {
    zoomLabel.textContent = `${Math.round(PRISMA_DIAGRAM_STATE.zoomLevel * 100)}%`;
  }
}

function updatePrismaCountField(key, val) {
  PRISMA_DIAGRAM_STATE[key] = Math.max(0, parseInt(val, 10) || 0);
  PRISMA_DIAGRAM_STATE.isModifiedFromWorkflow = true;
  refreshPrismaEditor(false); // Update without resetting cursor in inputs
}

function updatePrismaTextField(key, val) {
  PRISMA_DIAGRAM_STATE[key] = val;
  PRISMA_DIAGRAM_STATE.isModifiedFromWorkflow = true;
  refreshPrismaEditor(false);
}

function updatePrismaOtherSourceField(key, val) {
  if (!PRISMA_DIAGRAM_STATE.other_sources) PRISMA_DIAGRAM_STATE.other_sources = {};
  PRISMA_DIAGRAM_STATE.other_sources[key] = Math.max(0, parseInt(val, 10) || 0);
  PRISMA_DIAGRAM_STATE.isModifiedFromWorkflow = true;
  refreshPrismaEditor(false);
}

function updatePrismaPrevField(key, val) {
  if (!PRISMA_DIAGRAM_STATE.previous_studies) PRISMA_DIAGRAM_STATE.previous_studies = {};
  PRISMA_DIAGRAM_STATE.previous_studies[key] = Math.max(0, parseInt(val, 10) || 0);
  PRISMA_DIAGRAM_STATE.isModifiedFromWorkflow = true;
  refreshPrismaEditor(false);
}

function addPrismaExclusionReason(presetText = '', count = 0) {
  const textInput = document.getElementById('new-prisma-reason-text');
  const countInput = document.getElementById('new-prisma-reason-count');
  const text = presetText || textInput?.value?.trim() || 'Ineligible clinical criteria';
  const cnt = count || parseInt(countInput?.value, 10) || 1;

  PRISMA_DIAGRAM_STATE.exclusion_reasons.push({ reason: text, count: cnt });
  PRISMA_DIAGRAM_STATE.isModifiedFromWorkflow = true;

  if (textInput) textInput.value = '';
  if (countInput) countInput.value = '1';

  refreshPrismaEditor();
}

function removePrismaExclusionReason(index) {
  PRISMA_DIAGRAM_STATE.exclusion_reasons.splice(index, 1);
  PRISMA_DIAGRAM_STATE.isModifiedFromWorkflow = true;
  refreshPrismaEditor();
}

function updatePrismaExclusionReasonText(index, val) {
  if (PRISMA_DIAGRAM_STATE.exclusion_reasons[index]) {
    PRISMA_DIAGRAM_STATE.exclusion_reasons[index].reason = val;
    PRISMA_DIAGRAM_STATE.isModifiedFromWorkflow = true;
    renderPrismaPreviewCanvas();
  }
}

function updatePrismaExclusionReasonCount(index, val) {
  if (PRISMA_DIAGRAM_STATE.exclusion_reasons[index]) {
    PRISMA_DIAGRAM_STATE.exclusion_reasons[index].count = Math.max(0, parseInt(val, 10) || 0);
    PRISMA_DIAGRAM_STATE.isModifiedFromWorkflow = true;
    renderPrismaPreviewCanvas();
    renderPrismaValidationPanel();
  }
}

function resetPrismaDiagramToWorkflow() {
  if (confirm('Reset PRISMA diagram to the actual current review workflow counts? Any manual custom numbers will be overwritten with live search data.')) {
    syncPrismaStateFromWorkflow(true);
    refreshPrismaEditor();
  }
}

// ═══════════════════════════════════════════════════════════════
// EDITOR REFRESH & DOM UPDATES
// ═══════════════════════════════════════════════════════════════
function refreshPrismaEditor(repopulateInputs = true) {
  const s = PRISMA_DIAGRAM_STATE;

  // 1. Template Buttons
  ['A', 'B', 'C', 'D'].forEach(t => {
    const btn = document.getElementById(`btn-prisma-tmpl-${t}`);
    if (btn) {
      if (s.template === t) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  // 2. Orientation Buttons
  const btnPort = document.getElementById('btn-prisma-orient-portrait');
  const btnLand = document.getElementById('btn-prisma-orient-landscape');
  if (btnPort && btnLand) {
    if (s.orientation === 'landscape') {
      btnLand.classList.add('active');
      btnPort.classList.remove('active');
    } else {
      btnPort.classList.add('active');
      btnLand.classList.remove('active');
    }
  }

  // 3. Sync Status Badge
  const badge = document.getElementById('prisma-sync-status-badge');
  if (badge) {
    if (s.isModifiedFromWorkflow) {
      badge.className = 'pill pill-warn';
      badge.innerHTML = '✏️ Manual Edits Present (Customized)';
    } else {
      badge.className = 'pill pill-good';
      badge.innerHTML = '🔗 Synced with Active Review Workflow';
    }
  }

  // 4. Repopulate Form Inputs if requested
  if (repopulateInputs) {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && document.activeElement !== el) el.value = val;
    };

    setVal('prisma-input-title', s.reviewTitle);
    setVal('prisma-input-epmc', s.db_epmc);
    setVal('prisma-input-s2', s.db_s2);
    setVal('prisma-input-other-name', s.db_other_name);
    setVal('prisma-input-other-count', s.db_other_count);
    setVal('prisma-input-registers', s.registers_count);
    setVal('prisma-input-duplicates', s.duplicates_removed);
    setVal('prisma-input-auto-ineligible', s.automation_ineligible);
    setVal('prisma-input-other-removed', s.other_removed_before_screening);
    setVal('prisma-input-screened', s.records_screened);
    setVal('prisma-input-excluded-screening', s.records_excluded_screening);
    setVal('prisma-input-excluded-human', s.records_excluded_human);
    setVal('prisma-input-excluded-auto', s.records_excluded_automation);
    setVal('prisma-input-sought', s.reports_sought);
    setVal('prisma-input-not-retrieved', s.reports_not_retrieved);
    setVal('prisma-input-assessed', s.reports_assessed);
    setVal('prisma-input-excluded-fulltext', s.reports_excluded);
    setVal('prisma-input-studies-included', s.new_studies_included);
    setVal('prisma-input-reports-included', s.new_reports_included);

    // Other sources inputs
    const o = s.other_sources || {};
    setVal('prisma-input-other-websites', o.websites || 0);
    setVal('prisma-input-other-orgs', o.organisations || 0);
    setVal('prisma-input-other-citations', o.citation_searching || 0);
    setVal('prisma-input-other-misc', o.other || 0);
    setVal('prisma-input-other-sought', o.reports_sought || 0);
    setVal('prisma-input-other-not-retrieved', o.reports_not_retrieved || 0);
    setVal('prisma-input-other-assessed', o.reports_assessed || 0);
    setVal('prisma-input-other-excluded', o.reports_excluded || 0);
    setVal('prisma-input-other-studies', o.studies_included || 0);
    setVal('prisma-input-other-reports', o.reports_included || 0);

    // Previous studies inputs
    const p = s.previous_studies || {};
    setVal('prisma-input-prev-studies', p.studies_included || 0);
    setVal('prisma-input-prev-reports', p.reports_included || 0);

    // Totals
    setVal('prisma-input-tot-studies', s.total_studies_included || 0);
    setVal('prisma-input-tot-reports', s.total_reports_included || 0);
  }

  // 5. Render Exclusion Reasons Cards
  renderExclusionReasonsList();

  // 6. Template specific panels display
  const panelOther = document.getElementById('prisma-panel-other-methods');
  const panelPrev = document.getElementById('prisma-panel-previous-studies');
  const panelTotals = document.getElementById('prisma-panel-totals');

  if (panelOther) {
    if (s.template === 'B' || s.template === 'D') panelOther.classList.remove('hidden');
    else panelOther.classList.add('hidden');
  }
  if (panelPrev) {
    if (s.template === 'C' || s.template === 'D') panelPrev.classList.remove('hidden');
    else panelPrev.classList.add('hidden');
  }
  if (panelTotals) {
    if (s.template === 'B' || s.template === 'C' || s.template === 'D') panelTotals.classList.remove('hidden');
    else panelTotals.classList.add('hidden');
  }

  // 7. Validation Panel
  renderPrismaValidationPanel();

  // 8. Render Preview SVG
  renderPrismaPreviewCanvas();
}

function renderExclusionReasonsList() {
  const container = document.getElementById('prisma-reasons-list-container');
  if (!container) return;

  const reasons = PRISMA_DIAGRAM_STATE.exclusion_reasons || [];
  if (reasons.length === 0) {
    container.innerHTML = '<div style="font-size:.80rem;color:var(--muted);padding:8px 0">No full-text exclusion categories defined yet.</div>';
    return;
  }

  let html = '';
  reasons.forEach((r, idx) => {
    html += `
      <div class="prisma-reason-row" style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <input type="text" class="prisma-edit-input" value="${escapeXml(r.reason)}" style="flex:1;font-size:.80rem;padding:4px 8px" oninput="updatePrismaExclusionReasonText(${idx}, this.value)"/>
        <input type="number" class="prisma-edit-input" value="${r.count}" style="width:65px;font-size:.80rem;padding:4px 6px" min="0" oninput="updatePrismaExclusionReasonCount(${idx}, this.value)"/>
        <button type="button" class="mini-btn mini-btn-danger" onclick="removePrismaExclusionReason(${idx})" style="padding:4px 8px" title="Remove category">&times;</button>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderPrismaValidationPanel() {
  const panel = document.getElementById('prisma-validation-box');
  if (!panel) return;

  const val = validatePrismaDiagramCounts(PRISMA_DIAGRAM_STATE);

  if (val.isValid && !val.hasWarnings) {
    panel.className = 'alert-box alert-good';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:1.2rem">✔</span>
        <div>
          <strong>PRISMA 2020 Flow Accounting Reconciled</strong>
          <div style="font-size:.80rem">All identification, screening, retrieval, and inclusion numbers balance mathematically across branches.</div>
        </div>
      </div>
    `;
  } else {
    panel.className = 'alert-box alert-warn';
    let issuesHtml = '';
    val.issues.forEach(i => {
      issuesHtml += `<li style="margin-bottom:4px"><strong>[${escapeXml(i.phase)}] ${escapeXml(i.title)}:</strong> ${escapeXml(i.equation)}. <em>${escapeXml(i.hint)}</em></li>`;
    });
    val.warnings.forEach(w => {
      issuesHtml += `<li style="margin-bottom:4px"><strong>[Notice] ${escapeXml(w.title)}:</strong> ${escapeXml(w.equation)}. <em>${escapeXml(w.hint)}</em></li>`;
    });

    panel.innerHTML = `
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:8px">
          <div style="font-weight:700;color:var(--warn);display:flex;align-items:center;gap:6px">
            <span>⚠️</span> PRISMA Accounting Inconsistencies Detected (${val.issues.length} discrepancies):
          </div>
          <button type="button" class="mini-btn mini-btn-good" onclick="autoReconcilePrismaCounts()" style="font-weight:700">
            ⚡ Reconcile Arithmetic Automatically
          </button>
        </div>
        <ul style="margin:0;padding-left:18px;font-size:.80rem;line-height:1.45;color:var(--ink)">
          ${issuesHtml}
        </ul>
      </div>
    `;
  }
}

function renderPrismaPreviewCanvas() {
  const wrapper = document.getElementById('prisma-svg-canvas-wrapper');
  if (!wrapper) return;
  const svgXml = renderPrismaSVG(PRISMA_DIAGRAM_STATE);
  wrapper.innerHTML = svgXml;
}

// ═══════════════════════════════════════════════════════════════
// UPGRADE STEP 4 PRISMA TAB WITH PUBLICATION-GRADE EMBED
// ═══════════════════════════════════════════════════════════════
function renderStep4Prisma() {
  const container = document.getElementById('step4-prisma-view');
  if (!container) return;

  syncPrismaStateFromWorkflow(false);
  const svgMarkup = renderPrismaSVG(PRISMA_DIAGRAM_STATE);
  const val = validatePrismaDiagramCounts(PRISMA_DIAGRAM_STATE);

  let valBadge = '';
  if (val.isValid) {
    valBadge = '<span class="pill pill-good" style="margin:0">✔ PRISMA 2020 Validated</span>';
  } else {
    valBadge = `<span class="pill pill-warn" style="margin:0">⚠️ ${val.issues.length} Accounting Discrepancies</span>`;
  }

  container.innerHTML = `
    <div class="card" style="margin-bottom:20px;background:#ffffff">
      <!-- Toolbar -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <h3 class="sec-h" style="margin:0">📊 PRISMA 2020 Flow Diagram (Publication-Grade Vector)</h3>
            ${valBadge}
          </div>
          <p class="hint" style="margin:4px 0 0">Official PRISMA 2020 Layout (Page et al., BMJ 2021) · Complete Record &amp; Report Transparency</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="primary" onclick="openPrismaDiagramEditor()" style="font-weight:700">
            🎛️ Open PRISMA 2020 Diagram Editor
          </button>
          <button type="button" class="secondary" onclick="downloadPrismaPNG(3)">
            📥 Download PRISMA Diagram — PNG
          </button>
          <button type="button" class="secondary" onclick="downloadPrismaSVG()">
            📐 Download PRISMA Diagram — SVG
          </button>
          <button type="button" class="secondary" onclick="downloadPrismaPDF()">
            📄 Download PRISMA Diagram — PDF
          </button>
        </div>
      </div>

      <!-- Embedded Vector Preview Container -->
      <div style="overflow-x:auto;padding:16px 8px;display:flex;justify-content:center;background:#f8fafc;border-radius:8px;border:1px solid var(--border)">
        <div style="background:#ffffff;padding:12px;box-shadow:0 4px 15px rgba(0,0,0,.06);border-radius:4px;border:1px solid #cbd5e1;max-width:100%">
          ${svgMarkup}
        </div>
      </div>
    </div>
  `;
}

if (typeof window !== 'undefined') {
  window.PRISMA_DIAGRAM_STATE = PRISMA_DIAGRAM_STATE;
  window.syncPrismaStateFromWorkflow = syncPrismaStateFromWorkflow;
  window.validatePrismaDiagramCounts = validatePrismaDiagramCounts;
  window.renderPrismaSVG = renderPrismaSVG;
  window.openPrismaDiagramEditor = openPrismaDiagramEditor;
  window.closePrismaDiagramEditor = closePrismaDiagramEditor;
  window.setPrismaTemplate = setPrismaTemplate;
  window.setPrismaOrientation = setPrismaOrientation;
  window.renderStep4Prisma = renderStep4Prisma;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PRISMA_DIAGRAM_STATE,
    syncPrismaStateFromWorkflow,
    validatePrismaDiagramCounts,
    renderPrismaSVG,
    setPrismaTemplate,
    setPrismaOrientation
  };
}
