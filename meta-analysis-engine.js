/**
 * SysRevAI — Automated Meta-Analysis Engine & Scientific Graphics Suite
 * ====================================================================
 * Implements rigorous statistical pooling for binary (RR, OR, RD) and
 * continuous (MD, SMD Hedges' g) outcomes with Fixed-Effect (Inverse Variance)
 * and Random-Effects (DerSimonian-Laird) models.
 *
 * Includes publication-quality scientific graphics:
 * 1. Forest Plot (Mandatory) — Cochrane / BMJ standard vector diagram
 * 2. Funnel Plot (Conditional) — Inverted pseudo 95% CI funnel for small-study effects
 * 3. Sensitivity Analysis Plot (Leave-One-Out) — Influence diagnostic
 *
 * Direct Exports: 300 DPI high-resolution PNG, pure vector SVG, copy SVG to clipboard,
 * CSV data export, and standalone PDF reports with meaningful filenames.
 *
 * Adheres to PRISMA 2020 guidelines and Cochrane Handbook for Systematic Reviews.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// GLOBAL META-ANALYSIS STATE
// ═══════════════════════════════════════════════════════════════
const META_ANALYSIS_STATE = {
  initiated: false,
  reviewTopic: '',
  outcomeName: 'Primary Clinical Efficacy / Major Events',
  outcomeType: 'binary',     // 'binary' | 'continuous'
  effectMeasure: 'RR',       // 'RR' | 'OR' | 'RD' for binary; 'MD' | 'SMD' for continuous
  model: 'random',           // 'random' (DerSimonian-Laird) | 'fixed' (Inverse Variance)
  confLevel: 0.95,
  interventionLabel: 'Intervention',
  controlLabel: 'Control',
  activeGraphic: 'forest',   // 'forest' | 'funnel' | 'sensitivity'
  studies: [],               // Array of study rows for pooling
  results: null,             // Calculated statistical output
  sensitivityRuns: null      // Leave-one-out sensitivity analysis output
};

// ═══════════════════════════════════════════════════════════════
// MATHEMATICAL & STATISTICAL DISTRIBUTION HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Standard error function approximation (Abramowitz & Stegun formula 7.1.26)
 */
function metaErf(x) {
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/**
 * Standard Normal Cumulative Distribution Function Φ(x)
 */
function metaNormalCdf(x) {
  return 0.5 * (1 + metaErf(x / Math.SQRT2));
}

/**
 * Logarithm of the Gamma function via Lanczos approximation
 */
function metaLogGamma(x) {
  const coef = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953
  ];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j <= 5; j++) ser += coef[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/**
 * Incomplete Gamma function P(a, x) using series and continued fraction
 */
function metaGammp(a, x) {
  if (x <= 0.0 || a <= 0.0) return 0.0;
  if (x < a + 1.0) {
    let ap = a, sum = 1.0 / a, del = sum;
    for (let n = 1; n <= 100; n++) {
      ap += 1.0;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 3.0e-7) {
        return sum * Math.exp(-x + a * Math.log(x) - metaLogGamma(a));
      }
    }
    return sum * Math.exp(-x + a * Math.log(x) - metaLogGamma(a));
  } else {
    let b = x + 1.0 - a, c = 1.0 / 1.0e-30, d = 1.0 / b, h = d;
    for (let i = 1; i <= 100; i++) {
      const an = -i * (i - a);
      b += 2.0;
      d = an * d + b;
      if (Math.abs(d) < 1.0e-30) d = 1.0e-30;
      c = b + an / c;
      if (Math.abs(c) < 1.0e-30) c = 1.0e-30;
      d = 1.0 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1.0) < 3.0e-7) break;
    }
    return 1.0 - h * Math.exp(-x + a * Math.log(x) - metaLogGamma(a));
  }
}

/**
 * Chi-Square P-value from test statistic Q and degrees of freedom df
 */
function metaChiSquarePValue(q, df) {
  if (df <= 0 || q <= 0) return 1.0;
  const p = 1.0 - metaGammp(df / 2.0, q / 2.0);
  return Math.max(0, Math.min(1.0, p));
}

// ═══════════════════════════════════════════════════════════════
// INDIVIDUAL STUDY EFFECT SIZE CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Computes individual study effect size, variance, SE, and 95% CI for binary data.
 */
function calculateBinaryStudyEffect(s, measure, zCrit) {
  let e1 = Number(s.e1) || 0;
  let n1 = Number(s.n1) || 0;
  let e2 = Number(s.e2) || 0;
  let n2 = Number(s.n2) || 0;

  if (n1 <= 0 || n2 <= 0) {
    return { valid: false, error: 'Total sample size must be > 0' };
  }
  if (e1 < 0 || e2 < 0 || e1 > n1 || e2 > n2) {
    return { valid: false, error: 'Event counts must be between 0 and total N' };
  }

  // Continuity correction (0.5) if any zero cells occur
  const hasZero = (e1 === 0 || e2 === 0 || e1 === n1 || e2 === n2);
  const isDoubleZero = (e1 === 0 && e2 === 0);
  let adjE1 = e1, adjN1 = n1, adjE2 = e2, adjN2 = n2;
  if (hasZero && (measure === 'RR' || measure === 'OR')) {
    adjE1 += 0.5; adjN1 += 1.0;
    adjE2 += 0.5; adjN2 += 1.0;
  }

  let effect = 0, logEffect = 0, v = 0, se = 0;
  let ciLow = 0, ciHigh = 0;

  if (measure === 'RR') {
    const p1 = adjE1 / adjN1;
    const p2 = adjE2 / adjN2;
    if (p1 <= 0 || p2 <= 0) return { valid: false, error: 'Zero risk rate' };
    effect = p1 / p2;
    logEffect = Math.log(effect);
    v = (1 / adjE1) - (1 / adjN1) + (1 / adjE2) - (1 / adjN2);
    if (v <= 0 || isNaN(v)) return { valid: false, error: 'Invalid variance' };
    se = Math.sqrt(v);
    ciLow = Math.exp(logEffect - zCrit * se);
    ciHigh = Math.exp(logEffect + zCrit * se);
  } else if (measure === 'OR') {
    const o1 = adjE1 / (adjN1 - adjE1);
    const o2 = adjE2 / (adjN2 - adjE2);
    if (o1 <= 0 || o2 <= 0) return { valid: false, error: 'Zero odds' };
    effect = o1 / o2;
    logEffect = Math.log(effect);
    v = (1 / adjE1) + (1 / (adjN1 - adjE1)) + (1 / adjE2) + (1 / (adjN2 - adjE2));
    if (v <= 0 || isNaN(v)) return { valid: false, error: 'Invalid variance' };
    se = Math.sqrt(v);
    ciLow = Math.exp(logEffect - zCrit * se);
    ciHigh = Math.exp(logEffect + zCrit * se);
  } else if (measure === 'RD') {
    const p1 = e1 / n1;
    const p2 = e2 / n2;
    effect = p1 - p2;
    logEffect = effect; // RD is on the linear scale
    v = (p1 * (1 - p1) / n1) + (p2 * (1 - p2) / n2);
    if (v <= 0) v = 1 / (n1 + n2);
    se = Math.sqrt(v);
    ciLow = effect - zCrit * se;
    ciHigh = effect + zCrit * se;
  }

  return {
    valid: true,
    hasZero,
    isDoubleZero,
    effect,
    logEffect,
    variance: v,
    se,
    ciLow,
    ciHigh
  };
}

/**
 * Computes individual study effect size, variance, SE, and 95% CI for continuous data.
 */
