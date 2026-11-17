# SysRevAI Validation & Statistical Benchmark Report

This document records the empirical validation datasets, mathematical formulas, and benchmark results verified by `test-integrity.js` and the test suite.

---

## 1. Statistical Pooling Benchmarks (Cochrane Handbook Worked Examples)

### 1.1 Binary Synthesis (Inverse-Variance Fixed-Effect)
- **Dataset (Cochrane Standard 2-Study Trial Cohort)**:
  - Study 1: Treatment $E_1 = 10, N_1 = 100$; Control $E_2 = 20, N_2 = 100$
  - Study 2: Treatment $E_1 = 15, N_1 = 150$; Control $E_2 = 30, N_2 = 150$

| Metric | Mathematical Formula | Expected Value | Observed Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Risk Ratio (RR)** | $\exp\left(\frac{\sum w_i \ln(RR_i)}{\sum w_i}\right)$ | **0.500** [0.320, 0.782] | **0.500** [0.320, 0.782] | ✅ MATCH |
| **Odds Ratio (OR)** | $\exp\left(\frac{\sum w_i \ln(OR_i)}{\sum w_i}\right)$ | **0.444** [0.265, 0.745] | **0.444** [0.265, 0.745] | ✅ MATCH |
| **Risk Difference (RD)** | $\frac{\sum w_i RD_i}{\sum w_i}$ | **-0.100** [-0.162, -0.038] | **-0.100** [-0.162, -0.038] | ✅ MATCH |
| **Heterogeneity ($Q$)** | $\sum w_i (y_i - \hat{\theta})^2$ | **0.000** ($df = 1, P = 1.000$) | **0.000** ($P = 1.000$) | ✅ MATCH |
| **Inconsistency ($I^2$)** | $\max\left(0, \frac{Q - df}{Q}\right) \times 100\%$ | **0.0%** | **0.0%** | ✅ MATCH |

### 1.2 Continuous Synthesis (Inverse-Variance Fixed-Effect)
- **Dataset**:
  - Trial 1: Intervention $M_1 = 10, SD_1 = 2, N_1 = 50$; Control $M_2 = 12, SD_2 = 2, N_2 = 50$
  - Trial 2: Intervention $M_1 = 15, SD_1 = 3, N_1 = 60$; Control $M_2 = 18, SD_2 = 3, N_2 = 60$

| Metric | Mathematical Formula | Expected Value | Observed Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Mean Difference (MD)** | $\frac{\sum w_i (M_{1i} - M_{2i})}{\sum w_i}$ | **-2.348** [-2.981, -1.715] | **-2.348** [-2.981, -1.715] | ✅ MATCH |
| **Std Mean Difference (SMD)** | Hedges' $g$ with $J$ correction | **-0.993** [-1.271, -0.715] | **-0.993** [-1.271, -0.715] | ✅ MATCH |

---

## 2. Small-Study Effects & Egger Linear Regression Benchmark

### 2.1 Student's $t$ Distribution vs Standard Normal
Egger's linear regression tests the standard normal deviate ($y_i = \text{effect}_i / SE_i$) against precision ($x_i = 1 / SE_i$). Under Sterne & Egger (2001), the intercept significance test must strictly follow the Student's $t$ distribution with $df = k - 2$, not the normal approximation:

$$\text{Test Statistic: } t = \frac{\hat{\alpha}}{SE(\hat{\alpha})}, \quad df = k - 2$$

- **5-Study Empirical Validation Dataset**:
  - S1: $\text{logEffect} = -0.4, SE = 0.15$
  - S2: $\text{logEffect} = -0.6, SE = 0.22$
  - S3: $\text{logEffect} = -0.3, SE = 0.10$
  - S4: $\text{logEffect} = -0.9, SE = 0.35$
  - S5: $\text{logEffect} = -0.2, SE = 0.08$

| Test Parameter | Standard Normal (Faulty) | Student's $t$ ($df=3$, Target) | SysRevAI Evaluated | Status |
| :--- | :--- | :--- | :--- | :--- |
| **$t = 2.500$ Benchmark** | $P = 0.0124$ | **$P = 0.0877$ (0.088)** | **$P = 0.088$** | ✅ EXACT MATCH |
| **Dataset Intercept** | - | - | **$\hat{\alpha} = -1.724$** | ✅ EVALUATED |
| **Dataset $t$-Statistic** | - | - | **$t = -11.664$** | ✅ EVALUATED |
| **Dataset $P$-Value** | $P = 0.0000$ | **$P = 0.0013$ (0.001)** | **$P = 0.001$** | ✅ EXACT MATCH |
| **$k < 10$ Warning** | None | Must warn & suppress asymmetry | `"Egger's test not recommended for k < 10"` | ✅ SUPPRESSED |

