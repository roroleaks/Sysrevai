# 🔬 Sysrevai — AI-Assisted Systematic Review & Meta-Analysis Platform

<div align="center">

<p align="center">
  <img src="icon.jpg" alt="SysRevAI Platform Icon" width="160" style="border-radius:24px;box-shadow:0 8px 30px rgba(15,107,107,.35);border:2px solid rgba(255,255,255,.3)"/>
</p>

[![Live Production Deployment](https://img.shields.io/badge/Live_Deployment-sysrevai.vercel.app-0f6b6b?style=for-the-badge&logo=vercel&logoColor=white)](https://sysrevai.vercel.app)
[![GitHub Repository](https://img.shields.io/badge/GitHub-roroleaks%2FSysrevai-0a4a4a?style=for-the-badge&logo=github&logoColor=white)](https://github.com/roroleaks/Sysrevai)
[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg?style=for-the-badge)](LICENSE)

<br/>

[![PRISMA 2020 Aligned](https://img.shields.io/badge/Standard-PRISMA%202020%20Aligned-0f6b6b?style=flat-square&logo=academia)](http://www.prisma-statement.org/)
[![Preliminary RoB Screen](https://img.shields.io/badge/Quality-Preliminary%20RoB%20Screen-15803d?style=flat-square)](https://www.cochrane.org/)
[![Mandatory Sources](https://img.shields.io/badge/Sources-PubMed%20%C2%B7%20Cochrane%20%C2%B7%20Google%20Scholar%20%C2%B7%20CT.gov%20%C2%B7%20EPMC%20%C2%B7%20S2%20%C2%B7%20OpenAlex%20%C2%B7%20Crossref-blue?style=flat-square)](#step-2-mandatory-multi-source-retrieval--entity-resolution)
[![Citation Styles](https://img.shields.io/badge/Citations-Vancouver%20%7C%20APA%20%7C%20Harvard-1d4ed8?style=flat-square)](https://www.nlm.nih.gov/bsd/uniform_requirements.html)
[![Meta-Analysis](https://img.shields.io/badge/Meta--Analysis-Binary%20%26%20Continuous%20Pooling-7c3aed?style=flat-square)](#step-5-quantitative-synthesis--meta-analysis-engine)
[![Author](https://img.shields.io/badge/Author-Dr.%20Raouf%20Roshdy-0a4a4a?style=flat-square)](#-author--attribution)

<p align="center">
  <strong>From Structured Clinical Question (PICOS) to Evidence Synthesis Workspace</strong><br/>
  <em>An automated, high-throughput evidence synthesis platform engineered to assist clinicians, medical researchers, and review methodologists. Features PRISMA 2020 aligned structuring, preliminary Risk of Bias heuristics, tri-modal citation formatting (Vancouver, APA 7th, Harvard), and rigorous statistical meta-analysis pooling (Inverse-Variance, DerSimonian-Laird, REML, and Hartung-Knapp-Sidik-Jonkman).</em>
</p>

[**🚀 Explore Live App**](https://sysrevai.vercel.app) • [**📋 PRISMA 2020 Statement**](http://www.prisma-statement.org/) • [**🐛 Report an Issue**](https://github.com/roroleaks/Sysrevai/issues)

</div>

---

## ⚠️ Limitations and Intended Use

> [!IMPORTANT]
> **SysRevAI is an assistive software tool designed to support — not replace — a qualified human review team.** Systematic evidence synthesis requires expert human judgment, dual-reviewer screening, full-text appraisal, and clinical contextualization:
>
> 1. **Automated Triage, Not Definitive Screening**: Title/abstract screening is an automated preliminary filter based on protocol keywords. PRISMA 2020 and Cochrane standards require that full-text reports be assessed independently by at least two human reviewers.
> 2. **Preliminary RoB Screening Only**: Risk of bias domain ratings generated from abstract text are heuristic screening indicators, not validated RoB 2 or ROBINS-I assessments. Formal quality appraisal requires thorough manual evaluation of trial protocols, statistical analysis plans, and full publications.
> 3. **Zero Fabrication & Verification Mandatory**: The platform never fabricates or imputes numbers. Extracted event counts and sample sizes are exploratory suggestions that require explicit human verification against primary trial tables before entering the statistical pooling cohort.
> 4. **Working Draft Manuscript**: Synthesized manuscripts and PRISMA checklists are initial structural drafts. They do not issue clinical practice recommendations and must be critically examined, edited, and approved by the review team prior to publication or clinical application.

---

## 📑 Table of Contents
1. [Limitations and Intended Use](#-limitations-and-intended-use)
2. [Why Sysrevai? Paradigm Shift in Evidence Synthesis](#-why-sysrevai-paradigm-shift-in-evidence-synthesis)
3. [End-to-End 5-Step Pipeline Architecture](#-end-to-end-5-step-pipeline-architecture)
4. [System Workflow Diagrams](#-system-workflow-diagrams)
   - [High-Level 5-Step Pipeline Flow](#1-high-level-5-step-pipeline-flow)
   - [Dual Harvesting & Cross-Database Deduplication Sequence](#2-dual-harvesting--cross-database-deduplication-sequence)
   - [PRISMA 2020 Screening & Decision State Machine](#3-prisma-2020-screening--decision-state-machine)
   - [Quantitative Meta-Analysis Pooling & Forest Plot Engine](#4-quantitative-meta-analysis-pooling--forest-plot-engine)
5. [Deep Dive into Pipeline Stages](#-deep-dive-into-pipeline-stages)
   - [Step 1: PICOS & Eligibility Criteria Configuration](#step-1-picos--eligibility-criteria-configuration)
   - [Step 2: Mandatory Multi-Source Retrieval & Entity Resolution](#step-2-mandatory-multi-source-retrieval--entity-resolution)
   - [Step 3: PRISMA Screening & Preliminary RoB](#step-3-prisma-screening--cochrane-rob-2)
   - [Step 4: Systematic Review Manuscript Synthesis](#step-4-systematic-review-manuscript-synthesis)
   - [Step 5: Quantitative Synthesis & Meta-Analysis Engine](#step-5-quantitative-synthesis--meta-analysis-engine)
6. [Triple Citation Engine & Citation Verification](#-triple-citation-engine--parity-guarantee)
7. [Interactive PRISMA 2020 Flow Diagram Generator](#-interactive-prisma-2020-flow-diagram-generator)
8. [Medical & Scientific AI Advisory Compliance](#-medical--scientific-ai-advisory-compliance)
9. [PRISMA 2020 27-Item Compliance Matrix](#-prisma-2020-27-item-compliance-matrix)
10. [Quick Start & Installation](#-quick-start--installation)
11. [Technology Stack](#-technology-stack)
12. [Author & Attribution](#-author--attribution)
13. [License & Disclaimer](#-license--disclaimer)

---

## 💡 Why Sysrevai? Paradigm Shift in Evidence Synthesis

Traditional conversational AI tools output unstructured narrative summaries or opinion commentaries that violate evidence-based medicine standards. They hallucinate citations, fail to document identification counts, ignore pre-specified criteria, and cannot synthesize statistical effect sizes.

**Sysrevai** introduces a deterministic, reproducible, transparent pipeline designed specifically for systematic review methodology:

| Methodology Dimension | Standard AI Literature Bots | Narrative AI Summarizers | 🔬 **Sysrevai Platform** |
| :--- | :--- | :--- | :--- |
| **Protocol Framework** | Unstructured prompt | Free-form summary | **Structured 5-Point PICOS Protocol** |
| **Eligible Study Types** | Unfiltered / mixed | Variable | **Strict Restriction to 9 Empirical Designs** |
| **Search Infrastructure** | Single API / black box | Web search scraping | **10 mandatory sources: PubMed, Google Scholar (SerpApi), Cochrane CDSR + CENTRAL, ClinicalTrials.gov, Europe PMC (+ preprints), Semantic Scholar, OpenAlex, Crossref** |
| **Entity Resolution** | Incomplete / duplicates | None | **Union-find clustering with conflict guard, study-level linking & audit log — no paper shown twice** |
| **Screening Transparency** | Unverifiable | Opaque | **PRISMA 2020 Interactive Funnel with Rationale** |
| **Quality Assessment** | Omitted | Subjective ranking | **Automated Preliminary RoB Screening Matrix** |
| **Data Extraction** | Vague text snippets | Manual copying | **Automated Characteristics Table (Table 1)** |
| **Citation Formatting** | Bracketed numbers `[1]` | Static links | **Vancouver (Superscript), APA 7th, Harvard** |
| **Citation Parity** | Frequent discrepancies | Loose parity | **Automated Citation-to-Reference Verification** |
| **Quantitative Pooling** | Unsupported | Unsupported | **Meta-Analysis: Binary (RR/OR/RD) & Continuous (MD/SMD)** |
| **Forest & Funnel Plots** | Unsupported | Unsupported | **Vector SVG + High-Res PNG + Leave-One-Out Plots** |
| **Academic Exports** | Raw text / Markdown | Basic document | **Word-Compatible HTML + PDF + CSV + SVG** |

---

## 🗺️ End-to-End 5-Step Pipeline Architecture

The platform is organized into five tightly coupled, transparent stages:

```
[ Step 1: PICOS & Eligibility ] ➔ [ Step 2: Mandatory Multi-Source Retrieval ] ➔ [ Step 3: PRISMA Screening & RoB ] ➔ [ Step 4: Manuscript Synthesis ] ➔ [ Step 5: Meta-Analysis ]
```

1. **Step 1 · PICOS & Eligibility Criteria**: Define clinical question, decompose into structured PICOS (Population, Intervention, Comparator, Outcomes, Study Design), set pre-specified inclusion/exclusion rules, and construct boolean search queries.
2. **Step 2 · Mandatory Multi-Source Retrieval**: One shared search strategy is translated into each source's native syntax and run against all 10 mandatory sources concurrently. Every source reports only its own records and status (no cross-source substitution); records are clustered so that each study appears exactly once, with a badge for every source that found it.
3. **Step 3 · PRISMA Screening & RoB**: Screen literature against protocol rules, classify into Included / Excluded / Borderline with explicit reasons, evaluate 5 Cochrane RoB domains, and generate dynamic PRISMA 2020 flow diagrams.
4. **Step 4 · Systematic Review Manuscript**: Synthesize an IMRaD systematic review manuscript adhering to PRISMA 2020, generate Table 1 of study characteristics, support instant switching between Vancouver, APA 7th, and Harvard citations, and export publication PDFs.
5. **Step 5 · Meta-Analysis (Quantitative Synthesis)**: User-initiated statistical pooling for binary (Relative Risk, Odds Ratio, Risk Difference) and continuous outcomes (Mean Difference, Hedges' g Standardized Mean Difference), heterogeneity profiling ($I^2$, $\tau^2$, Cochran's $Q$), custom PDF/DOCX paper ingestion, Forest Plots, Funnel Plots, and Leave-One-Out sensitivity analysis.

---

## 📊 System Workflow Diagrams

### 1. High-Level 5-Step Pipeline Flow

```mermaid
flowchart TD
    subgraph S1["Step 1: PICOS & Protocol Configuration"]
        A1["Clinical Research Question"] --> A2["5-Point PICOS Decomposition<br/>(P, I, C, O, S)"]
        A2 --> A3["Pre-Specified Eligibility Rules<br/>• 9 Empirical Study Types<br/>• Exclusion of Narrative Reviews/In-Vitro"]
        A3 --> A4["Search Query Builder<br/>• Year Range Filter (1-20y / All)<br/>• Boolean Mesh & Keyword Query"]
    end

    subgraph S2["Step 2: Mandatory Multi-Source Retrieval & Deduplication"]
        B0["Shared search strategy<br/>→ per-source translation"] --> B1["Databases<br/>PubMed · Europe PMC · Preprints · Cochrane CDSR<br/>Cochrane CENTRAL (RIS import) · S2 · OpenAlex · Crossref"]
        B0 --> B2["Register<br/>ClinicalTrials.gov"] & B5["Other methods<br/>Google Scholar (SerpApi)"]
        B1 & B2 & B5 --> B3["addRecordsToPool → union-find clustering<br/>• PMID / PMCID / DOI / OpenAlex / S2 / Scholar / CD number<br/>• exact & fuzzy title (+ year, first author)<br/>• conflict guard · study-level linking"]
        B3 --> B4["One record per study + audit log<br/>(identified = unique + removed)"]
    end

    subgraph S3["Step 3: Screening, PRISMA 2020 & Cochrane RoB"]
        C1["Algorithmic Title/Abstract Screening<br/>• INCLUDED (Meets all PICOS)<br/>• EXCLUDED (Explicit Reason Logged)<br/>• BORDERLINE (Needs Full Text)"] --> C2["Cochrane RoB 2 Quality Appraisal<br/>• D1: Randomization / Selection<br/>• D2: Deviations / Allocation<br/>• D3: Incomplete Outcome Data<br/>• D4: Measurement of Outcome<br/>• D5: Selective Reporting"]
        C2 --> C3["Human-in-the-Loop Override<br/>• One-Click Re-classification<br/>• Real-Time PRISMA Recalculation"]
    end

    subgraph S4["Step 4: Systematic Review Manuscript"]
        D1["Structured IMRaD Manuscript<br/>• 6-Part Structured Abstract<br/>• Methods, PRISMA Flow Narrative<br/>• Table 1: Characteristics of Included Studies<br/>• Cochrane RoB Traffic-Light Matrix"] --> D2["Tri-Modal Citation Engine<br/>• Vancouver (Superscript no brackets)<br/>• APA 7th (Author, Year & DOI)<br/>• Harvard (Author Year & Quoted Titles)<br/>• 100% In-Text to Bibliography Parity"]
        D2 --> D3["Triple Academic PDF Exports<br/>• Full Systematic Review PDF<br/>• PRISMA 2020 Flow & Audit PDF<br/>• Formatted References PDF"]
    end

    subgraph S5["Step 5: Meta-Analysis Engine (Quantitative Synthesis)"]
        E1["User-Initiated Extension<br/>• Binary: RR, OR, RD<br/>• Continuous: MD, SMD (Hedges' g)<br/>• Custom PC Study Upload (PDF/DOCX)"] --> E2["Statistical Pooling Models<br/>• Inverse-Variance Fixed-Effect<br/>• DerSimonian-Laird Random-Effects<br/>• Heterogeneity: Q, I², Tau²<br/>• Zero-Event Continuity Corrections"]
        E2 --> E3["Publication Graphics & Exports<br/>• Interactive Vector Forest Plot SVG/PNG<br/>• Publication Bias Funnel Plot SVG/PNG<br/>• Leave-One-Out Sensitivity Analysis<br/>• Meta-Analysis PDF & CSV Dataset"]
    end

    S1 --> S2 --> S3 --> S4
    S4 -->|Optional Quantitative Stage| S5
```

---

### 2. Dual Harvesting & Cross-Database Deduplication Sequence

```mermaid
sequenceDiagram
    autonumber
    actor User as Clinician / Researcher
    participant UI as SysRev UI Controller
    participant REG as SOURCE_REGISTRY (sources.js)
    participant API as /api/* proxies & Europe PMC
    participant POOL as addRecordsToPool (dedup.js)
    participant STORE as Pipeline State Manager

    User->>UI: Input Topic, PICOS, optional CENTRAL RIS export
    UI->>REG: buildSearchStrategy() — one shared strategy
    par All 10 mandatory sources (Promise.allSettled)
        REG->>API: PubMed esearch+efetch · CDSR journal filter · CT.gov v2
        REG->>API: Europe PMC (MED/PMC) · Europe PMC SRC:PPR · S2 · OpenAlex · Crossref
        REG->>API: Google Scholar via SerpApi (+ Crossref/EPMC enrichment)
    end
    API-->>REG: Records + hitCount, or failed / not_configured / not_searched
    REG-->>STORE: searchLog[] (exact query, endpoint, timestamp, hits, retrieved)
    REG->>POOL: Raw records per source (replace = idempotent)
    POOL->>POOL: Union-find on identifiers & titles with conflict guard
    POOL->>POOL: Link preprints, registrations, errata/retractions, Cochrane versions
    POOL-->>STORE: Unique pool + dedupLog[] + invariant check
    STORE-->>UI: Live source board, PRISMA (Template B), Duplicates panel
    UI-->>User: Transition to Step 3: Screening & Quality Appraisal
```

---

### 3. PRISMA 2020 Screening & Decision State Machine

```mermaid
stateDiagram-v2
    [*] --> Identification: Records harvested from all mandatory sources

    state Identification {
        RawPool: Total Raw Records Identified
        Deduplication: Cluster identifiers & titles, link related reports
        RawPool --> Deduplication
    }

    Deduplication --> Screening: Unique Records Retained

    state Screening {
        FilterDesign: Check Against 9 Eligible Study Designs
        FilterExclusions: Screen for Animal, Review, In-Vitro
        FilterPICOS: Evaluate Population, Intervention, Outcomes
        FilterDesign --> FilterExclusions
        FilterExclusions --> FilterPICOS
    }

    state Decision <<choice>>
    FilterPICOS --> Decision

    Decision --> Excluded: Violates Criteria (Reason Tagged)
    Decision --> Borderline: Unclear Abstract / Partial Data
    Decision --> Included: Meets Full PICOS Eligibility

    state HumanReview {
        Borderline --> ManualInspection: Clinician Review
        ManualInspection --> Included: Overridden by Clinician
        ManualInspection --> Excluded: Excluded with Clinician Reason
    }

    Excluded --> PRISMAExclusionLog: Logged in Flow Diagram
    Included --> RoBAppraisal: Evaluate 5 Cochrane Domains

    state RoBAppraisal {
        D1: Randomization Process
        D2: Deviations from Interventions
        D3: Missing Outcome Data
        D4: Measurement of the Outcome
        D5: Selection of Reported Results
    }

    RoBAppraisal --> SynthesisPool: Ready for Step 4 & Step 5
```

---

### 4. Quantitative Meta-Analysis Pooling & Forest Plot Engine

```mermaid
flowchart LR
    subgraph DataIngestion["Study Ingestion & Validation"]
        F1["Step 3 Included Studies<br/>(Automated Parameter Extraction)"]
        F2["Custom Study Import<br/>(Upload PDF / Word DOCX from PC)"]
        F1 & F2 --> F3["Outcome Parameter Inspector<br/>• Binary: Events / Total (Intervention & Control)<br/>• Continuous: N, Mean, SD (Intervention & Control)"]
    end

    subgraph StatisticalCore["Statistical Modeling"]
        F3 --> F4{Select Outcome Type}
        F4 -->|Binary| G1["Compute Effect Size<br/>• Relative Risk (RR)<br/>• Odds Ratio (OR)<br/>• Risk Difference (RD)"]
        F4 -->|Continuous| G2["Compute Effect Size<br/>• Mean Difference (MD)<br/>• Hedges' g (SMD)"]
        G1 & G2 --> H1["Heterogeneity Analysis<br/>• Cochran's Q (p-value)<br/>• Higgins I² (%)<br/>• Between-study Tau² (DL)"]
        H1 --> H2["Pooling Models<br/>• Fixed-Effect (Inverse Variance / MH)<br/>• Random-Effects (DerSimonian-Laird)"]
        H2 --> H3["Continuity Correction<br/>• 0.5 Adjustment on Zero-Cell Frequencies"]
    end

    subgraph VisualSuite["Vector Graphics & Exports"]
        H3 --> I1["Forest Plot Engine<br/>• Vector SVG (Custom Scaling)<br/>• High-Resolution PNG (300 DPI)<br/>• CI Diamonds & Weight Boxes"]
        H3 --> I2["Publication Bias Funnel Plot<br/>• Pseudo 95% Confidence Limit Lines<br/>• Inverted Standard Error Axis"]
        H3 --> I3["Sensitivity Analysis<br/>• Leave-One-Out Iterative Forest Plot<br/>• Robustness Testing"]
        I1 & I2 & I3 --> I4["Deliverables<br/>• Meta-Analysis PDF Report<br/>• Raw Analysis Dataset (.csv)"]
    end
```

---

## 🔬 Deep Dive into Pipeline Stages

### Step 1: PICOS & Eligibility Criteria Configuration
* **Topic & Protocol Definition**: Input clinical inquiry (e.g. *"Efficacy and Safety of GLP-1 Receptor Agonists on Cardiovascular Outcomes in Patients with Type 2 Diabetes"*).
* **Decomposed 5-Point PICOS Framework**:
  - **P (Population)**: Cohort characteristics, age, disease severity, baseline comorbidities.
  - **I (Intervention)**: Specific drug dosage, surgical procedure, medical device, or diagnostic intervention.
  - **C (Comparator)**: Placebo, standard of care, active comparator, or sham procedure.
  - **O (Outcomes)**: Primary efficacy endpoints, secondary outcomes, composite safety outcomes, mortality.
  - **S (Study Design)**: Strictly targeted to empirical designs.
* **Pre-Specified Inclusion & Exclusion Rules**: Customizable rule engine guaranteeing transparent screening.
* **Strict Restriction to 9 Eligible Study Types**:
  1. *Randomized controlled trials (RCTs)*
  2. *Non-randomized controlled trials*
  3. *Cohort studies (prospective or retrospective)*
  4. *Case-control studies*
  5. *Cross-sectional studies*
  6. *Diagnostic accuracy studies*
  7. *Case series and case reports*
  8. *Qualitative studies*
  9. *Observational studies*
  *(All non-empirical articles, narrative reviews, secondary meta-analyses, commentaries, and letters are systematically excluded).*

### Step 2: Mandatory Multi-Source Retrieval & Entity Resolution
Every run searches **all** sources below; none can be deselected. A source that could not be searched (missing key, outage, or a manual step not done) is shown as such on the live source board and is reported as **not searched / failed, with the reason** in PRISMA, Methods and Limitations — it is never listed as searched.

| Source | Interface | PRISMA box | Notes |
| :--- | :--- | :--- | :--- |
| **PubMed / MEDLINE** | NCBI E-utilities (`/api/pubmed`, esearch + efetch XML) | Databases | `term[tiab]` translation; review/editorial/letter/comment excluded. Optional `NCBI_API_KEY`, `NCBI_EMAIL`. |
| **Google Scholar** | SerpApi `engine=google_scholar` (`/api/scholar`) | Other methods | **Requires `SERPAPI_KEY`**; Google Scholar is never scraped. Results are matched to Crossref (title Jaccard ≥ 0.90, \|Δyear\| ≤ 1) for a DOI, then Europe PMC / OpenAlex for the abstract; unmatched records keep only a snippet and are forced to BORDERLINE. |
| **Cochrane Library: CDSR** | Journal-restricted search via PubMed (`"Cochrane Database Syst Rev"[ta]`) and Europe PMC | Databases | Shown in an *Existing Cochrane evidence* panel; counted as identified and excluded as "Systematic review (used for background/citation searching)". `.pubN` versions collapse to the latest. |
| **Cochrane Library: CENTRAL** | User-exported RIS from the Cochrane Library | Databases | Cochrane has no public search API. Step 1 generates a copy-ready Cochrane Library strategy; upload the RIS export. Without it CENTRAL is reported as *not searched* and manuscript generation requires an explicit acknowledgement (printed in Limitations). |
| **ClinicalTrials.gov** | API v2 (`/api/ctgov`) | Registers | Registrations are linked to their publications by NCT number or registry-listed result PMIDs. |
| **Europe PMC** | REST API (`SRC:MED OR SRC:PMC`) | Databases | |
| **Preprints** | Europe PMC REST API (`SRC:PPR`) | Databases | Not peer reviewed; BORDERLINE by default; linked to the published version when found. |
| **Semantic Scholar** | Graph API v1 (`/api/s2`) | Databases | Plain-text relevance search (no Boolean support). |
| **OpenAlex** | Works API (`/api/openalex`) | Databases | |
| **Crossref** | REST API (`/api/crossref`) | Databases | |

* **One shared search strategy** (PICO blocks or the custom query) is translated per source; the exact executed query, endpoint, timestamp, hits and retrieved counts are logged (PRISMA-S) and printed in Methods Table S1 and the PRISMA audit PDF.
* **No cross-source substitution**: if a source fails, it is reported as failed; HTTP 429 is retried with backoff within the same source only.
* **No paper repeated, ever**: `addRecordsToPool()` is the only entry point into the screening pool (searches, retries, CENTRAL RIS import, Step 5 full-text imports, project load). Records are clustered with union-find over PMID, PMCID, DOI, OpenAlex, S2, Scholar and Cochrane identifiers, exact titles and fuzzy titles (token Jaccard ≥ 0.88, \|Δyear\| ≤ 1, matching first author). A **conflict guard** never merges records with different PMIDs or DOIs. Preprints, trial registrations, errata/retraction notices and superseded Cochrane versions are **linked** to their study rather than shown separately; retracted papers are forced to EXCLUDED.
* **Audit trail**: every merge/link is listed in the Step 3 *Duplicates & linked reports* panel (CSV export, PRISMA audit PDF) with a one-click **"Not a duplicate — split"** override that immediately recomputes PRISMA counts. Invariant enforced on every rebuild: Σ retrieved per source = records identified = unique + removed.

### Step 3: PRISMA Screening & Cochrane RoB 2
* **Automated PICOS Screening Engine**: Evaluates title, abstract, keywords, and study design to classify each paper as **Included**, **Excluded** (with specific rationale), or **Borderline**.
* **5-Domain Cochrane Risk of Bias (RoB 2) Matrix**:
  - *Domain 1: Bias arising from the randomization process*
  - *Domain 2: Bias due to deviations from intended interventions*
  - *Domain 3: Bias due to missing outcome data*
  - *Domain 4: Bias in measurement of the outcome*
  - *Domain 5: Bias in selection of the reported result*
  - *Overall Risk*: Automated traffic-light classification (**Low Risk** 🟢, **Some Concerns** 🟡, **High Risk** 🔴).
* **Human-in-the-Loop Supervision**: Clinicians can re-classify any paper with a single click, instantly updating PRISMA counts and manuscript synthesis.

### Step 4: Systematic Review Manuscript Synthesis
* **PRISMA 2020 Compliant Structure**:
  - **Structured Abstract**: Background, Objectives, Methods, Results, Conclusions, Registration.
  - **Introduction**: Clinical dilemma, therapeutic equipoise, explicit PICOS objective statement.
  - **Methods**: Search strategy, database sources, eligibility criteria, screening protocol, RoB appraisal.
  - **Results**: Study selection, PRISMA flow narrative, RoB summary, characteristics of included studies (**Table 1**), individual synthesis by outcome.
  - **Discussion**: Primary findings, comparison with existing literature, strengths, limitations, clinical implications.
  - **Conclusions & Guidance**: Actionable clinical takeaways and future research priorities.
* **Table 1: Characteristics of Included Studies**: Structured comparison of author, year, study type, sample size, population, intervention, comparator, and primary findings.
* **Triple PDF Document Generation**:
  1. *Complete Systematic Review Manuscript PDF*
  2. *PRISMA 2020 Flow Diagram & Risk of Bias Audit PDF*
  3. *Comprehensive References Bibliography PDF*

### Step 5: Quantitative Synthesis & Meta-Analysis Engine
Sysrevai includes a dedicated statistical meta-analysis module (Step 5) that enables quantitative pooling without third-party statistical software (such as R `meta`, RevMan, or Stata):
* **Binary Effect Measures**:
  - **Risk Ratio (RR)**
  - **Odds Ratio (OR)**
  - **Risk Difference (RD)**
* **Continuous Effect Measures**:
  - **Mean Difference (MD)**
  - **Standardized Mean Difference (SMD / Hedges' g)** with small-sample bias adjustment ($J \approx 1 - \frac{3}{4df - 1}$).
* **Statistical Pooling Models**:
  - **Fixed-Effect Model**: Inverse-variance and Mantel-Haenszel weighting.
  - **Random-Effects Model**: DerSimonian-Laird estimator for between-study variance ($\tau^2$).
* **Comprehensive Heterogeneity Assessment**:
  - **Cochran's $Q$ Test**: Chi-square distributed test statistic with degrees of freedom and $p$-value.
  - **Higgins & Thompson's $I^2$**: Quantifies proportion of total variation attributable to heterogeneity ($I^2 = \max(0, \frac{Q - df}{Q}) \times 100\%$).
  - **$\tau^2$ (Tau-squared)**: Estimate of between-study variance.
* **Zero-Event Handling**: Automated $0.5$ continuity correction for studies with zero cells in binary $2 \times 2$ tables, with transparent clinical warnings.
* **Import Custom Studies from PC**: Clinicians can import trial publications directly from their PC in **PDF**, **Word DOC/DOCX**, or **TXT** formats. The system parses and ingests title, sample size, and effect numbers directly into the meta-analysis pool.
* **Publication Graphics Suite**:
  - **Forest Plot Generator**: Vector SVG and 300 DPI PNG with study weights, 95% confidence intervals, and pooled summary diamonds.
  - **Funnel Plot**: Evaluates small-study effects and publication bias with pseudo 95% confidence limit funnels.
  - **Leave-One-Out Sensitivity Analysis**: Re-pools the meta-analysis excluding each study sequentially to identify disproportionate influence.
  - **CSV & PDF Export**: One-click download of the pooled dataset and complete quantitative report.

---

## 📚 Triple Citation Engine & Parity Guarantee

Sysrevai provides a one-click citation switcher on the manuscript page supporting three internationally recognized academic referencing systems:

```
[ Vancouver ]   [ APA ]   [ Harvard ]
```

### 1. Vancouver Style (ICMJE Standard)
* **In-Text Citation**: Uppercase superscript numbers without brackets:
  $$\text{Recent landmark trials}^{1, 2}\text{ demonstrated significant reduction}^{3}.$$
* **Bibliography**: Numbered sequentially in order of appearance following National Library of Medicine (NLM) / ICMJE standards:
  > 1. Marso SP, Daniels GH, Brown-Frandsen K, et al. Liraglutide and Cardiovascular Outcomes in Type 2 Diabetes. *N Engl J Med*. 2016;375(4):311-322. doi:10.1056/NEJMoa1603827

### 2. APA 7th Edition
* **In-Text Citation**: Author-year format with ampersand `&` and comma:
  $$\text{Recent landmark trials (Marso \& Daniels, 2016; Wilding \& Batterham, 2021) demonstrated significant reduction.}$$
* **Bibliography**: Alphabetized by first author surname with sentence-case titles and HTTPS DOIs:
  > Marso, S. P., Daniels, G. H., & Brown-Frandsen, K. (2016). Liraglutide and cardiovascular outcomes in type 2 diabetes. *New England Journal of Medicine*, 375(4), 311–322. https://doi.org/10.1056/NEJMoa1603827

### 3. Harvard Style
* **In-Text Citation**: Author-year format without comma and with spelled-out `and`:
  $$\text{Recent landmark trials (Marso and Daniels 2016; Wilding and Batterham 2021) demonstrated significant reduction.}$$
* **Bibliography**: Alphabetized by first author surname with single-quoted titles and explicit volume/issue/page abbreviations:
  > Marso, S.P., Daniels, G.H. and Brown-Frandsen, K., 2016. 'Liraglutide and cardiovascular outcomes in type 2 diabetes', *New England Journal of Medicine*, vol. 375, no. 4, pp. 311–322. Available at: <https://doi.org/10.1056/NEJMoa1603827> [Accessed 22 October 2026].

### 🔒 100% Citation Parity Guarantee
An integrated deterministic audit verifies:
1. Every cited study in the narrative corresponds to an exact bibliographic entry.
2. Every entry in the reference list is cited in the text (zero orphan citations).
3. Citation indices and author spellings match with zero discrepancy.

---

## 📐 Interactive PRISMA 2020 Flow Diagram Generator

Sysrevai includes a vector flow diagram generator adhering to the official **PRISMA 2020 statement** with four supported layout templates:

| Template | Scope | Architectural Description |
| :---: | :--- | :--- |
| **Template A** | *Standard Review* | Flow for new systematic reviews searching databases and registers only. |
| **Template B** | *Extended Multi-Source* | Flow for reviews searching databases, registers, and other search methods (websites, organizations, citations). |
| **Template C** | *Review Update* | Flow for updated systematic reviews tracking previous review records alongside new search records. |
| **Template D** | *Comprehensive Update* | Flow for updated reviews incorporating both new databases and non-database identification sources. |

*All flow diagrams dynamically update in real time as studies are screened or re-classified, and can be downloaded as vector SVG or exported inside the PRISMA Audit PDF.*

---

## ⚖️ Medical & Scientific AI Advisory Compliance

Sysrevai implements strict biomedical AI governance and transparency safeguards:
* **Evidence Synthesis Auxiliary Engine**: Explicitly designed as a PRISMA 2020 protocol engine to support human researchers, not replace clinical decision-making.
* **Probabilistic Awareness**: Highlights that generative models are probabilistic and mandate independent clinician oversight.
* **Supervision Requirement**: All eligibility decisions, Cochrane RoB 2 appraisals, and statistical syntheses must be independently supervised by qualified investigators before clinical adoption.
* **On-Demand Advisory**: Users can review the complete medical AI advisory at any time via the persistent `⚖️ AI Advisory` footer trigger.

---

## 📋 PRISMA 2020 27-Item Compliance Matrix

| PRISMA Section | Item # | Checklist Standard | Sysrevai Implementation |
| :--- | :---: | :--- | :--- |
| **Title** | 1 | Identify report as a systematic review | Automatic title: *"A Systematic Review and Evidence Synthesis Adhering to PRISMA 2020 Guidelines"* |
| **Abstract** | 2 | Structured summary of review | 6-part structured abstract: Background, Objectives, Methods, Results, Conclusions, Registration |
| **Rationale** | 3 | Describe rationale in context of knowledge | Section 1.1 formalizes clinical background and therapeutic equipoise |
| **Objectives** | 4 | Explicit PICOS statement | Section 1.2 models complete 5-point PICOS framework |
| **Eligibility** | 5 | Specify inclusion and exclusion criteria | Section 2.2 formalizes pre-specified inclusion and exclusion rules |
| **Information Sources**| 6 | Specify all databases, registers and other sources searched | 10 mandatory sources (databases, ClinicalTrials.gov register, Google Scholar as other method); only sources actually searched are named, the rest are reported as not searched with reasons |
| **Search Strategy** | 7 | Present full electronic search query | Exact executed query per source, date, hits and retrieved (Methods Table S1, PRISMA-S) |
| **Selection Process** | 8 | Document screening and deduplication | Cluster-based deduplication with audit log and reviewer split override; automated title/abstract screening with human override |
| **Data Collection** | 9 | Process for obtaining study data | Automated parameter extraction (Sample size, Population, Findings) |
| **Risk of Bias** | 11, 14 | Methodological quality appraisal | 5-Domain Cochrane RoB 2 appraisal matrix with traffic-light indicators |
| **Synthesis of Results**| 13 | Summarize characteristics & findings | Section 3.3 individual study synthesis with 100% citation parity |
| **Meta-Analysis** | 13, 15 | Quantitative effect pooling & heterogeneity | Step 5: RR/OR/RD/MD/SMD pooling, $I^2$, $\tau^2$, Cochran's $Q$, Forest Plots |
| **Citations** | Specific | Complete bibliographic audit | Tri-modal citation engine (Vancouver, APA 7th, Harvard) with parity audit |

---

## 🚀 Quick Start & Installation

### Option 1: Direct Cloud Access (Zero Installation)
Launch the production web application directly in your browser:  
👉 [**https://sysrevai.vercel.app**](https://sysrevai.vercel.app)

### Option 2: Zero-Dependency Local Browser Run
1. Clone the repository:
   ```bash
   git clone https://github.com/roroleaks/Sysrevai.git
   cd Sysrevai
   ```
2. Double-click `index.html` to open directly in Google Chrome, Microsoft Edge, Mozilla Firefox, or Apple Safari.

### Option 3: Local Node.js Development Server
1. Clone the repository and start the server:
   ```bash
   git clone https://github.com/roroleaks/Sysrevai.git
   cd Sysrevai
   node server.js
   ```
2. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

### Option 4: Production Deployment & Environment Variables

SysRevAI operates with zero required configuration via public literature APIs and polite pools. For high-volume production deployments (e.g., on Vercel), configure server-side API keys via environment variables:

```bash
# Add Semantic Scholar Graph API Key
vercel env add S2_API_KEY

# Add OpenAlex Works API Key
vercel env add OPENALEX_API_KEY

# Google Scholar (required for the Google Scholar source; https://serpapi.com/)
vercel env add SERPAPI_KEY

# NCBI E-utilities (optional key raises PubMed limits from 3 to 10 req/s; e-mail requested by NCBI)
vercel env add NCBI_API_KEY
vercel env add NCBI_EMAIL
```

Without `SERPAPI_KEY`, Google Scholar is reported as **not configured** (in the source board, PRISMA, Methods and Limitations); no other source is substituted for it.

For local development with customized environment variables:
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Populate `S2_API_KEY`, `OPENALEX_API_KEY`, `SERPAPI_KEY`, `NCBI_API_KEY` and `NCBI_EMAIL`. Server proxy endpoints (`/api/s2`, `/api/openalex`, `/api/scholar`, `/api/pubmed`) read these keys on the server without ever exposing them to browser clients.

---

## 🛠️ Technology Stack

* **Frontend Architecture**: Pure Vanilla Modern JavaScript (ES6+), HTML5, Responsive CSS3 (Zero bloated frontend frameworks, instantaneous rendering).
* **Statistical Meta-Analysis Engine**: Client-side mathematical implementation of DerSimonian-Laird, Inverse-Variance, Hedges' $g$, and Cochran's $Q$ (`meta-analysis-engine.js`).
* **PRISMA 2020 Vector Engine**: Scalable Vector Graphics (SVG) template renderer (`prisma-generator.js`).
* **PDF Document Generator**: [jsPDF 2.5.1](https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js) client-side vector engine.
* **Document Parsers**: [PDF.js 3.11](https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js) and [Mammoth.js 1.6](https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js) for parsing user-uploaded trial publications.
* **Literature sources** (registry in `sources.js`, deduplication in `dedup.js`):
  * [PubMed via NCBI E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/) (`/api/pubmed`).
  * [Google Scholar via SerpApi](https://serpapi.com/google-scholar-api) (`/api/scholar`, requires `SERPAPI_KEY`).
  * Cochrane Library: CDSR via PubMed / Europe PMC journal filter; [CENTRAL](https://www.cochranelibrary.com/advanced-search) via user-exported RIS.
  * [ClinicalTrials.gov API v2](https://clinicaltrials.gov/data-api/api) (`/api/ctgov`).
  * [Europe PMC REST Web Service](https://europepmc.org/RestfulWebService) (EMBL-EBI), including preprints (`SRC:PPR`).
  * [Semantic Scholar Academic Graph API](https://api.semanticscholar.org/graph/v1) (Allen Institute for AI).
  * [OpenAlex Works API](https://docs.openalex.org/) and [Crossref REST API](https://api.crossref.org/).
* **Hosting & Deployment**: Vercel Cloud Serverless Edge Platform (`vercel.json`).

---

## 👨‍⚕️ Author & Attribution

**Dr. Raouf Roshdy**  
*Creator & Lead Architect, Sysrevai*  
Project: **AIMed Biomedical Informatics Initiative**  
*Dedicated to my mentor, Prof. Dr. Abdel Hamid Attia.*

---

## 📜 License & Disclaimer

This project is licensed under the [MIT License](LICENSE) — free for educational, clinical, and scientific research use.

> [!IMPORTANT]
> **Academic & Clinical Disclaimer**: Sysrevai is an auxiliary research synthesis and PRISMA 2020 protocol platform designed to accelerate evidence synthesis. All synthesized systematic reviews, risk of bias assessments, and statistical meta-analyses must be supervised and verified by qualified human medical researchers and clinicians prior to clinical guideline adoption or medical practice decisions.