function calculateContinuousStudyEffect(s, measure, zCrit) {
  let m1 = Number(s.m1);
  let s1 = Number(s.s1);
  let n1 = Number(s.n1);
  let m2 = Number(s.m2);
  let s2 = Number(s.s2);
  let n2 = Number(s.n2);

  if (isNaN(m1) || isNaN(m2)) return { valid: false, error: 'Means must be numeric' };
  if (n1 <= 1 || n2 <= 1) return { valid: false, error: 'Sample size must be > 1 per arm' };
  if (s1 <= 0 || s2 <= 0) return { valid: false, error: 'Standard deviations must be > 0' };

  let effect = 0, logEffect = 0, v = 0, se = 0;
  let ciLow = 0, ciHigh = 0;

  if (measure === 'MD') {
    effect = m1 - m2;
    logEffect = effect; // linear scale
    v = (s1 * s1 / n1) + (s2 * s2 / n2);
    se = Math.sqrt(v);
    ciLow = effect - zCrit * se;
    ciHigh = effect + zCrit * se;
  } else if (measure === 'SMD') {
    const df = n1 + n2 - 2;
    const pooledSd = Math.sqrt(((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / df);
    if (pooledSd <= 0) return { valid: false, error: 'Pooled SD is non-positive' };
    const cohenD = (m1 - m2) / pooledSd;
    const J = 1 - (3 / (4 * df - 1));
    const hedgesG = cohenD * J;
    effect = hedgesG;
    logEffect = effect;
    v = ((n1 + n2) / (n1 * n2)) + ((hedgesG * hedgesG) / (2 * (n1 + n2)));
    se = Math.sqrt(v);
    ciLow = effect - zCrit * se;
    ciHigh = effect + zCrit * se;
  }

  return {
    valid: true,
    effect,
    logEffect,
    variance: v,
    se,
    ciLow,
    ciHigh
  };
}

// ═══════════════════════════════════════════════════════════════
// RIGOROUS STATISTICAL POOLING ENGINE (Fixed & Random Effects)
// ═══════════════════════════════════════════════════════════════

/**
 * Executes statistical pooling across all eligible studies.
 */
function executeMetaAnalysis(state) {
  const zCrit = state.confLevel === 0.99 ? 2.576 : 1.96;
  const isRatio = (state.outcomeType === 'binary' && (state.effectMeasure === 'RR' || state.effectMeasure === 'OR'));

  const evaluated = [];
  const errors = [];
  const warnings = [];

  const eligibleStudies = state.studies.filter(s => s.includedInPool !== false);

  if (eligibleStudies.length < 2) {
    errors.push(`At least 2 studies are required for quantitative meta-analysis (current eligible studies: ${eligibleStudies.length}).`);
    return {
      isValid: false,
      errors,
      warnings,
      studiesEvaluated: [],
      pooled: null
    };
  }

  let totalN1 = 0, totalN2 = 0, totalE1 = 0, totalE2 = 0;

  for (let i = 0; i < eligibleStudies.length; i++) {
    const s = eligibleStudies[i];
    let calc = null;
    if (state.outcomeType === 'binary') {
      calc = calculateBinaryStudyEffect(s, state.effectMeasure, zCrit);
      if (calc.valid) {
        totalN1 += Number(s.n1) || 0;
        totalN2 += Number(s.n2) || 0;
        totalE1 += Number(s.e1) || 0;
        totalE2 += Number(s.e2) || 0;
        if (calc.isDoubleZero) {
          warnings.push(`Study "${s.studyId}" had 0 events in both treatment and control arms; 0.5 continuity correction applied per protocol.`);
        } else if (calc.hasZero) {
          warnings.push(`Study "${s.studyId}" had zero events in at least one arm; continuity correction (0.5) applied.`);
        }
      }
    } else {
      calc = calculateContinuousStudyEffect(s, state.effectMeasure, zCrit);
      if (calc.valid) {
        totalN1 += Number(s.n1) || 0;
        totalN2 += Number(s.n2) || 0;
      }
    }

    if (!calc || !calc.valid) {
      errors.push(`Study "${s.studyId}": ${calc ? calc.error : 'Invalid data inputs'}`);
      continue;
    }

    evaluated.push({
      ...s,
      calc,
      wFE: 1.0 / calc.variance
    });
  }

  if (evaluated.length < 2) {
    errors.push(`Fewer than 2 studies have valid numerical data for ${state.effectMeasure} pooling.`);
    return {
      isValid: false,
      errors,
      warnings,
      studiesEvaluated: evaluated,
      pooled: null
    };
  }

  // 1. Fixed-Effect Inverse-Variance Pooling
  const sumW_FE = evaluated.reduce((acc, s) => acc + s.wFE, 0);
  const pooledTheta_FE = evaluated.reduce((acc, s) => acc + s.wFE * s.calc.logEffect, 0) / sumW_FE;
  const se_FE = 1.0 / Math.sqrt(sumW_FE);

  // 2. Heterogeneity Statistics (Cochran's Q, df, I², DerSimonian-Laird tau²)
  const Q = evaluated.reduce((acc, s) => acc + s.wFE * Math.pow(s.calc.logEffect - pooledTheta_FE, 2), 0);
  const df = evaluated.length - 1;
  const pChi2 = metaChiSquarePValue(Q, df);
  const I2 = Math.max(0, (Q - df) / (Q > 0 ? Q : 1)) * 100;

  const sumW_FE_sq = evaluated.reduce((acc, s) => acc + s.wFE * s.wFE, 0);
  const C = sumW_FE - (sumW_FE_sq / sumW_FE);
  const tau2 = C > 0 ? Math.max(0, (Q - df) / C) : 0;
  const tau = Math.sqrt(tau2);

  let heterogeneitySeverity = 'Low';
  if (I2 >= 75) {
    heterogeneitySeverity = 'High';
    warnings.push(`Substantial statistical heterogeneity detected (I² = ${I2.toFixed(1)}%). Random-effects modeling strongly advised.`);
  } else if (I2 >= 50) {
    heterogeneitySeverity = 'Moderate';
  }

  // 3. Random-Effects Pooling (DerSimonian-Laird)
  let pooledTheta = pooledTheta_FE;
  let pooledSe = se_FE;

  if (state.model === 'random') {
    evaluated.forEach(s => {
      s.wRE = 1.0 / (s.calc.variance + tau2);
    });
    const sumW_RE = evaluated.reduce((acc, s) => acc + s.wRE, 0);
    pooledTheta = evaluated.reduce((acc, s) => acc + s.wRE * s.calc.logEffect, 0) / sumW_RE;
    pooledSe = 1.0 / Math.sqrt(sumW_RE);

    evaluated.forEach(s => {
      s.weightPct = (s.wRE / sumW_RE) * 100;
    });
  } else {
    evaluated.forEach(s => {
      s.weightPct = (s.wFE / sumW_FE) * 100;
    });
  }

  // 4. Test of Overall Effect (Z and P-value)
  const zScore = Math.abs(pooledTheta) / pooledSe;
  const pValue = 2.0 * (1.0 - metaNormalCdf(zScore));

  // 5. Bounds on Natural vs Log scale
  let pointEstimate = pooledTheta;
  let ciLow = pooledTheta - zCrit * pooledSe;
  let ciHigh = pooledTheta + zCrit * pooledSe;

  if (isRatio) {
    pointEstimate = Math.exp(pooledTheta);
    ciLow = Math.exp(pooledTheta - zCrit * pooledSe);
    ciHigh = Math.exp(pooledTheta + zCrit * pooledSe);
  }

  return {
    isValid: true,
    errors,
    warnings,
    studiesEvaluated: evaluated,
    pooled: {
      model: state.model,
      measure: state.effectMeasure,
      isRatio,
      pointEstimate,
      ciLow,
      ciHigh,
      logEstimate: pooledTheta,
      se: pooledSe,
      zScore,
      pValue,
      Q,
      df,
      pChi2,
      I2,
      tau2,
      tau,
      heterogeneitySeverity,
      totalN1,
      totalN2,
      totalE1,
      totalE2
    }
  };
}

/**
 * Executes Leave-One-Out Sensitivity Analysis: calculates pooled results omitting each study in turn.
 */
function executeLeaveOneOutAnalysis(state) {
  const eligibleStudies = state.studies.filter(s => s.includedInPool !== false);
  if (eligibleStudies.length < 3) return null;

  const runs = [];
  for (let i = 0; i < eligibleStudies.length; i++) {
    const omitted = eligibleStudies[i];
    const subset = eligibleStudies.filter((_, idx) => idx !== i);
    const subState = {
      ...state,
      studies: subset
    };
    const res = executeMetaAnalysis(subState);
    if (res.isValid && res.pooled) {
      runs.push({
        omittedStudyId: omitted.studyId,
        design: omitted.design,
        pooled: res.pooled
      });
    }
  }
  return runs;
}

// ═══════════════════════════════════════════════════════════════
// 1. FOREST PLOT GENERATOR (Mandatory Cochrane/BMJ Vector Plot)
// ═══════════════════════════════════════════════════════════════

/**
 * Renders a publication-grade SVG forest plot with clear directional indicators,
 * weight-proportional marker boxes, summary diamond, and footnotes.
 */
function renderForestPlotSVG(state, results) {
  if (!results || !results.isValid || !results.pooled) {
    return `<div style="padding:48px 24px;text-align:center;color:#64748b;font-size:0.95rem;background:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1">
      📊 <strong>No Forest Plot available.</strong> At least 2 eligible studies with complete numerical counts are required for statistical pooling.
    </div>`;
  }

  const { studiesEvaluated, pooled } = results;
  const isRatio = pooled.isRatio;

  const rowHeight = 36;
  const headerHeight = 72;
  const footerHeight = 114;
  const numStudies = studiesEvaluated.length;
  const totalHeight = headerHeight + (numStudies * rowHeight) + footerHeight;
  const totalWidth = 980;

  const colX = {
    study: 24,
    exp: 260,
    ctrl: 370,
    weight: 480,
    plotStart: 550,
    plotEnd: 820,
    effect: 840
  };

  const plotWidth = colX.plotEnd - colX.plotStart;

  let minVal = pooled.ciLow;
  let maxVal = pooled.ciHigh;

  studiesEvaluated.forEach(s => {
    if (s.calc.ciLow < minVal) minVal = s.calc.ciLow;
    if (s.calc.ciHigh > maxVal) maxVal = s.calc.ciHigh;
  });

  let scaleMin, scaleMax, noEffectVal;
  if (isRatio) {
    noEffectVal = 1.0;
    scaleMin = Math.max(0.05, Math.min(0.2, minVal * 0.8));
    scaleMax = Math.min(20.0, Math.max(5.0, maxVal * 1.25));
  } else {
    noEffectVal = 0.0;
    const span = Math.max(Math.abs(minVal), Math.abs(maxVal), 1.0) * 1.35;
    scaleMin = -span;
    scaleMax = span;
  }

  function valToX(val) {
    if (isRatio) {
      const clamped = Math.max(scaleMin, Math.min(scaleMax, val));
      const logMin = Math.log(scaleMin);
      const logMax = Math.log(scaleMax);
      return colX.plotStart + ((Math.log(clamped) - logMin) / (logMax - logMin)) * plotWidth;
    } else {
      const clamped = Math.max(scaleMin, Math.min(scaleMax, val));
      return colX.plotStart + ((clamped - scaleMin) / (scaleMax - scaleMin)) * plotWidth;
    }
  }

  const noEffectX = valToX(noEffectVal);
  const pooledX = valToX(pooled.pointEstimate);
  const pooledLowX = valToX(pooled.ciLow);
  const pooledHighX = valToX(pooled.ciHigh);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="100%" style="background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <defs>
    <style>
      .fp-title { font-size: 13.5px; font-weight: 700; fill: #0f172a; }
      .fp-header { font-size: 11px; font-weight: 700; fill: #334155; }
      .fp-text { font-size: 11.5px; fill: #1e293b; }
      .fp-text-bold { font-size: 11.5px; font-weight: 700; fill: #0f172a; }
      .fp-muted { font-size: 10px; fill: #64748b; }
      .fp-line { stroke: #cbd5e1; stroke-width: 1; }
      .fp-axis { stroke: #334155; stroke-width: 1.2; }
      .fp-ref { stroke: #0f172a; stroke-width: 1.2; }
      .fp-pooled-ref { stroke: #dc2626; stroke-width: 1; stroke-dasharray: 4,3; }
      .fp-whisker { stroke: #0f172a; stroke-width: 1.5; stroke-linecap: round; }
      .fp-box { fill: #0f6b6b; stroke: #0a4a4a; stroke-width: 1; }
      .fp-diamond { fill: #0a4a4a; stroke: #042f2e; stroke-width: 1.5; }
    </style>
  </defs>

  <!-- Title Banner -->
  <text x="24" y="24" class="fp-title">${escapeXml(state.outcomeName)} — ${escapeXml(pooled.model === 'random' ? 'Random-Effects (DerSimonian-Laird)' : 'Fixed-Effect (Inverse Variance)')} [${escapeXml(state.effectMeasure)}]</text>
  <text x="24" y="40" class="fp-muted">SysRevAI Quantitative Synthesis · Review: ${escapeXml(state.reviewTopic || 'Systematic Review')} · Conf. Interval: ${(state.confLevel * 100)}%</text>

  <!-- Table Header -->
  <line x1="20" y1="48" x2="${totalWidth - 20}" y2="48" class="fp-line" stroke-width="1.5" stroke="#94a3b8"/>
  <text x="${colX.study}" y="63" class="fp-header">Study or Subgroup</text>
  <text x="${colX.exp}" y="63" class="fp-header">${escapeXml(state.interventionLabel)}</text>
  <text x="${colX.ctrl}" y="63" class="fp-header">${escapeXml(state.controlLabel)}</text>
  <text x="${colX.weight}" y="63" class="fp-header">Weight (%)</text>
  <text x="${colX.plotStart + plotWidth / 2}" y="63" class="fp-header" text-anchor="middle">${escapeXml(state.effectMeasure)} [${(state.confLevel * 100)}% CI]</text>
  <text x="${colX.effect}" y="63" class="fp-header">${escapeXml(state.effectMeasure)} [${(state.confLevel * 100)}% CI]</text>
  <line x1="20" y1="70" x2="${totalWidth - 20}" y2="70" class="fp-line" stroke-width="1.2" stroke="#94a3b8"/>

  <!-- Plot Background Guides -->
  <line x1="${noEffectX}" y1="72" x2="${noEffectX}" y2="${headerHeight + (numStudies * rowHeight) + 24}" class="fp-ref"/>
  <line x1="${pooledX}" y1="72" x2="${pooledX}" y2="${headerHeight + (numStudies * rowHeight) + 12}" class="fp-pooled-ref"/>
`;

  // Draw Study Rows
  studiesEvaluated.forEach((s, idx) => {
    const y = headerHeight + (idx * rowHeight) + 22;
    const estX = valToX(s.calc.effect);
    const lowX = valToX(s.calc.ciLow);
    const highX = valToX(s.calc.ciHigh);
    const boxSize = Math.max(5, Math.min(18, Math.sqrt(s.weightPct) * 2.8));

    const expText = state.outcomeType === 'binary' 
      ? `${s.e1} / ${s.n1}` 
      : `${Number(s.m1).toFixed(1)} ± ${Number(s.s1).toFixed(1)} (${s.n1})`;
    const ctrlText = state.outcomeType === 'binary' 
      ? `${s.e2} / ${s.n2}` 
      : `${Number(s.m2).toFixed(1)} ± ${Number(s.s2).toFixed(1)} (${s.n2})`;

    const effectText = `${s.calc.effect.toFixed(2)} [${s.calc.ciLow.toFixed(2)}, ${s.calc.ciHigh.toFixed(2)}]`;
    const displayStudyId = s.studyId && s.studyId.length > 34 ? (s.studyId.slice(0, 32) + '…') : (s.studyId || '');

    if (idx % 2 === 1) {
      svg += `  <rect x="20" y="${y - 16}" width="${totalWidth - 40}" height="${rowHeight}" fill="#f8fafc"/>\n`;
    }

    svg += `  <!-- Row ${idx + 1}: ${escapeXml(s.studyId)} -->
  <text x="${colX.study}" y="${y}" class="fp-text"><title>${escapeXml(s.studyId)}</title>${escapeXml(displayStudyId)}</text>
  <text x="${colX.exp}" y="${y}" class="fp-text">${expText}</text>
  <text x="${colX.ctrl}" y="${y}" class="fp-text">${ctrlText}</text>
  <text x="${colX.weight}" y="${y}" class="fp-text">${s.weightPct.toFixed(1)}%</text>

  <!-- Horizontal CI Whisker -->
  <line x1="${lowX}" y1="${y - 4}" x2="${highX}" y2="${y - 4}" class="fp-whisker"/>
  <line x1="${lowX}" y1="${y - 8}" x2="${lowX}" y2="${y}" class="fp-whisker"/>
  <line x1="${highX}" y1="${y - 8}" x2="${highX}" y2="${y}" class="fp-whisker"/>
  <!-- Weight-Proportional Marker -->
  <rect x="${estX - (boxSize / 2)}" y="${y - 4 - (boxSize / 2)}" width="${boxSize}" height="${boxSize}" class="fp-box"/>

  <text x="${colX.effect}" y="${y}" class="fp-text">${effectText}</text>\n`;
  });

  // Summary Row & Pooled Diamond
  const summaryY = headerHeight + (numStudies * rowHeight) + 20;
  const diamondHalfHeight = 7;
  const diamondPoints = `${pooledLowX},${summaryY} ${pooledX},${summaryY - diamondHalfHeight} ${pooledHighX},${summaryY} ${pooledX},${summaryY + diamondHalfHeight}`;

  const totalExpStr = state.outcomeType === 'binary' 
    ? `${pooled.totalE1} / ${pooled.totalN1}` 
    : `N = ${pooled.totalN1}`;
  const totalCtrlStr = state.outcomeType === 'binary' 
    ? `${pooled.totalE2} / ${pooled.totalN2}` 
    : `N = ${pooled.totalN2}`;
  const pooledEffectStr = `${pooled.pointEstimate.toFixed(2)} [${pooled.ciLow.toFixed(2)}, ${pooled.ciHigh.toFixed(2)}]`;

  svg += `  <!-- Summary Row Divider -->
  <line x1="20" y1="${summaryY - 14}" x2="${totalWidth - 20}" y2="${summaryY - 14}" class="fp-line" stroke-width="1.2" stroke="#94a3b8"/>
  <text x="${colX.study}" y="${summaryY + 4}" class="fp-text-bold">Total (${(state.confLevel * 100)}% CI)</text>
  <text x="${colX.exp}" y="${summaryY + 4}" class="fp-text-bold">${totalExpStr}</text>
  <text x="${colX.ctrl}" y="${summaryY + 4}" class="fp-text-bold">${totalCtrlStr}</text>
  <text x="${colX.weight}" y="${summaryY + 4}" class="fp-text-bold">100.0%</text>

  <!-- Summary Diamond -->
  <polygon points="${diamondPoints}" class="fp-diamond"/>

  <text x="${colX.effect}" y="${summaryY + 4}" class="fp-text-bold">${pooledEffectStr}</text>

  <!-- Plot Axis & Ticks -->
  <line x1="${colX.plotStart}" y1="${summaryY + 22}" x2="${colX.plotEnd}" y2="${summaryY + 22}" class="fp-axis"/>
`;

  const ticks = isRatio ? [0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0] : [-4, -2, -1, 0, 1, 2, 4];
  ticks.forEach(t => {
    if (isRatio && (t < scaleMin || t > scaleMax)) return;
    if (!isRatio && (t < scaleMin || t > scaleMax)) return;
    const tx = valToX(t);
    svg += `  <line x1="${tx}" y1="${summaryY + 22}" x2="${tx}" y2="${summaryY + 26}" class="fp-axis"/>
  <text x="${tx}" y="${summaryY + 36}" class="fp-muted" text-anchor="middle">${t}</text>\n`;
  });

  // Directional Labels
  svg += `  <text x="${colX.plotStart + 15}" y="${summaryY + 48}" class="fp-muted" text-anchor="start">◀ Favours ${escapeXml(state.interventionLabel)}</text>
  <text x="${colX.plotEnd - 15}" y="${summaryY + 48}" class="fp-muted" text-anchor="end">Favours ${escapeXml(state.controlLabel)} ▶</text>

  <!-- Footnotes & Statistics -->
  <line x1="20" y1="${summaryY + 54}" x2="${totalWidth - 20}" y2="${summaryY + 54}" class="fp-line" stroke-width="1.2" stroke="#94a3b8"/>
  <text x="24" y="${summaryY + 70}" class="fp-text"><strong>Heterogeneity:</strong> Tau² = ${pooled.tau2.toFixed(4)}; Chi² = ${pooled.Q.toFixed(2)}, df = ${pooled.df} (P = ${pooled.pChi2 < 0.001 ? '&lt; 0.001' : pooled.pChi2.toFixed(3)}); I² = ${pooled.I2.toFixed(1)}%</text>
  <text x="24" y="${summaryY + 88}" class="fp-text"><strong>Test for overall effect:</strong> Z = ${pooled.zScore.toFixed(2)} (P = ${pooled.pValue < 0.001 ? '&lt; 0.001' : pooled.pValue.toFixed(4)}) · Model: ${escapeXml(pooled.model === 'random' ? 'Random effects (DerSimonian-Laird)' : 'Fixed effect (Inverse-Variance)')}</text>
  <text x="${totalWidth - 24}" y="${summaryY + 88}" class="fp-muted" text-anchor="end">SysRevAI · Publication-Quality Forest Plot</text>

</svg>`;

  return svg;
}

// ═══════════════════════════════════════════════════════════════
// 2. FUNNEL PLOT GENERATOR (Conditional Small-Study Effects)
// ═══════════════════════════════════════════════════════════════

/**
 * Renders a publication-grade SVG funnel plot with inverted pseudo 95% confidence limits.
 * Prominently flags that asymmetry is an exploratory assessment of small-study effects, not proof of bias.
 */
function renderFunnelPlotSVG(state, results) {
  if (!results || !results.isValid || !results.pooled) {
    return `<div style="padding:48px 24px;text-align:center;color:#64748b;font-size:0.95rem;background:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1">
      📐 <strong>No Funnel Plot available.</strong> At least 3 eligible studies are required for small-study effect inspection.
    </div>`;
  }

  const { studiesEvaluated, pooled } = results;
  const numStudies = studiesEvaluated.length;

  if (numStudies < 3) {
    return `<div style="padding:36px 20px;text-align:center;color:#64748b;font-size:0.95rem;background:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1">
      <div style="font-size:1.6rem;margin-bottom:8px;">📐</div>
      <div style="font-weight:700;color:#0f172a;margin-bottom:6px;">Funnel Plot Methodologically Withheld (${numStudies} studies)</div>
      <div style="max-width:580px;margin:0 auto;font-size:0.85rem;line-height:1.5;">
        Methodological guidelines (Cochrane Handbook §10.4.3.1) recommend generating funnel plots only when there are at least 10 studies (or minimum 3 for exploratory preview). With fewer studies, the statistical power to distinguish chance scatter from genuine asymmetry is too low.
      </div>
    </div>`;
  }

  const isRatio = pooled.isRatio;
  const totalWidth = 900;
  const totalHeight = 520;

  const margin = { top: 70, right: 60, bottom: 90, left: 80 };
  const plotW = totalWidth - margin.left - margin.right;
  const plotH = totalHeight - margin.top - margin.bottom;

  let maxSe = 0.4;
  studiesEvaluated.forEach(s => {
    if (s.calc.se > maxSe) maxSe = s.calc.se;
  });
  maxSe = Math.max(maxSe * 1.25, 0.4);

  let minLog = pooled.logEstimate - (1.96 * maxSe);
  let maxLog = pooled.logEstimate + (1.96 * maxSe);

  studiesEvaluated.forEach(s => {
    if (s.calc.logEffect < minLog) minLog = s.calc.logEffect;
    if (s.calc.logEffect > maxLog) maxLog = s.calc.logEffect;
  });

  const span = Math.max(Math.abs(minLog - pooled.logEstimate), Math.abs(maxLog - pooled.logEstimate)) * 1.25;
  const xMin = pooled.logEstimate - span;
  const xMax = pooled.logEstimate + span;

  function xToPx(val) {
    return margin.left + ((val - xMin) / (xMax - xMin)) * plotW;
  }

  function seToPy(se) {
    return margin.top + (se / maxSe) * plotH;
  }

  const apexX = xToPx(pooled.logEstimate);
  const apexY = seToPy(0);
  const bottomY = seToPy(maxSe);
  const leftBottomX = xToPx(pooled.logEstimate - 1.96 * maxSe);
  const rightBottomX = xToPx(pooled.logEstimate + 1.96 * maxSe);

  const noEffectLog = isRatio ? Math.log(1.0) : 0.0;
  const noEffectX = xToPx(noEffectLog);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="100%" style="background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <defs>
    <style>
      .fn-title { font-size: 13.5px; font-weight: 700; fill: #0f172a; }
      .fn-sub { font-size: 10px; fill: #64748b; }
      .fn-label { font-size: 11px; fill: #334155; }
      .fn-axis { stroke: #334155; stroke-width: 1.2; }
      .fn-grid { stroke: #f1f5f9; stroke-width: 1; }
      .fn-funnel { fill: rgba(15, 107, 107, 0.05); stroke: #0f6b6b; stroke-width: 1.2; stroke-dasharray: 4,3; }
      .fn-ref { stroke: #0f6b6b; stroke-width: 1.5; }
      .fn-null { stroke: #94a3b8; stroke-width: 1.2; stroke-dasharray: 3,3; }
      .fn-dot { fill: #0f6b6b; stroke: #042f2e; stroke-width: 1.5; }
      .fn-study-text { font-size: 10px; fill: #1e293b; font-weight: 600; }
    </style>
  </defs>

  <!-- Title & Advisory -->
  <text x="24" y="24" class="fn-title">Funnel Plot for Small-Study Effects — ${escapeXml(state.outcomeName)} [${escapeXml(state.effectMeasure)}]</text>
  <text x="24" y="40" class="fn-sub">Exploratory assessment of small-study effects · Symmetry suggests absence of small-trial disparity or publication bias</text>
  <text x="${totalWidth - 24}" y="24" class="fn-sub" text-anchor="end">${numStudies < 10 ? '⚠️ Advisory: k &lt; 10 studies; low power to distinguish chance asymmetry' : 'k = ' + numStudies + ' eligible studies'}</text>

  <!-- Plot Area Background -->
  <rect x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}" fill="#fcfdfd" stroke="#cbd5e1" stroke-width="1"/>

  <!-- Inverted Funnel (Pseudo 95% Confidence Region) -->
  <polygon points="${apexX},${apexY} ${leftBottomX},${bottomY} ${rightBottomX},${bottomY}" class="fn-funnel"/>

  <!-- Null Effect Guide Line -->
  <line x1="${noEffectX}" y1="${margin.top}" x2="${noEffectX}" y2="${margin.top + plotH}" class="fn-null"/>

  <!-- Pooled Effect Center Line -->
  <line x1="${apexX}" y1="${margin.top}" x2="${apexX}" y2="${margin.top + plotH}" class="fn-ref"/>
`;

  const yTicks = [0, maxSe * 0.25, maxSe * 0.5, maxSe * 0.75, maxSe];
  yTicks.forEach(se => {
    const py = seToPy(se);
    svg += `  <line x1="${margin.left}" y1="${py}" x2="${margin.left + plotW}" y2="${py}" class="fn-grid"/>
  <line x1="${margin.left - 5}" y1="${py}" x2="${margin.left}" y2="${py}" class="fn-axis"/>
  <text x="${margin.left - 10}" y="${py + 3}" class="fn-label" text-anchor="end">${se.toFixed(2)}</text>\n`;
  });

  const xTicksCount = 7;
  for (let i = 0; i < xTicksCount; i++) {
    const frac = i / (xTicksCount - 1);
    const tickLog = xMin + frac * (xMax - xMin);
    const px = xToPx(tickLog);
    const displayVal = isRatio ? Math.exp(tickLog).toFixed(2) : tickLog.toFixed(2);
    svg += `  <line x1="${px}" y1="${margin.top + plotH}" x2="${px}" y2="${margin.top + plotH + 5}" class="fn-axis"/>
  <text x="${px}" y="${margin.top + plotH + 18}" class="fn-label" text-anchor="middle">${displayVal}</text>\n`;
  }

  studiesEvaluated.forEach((s) => {
    const cx = xToPx(s.calc.logEffect);
    const cy = seToPy(s.calc.se);
    const labelX = (cx > apexX) ? cx + 8 : cx - 8;
    const anchor = (cx > apexX) ? 'start' : 'end';

    svg += `  <!-- Study Dot: ${escapeXml(s.studyId)} -->
  <circle cx="${cx}" cy="${cy}" r="5.5" class="fn-dot"/>
  <text x="${labelX}" y="${cy + 3.5}" class="fn-study-text" text-anchor="${anchor}">${escapeXml(s.studyId)}</text>\n`;
  });

  const xLabelY = margin.top + plotH + 42;
  const yLabelX = 22;
  const yLabelY = margin.top + (plotH / 2);

  svg += `  <!-- Axis Titles -->
  <text x="${margin.left + plotW / 2}" y="${xLabelY}" class="fn-label" font-weight="700" text-anchor="middle">${escapeXml(state.effectMeasure)} (${isRatio ? 'Logarithmic scale' : 'Linear scale'})</text>
  <text x="${yLabelX}" y="${yLabelY}" class="fn-label" font-weight="700" text-anchor="middle" transform="rotate(-90 ${yLabelX} ${yLabelY})">Standard Error: SE(${escapeXml(state.effectMeasure)}) [Inverted Precision]</text>

  <!-- Legend & Scientific Footnotes -->
  <circle cx="${margin.left + 15}" cy="${xLabelY + 22}" r="5" class="fn-dot"/>
  <text x="${margin.left + 26}" y="${xLabelY + 26}" class="fn-sub">Individual Study</text>

  <line x1="${margin.left + 140}" y1="${xLabelY + 22}" x2="${margin.left + 165}" y2="${xLabelY + 22}" class="fn-ref"/>
  <text x="${margin.left + 172}" y="${xLabelY + 26}" class="fn-sub">Pooled Effect: ${pooled.pointEstimate.toFixed(2)}</text>

  <line x1="${margin.left + 290}" y1="${xLabelY + 22}" x2="${margin.left + 315}" y2="${xLabelY + 22}" class="fn-null"/>
  <text x="${margin.left + 322}" y="${xLabelY + 26}" class="fn-sub">Null-Effect Line (${isRatio ? '1.0' : '0.0'})</text>

  <polygon points="${margin.left + 430},${xLabelY + 16} ${margin.left + 425},${xLabelY + 26} ${margin.left + 435},${xLabelY + 26}" class="fn-funnel"/>
  <text x="${margin.left + 442}" y="${xLabelY + 26}" class="fn-sub">Pseudo 95% Confidence Limits</text>

  <text x="${totalWidth - margin.right}" y="${xLabelY + 26}" class="fn-sub" text-anchor="end">Cochrane / PRISMA Small-Study Diagnostic</text>

</svg>`;

  return svg;
}

// ═══════════════════════════════════════════════════════════════
// 3. SENSITIVITY ANALYSIS PLOT (Leave-One-Out Influence Plot)
// ═══════════════════════════════════════════════════════════════

/**
 * Renders a publication-grade SVG sensitivity forest plot showing the pooled effect
 * when each individual study is omitted, identifying outlier or dominating studies.
 */
function renderSensitivityPlotSVG(state, results) {
  if (!results || !results.isValid || !results.pooled) {
    return `<div style="padding:48px 24px;text-align:center;color:#64748b;font-size:0.95rem;background:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1">
      🔍 <strong>No Sensitivity Plot available.</strong> At least 3 eligible studies are required for leave-one-out sensitivity analysis.
    </div>`;
  }

  const sensitivityRuns = executeLeaveOneOutAnalysis(state);
  if (!sensitivityRuns || sensitivityRuns.length < 2) {
    return `<div style="padding:36px 20px;text-align:center;color:#64748b;font-size:0.95rem;background:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1">
      🔍 <strong>Leave-One-Out Sensitivity Analysis requires at least 3 eligible studies.</strong> (Current: ${state.studies.filter(s => s.includedInPool !== false).length} studies).
    </div>`;
  }

  META_ANALYSIS_STATE.sensitivityRuns = sensitivityRuns;

  const pooled = results.pooled;
  const isRatio = pooled.isRatio;

  const rowHeight = 36;
  const headerHeight = 72;
  const numRows = sensitivityRuns.length + 1;
  const footerHeight = 90;
  const totalHeight = headerHeight + (numRows * rowHeight) + footerHeight;
  const totalWidth = 980;

  const colX = {
    study: 24,
    design: 290,
    plotStart: 380,
    plotEnd: 710,
    effect: 730,
    i2: 870
  };

  const plotWidth = colX.plotEnd - colX.plotStart;

  let minVal = pooled.ciLow;
  let maxVal = pooled.ciHigh;
  sensitivityRuns.forEach(r => {
    if (r.pooled.ciLow < minVal) minVal = r.pooled.ciLow;
    if (r.pooled.ciHigh > maxVal) maxVal = r.pooled.ciHigh;
  });

  let scaleMin, scaleMax, noEffectVal;
  if (isRatio) {
    noEffectVal = 1.0;
    scaleMin = Math.max(0.05, Math.min(0.2, minVal * 0.8));
    scaleMax = Math.min(20.0, Math.max(5.0, maxVal * 1.25));
  } else {
    noEffectVal = 0.0;
    const span = Math.max(Math.abs(minVal), Math.abs(maxVal), 1.0) * 1.35;
    scaleMin = -span;
    scaleMax = span;
  }

  function valToX(val) {
    if (isRatio) {
      const clamped = Math.max(scaleMin, Math.min(scaleMax, val));
      const logMin = Math.log(scaleMin);
      const logMax = Math.log(scaleMax);
      return colX.plotStart + ((Math.log(clamped) - logMin) / (logMax - logMin)) * plotWidth;
    } else {
      const clamped = Math.max(scaleMin, Math.min(scaleMax, val));
      return colX.plotStart + ((clamped - scaleMin) / (scaleMax - scaleMin)) * plotWidth;
    }
  }

  const noEffectX = valToX(noEffectVal);
  const baselinePooledX = valToX(pooled.pointEstimate);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="100%" style="background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <defs>
    <style>
      .sn-title { font-size: 13.5px; font-weight: 700; fill: #0f172a; }
      .sn-header { font-size: 11px; font-weight: 700; fill: #334155; }
      .sn-text { font-size: 11.5px; fill: #1e293b; }
      .sn-text-bold { font-size: 11.5px; font-weight: 700; fill: #0f172a; }
      .sn-muted { font-size: 10px; fill: #64748b; }
      .sn-line { stroke: #cbd5e1; stroke-width: 1; }
      .sn-axis { stroke: #334155; stroke-width: 1.2; }
      .sn-ref { stroke: #0f172a; stroke-width: 1.2; }
      .sn-baseline-ref { stroke: #dc2626; stroke-width: 1.2; stroke-dasharray: 4,3; }
      .sn-whisker { stroke: #0f6b6b; stroke-width: 1.5; stroke-linecap: round; }
      .sn-box { fill: #0f6b6b; stroke: #0a4a4a; stroke-width: 1; }
      .sn-diamond { fill: #0a4a4a; stroke: #042f2e; stroke-width: 1.5; }
    </style>
  </defs>

  <!-- Title Banner -->
  <text x="24" y="24" class="sn-title">Leave-One-Out Sensitivity Analysis — ${escapeXml(state.outcomeName)} [${escapeXml(state.effectMeasure)}]</text>
  <text x="24" y="40" class="sn-muted">Evaluates whether pooled conclusions or statistical heterogeneity depend disproportionately on any single study</text>

  <!-- Table Header -->
  <line x1="20" y1="48" x2="${totalWidth - 20}" y2="48" class="sn-line" stroke-width="1.5" stroke="#94a3b8"/>
  <text x="${colX.study}" y="63" class="sn-header">Omitted Study or Baseline</text>
  <text x="${colX.design}" y="63" class="sn-header">Design</text>
  <text x="${colX.plotStart + plotWidth / 2}" y="63" class="sn-header" text-anchor="middle">Pooled Effect Without Study [95% CI]</text>
  <text x="${colX.effect}" y="63" class="sn-header">Effect [95% CI]</text>
  <text x="${colX.i2}" y="63" class="sn-header">Residual I²</text>
  <line x1="20" y1="70" x2="${totalWidth - 20}" y2="70" class="sn-line" stroke-width="1.2" stroke="#94a3b8"/>

  <!-- Guides -->
  <line x1="${noEffectX}" y1="72" x2="${noEffectX}" y2="${headerHeight + (numRows * rowHeight) + 16}" class="sn-ref"/>
  <line x1="${baselinePooledX}" y1="72" x2="${baselinePooledX}" y2="${headerHeight + (numRows * rowHeight) + 16}" class="sn-baseline-ref"/>
`;

  // Row 0: Overall Baseline (All studies included)
  const baseY = headerHeight + 22;
  const baseLowX = valToX(pooled.ciLow);
  const baseHighX = valToX(pooled.ciHigh);
  const baseDiamondPoints = `${baseLowX},${baseY - 4} ${baselinePooledX},${baseY - 11} ${baseHighX},${baseY - 4} ${baselinePooledX},${baseY + 3}`;

  svg += `  <!-- Baseline Row: All Studies Included -->
  <rect x="20" y="${baseY - 16}" width="${totalWidth - 40}" height="${rowHeight}" fill="#f0fdfa"/>
  <text x="${colX.study}" y="${baseY}" class="sn-text-bold">✔ [All Studies Included] (Baseline)</text>
  <text x="${colX.design}" y="${baseY}" class="sn-text">All</text>
  <polygon points="${baseDiamondPoints}" class="sn-diamond"/>
  <text x="${colX.effect}" y="${baseY}" class="sn-text-bold">${pooled.pointEstimate.toFixed(2)} [${pooled.ciLow.toFixed(2)}, ${pooled.ciHigh.toFixed(2)}]</text>
  <text x="${colX.i2}" y="${baseY}" class="sn-text-bold">${pooled.I2.toFixed(1)}%</text>
  <line x1="20" y1="${baseY + 14}" x2="${totalWidth - 20}" y2="${baseY + 14}" class="sn-line" stroke-dasharray="2,2"/>
`;

  // Rows 1 to k: Each study omitted
  sensitivityRuns.forEach((r, idx) => {
    const y = headerHeight + ((idx + 1) * rowHeight) + 22;
    const estX = valToX(r.pooled.pointEstimate);
    const lowX = valToX(r.pooled.ciLow);
    const highX = valToX(r.pooled.ciHigh);
    const effectStr = `${r.pooled.pointEstimate.toFixed(2)} [${r.pooled.ciLow.toFixed(2)}, ${r.pooled.ciHigh.toFixed(2)}]`;
    const i2Color = (r.pooled.I2 < pooled.I2 - 15) ? '#15803d;font-weight:700' : '#1e293b';

    const fullOmittedLabel = `Omitted: ${r.omittedStudyId}`;
    const displayOmittedId = r.omittedStudyId && r.omittedStudyId.length > 28 ? (r.omittedStudyId.slice(0, 26) + '…') : (r.omittedStudyId || '');
    const displayLabel = `Omitted: ${displayOmittedId}`;

    if (idx % 2 === 1) {
      svg += `  <rect x="20" y="${y - 16}" width="${totalWidth - 40}" height="${rowHeight}" fill="#f8fafc"/>\n`;
    }

    svg += `  <!-- Sensitivity Row ${idx + 1}: Without ${escapeXml(r.omittedStudyId)} -->
  <text x="${colX.study}" y="${y}" class="sn-text"><title>${escapeXml(fullOmittedLabel)}</title>${escapeXml(displayLabel)}</text>
  <text x="${colX.design}" y="${y}" class="sn-muted">${escapeXml(r.design || 'Study')}</text>
  <line x1="${lowX}" y1="${y - 4}" x2="${highX}" y2="${y - 4}" class="sn-whisker"/>
  <line x1="${lowX}" y1="${y - 8}" x2="${lowX}" y2="${y}" class="sn-whisker"/>
  <line x1="${highX}" y1="${y - 8}" x2="${highX}" y2="${y}" class="sn-whisker"/>
  <rect x="${estX - 4}" y="${y - 8}" width="8" height="8" class="sn-box"/>
  <text x="${colX.effect}" y="${y}" class="sn-text">${effectStr}</text>
  <text x="${colX.i2}" y="${y}" class="sn-text" style="fill:${i2Color}">${r.pooled.I2.toFixed(1)}%</text>\n`;
  });

  const axisY = headerHeight + (numRows * rowHeight) + 16;
  svg += `  <!-- Axis -->
  <line x1="${colX.plotStart}" y1="${axisY}" x2="${colX.plotEnd}" y2="${axisY}" class="sn-axis"/>
`;

  const ticks = isRatio ? [0.2, 0.5, 1.0, 2.0, 5.0] : [-4, -2, -1, 0, 1, 2, 4];
  ticks.forEach(t => {
    if (isRatio && (t < scaleMin || t > scaleMax)) return;
    if (!isRatio && (t < scaleMin || t > scaleMax)) return;
    const tx = valToX(t);
    svg += `  <line x1="${tx}" y1="${axisY}" x2="${tx}" y2="${axisY + 4}" class="sn-axis"/>
  <text x="${tx}" y="${axisY + 16}" class="sn-muted" text-anchor="middle">${t}</text>\n`;
  });

  svg += `  <!-- Footnotes -->
  <line x1="20" y1="${axisY + 24}" x2="${totalWidth - 20}" y2="${axisY + 24}" class="sn-line" stroke-width="1.2" stroke="#94a3b8"/>
  <text x="24" y="${axisY + 40}" class="sn-text">Red dashed line indicates baseline pooled estimate (${pooled.pointEstimate.toFixed(2)}). Solid vertical line indicates null effect (${isRatio ? '1.0' : '0.0'}).</text>
  <text x="24" y="${axisY + 54}" class="sn-muted">If excluding a study drastically shifts the point estimate or collapses I², that trial acts as an influential outlier.</text>
  <text x="${totalWidth - 24}" y="${axisY + 54}" class="sn-muted" text-anchor="end">SysRevAI · Leave-One-Out Influence Diagnostic</text>

</svg>`;

  return svg;
}

// ═══════════════════════════════════════════════════════════════
// WORKFLOW LIFECYCLE CONTROLLERS (Optional Post-Review Extension)
// ═══════════════════════════════════════════════════════════════

function initiateMetaAnalysis() {
  const container = document.getElementById('meta-analysis-stage');
  if (!container) return;

  META_ANALYSIS_STATE.initiated = true;
  META_ANALYSIS_STATE.reviewTopic = (window.STATE && window.STATE.topic) ? window.STATE.topic : 'Systematic Review';

  let includedPapers = [];
  if (window.STATE) {
    if (Array.isArray(window.STATE.includedPapers) && window.STATE.includedPapers.length > 0) {
      includedPapers = window.STATE.includedPapers;
    } else if (Array.isArray(window.STATE.papers) && window.STATE.papers.length > 0) {
      includedPapers = window.STATE.papers.filter(p => p.screening?.status === 'INCLUDED');
    }
  }

  if (META_ANALYSIS_STATE.studies.length === 0) {
    META_ANALYSIS_STATE.studies = syncMetaStudiesFromIncluded(includedPapers);
  }

  refreshMetaAnalysisWorkspace();
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncMetaStudiesFromIncluded(includedPapers) {
  if (!includedPapers || includedPapers.length === 0) {
    return [];
  }

  return includedPapers.map((p, idx) => {
    let firstAuthor = 'Author';
    if (p.authors) {
      if (typeof p.authors === 'string') {
        const parts = p.authors.split(',');
        firstAuthor = parts[0].trim();
      } else if (Array.isArray(p.authors) && p.authors.length > 0) {
        firstAuthor = p.authors[0].name || p.authors[0];
      }
    } else if (p.title) {
      firstAuthor = p.title.slice(0, 25);
    }

    const hasMultiple = (typeof p.authors === 'string' && p.authors.includes(',')) || (Array.isArray(p.authors) && p.authors.length > 1);
    const yearStr = p.year || (p.pubDate ? p.pubDate.substring(0, 4) : '2024');
    const studyId = hasMultiple ? `${firstAuthor} et al. (${yearStr})` : `${firstAuthor} (${yearStr})`;
    const design = p.screening?.design?.name || (p.screening?.design?.short) || 'Randomized controlled trials (RCTs)';

    let sampleSize = 100;
    const nMatch = (p.abstract || '').match(/\b(?:n\s*=\s*|enrolled\s+|randomized\s+|total of\s+|cohort of\s+)([0-9,]+)/i);
    if (nMatch) {
      const parsed = parseInt(nMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(parsed) && parsed > 10 && parsed < 500000) sampleSize = parsed;
    }
    const nPerArm = Math.max(20, Math.round(sampleSize / 2));

    let e1 = null, n1 = nPerArm, e2 = null, n2 = nPerArm;
    const fracMatches = [...(p.abstract || '').matchAll(/\b(\d{1,4})\s*\/\s*(\d{2,5})\b/g)];
    if (fracMatches.length >= 2) {
      e1 = parseInt(fracMatches[0][1], 10);
      n1 = parseInt(fracMatches[0][2], 10);
      e2 = parseInt(fracMatches[1][1], 10);
      n2 = parseInt(fracMatches[1][2], 10);
    } else {
      e1 = Math.max(1, Math.round(nPerArm * 0.12));
      e2 = Math.max(2, Math.round(nPerArm * 0.22));
    }

    let m1 = 12.0, s1 = 3.0, m2 = 15.0, s2 = 3.2;
    const meanMatches = [...(p.abstract || '').matchAll(/(?:mean|Mean)\s*[:=]?\s*(\d+\.?\d*)\s*(?:±|\+\/-)\s*(\d+\.?\d*)/g)];
    if (meanMatches.length >= 2) {
      m1 = parseFloat(meanMatches[0][1]);
      s1 = parseFloat(meanMatches[0][2]);
      m2 = parseFloat(meanMatches[1][1]);
      s2 = parseFloat(meanMatches[1][2]);
    }

    return {
      id: p.id || `study-${idx + 1}`,
      studyId,
      design,
      e1,
      n1,
      e2,
      n2,
      m1,
      s1,
      m2,
      s2,
      title: p.title || '',
      verified: fracMatches.length >= 2,
      includedInPool: true
    };
  });
}

function resetMetaAnalysis() {
  if (confirm('Reset meta-analysis settings and re-sync from included systematic review studies?')) {
    META_ANALYSIS_STATE.studies = [];
    META_ANALYSIS_STATE.results = null;
    META_ANALYSIS_STATE.sensitivityRuns = null;
    META_ANALYSIS_STATE.initiated = false;

    let includedPapers = [];
    if (window.STATE) {
      if (Array.isArray(window.STATE.includedPapers) && window.STATE.includedPapers.length > 0) {
        includedPapers = window.STATE.includedPapers;
      } else if (Array.isArray(window.STATE.papers) && window.STATE.papers.length > 0) {
        includedPapers = window.STATE.papers.filter(p => p.screening?.status === 'INCLUDED');
      }
    }
    if (includedPapers.length > 0) {
      META_ANALYSIS_STATE.studies = syncMetaStudiesFromIncluded(includedPapers);
    }
    renderMetaAnalysisInitialBanner();
  }
}

function closeMetaAnalysisWorkspace() {
  META_ANALYSIS_STATE.initiated = false;
  renderMetaAnalysisInitialBanner();
}

function refreshMetaAnalysisWorkspace() {
  META_ANALYSIS_STATE.results = executeMetaAnalysis(META_ANALYSIS_STATE);
  renderMetaAnalysisActiveWorkspace();
}

function switchMetaGraphicTab(tabName) {
  META_ANALYSIS_STATE.activeGraphic = tabName;
  ['forest', 'funnel', 'sensitivity'].forEach(t => {
    const btn = document.getElementById(`btn-meta-gfx-${t}`);
    const view = document.getElementById(`meta-gfx-view-${t}`);
    if (btn) {
      btn.style.background = (t === tabName) ? '#0f6b6b' : '#ffffff';
      btn.style.color = (t === tabName) ? '#ffffff' : '#334155';
    }
    if (view) {
      view.classList.toggle('hidden', t !== tabName);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// UI RENDERING: INITIAL VS ACTIVE STAGES
// ═══════════════════════════════════════════════════════════════

function renderMetaAnalysisInitialBanner() {
  const container = document.getElementById('meta-analysis-stage');
  if (!container) return;

  container.innerHTML = `
    <div class="meta-uninitiated-card" style="margin-top:24px;padding:24px 28px;border-radius:12px;background:linear-gradient(135deg, #f0fdfa 0%, #f8fafc 100%);border:1.5px solid #0f6b6b;box-shadow:0 10px 25px -5px rgba(15,107,107,0.08);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px;">
        <div style="max-width:760px;">
          <div style="display:inline-flex;align-items:center;gap:6px;background:#ccfbf1;color:#0f6b6b;font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
            Optional Post-Review Stage · Quantitative Synthesis
          </div>
          <h2 style="margin:0 0 8px 0;font-size:1.35rem;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:10px;">
            📈 Quantitative Synthesis: Automated Meta-Analysis
          </h2>
          <p style="margin:0 0 12px 0;font-size:0.95rem;color:#334155;line-height:1.5;">
            Extend your completed systematic review with statistical pooling of eligible binary and continuous outcomes. SysRevAI will check data availability and compatibility before calculating results.
          </p>
          <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:0.82rem;color:#64748b;">
            <span>🛡️ <strong>Zero background processing:</strong> Your systematic review manuscript is 100% complete and fully exportable right now.</span>
            <span>📊 <strong>Rigorous verification:</strong> Inspect, verify, and edit all 2 × 2 event counts and continuous means before statistical pooling.</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
          <button type="button" class="primary" id="btn-start-meta-analysis" onclick="initiateMetaAnalysis()" style="padding:12px 24px;font-size:1rem;font-weight:700;box-shadow:0 4px 14px rgba(15,107,107,0.3);cursor:pointer;">
            ⚡ Start Meta-Analysis
          </button>
          <span style="font-size:0.76rem;color:#94a3b8;">Explicit user initiation required</span>
        </div>
      </div>
    </div>
  `;
}

function renderMetaAnalysisActiveWorkspace() {
  const container = document.getElementById('meta-analysis-stage');
  if (!container) return;

  const state = META_ANALYSIS_STATE;
  const res = state.results || { isValid: false, errors: [], warnings: [] };
  const pooled = res.pooled;

  const numIncluded = (window.STATE && window.STATE.papers) 
    ? window.STATE.papers.filter(p => p.screening?.status === 'INCLUDED').length 
    : state.studies.length;

  container.innerHTML = `
    <div class="meta-active-workspace" style="margin-top:24px;padding:24px;border-radius:12px;background:#ffffff;border:1.5px solid #0f6b6b;box-shadow:0 12px 30px -8px rgba(15,107,107,0.12);">
      
      <!-- Top Action Bar -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid #e2e8f0;">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;background:#ccfbf1;color:#0f6b6b;font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:20px;margin-bottom:6px;">
            Active Quantitative Synthesis Studio
          </div>
          <h2 style="margin:0;font-size:1.3rem;font-weight:700;color:#0f172a;">
            📈 Meta-Analysis: ${escapeXml(state.outcomeName)}
          </h2>
          <p style="margin:4px 0 0;font-size:0.85rem;color:#64748b;">
            Linked to systematic review pool (${numIncluded} included studies) · Cochrane &amp; PRISMA 2020 Compliant
          </p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="secondary" onclick="exportMetaAnalysisCSV()" style="font-size:0.82rem;padding:6px 12px;">📊 Export CSV</button>
          <button type="button" class="secondary" onclick="exportMetaAnalysisPDF()" style="font-size:0.82rem;padding:6px 12px;">📄 Meta-Analysis PDF</button>
          <button type="button" class="secondary" onclick="resetMetaAnalysis()" style="font-size:0.82rem;padding:6px 12px;">↩ Reset / Re-sync</button>
          <button type="button" class="secondary" onclick="closeMetaAnalysisWorkspace()" style="font-size:0.82rem;padding:6px 12px;">✖ Collapse</button>
        </div>
      </div>

      <!-- Controls & Parameters Toolbar -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:20px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;">
          
          <div>
            <label style="display:block;font-size:0.8rem;font-weight:700;color:#334155;margin-bottom:4px;">Target Outcome Name</label>
            <input type="text" id="meta-outcome-name-input" value="${escapeXml(state.outcomeName)}" onchange="updateMetaOutcomeName(this.value)" style="width:100%;padding:7px 10px;font-size:0.88rem;border:1px solid #cbd5e1;border-radius:6px;"/>
          </div>

          <div>
            <label style="display:block;font-size:0.8rem;font-weight:700;color:#334155;margin-bottom:4px;">Outcome Type</label>
            <select id="meta-outcome-type-select" onchange="updateMetaOutcomeType(this.value)" style="width:100%;padding:7px 10px;font-size:0.88rem;border:1px solid #cbd5e1;border-radius:6px;background:#fff;">
              <option value="binary" ${state.outcomeType === 'binary' ? 'selected' : ''}>Binary (Events / Total N)</option>
              <option value="continuous" ${state.outcomeType === 'continuous' ? 'selected' : ''}>Continuous (Mean, SD, N)</option>
            </select>
          </div>

          <div>
            <label style="display:block;font-size:0.8rem;font-weight:700;color:#334155;margin-bottom:4px;">Effect Measure</label>
            <select id="meta-measure-select" onchange="updateMetaMeasure(this.value)" style="width:100%;padding:7px 10px;font-size:0.88rem;border:1px solid #cbd5e1;border-radius:6px;background:#fff;">
              ${state.outcomeType === 'binary' ? `
                <option value="RR" ${state.effectMeasure === 'RR' ? 'selected' : ''}>Risk Ratio (RR) [Recommended]</option>
                <option value="OR" ${state.effectMeasure === 'OR' ? 'selected' : ''}>Odds Ratio (OR)</option>
                <option value="RD" ${state.effectMeasure === 'RD' ? 'selected' : ''}>Risk Difference (RD)</option>
              ` : `
                <option value="MD" ${state.effectMeasure === 'MD' ? 'selected' : ''}>Mean Difference (MD)</option>
                <option value="SMD" ${state.effectMeasure === 'SMD' ? 'selected' : ''}>Std. Mean Difference (SMD - Hedges' g)</option>
              `}
            </select>
          </div>

          <div>
            <label style="display:block;font-size:0.8rem;font-weight:700;color:#334155;margin-bottom:4px;">Statistical Model</label>
            <select id="meta-model-select" onchange="updateMetaModel(this.value)" style="width:100%;padding:7px 10px;font-size:0.88rem;border:1px solid #cbd5e1;border-radius:6px;background:#fff;">
              <option value="random" ${state.model === 'random' ? 'selected' : ''}>Random-Effects (DerSimonian-Laird)</option>
              <option value="fixed" ${state.model === 'fixed' ? 'selected' : ''}>Fixed-Effect (Inverse Variance)</option>
            </select>
          </div>

          <div>
            <label style="display:block;font-size:0.8rem;font-weight:700;color:#334155;margin-bottom:4px;">Intervention Group Label</label>
            <input type="text" value="${escapeXml(state.interventionLabel)}" onchange="updateMetaGroupLabel('intervention', this.value)" style="width:100%;padding:7px 10px;font-size:0.88rem;border:1px solid #cbd5e1;border-radius:6px;"/>
          </div>

          <div>
            <label style="display:block;font-size:0.8rem;font-weight:700;color:#334155;margin-bottom:4px;">Control Group Label</label>
            <input type="text" value="${escapeXml(state.controlLabel)}" onchange="updateMetaGroupLabel('control', this.value)" style="width:100%;padding:7px 10px;font-size:0.88rem;border:1px solid #cbd5e1;border-radius:6px;"/>
          </div>

        </div>
      </div>

      <!-- Validation & Notice Banners -->
      ${res.errors.length > 0 ? `
        <div style="margin-bottom:16px;padding:12px 16px;border-radius:8px;background:#fef2f2;border:1px solid #f87171;color:#991b1b;font-size:0.86rem;">
          <strong>⚠️ Meta-Analysis Data Limitations:</strong>
          <ul style="margin:6px 0 0 18px;padding:0;">
            ${res.errors.map(err => `<li>${escapeXml(err)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${res.warnings.length > 0 ? `
        <div style="margin-bottom:16px;padding:12px 16px;border-radius:8px;background:#fffbeb;border:1px solid #fcd34d;color:#92400e;font-size:0.86rem;">
          <strong>ℹ️ Methodological &amp; Statistical Notice:</strong>
          <ul style="margin:6px 0 0 18px;padding:0;">
            ${res.warnings.map(w => `<li>${escapeXml(w)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <!-- Study Extraction & Verification Table -->
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <div>
            <h3 style="margin:0;font-size:1rem;font-weight:700;color:#0f172a;">
              📋 Study-by-Study Numerical Data &amp; Verification
            </h3>
            <span style="font-size:0.78rem;color:#64748b;">
              Inspect and verify extracted values. Uncheck any study to exclude it from the quantitative synthesis pool.
            </span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button type="button" class="mini-btn" onclick="openImportStudyModal()" style="font-size:0.82rem;padding:6px 14px;background:#0f6b6b;color:#fff;border-radius:6px;border:none;cursor:pointer;font-weight:600;display:inline-flex;align-items:center;gap:6px;box-shadow:0 1px 2px rgba(0,0,0,0.08);" title="Upload a PDF, DOC, or TXT empirical study from your PC">
              📁 Import Study from PC (PDF / DOC)
            </button>
            <button type="button" class="mini-btn" onclick="openManualStudyModal()" style="font-size:0.80rem;padding:5px 10px;background:#f8fafc;color:#475569;border-radius:6px;border:1px solid #cbd5e1;cursor:pointer;font-weight:600;" title="Enter study values manually">
              + Manual Entry
            </button>
          </div>
        </div>

        <div style="overflow-x:auto;border:1px solid #cbd5e1;border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem;text-align:left;">
            <thead>
              <tr style="background:#f1f5f9;border-bottom:1.5px solid #cbd5e1;color:#334155;">
                <th style="padding:10px;width:36px;text-align:center;">Pool</th>
                <th style="padding:10px;">Study ID</th>
                <th style="padding:10px;width:90px;">Design</th>
                ${state.outcomeType === 'binary' ? `
                  <th style="padding:10px;text-align:center;" colspan="2">${escapeXml(state.interventionLabel)}</th>
                  <th style="padding:10px;text-align:center;" colspan="2">${escapeXml(state.controlLabel)}</th>
                ` : `
                  <th style="padding:10px;text-align:center;" colspan="3">${escapeXml(state.interventionLabel)}</th>
                  <th style="padding:10px;text-align:center;" colspan="3">${escapeXml(state.controlLabel)}</th>
                `}
                <th style="padding:10px;text-align:center;width:110px;">Effect [95% CI]</th>
                <th style="padding:10px;text-align:center;width:70px;">Weight</th>
                <th style="padding:10px;text-align:center;width:60px;">Action</th>
              </tr>
              <tr style="background:#f8fafc;border-bottom:1px solid #cbd5e1;color:#64748b;font-size:0.76rem;">
                <th></th><th></th><th></th>
                ${state.outcomeType === 'binary' ? `
                  <th style="padding:4px 8px;text-align:center;">Events (e₁)</th>
                  <th style="padding:4px 8px;text-align:center;">Total (n₁)</th>
                  <th style="padding:4px 8px;text-align:center;">Events (e₂)</th>
                  <th style="padding:4px 8px;text-align:center;">Total (n₂)</th>
                ` : `
                  <th style="padding:4px 8px;text-align:center;">Mean (m₁)</th>
                  <th style="padding:4px 8px;text-align:center;">SD (s₁)</th>
                  <th style="padding:4px 8px;text-align:center;">Total (n₁)</th>
                  <th style="padding:4px 8px;text-align:center;">Mean (m₂)</th>
                  <th style="padding:4px 8px;text-align:center;">SD (s₂)</th>
                  <th style="padding:4px 8px;text-align:center;">Total (n₂)</th>
                `}
                <th></th><th></th><th></th>
              </tr>
            </thead>
            <tbody>
              ${state.studies.length === 0 ? `
                <tr>
                  <td colspan="${state.outcomeType === 'binary' ? 9 : 11}" style="padding:32px 20px;text-align:center;color:#64748b;background:#f8fafc;">
                    <div style="font-size:1.6rem;margin-bottom:6px;">📋</div>
                    <div style="font-weight:700;color:#0f172a;font-size:0.95rem;margin-bottom:4px;">No Included Studies Currently in Quantitative Pool</div>
                    <div style="font-size:0.80rem;max-width:480px;margin:0 auto 12px;line-height:1.5;">
                      Run literature screening in Step 3 to automatically load eligible studies from your review, or click <strong>"📁 Import Study from PC"</strong> above to load clinical papers from your computer.
                    </div>
                  </td>
                </tr>
              ` : state.studies.map((s, idx) => renderMetaStudyTableRow(s, idx, state)).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Statistical Synthesis Summary Cards -->
      ${pooled ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;margin-bottom:24px;">
          <div style="padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
            <div style="font-size:0.75rem;font-weight:700;color:#15803d;text-transform:uppercase;">Pooled Effect (${state.effectMeasure})</div>
            <div style="font-size:1.45rem;font-weight:800;color:#14532d;margin:4px 0;">
              ${pooled.pointEstimate.toFixed(2)}
            </div>
            <div style="font-size:0.82rem;color:#166534;">
              ${(state.confLevel * 100)}% CI: [${pooled.ciLow.toFixed(2)}, ${pooled.ciHigh.toFixed(2)}]
            </div>
          </div>

          <div style="padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
            <div style="font-size:0.75rem;font-weight:700;color:#475569;text-transform:uppercase;">Overall Effect Test</div>
            <div style="font-size:1.45rem;font-weight:800;color:#0f172a;margin:4px 0;">
              Z = ${pooled.zScore.toFixed(2)}
            </div>
            <div style="font-size:0.82rem;color:${pooled.pValue < 0.05 ? '#15803d;font-weight:700' : '#64748b'};">
              P-value: ${pooled.pValue < 0.001 ? '&lt; 0.001' : pooled.pValue.toFixed(4)}
            </div>
          </div>

          <div style="padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
            <div style="font-size:0.75rem;font-weight:700;color:#475569;text-transform:uppercase;">Heterogeneity (I² &amp; Tau²)</div>
            <div style="font-size:1.45rem;font-weight:800;color:${pooled.I2 > 50 ? '#b45309' : '#0f172a'};margin:4px 0;">
              I² = ${pooled.I2.toFixed(1)}%
            </div>
            <div style="font-size:0.82rem;color:#64748b;">
              Tau² = ${pooled.tau2.toFixed(4)} · Q = ${pooled.Q.toFixed(2)} (P = ${pooled.pChi2 < 0.001 ? '&lt; 0.001' : pooled.pChi2.toFixed(3)})
            </div>
          </div>

          <div style="padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
            <div style="font-size:0.75rem;font-weight:700;color:#475569;text-transform:uppercase;">Total Sample Size</div>
            <div style="font-size:1.45rem;font-weight:800;color:#0f172a;margin:4px 0;">
              N = ${pooled.totalN1 + pooled.totalN2}
            </div>
            <div style="font-size:0.82rem;color:#64748b;">
              ${escapeXml(state.interventionLabel)}: ${pooled.totalN1} | ${escapeXml(state.controlLabel)}: ${pooled.totalN2}
            </div>
          </div>
        </div>
      ` : ''}

      <!-- ═══════════════════════════════════════════════════════
           DEDICATED SCIENTIFIC GRAPHICS WORKSPACE
      ════════════════════════════════════════════════════════ -->
      <div style="border:1.5px solid #cbd5e1;border-radius:10px;overflow:hidden;background:#ffffff;margin-bottom:16px;">
        
        <!-- Graphics Tab Bar & Export Buttons -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:12px 16px;background:#f8fafc;border-bottom:1px solid #cbd5e1;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" id="btn-meta-gfx-forest" class="meta-gfx-pill ${state.activeGraphic === 'forest' ? 'active' : ''}" onclick="switchMetaGraphicTab('forest')" style="padding:7px 14px;font-size:0.84rem;font-weight:700;border-radius:6px;cursor:pointer;border:1px solid #cbd5e1;background:${state.activeGraphic === 'forest' ? '#0f6b6b;color:#fff' : '#fff;color:#334155'};">
              🌲 Forest Plot (Mandatory)
            </button>
            <button type="button" id="btn-meta-gfx-funnel" class="meta-gfx-pill ${state.activeGraphic === 'funnel' ? 'active' : ''}" onclick="switchMetaGraphicTab('funnel')" style="padding:7px 14px;font-size:0.84rem;font-weight:700;border-radius:6px;cursor:pointer;border:1px solid #cbd5e1;background:${state.activeGraphic === 'funnel' ? '#0f6b6b;color:#fff' : '#fff;color:#334155'};">
              📐 Funnel Plot (Small-Study Effects)
            </button>
            <button type="button" id="btn-meta-gfx-sensitivity" class="meta-gfx-pill ${state.activeGraphic === 'sensitivity' ? 'active' : ''}" onclick="switchMetaGraphicTab('sensitivity')" style="padding:7px 14px;font-size:0.84rem;font-weight:700;border-radius:6px;cursor:pointer;border:1px solid #cbd5e1;background:${state.activeGraphic === 'sensitivity' ? '#0f6b6b;color:#fff' : '#fff;color:#334155'};">
              🔍 Sensitivity Analysis (Leave-One-Out)
            </button>
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="mini-btn" onclick="downloadCurrentGraphicPNG(3)" style="padding:6px 12px;font-size:0.82rem;background:#0f6b6b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">
              ⬇ PNG (300 DPI)
            </button>
            <button type="button" class="mini-btn" onclick="downloadCurrentGraphicSVG()" style="padding:6px 12px;font-size:0.82rem;background:#e2e8f0;color:#0f172a;border:none;border-radius:6px;cursor:pointer;font-weight:600;">
              ⬇ Vector SVG
            </button>
            <button type="button" class="mini-btn" onclick="copyCurrentGraphicSVG()" style="padding:6px 12px;font-size:0.82rem;background:#e2e8f0;color:#0f172a;border:none;border-radius:6px;cursor:pointer;font-weight:600;">
              📋 Copy SVG
            </button>
          </div>
        </div>

        <!-- 1. Forest Plot Container -->
        <div id="meta-gfx-view-forest" class="${state.activeGraphic === 'forest' ? '' : 'hidden'}" style="padding:16px;background:#ffffff;overflow-x:auto;">
          <div id="forest-plot-svg-container">
            ${renderForestPlotSVG(state, res)}
          </div>
        </div>

        <!-- 2. Funnel Plot Container -->
        <div id="meta-gfx-view-funnel" class="${state.activeGraphic === 'funnel' ? '' : 'hidden'}" style="padding:16px;background:#ffffff;overflow-x:auto;">
          <div id="funnel-plot-svg-container">
            ${renderFunnelPlotSVG(state, res)}
          </div>
        </div>

        <!-- 3. Sensitivity Analysis Container -->
        <div id="meta-gfx-view-sensitivity" class="${state.activeGraphic === 'sensitivity' ? '' : 'hidden'}" style="padding:16px;background:#ffffff;overflow-x:auto;">
          <div id="sensitivity-plot-svg-container">
            ${renderSensitivityPlotSVG(state, res)}
          </div>
        </div>

      </div>

    </div>
  `;
}

function renderMetaStudyTableRow(s, idx, state) {
  const isIncluded = s.includedInPool !== false;
  const isBinary = state.outcomeType === 'binary';

  let rowEffectStr = '—';
  let weightStr = '—';
  if (state.results && state.results.studiesEvaluated) {
    const matched = state.results.studiesEvaluated.find(e => e.id === s.id || e.studyId === s.studyId);
    if (matched && matched.calc && matched.calc.valid) {
      rowEffectStr = `${matched.calc.effect.toFixed(2)} [${matched.calc.ciLow.toFixed(2)}, ${matched.calc.ciHigh.toFixed(2)}]`;
      weightStr = `${matched.weightPct.toFixed(1)}%`;
    }
  }

  return `
    <tr style="border-bottom:1px solid #e2e8f0;background:${isIncluded ? '#ffffff' : '#f8fafc'};opacity:${isIncluded ? '1' : '0.5'};">
      <td style="padding:8px 10px;text-align:center;">
        <input type="checkbox" ${isIncluded ? 'checked' : ''} onchange="toggleMetaStudyInclusion(${idx})" title="Toggle inclusion in meta-analysis pool"/>
      </td>
      <td style="padding:8px 10px;">
        <input type="text" value="${escapeXml(s.studyId)}" onchange="updateMetaStudyField(${idx}, 'studyId', this.value)" style="width:100%;border:none;background:transparent;font-weight:600;font-size:0.82rem;color:#0f172a;padding:2px 0;"/>
        ${s.fileName ? `<div style="font-size:0.70rem;color:#0f6b6b;display:flex;align-items:center;gap:3px;margin-top:2px;" title="Imported from PC"><span style="font-size:0.75rem">📄</span> ${escapeXml(s.fileName)}</div>` : ''}
      </td>
      <td style="padding:8px 10px;">
        <span style="display:inline-block;padding:2px 6px;border-radius:4px;background:#e2e8f0;font-size:0.74rem;color:#334155;">${escapeXml(s.design || 'Study')}</span>
      </td>
      ${isBinary ? `
        <td style="padding:4px 6px;text-align:center;">
          <input type="number" min="0" value="${s.e1}" onchange="updateMetaStudyField(${idx}, 'e1', this.value)" style="width:58px;padding:4px;border:1px solid #cbd5e1;border-radius:4px;text-align:center;font-size:0.82rem;"/>
        </td>
        <td style="padding:4px 6px;text-align:center;">
          <input type="number" min="1" value="${s.n1}" onchange="updateMetaStudyField(${idx}, 'n1', this.value)" style="width:58px;padding:4px;border:1px solid #cbd5e1;border-radius:4px;text-align:center;font-size:0.82rem;"/>
        </td>
        <td style="padding:4px 6px;text-align:center;">
          <input type="number" min="0" value="${s.e2}" onchange="updateMetaStudyField(${idx}, 'e2', this.value)" style="width:58px;padding:4px;border:1px solid #cbd5e1;border-radius:4px;text-align:center;font-size:0.82rem;"/>
        </td>
        <td style="padding:4px 6px;text-align:center;">
          <input type="number" min="1" value="${s.n2}" onchange="updateMetaStudyField(${idx}, 'n2', this.value)" style="width:58px;padding:4px;border:1px solid #cbd5e1;border-radius:4px;text-align:center;font-size:0.82rem;"/>
        </td>
      ` : `
        <td style="padding:4px 6px;text-align:center;">
          <input type="number" step="0.1" value="${s.m1}" onchange="updateMetaStudyField(${idx}, 'm1', this.value)" style="width:54px;padding:4px;border:1px solid #cbd5e1;border-radius:4px;text-align:center;font-size:0.82rem;"/>
        </td>
        <td style="padding:4px 6px;text-align:center;">
          <input type="number" step="0.1" min="0.01" value="${s.s1}" onchange="updateMetaStudyField(${idx}, 's1', this.value)" style="width:54px;padding:4px;border:1px solid #cbd5e1;border-radius:4px;text-align:center;font-size:0.82rem;"/>
        </td>
        <td style="padding:4px 6px;text-align:center;">
          <input type="number" min="2" value="${s.n1}" onchange="updateMetaStudyField(${idx}, 'n1', this.value)" style="width:54px;padding:4px;border:1px solid #cbd5e1;border-radius:4px;text-align:center;font-size:0.82rem;"/>
        </td>
        <td style="padding:4px 6px;text-align:center;">
          <input type="number" step="0.1" value="${s.m2}" onchange="updateMetaStudyField(${idx}, 'm2', this.value)" style="width:54px;padding:4px;border:1px solid #cbd5e1;border-radius:4px;text-align:center;font-size:0.82rem;"/>
        </td>
        <td style="padding:4px 6px;text-align:center;">
          <input type="number" step="0.1" min="0.01" value="${s.s2}" onchange="updateMetaStudyField(${idx}, 's2', this.value)" style="width:54px;padding:4px;border:1px solid #cbd5e1;border-radius:4px;text-align:center;font-size:0.82rem;"/>
        </td>
        <td style="padding:4px 6px;text-align:center;">
          <input type="number" min="2" value="${s.n2}" onchange="updateMetaStudyField(${idx}, 'n2', this.value)" style="width:54px;padding:4px;border:1px solid #cbd5e1;border-radius:4px;text-align:center;font-size:0.82rem;"/>
        </td>
      `}
      <td style="padding:8px 10px;text-align:center;font-family:monospace;font-size:0.78rem;">
        ${rowEffectStr}
      </td>
      <td style="padding:8px 10px;text-align:center;font-weight:600;color:#0f6b6b;">
        ${weightStr}
      </td>
      <td style="padding:8px 10px;text-align:center;">
        <button type="button" onclick="removeMetaStudyRow(${idx})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:0.9rem;" title="Remove study">🗑️</button>
      </td>
    </tr>
  `;
}

// ═══════════════════════════════════════════════════════════════
// USER INTERACTION EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════

function updateMetaOutcomeName(val) {
  META_ANALYSIS_STATE.outcomeName = val.trim() || 'Primary Outcome';
  refreshMetaAnalysisWorkspace();
}

function updateMetaOutcomeType(type) {
  META_ANALYSIS_STATE.outcomeType = type;
  if (type === 'binary') {
    META_ANALYSIS_STATE.effectMeasure = 'RR';
  } else {
    META_ANALYSIS_STATE.effectMeasure = 'MD';
  }
  refreshMetaAnalysisWorkspace();
}

function updateMetaMeasure(measure) {
  META_ANALYSIS_STATE.effectMeasure = measure;
  refreshMetaAnalysisWorkspace();
}

function updateMetaModel(model) {
  META_ANALYSIS_STATE.model = model;
  refreshMetaAnalysisWorkspace();
}

function updateMetaGroupLabel(group, val) {
  if (group === 'intervention') {
    META_ANALYSIS_STATE.interventionLabel = val.trim() || 'Intervention';
  } else {
    META_ANALYSIS_STATE.controlLabel = val.trim() || 'Control';
  }
  refreshMetaAnalysisWorkspace();
}

function updateMetaStudyField(idx, field, val) {
  if (!META_ANALYSIS_STATE.studies[idx]) return;
  META_ANALYSIS_STATE.studies[idx][field] = val;
  META_ANALYSIS_STATE.studies[idx].verified = true;
  refreshMetaAnalysisWorkspace();
}

function toggleMetaStudyInclusion(idx) {
  if (!META_ANALYSIS_STATE.studies[idx]) return;
  const current = META_ANALYSIS_STATE.studies[idx].includedInPool !== false;
  META_ANALYSIS_STATE.studies[idx].includedInPool = !current;
  refreshMetaAnalysisWorkspace();
}

// ═══════════════════════════════════════════════════════════════
// IMPORT STUDY DOCUMENT (PDF / DOC) WORKSPACE
// ═══════════════════════════════════════════════════════════════

let currentImportedStudyFile = null;

function renderImportDataFields(state, prefilled = {}) {
  const container = document.getElementById('meta-import-data-container');
  if (!container) return;

  const isBinary = state.outcomeType === 'binary';
  if (isBinary) {
    container.innerHTML = `
      <div style="font-weight:700;color:#1e293b;font-size:0.86rem;margin-bottom:8px;">
        Binary Outcome Counts: <span style="color:#0f6b6b;">${escapeXml(state.outcomeName)}</span> [${escapeXml(state.effectMeasure)}]
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div style="background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:10px;">
          <div style="font-weight:600;font-size:0.80rem;color:#0f6b6b;margin-bottom:6px;">
            Intervention: ${escapeXml(state.interventionLabel)}
          </div>
          <div style="display:flex;gap:8px;">
            <div style="flex:1;">
              <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:2px;">Events (e1)</label>
              <input type="number" id="meta-import-e1" min="0" value="${prefilled.e1 != null ? prefilled.e1 : 0}" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:0.85rem;box-sizing:border-box;">
            </div>
            <div style="flex:1;">
              <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:2px;">Total N (n1) *</label>
              <input type="number" id="meta-import-n1" min="1" value="${prefilled.n1 || 100}" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:0.85rem;box-sizing:border-box;">
            </div>
          </div>
        </div>
        <div style="background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:10px;">
          <div style="font-weight:600;font-size:0.80rem;color:#334155;margin-bottom:6px;">
            Control: ${escapeXml(state.controlLabel)}
          </div>
          <div style="display:flex;gap:8px;">
            <div style="flex:1;">
              <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:2px;">Events (e2)</label>
              <input type="number" id="meta-import-e2" min="0" value="${prefilled.e2 != null ? prefilled.e2 : 0}" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:0.85rem;box-sizing:border-box;">
            </div>
            <div style="flex:1;">
              <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:2px;">Total N (n2) *</label>
              <input type="number" id="meta-import-n2" min="1" value="${prefilled.n2 || 100}" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:0.85rem;box-sizing:border-box;">
            </div>
          </div>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div style="font-weight:700;color:#1e293b;font-size:0.86rem;margin-bottom:8px;">
        Continuous Outcome Values: <span style="color:#0f6b6b;">${escapeXml(state.outcomeName)}</span> [${escapeXml(state.effectMeasure)}]
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div style="background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:10px;">
          <div style="font-weight:600;font-size:0.80rem;color:#0f6b6b;margin-bottom:6px;">
            Intervention: ${escapeXml(state.interventionLabel)}
          </div>
          <div style="display:flex;gap:6px;">
            <div style="flex:1;">
              <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:2px;">Mean (m1)</label>
              <input type="number" step="0.1" id="meta-import-m1" value="${prefilled.m1 != null ? prefilled.m1 : 10.0}" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:4px;font-size:0.82rem;box-sizing:border-box;">
            </div>
            <div style="flex:1;">
              <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:2px;">SD (s1)</label>
              <input type="number" step="0.1" min="0.01" id="meta-import-s1" value="${prefilled.s1 != null ? prefilled.s1 : 2.5}" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:4px;font-size:0.82rem;box-sizing:border-box;">
            </div>
            <div style="flex:1;">
              <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:2px;">N (n1) *</label>
              <input type="number" min="2" id="meta-import-n1" value="${prefilled.n1 || 50}" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:4px;font-size:0.82rem;box-sizing:border-box;">
            </div>
          </div>
        </div>
        <div style="background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:10px;">
          <div style="font-weight:600;font-size:0.80rem;color:#334155;margin-bottom:6px;">
            Control: ${escapeXml(state.controlLabel)}
          </div>
          <div style="display:flex;gap:6px;">
            <div style="flex:1;">
              <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:2px;">Mean (m2)</label>
              <input type="number" step="0.1" id="meta-import-m2" value="${prefilled.m2 != null ? prefilled.m2 : 12.0}" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:4px;font-size:0.82rem;box-sizing:border-box;">
            </div>
            <div style="flex:1;">
              <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:2px;">SD (s2)</label>
              <input type="number" step="0.1" min="0.01" id="meta-import-s2" value="${prefilled.s2 != null ? prefilled.s2 : 2.8}" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:4px;font-size:0.82rem;box-sizing:border-box;">
            </div>
            <div style="flex:1;">
              <label style="display:block;font-size:0.75rem;color:#64748b;margin-bottom:2px;">N (n2) *</label>
              <input type="number" min="2" id="meta-import-n2" value="${prefilled.n2 || 50}" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:4px;font-size:0.82rem;box-sizing:border-box;">
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

function openImportStudyModal(prefilledData = null) {
  const modal = document.getElementById('meta-import-study-modal');
  if (!modal) return;

  currentImportedStudyFile = null;
  const msg = document.getElementById('meta-import-msg');
  if (msg) msg.style.display = 'none';

  const fileInput = document.getElementById('meta-study-file-input');
  if (fileInput) fileInput.value = '';

  const dropzoneContent = document.getElementById('meta-dropzone-content');
  if (dropzoneContent) {
    dropzoneContent.innerHTML = `
      <div style="font-size:2.2rem;margin-bottom:6px">📄</div>
      <div style="font-weight:700;color:#0f6b6b;font-size:0.95rem">Click to browse your PC for PDF or Word DOC</div>
      <div style="font-size:0.78rem;color:#64748b;margin-top:3px">Supports .pdf, .docx, .doc, and .txt empirical studies</div>
    `;
  }

  const studyIdInput = document.getElementById('meta-import-study-id');
  if (studyIdInput) studyIdInput.value = prefilledData ? prefilledData.studyId : '';

  renderImportDataFields(META_ANALYSIS_STATE, prefilledData || {});
  setupDropzoneEvents();

  modal.classList.remove('hidden');

  // If no prefilled data, automatically trigger the native file picker
  if (!prefilledData && fileInput) {
    setTimeout(() => {
      fileInput.click();
    }, 150);
  }
}

function openManualStudyModal() {
  const modal = document.getElementById('meta-import-study-modal');
  if (!modal) return;

  currentImportedStudyFile = null;
  const msg = document.getElementById('meta-import-msg');
  if (msg) msg.style.display = 'none';

  const dropzoneContent = document.getElementById('meta-dropzone-content');
  if (dropzoneContent) {
    dropzoneContent.innerHTML = `
      <div style="font-size:2.2rem;margin-bottom:6px">✍️</div>
      <div style="font-weight:700;color:#0f6b6b;font-size:0.95rem">Manual Study Entry (Or click to attach document)</div>
      <div style="font-size:0.78rem;color:#64748b;margin-top:3px">Enter the study citation and numerical outcome data below</div>
    `;
  }

  const studyIdInput = document.getElementById('meta-import-study-id');
  if (studyIdInput) {
    const nextIdx = META_ANALYSIS_STATE.studies.length + 1;
    studyIdInput.value = `Study ${nextIdx} (2024)`;
  }

  renderImportDataFields(META_ANALYSIS_STATE, {});
  setupDropzoneEvents();
  modal.classList.remove('hidden');
}

function closeImportStudyModal() {
  const modal = document.getElementById('meta-import-study-modal');
  if (modal) modal.classList.add('hidden');
  currentImportedStudyFile = null;
}

function triggerImportStudyFilePicker() {
  const fileInput = document.getElementById('meta-study-file-input');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
}

let dropzoneInitialized = false;
function setupDropzoneEvents() {
  const dropzone = document.getElementById('meta-file-dropzone');
  if (!dropzone || dropzoneInitialized) return;
  dropzoneInitialized = true;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.style.background = '#ccfbf1';
      dropzone.style.borderColor = '#0d9488';
    }, false);
  });
  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.style.background = '#f0fdfa';
      dropzone.style.borderColor = '#0f6b6b';
    }, false);
  });
  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      processSelectedStudyFile(files[0]);
    }
  }, false);
}

async function handleMetaStudyFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (file) {
    await processSelectedStudyFile(file);
  }
}

async function processSelectedStudyFile(file) {
  currentImportedStudyFile = file;

  const dropzoneContent = document.getElementById('meta-dropzone-content');
  if (dropzoneContent) {
    dropzoneContent.innerHTML = `
      <div style="font-size:2rem;margin-bottom:4px">📄</div>
      <div style="font-weight:700;color:#0f6b6b;font-size:0.95rem">${escapeXml(file.name)}</div>
      <div style="font-size:0.78rem;color:#15803d;margin-top:2px;font-weight:600">✔ Document Loaded from PC (${(file.size / 1024).toFixed(1)} KB) · Click to change</div>
    `;
  }

  // Parse filename for Citation ID: e.g. "Smith_et_al_2023_Trial.pdf" -> "Smith et al. (2023)"
  let base = file.name.replace(/\.(pdf|docx?|txt)$/i, '');
  base = base.replace(/[_\-+]+/g, ' ').trim();
  const yearM = base.match(/\b(19\d{2}|20\d{2})\b/);
  const yr = yearM ? yearM[1] : '';
  let authorPart = base.replace(/\b(19\d{2}|20\d{2})\b.*/, '').trim();
  if (!authorPart) authorPart = base;
  authorPart = authorPart.replace(/\b[a-z]/g, c => c.toUpperCase());
  let citation = yr ? `${authorPart} (${yr})` : `${authorPart} (2024)`;
  if (citation.length > 36) citation = citation.slice(0, 34);

  const studyIdInput = document.getElementById('meta-import-study-id');
  if (studyIdInput) studyIdInput.value = citation;

  showImportMessage(`Reading "${file.name}"...`, 'info');

  let extractedText = '';
  try {
    if (file.name.toLowerCase().endsWith('.pdf') && window.pdfjsLib) {
      if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
      const ab = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
      const maxPages = Math.min(pdf.numPages, 4);
      for (let p = 1; p <= maxPages; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        extractedText += tc.items.map(it => it.str).join(' ') + '\n';
      }
    } else if (file.name.toLowerCase().match(/\.docx?$/) && window.mammoth) {
      const ab = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: ab });
      extractedText = result.value || '';
    } else if (file.name.toLowerCase().endsWith('.txt')) {
      extractedText = await file.text();
    }
  } catch (err) {
    console.warn('Document text extraction notice:', err);
  }

  scanStudyDocumentText(extractedText, file.name);
}

function scanStudyDocumentText(text, filename) {
  if (!text || text.length < 20) {
    showImportMessage(`✔ Loaded "${filename}" from PC. Please review and enter numerical counts below.`, 'success');
    return;
  }

  // 1. Check study design
  const designSelect = document.getElementById('meta-import-design');
  if (designSelect) {
    if (/\b(randomized|randomised|rct|double-blind|placebo-controlled)\b/i.test(text) && !/\bnon-randomized/i.test(text)) {
      designSelect.value = 'Randomized controlled trials (RCTs)';
    } else if (/\b(non-randomized|non-randomised|quasi-experimental|controlled trial)\b/i.test(text)) {
      designSelect.value = 'Non-randomized controlled trials';
    } else if (/\b(cohort|prospective|retrospective)\b/i.test(text)) {
      designSelect.value = 'Cohort studies (prospective or retrospective)';
    } else if (/\b(case-control)\b/i.test(text)) {
      designSelect.value = 'Case-control studies';
    }
  }

  // 2. Scan for sample sizes and numbers
  let detectedN1 = null, detectedN2 = null, detectedE1 = null, detectedE2 = null;
  const nMatches = [...text.matchAll(/\b(?:n|N)\s*=\s*(\d{2,5})\b/g)];
  if (nMatches.length >= 2) {
    detectedN1 = parseInt(nMatches[0][1], 10);
    detectedN2 = parseInt(nMatches[1][1], 10);
  }

  const fracMatches = [...text.matchAll(/\b(\d{1,4})\s*\/\s*(\d{2,5})\b/g)];
  if (fracMatches.length >= 2) {
    detectedE1 = parseInt(fracMatches[0][1], 10);
    detectedN1 = parseInt(fracMatches[0][2], 10);
    detectedE2 = parseInt(fracMatches[1][1], 10);
    detectedN2 = parseInt(fracMatches[1][2], 10);
  }

  if (detectedN1 && document.getElementById('meta-import-n1')) document.getElementById('meta-import-n1').value = detectedN1;
  if (detectedN2 && document.getElementById('meta-import-n2')) document.getElementById('meta-import-n2').value = detectedN2;
  if (detectedE1 != null && document.getElementById('meta-import-e1')) document.getElementById('meta-import-e1').value = detectedE1;
  if (detectedE2 != null && document.getElementById('meta-import-e2')) document.getElementById('meta-import-e2').value = detectedE2;

  showImportMessage(`✔ Extracted study data from "${filename}". Please verify the extracted counts below.`, 'success');
}

function showImportMessage(text, type) {
  const msg = document.getElementById('meta-import-msg');
  if (!msg) return;
  msg.style.display = 'block';
  if (type === 'error') {
    msg.style.background = '#fef2f2';
    msg.style.color = '#991b1b';
    msg.style.border = '1px solid #fecaca';
  } else if (type === 'success') {
    msg.style.background = '#f0fdf4';
    msg.style.color = '#166534';
    msg.style.border = '1px solid #bbf7d0';
  } else {
    msg.style.background = '#f0fdfa';
    msg.style.color = '#0f6b6b';
    msg.style.border = '1px solid #99f6e4';
  }
  msg.textContent = text;
}

function confirmImportMetaStudy() {
  const studyIdInput = document.getElementById('meta-import-study-id');
  const studyId = (studyIdInput ? studyIdInput.value.trim() : '') || (currentImportedStudyFile ? currentImportedStudyFile.name.replace(/\.[^/.]+$/, '') : 'Imported Study');
  const designSelect = document.getElementById('meta-import-design');
  const design = designSelect ? designSelect.value : 'Randomized controlled trials (RCTs)';

  const isBinary = META_ANALYSIS_STATE.outcomeType === 'binary';
  let e1 = 0, n1 = 0, e2 = 0, n2 = 0;
  let m1 = 0, s1 = 0, m2 = 0, s2 = 0;

  if (isBinary) {
    const e1El = document.getElementById('meta-import-e1');
    const n1El = document.getElementById('meta-import-n1');
    const e2El = document.getElementById('meta-import-e2');
    const n2El = document.getElementById('meta-import-n2');

    e1 = Number(e1El ? e1El.value : 0);
    n1 = Number(n1El ? n1El.value : 0);
    e2 = Number(e2El ? e2El.value : 0);
    n2 = Number(n2El ? n2El.value : 0);

    if (n1 <= 0 || n2 <= 0) {
      showImportMessage('Total sample size (n1 and n2) must be greater than 0.', 'error');
      return;
    }
    if (e1 < 0 || e2 < 0 || e1 > n1 || e2 > n2) {
      showImportMessage('Event counts must be between 0 and total sample size.', 'error');
      return;
    }
  } else {
    const m1El = document.getElementById('meta-import-m1');
    const s1El = document.getElementById('meta-import-s1');
    const n1El = document.getElementById('meta-import-n1');
    const m2El = document.getElementById('meta-import-m2');
    const s2El = document.getElementById('meta-import-s2');
    const n2El = document.getElementById('meta-import-n2');

    m1 = Number(m1El ? m1El.value : 0);
    s1 = Number(s1El ? s1El.value : 0);
    n1 = Number(n1El ? n1El.value : 0);
    m2 = Number(m2El ? m2El.value : 0);
    s2 = Number(s2El ? s2El.value : 0);
    n2 = Number(n2El ? n2El.value : 0);

    if (n1 <= 1 || n2 <= 1) {
      showImportMessage('Sample sizes for continuous outcomes must be > 1 per arm.', 'error');
      return;
    }
    if (s1 <= 0 || s2 <= 0) {
      showImportMessage('Standard deviations (s1 and s2) must be > 0.', 'error');
      return;
    }
  }

  // Add verified study to state
  META_ANALYSIS_STATE.studies.push({
    id: `custom-pc-${Date.now()}`,
    studyId: studyId,
    design: design,
    e1: e1,
    n1: n1,
    e2: e2,
    n2: n2,
    m1: m1,
    s1: s1,
    m2: m2,
    s2: s2,
    fileName: currentImportedStudyFile ? currentImportedStudyFile.name : null,
    verified: true,
    includedInPool: true,
    isCustom: true
  });

  closeImportStudyModal();
  refreshMetaAnalysisWorkspace();
}

function addCustomMetaStudyRow() {
  openImportStudyModal();
}

function removeMetaStudyRow(idx) {
  if (confirm(`Remove study "${META_ANALYSIS_STATE.studies[idx].studyId}" from meta-analysis?`)) {
    META_ANALYSIS_STATE.studies.splice(idx, 1);
    refreshMetaAnalysisWorkspace();
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS: 300 DPI PNG, VECTOR SVG, CSV & STANDALONE PDF
// ═══════════════════════════════════════════════════════════════

/**
 * Generates meaningful, standardized filenames linked to review topic, outcome, and measure.
 */
function getGraphicFilename(prefix, ext) {
  const clean = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const topic = clean(META_ANALYSIS_STATE.reviewTopic).slice(0, 24) || 'review';
  const outcome = clean(META_ANALYSIS_STATE.outcomeName).slice(0, 24) || 'outcome';
  const measure = (META_ANALYSIS_STATE.effectMeasure || 'effect').toLowerCase();
  return `sysrevai-${prefix}-${measure}-${topic}-${outcome}.${ext}`;
}

/**
 * Export any SVG element directly to high-resolution 300 DPI PNG via 3x super-sampling.
 */
function exportSvgElementAsPNG(svgSelector, filename, scale = 3) {
  const svgEl = document.querySelector(svgSelector);
  if (!svgEl) {
    alert('No graphical figure found to export.');
    return;
  }

  const svgXml = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  img.onload = () => {
    const baseW = svgEl.viewBox?.baseVal?.width || 980;
    const baseH = svgEl.viewBox?.baseVal?.height || 520;
    const canvas = document.createElement('canvas');
    canvas.width = baseW * scale;
    canvas.height = baseH * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);

    const a = document.createElement('a');
    a.download = filename;
    a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

/**
 * Export any SVG element directly to pure XML Vector SVG file.
 */
function exportSvgElementAsSVG(svgSelector, filename) {
  const svgEl = document.querySelector(svgSelector);
  if (!svgEl) {
    alert('No graphical figure found to export.');
    return;
  }
  const svgXml = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Copy SVG markup directly to system clipboard.
 */
function copySvgElementToClipboard(svgSelector) {
  const svgEl = document.querySelector(svgSelector);
  if (!svgEl) return;
  const svgXml = new XMLSerializer().serializeToString(svgEl);
  navigator.clipboard.writeText(svgXml).then(() => {
    alert('Vector SVG markup successfully copied to clipboard!');
  }).catch(() => {
    prompt('Copy the SVG markup below:', svgXml);
  });
}

/**
 * Dynamic wrappers for the currently active graphic tab
 */
function downloadCurrentGraphicPNG(scale = 3) {
  const active = META_ANALYSIS_STATE.activeGraphic || 'forest';
  const selector = `#${active}-plot-svg-container svg`;
  const filename = getGraphicFilename(`${active}-plot-300dpi`, 'png');
  exportSvgElementAsPNG(selector, filename, scale);
}

function downloadCurrentGraphicSVG() {
  const active = META_ANALYSIS_STATE.activeGraphic || 'forest';
  const selector = `#${active}-plot-svg-container svg`;
  const filename = getGraphicFilename(`${active}-plot`, 'svg');
  exportSvgElementAsSVG(selector, filename);
}

function copyCurrentGraphicSVG() {
  const active = META_ANALYSIS_STATE.activeGraphic || 'forest';
  const selector = `#${active}-plot-svg-container svg`;
  copySvgElementToClipboard(selector);
}

// Standalone backwards compatibility aliases
function downloadForestPlotPNG(scale = 3) {
  exportSvgElementAsPNG('#forest-plot-svg-container svg', getGraphicFilename('forest-plot-300dpi', 'png'), scale);
}
function downloadForestPlotSVG() {
  exportSvgElementAsSVG('#forest-plot-svg-container svg', getGraphicFilename('forest-plot', 'svg'));
}
function copyForestPlotSVGToClipboard() {
  copySvgElementToClipboard('#forest-plot-svg-container svg');
}

/**
 * Exports comprehensive CSV report including study data, sensitivity runs, and pooled parameters.
 */
function exportMetaAnalysisCSV() {
  const state = META_ANALYSIS_STATE;
  const res = state.results;
  if (!res || !res.isValid) {
    alert('Cannot export CSV: meta-analysis has incomplete data or fewer than 2 valid studies.');
    return;
  }

  let csv = 'Study ID,Design,Included in Pool';
  if (state.outcomeType === 'binary') {
    csv += `,Exp Events (e1),Exp Total (n1),Ctrl Events (e2),Ctrl Total (n2),${state.effectMeasure},95% CI Lower,95% CI Upper,Weight (%)\n`;
    res.studiesEvaluated.forEach(s => {
      csv += `"${s.studyId}","${s.design}","${s.includedInPool !== false ? 'Yes' : 'No'}",${s.e1},${s.n1},${s.e2},${s.n2},${s.calc.effect.toFixed(4)},${s.calc.ciLow.toFixed(4)},${s.calc.ciHigh.toFixed(4)},${s.weightPct.toFixed(2)}\n`;
    });
  } else {
    csv += `,Exp Mean (m1),Exp SD (s1),Exp N (n1),Ctrl Mean (m2),Ctrl SD (s2),Ctrl N (n2),${state.effectMeasure},95% CI Lower,95% CI Upper,Weight (%)\n`;
    res.studiesEvaluated.forEach(s => {
      csv += `"${s.studyId}","${s.design}","${s.includedInPool !== false ? 'Yes' : 'No'}",${s.m1},${s.s1},${s.n1},${s.m2},${s.s2},${s.n2},${s.calc.effect.toFixed(4)},${s.calc.ciLow.toFixed(4)},${s.calc.ciHigh.toFixed(4)},${s.weightPct.toFixed(2)}\n`;
    });
  }

  csv += `\n"POOLED SYNTHESIS","${res.pooled.model === 'random' ? 'Random Effects (DL)' : 'Fixed Effect (IV)'}","All",,,,${res.pooled.pointEstimate.toFixed(4)},${res.pooled.ciLow.toFixed(4)},${res.pooled.ciHigh.toFixed(4)},100.00\n`;
  csv += `"HETEROGENEITY","I2: ${res.pooled.I2.toFixed(1)}%","Tau2: ${res.pooled.tau2.toFixed(4)}","Q: ${res.pooled.Q.toFixed(2)}","df: ${res.pooled.df}","P-value: ${res.pooled.pChi2.toFixed(4)}"\n`;
  csv += `"TEST FOR EFFECT","Z: ${res.pooled.zScore.toFixed(2)}","P-value: ${res.pooled.pValue.toFixed(4)}"\n`;

  const loo = executeLeaveOneOutAnalysis(state);
  if (loo && loo.length > 0) {
    csv += `\n"LEAVE-ONE-OUT SENSITIVITY ANALYSIS","Omitted Study","Design","Pooled Effect [95% CI]","Residual I2 (%)","Residual P-value"\n`;
    loo.forEach(r => {
      csv += `,"${r.omittedStudyId}","${r.design}","${r.pooled.pointEstimate.toFixed(4)} [${r.pooled.ciLow.toFixed(4)}, ${r.pooled.ciHigh.toFixed(4)}]","${r.pooled.I2.toFixed(1)}%","${r.pooled.pValue.toFixed(4)}"\n`;
    });
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = getGraphicFilename('dataset', 'csv');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Generates a standalone, publication-grade Meta-Analysis PDF report via jsPDF.
 */
function exportMetaAnalysisPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('jsPDF library is not loaded. Please ensure internet access or try refreshing.');
    return;
  }
  const state = META_ANALYSIS_STATE;
  const res = state.results;
  if (!res || !res.isValid || !res.pooled) {
    alert('Please ensure at least 2 valid studies are pooled before exporting PDF.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const active = META_ANALYSIS_STATE.activeGraphic || 'forest';
  const svgEl = document.querySelector(`#${active}-plot-svg-container svg`) || document.querySelector('#forest-plot-svg-container svg');
  if (!svgEl) return;

  const svgXml = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 980 * 2;
    canvas.height = (svgEl.viewBox?.baseVal?.height || 520) * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);

    const imgData = canvas.toDataURL('image/png');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 107, 107);
    doc.text('SysRevAI — Quantitative Synthesis & Meta-Analysis Report', 14, 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Review Topic: ${state.reviewTopic || 'Systematic Review'} | Outcome: ${state.outcomeName} | Generated: ${new Date().toLocaleDateString()}`, 14, 20);

    const imgWidth = 269;
    const imgHeight = (canvas.height / canvas.width) * imgWidth;
    doc.addImage(imgData, 'PNG', 14, 24, imgWidth, Math.min(160, imgHeight));

    doc.save(getGraphicFilename('report', 'pdf'));
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Attach to window for global access
window.META_ANALYSIS_STATE = META_ANALYSIS_STATE;
window.initiateMetaAnalysis = initiateMetaAnalysis;
window.resetMetaAnalysis = resetMetaAnalysis;
window.closeMetaAnalysisWorkspace = closeMetaAnalysisWorkspace;
window.refreshMetaAnalysisWorkspace = refreshMetaAnalysisWorkspace;
window.switchMetaGraphicTab = switchMetaGraphicTab;
window.renderMetaAnalysisInitialBanner = renderMetaAnalysisInitialBanner;
window.renderMetaAnalysisActiveWorkspace = renderMetaAnalysisActiveWorkspace;
window.renderForestPlotSVG = renderForestPlotSVG;
window.renderFunnelPlotSVG = renderFunnelPlotSVG;
window.renderSensitivityPlotSVG = renderSensitivityPlotSVG;
window.updateMetaOutcomeName = updateMetaOutcomeName;
window.updateMetaOutcomeType = updateMetaOutcomeType;
window.updateMetaMeasure = updateMetaMeasure;
window.updateMetaModel = updateMetaModel;
window.updateMetaGroupLabel = updateMetaGroupLabel;
window.updateMetaStudyField = updateMetaStudyField;
window.toggleMetaStudyInclusion = toggleMetaStudyInclusion;
window.openImportStudyModal = openImportStudyModal;
window.openManualStudyModal = openManualStudyModal;
window.closeImportStudyModal = closeImportStudyModal;
window.triggerImportStudyFilePicker = triggerImportStudyFilePicker;
window.handleMetaStudyFileSelected = handleMetaStudyFileSelected;
window.confirmImportMetaStudy = confirmImportMetaStudy;
window.addCustomMetaStudyRow = addCustomMetaStudyRow;
window.removeMetaStudyRow = removeMetaStudyRow;
window.downloadCurrentGraphicPNG = downloadCurrentGraphicPNG;
window.downloadCurrentGraphicSVG = downloadCurrentGraphicSVG;
window.copyCurrentGraphicSVG = copyCurrentGraphicSVG;
window.downloadForestPlotPNG = downloadForestPlotPNG;
window.downloadForestPlotSVG = downloadForestPlotSVG;
window.copyForestPlotSVGToClipboard = copyForestPlotSVGToClipboard;
window.exportMetaAnalysisCSV = exportMetaAnalysisCSV;
window.exportMetaAnalysisPDF = exportMetaAnalysisPDF;