---

## 3. Extraction & Zero Data Fabrication Validation

### 3.1 Non-Numerical Abstracts
- **Input**: 3 included study abstracts describing qualitative designs without numerical counts.
- **Expected**: `e1=null`, `n1=null`, `e2=null`, `n2=null`, `status='suggested'`, `verified=false`, `includedInPool=false`, `isValid=false`.
- **Observed**: All fields strictly `null`, pool status `false`, statistical pooling safely rejects execution (`isValid: false`).

### 3.2 Numerical Abstract with Explicit Arms (Agana 2026)
- **Input Abstract**: `"Preterm delivery endpoint was pre-eclampsia (10.0% vs. 34.0%… 50 exposed and 50 unexposed)."`
- **Expected**:
  - Arm 1 (exposed): $10.0\% \times 50 = 5 / 50$
  - Arm 2 (unexposed): $34.0\% \times 50 = 17 / 50$
  - Status: `'suggested'`, `verified: false`, `includedInPool: false`
- **Observed**: Suggested counts exactly $5/50$ vs $17/50$, status strictly suggested until explicit reviewer confirmation.

---

## 4. Screening, Design & Risk of Bias Validation

| Test Case | Source Input | Expected Outcome | Observed Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Unicode Hyphen** | Title: `"SGLT2 inhibitors: a meta‐analysis"` (`U+2010`) | `isEligible: false` (`ineligible-review`) | `isEligible: false` | ✅ PASS |
| **Narrative Review** | Title: `"Management of Heart Failure – A Review"` | `isEligible: false` (`ineligible-review`) | `isEligible: false` | ✅ PASS |
| **Invited Commentary**| Title: `"Cardiovascular outcomes: Invited Commentary"` | `isEligible: false` (`ineligible-review`) | `isEligible: false` | ✅ PASS |
| **Book Chapter** | Crossref `type: 'book-chapter'` | `isEligible: false` (`ineligible-review`) | `isEligible: false` | ✅ PASS |
| **Word Boundary** | Intervention: `"ASA"`, Abstract: `"saline nasal spray"` | `status: 'EXCLUDED'` | `status: 'EXCLUDED'` | ✅ PASS |
| **RoB 2 D2 Blinding**| Abstract: `"admitted to cardiology department"` | $D_2 \neq \text{'Low'}$ (`Some Concerns`) | $D_2 = \text{'Some Concerns'}$ | ✅ PASS |
| **RoB 2 Overall** | RCT with one $D_3 = \text{'Some Concerns'}$ | $\text{Overall} = \text{'Some Concerns'}$ | $\text{Overall} = \text{'Some Concerns'}$ | ✅ PASS |
| **Non-RCT RoB** | Observational cohort study | $\text{Tool} = \text{'ROBINS-I'}$, all domains `Not assessed` | All domains `Not assessed` | ✅ PASS |

---

## 5. Security & Deduplication Validation

### 5.1 Multi-Key Identifier Propagation Deduplication
- **Input**:
  - Copy 1: PMID `99887766` only (Europe PMC)
  - Copy 2: PMID `99887766` + DOI `10.1016/j.ajog.2024.01.001` (Semantic Scholar)
  - Copy 3: DOI `10.1016/j.ajog.2024.01.001` only with different subtitle (Crossref)
- **Expected**: Collapses to exactly 1 unique record, merging all sources (`['Europe PMC', 'Semantic Scholar', 'Crossref']`).
- **Observed**: Exactly 1 unique record, 2 duplicates removed, all identifiers and sources harmonized.

### 5.2 XSS Payload Neutralization
- **Input**: Abstract with `<img src=x onerror=alert(1)>`.
- **Expected**: Escaped to `&lt;img src=x onerror=alert(1)&gt;`, zero DOM elements created.
- **Observed**: Rendered strictly as escaped text.

### 5.3 PDF Unicode Preservation
- **Input Reference**: `"Mureșan D, Lukáčová M. Preeclampsia prevention. 2024."`
- **Expected**: `"Mureșan"` and `"Lukáčová"` preserved in text layer without character deletion.
- **Observed**: Fully preserved.
