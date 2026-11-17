# SysRevAI Changelog & Scientific Integrity Audit Fixes

All notable methodology, statistical, screening, security, and export improvements are documented in this log.

---

## [Phase 1] - Zero Data Fabrication & Truth in Synthesis (Commit `bece4c7`)

### `meta-analysis-engine.js`
- **`autoExtractAndCompleteMetaAnalysis()`**:
  - Eliminated all fabricated default parameters (`totalN = 250`, `pCtrl = 0.22`, `pExp = 0.16`, `m1=12`, `s1=3.5`, `m2=14.8`, `s2=3.8`).
  - Removed keyword-based directional assumption (`increased risk` favoring intervention).
  - Replaced automatic pooling with `suggestValuesFromAbstracts()` which marks extracted values as `status: 'suggested'`, `verified: false`, and `includedInPool: false`.
  - Added requirement for explicit reviewer confirmation per study row (`confirmStudyCounts`) or in bulk (`confirmAllSuggestedStudies`).
  - Extracted verbatim snippet `evidenceText` for full transparency.
- **`extractBinarySuggestionFromAbstract()`**:
  - Requires explicit arm identification (e.g. "in the aspirin group", "placebo", "control") before assigning values to treatment or comparator.
  - Recognizes structured patterns `x/N (y%)`, `x of N`, `y% vs z%` only when denominator $N$ is documented.
  - Returns `null` if arm assignment is ambiguous or absent.
- **`syncMetaResultsToManuscript()`**:
  - Suppressed execution when any included study has unconfirmed or unverified parameters.

### `index.html`
- **`extractStudyCharacteristics()`**:
  - Removed boilerplate outcome finding string; defaults to `null` and displays `"Key finding not extracted; see abstract."`.
  - Added robust sentence splitting that ignores periods within numbers (`10.0%`, `0.911`) and abbreviations (`vs.`, `et al.`, `i.e.`, `CI`).
  - Expanded sample size extraction nouns (women, pregnancies, mothers, neonates, infants, couples, cycles, embryos, oocytes).
  - Replaced copy-pasted protocol PICO in Table 1 rows with per-study extracted text or `"Not extracted"`.
- **`SystematicReviewGenerator`**:
  - Replaced fabricated quotes with verbatim complete abstract sentences or explicit `"Key finding not extracted; see abstract."`.
  - Removed false claim of controlled vocabulary ("MeSH") indexing; prints exact query string and year filter applied.
  - Removed false claim of two-stage screening and full-text evaluation; accurately describes automated title/abstract screening with human override.
  - Removed false protocol pre-specification claim; replaced with user-specified PROSPERO registration ID or `"Not registered"`.
  - Removed unwarranted generic in-text citations from background text.
  - Removed practice recommendations from automated conclusions, replacing with verification requirement.
  - Replaced hardcoded author block with user-editable Authors and Affiliation fields.
- **`renderAuditReport()`**:
  - Replaced hardcoded "27/27 PASSED" with dynamic PRISMA 2020 item evaluation (`Reported`, `Partially reported`, `Not reported`, `Not applicable`).
  - Implemented real in-text citation-to-reference parity verification.

---

## [Phase 2] - Screening, Risk of Bias & PRISMA Flow Correctness (Commit `6a49fd1`)

### `index.html`
- **`classifyStudyDesign()`**:
  - Added normalization of Unicode hyphens/dashes (`U+2010`–`U+2015`, `U+2212`) to ASCII hyphen before regex matching.
  - Added detection and exclusion of reviews ending in `"– A Review"`, `"a review$"`, `"invited commentary"`, rhetorical question titles (`"Does ...?"`, `"What ...?"`), and Crossref `type: book-chapter`.
- **`extractInterventionKeywords()`**:
  - Removed hardcoded disease and drug lists (SGLT2, GLP-1, aspirin, statin, CRISPR).
  - Added dynamic parenthetical acronym extraction and configurable synonyms per PICO element.
  - Implemented whitelisted short terms (`asa`, `rct`, `mri`, `dna`, `rna`, `ct`, `hiv`, `cv`).
- **`screenPaperAgainstCriteria()`**:
  - Enforced word-boundary matching (`\b${term}\b`) to eliminate substring false positives (e.g. "asa" in "nasal spray", "Kansas", "Hasan").
  - Evaluated Population, Comparator, and Outcomes criteria (unmatched P/C/O results in `BORDERLINE` status).
  - Evaluated user inclusion and exclusion criteria and logged decision rules.
  - Classified prediction/diagnostic-model studies in intervention questions as `BORDERLINE` ("Not an intervention comparison").
- **`evaluateRiskOfBias()`**:
  - Restricted RoB 2 appraisal exclusively to randomized controlled trials (RCTs).
  - Designated non-randomized studies as `"ROBINS-I (manual assessment required)"` with all domains `"Not assessed"`.
  - Fixed D2 regex to use word boundary around `\bitt\b` (preventing "admitted", "committee", "submitted" from triggering Low risk).
  - Fixed D3 logic: missing attrition information is classified as `Some Concerns`; requires documented zero attrition for `Low`.
  - Fixed D4 logic: requires documented objective adjudication or blinded assessment for `Low`.
  - Fixed Overall algorithm: requires all domains Low for `Low Risk`; any Some Concerns yields `Some Concerns`; any High yields `High Risk`.
  - Added provenance tracking (`auto` vs `reviewer`) for manual domain overrides.
  - Labeled output as `"Automated preliminary RoB screen — not a validated RoB 2/ROBINS-I assessment"` across UI, tables, and exports.
- **`updatePrismaAndCounters()`**:
  - Relabeled "Full-Text Reports Assessed" to "Records Needing Full-Text Review (Borderline)" and excluded borderline records from exclusion counts.
  - Preserved per-database `hitCount` alongside screened records.
- **`fetchSemanticScholar()` & `fetchEuropePMC()`**:
  - Prevented duplicate harvesting: fallback queries to OpenAlex and Crossref are disabled if those databases are already selected in the active query.

---

## [Phase 3] - Statistics, Data Quality, API Hardening & Persistence (Commit `d98f6a9`)

### `meta-analysis-engine.js`
- **`calculateEggerTest()`**:
  - Replaced standard normal distribution $Z$-score with exact Student's $t$ distribution ($df = k - 2$) via regularized incomplete beta function (`metaIbeta` / `metaBetacf`).
  - Added warning and suppressed asymmetry flag for $k < 10$ per Cochrane Handbook guidelines.
- **`getTCritical(df, alpha)`**:
  - Replaced hardcoded lookup table with exact inverse $t$-distribution quantile calculation supporting arbitrary $df$ and $\alpha$ levels (e.g. 95% vs 99% CI).
- **`executeMetaAnalysis()`**:
  - Added `excludeDoubleZeros`: default `true` (skips binary studies with zero events in both arms for RR/OR with warning per Cochrane Handbook §10.4.4.1; retained for RD).
  - Added REML (Restricted Maximum Likelihood) between-study variance $\tau^2$ estimation via Fisher scoring algorithm (`calculateREMLTau2`).
  - Added Hartung-Knapp-Sidik-Jonkman (HKSJ) adjustment option (`state.method === 'hksj'`) with Knapp-Hartung standard error correction and Student's $t$ inference.
  - Added `kStudies` count, `isHksj` flag, and `tau2Method` to pooled results.
- **`executeLeaveOneOutAnalysis()`**:
  - Restricted sensitivity analysis strictly to confirmed and verified pooled studies (`s.verified && s.includedInPool && s.status !== 'suggested'`).
- **Formatting**:
  - Fixed p-value rendering: replaced `P = < 0.001` with `P < 0.001` across SVG plots and summary statistics.

### `index.html`
- **`deduplicatePapers()`**:
  - Implemented identifier propagation: newly merged PMID and DOI identifiers are registered into `pmidMap` and `doiMap`, ensuring 3-way multi-source duplicates collapse into a single record.
  - Updated `normalizeTitle` to preserve subtitles for exact-key matching.
- **`parseAuthorList()` & `parseAuthors()`**:
  - Prefers structured `authorObjects` (family, given, initials).
  - Added Unicode uppercase `\p{Lu}` support in initial extraction regex, correctly parsing Icelandic ("Atladóttir LÓ") and non-English names.
  - Mapped volume, issue, page numbers, and NLM ISO journal abbreviations from Europe PMC.
- **XSS Prevention (`escapeHtml`)**:
  - Enforced `escapeHtml()` across all API-sourced attributes (`title`, `authors`, `journal`, `abstract`, `chars.*`).
  - Replaced `innerHTML` in `renderReferencesList` with `li.textContent`.
- **Metadata Accuracy**:
  - Replaced current year fallback (`|| currentYear`) with `null` across all search harvesters, rendering `"n.d."` for missing dates.
  - Replaced Crossref license heuristic for Open Access with explicit `isOpenAccess` property.
- **Project Persistence & Import/Export**:
  - Implemented `saveProjectState()` to `localStorage`, `loadProjectState()`, `exportProjectJSON()`, and `handleProjectFileImport()`.
  - Added "💾 Export Project (.json)" and "📂 Import Project" header controls.

### `api/*.js`
- **`api/s2.js`**:
  - Removed `?key=` query parameter acceptance (accepts only `x-api-key` header).
  - Clamped retrieval limit to $\le 100$.
  - Added deployment origin restriction and per-IP rate limiting (60 req/min).
- **`api/openalex.js`**:
  - Clamped limit to $\le 200$.
  - Added support for range parsing (`startYear` and `endYear`).
  - Set missing publication year fallback to `null`.
  - Added origin check and per-IP rate limiting.
- **`api/crossref.js`**:
  - Clamped limit to $\le 1000$.
  - Set `isOpenAccess` to explicit OA flags only.
  - Added origin check and per-IP rate limiting.

---

## [Phase 4] - Document Layout, Exports & Verification (Commit `599812d`)

### `index.html`
- **`exportSystematicReviewWordDoc()`**:
  - Added landscape section CSS (`@page SectionLandscape`) for Table 1 (Characteristics of Studies) and Table 2 (RoB Matrix).
  - Replaced hardcoded author block with user-specified Authors and Affiliation fields.
  - Added mandatory Automated Assistance Disclosure banner.
  - Added PRISMA 2020 Checklist audit table as Supplementary Material S1.
- **`exportSystematicReviewPDF()` & `sanitizePdfText()`**:
  - Removed non-Latin-1 character stripping regex in `sanitizePdfText`, preserving Unicode diacritics (e.g. "Mureșan" and "Lukáčová").
  - Removed quoted p-value alteration (`p < 0.0001` -> `P < 0.001`).
  - Replaced hardcoded author names with active workspace author metadata.
- **On-Screen Manuscript Formatting**:
  - Fixed singular/plural grammar throughout results and conclusions ("in 18 studies", "an observational study").
  - Converted markdown bold (`**text**`) to clean HTML bold tags in `citify()`.
  - Standardized missing author names to `[Anonymous]`.

### `test-integrity.js`
- Implemented comprehensive 31-test integrity verification suite validating all 12 required benchmarks across all four phases:
  - Test 1: Zero fabrication on non-numerical abstracts.
  - Test 2: Accurate extraction and manual confirmation requirement.
  - Test 3: Verbatim quote integrity.
  - Test 4: Absence of forbidden claims.
  - Test 5: Unicode hyphenation, review exclusion, and word boundary matching.
  - Test 6: RoB 2 logic (D2, D3, D4, overall, and ROBINS-I classification).
  - Test 7: Student's $t$ Egger test evaluation ($df = k - 2$).
  - Test 8: Statistical regression against Cochrane benchmark datasets (RR, OR, RD, MD, SMD).
  - Test 9: HTML tag stripping preserving literal `<` before digits.
  - Test 10: XSS tag sanitization.
  - Test 11: PDF Unicode character preservation.
  - Test 12: 3-way multi-source deduplication resolution.

---

## [Phase 5] - Mandatory Literature Sources & "No Paper Repeated" Deduplication

### New files
- **`sources.js`**: frozen `SOURCE_REGISTRY` of 10 mandatory sources (PubMed, Google Scholar, Cochrane CDSR, Cochrane CENTRAL, ClinicalTrials.gov, Europe PMC, Europe PMC preprints, Semantic Scholar, OpenAlex, Crossref), each with `key`, `displayName`, `interfaceLabel`, `prismaCategory`, `fetch()`, `translateQuery()`, `requiresKey`, `peerReviewed`. One shared search strategy (`buildSearchStrategy`) with per-source translators; copy-ready Cochrane Library strategy; RIS parser; ClinicalTrials.gov and SerpApi mappers; Google Scholar enrichment (Crossref DOI match → Europe PMC / OpenAlex abstract).
- **`dedup.js`**: union-find clustering over all raw records (PMID, PMCID, DOI, OpenAlex, S2, Scholar, Cochrane CD number, CENTRAL accession, exact and fuzzy titles) with a cluster-level conflict guard; study-level linking of preprints, trial registrations, errata/retraction notices and Cochrane `.pubN` versions; merge audit log.
- **`api/pubmed.js`** (E-utilities esearch + efetch XML, NCBI throttle, structured abstracts), **`api/scholar.js`** (SerpApi; `not_configured` without `SERPAPI_KEY`, never scrapes), **`api/ctgov.js`** (API v2), shared **`api/_proxy-utils.js`**. `api/crossref.js` gains a bibliographic lookup mode and `api/openalex.js` a DOI lookup mode.
- **`test-dedup.js`**, **`test-sources.js`**, **`test-app-harness.js`**.

### Fixed defects
1. **Silent cross-source substitution removed.** Europe PMC no longer returns OpenAlex results on failure and Semantic Scholar no longer returns OpenAlex + Crossref; those records were double-counted and credited to the wrong source. Each source reports only its own records and status; HTTP 429 is retried within the same source.
2. **Greedy single-pass dedup replaced** by union-find clustering, so transitive duplicates (X{pmid:1} · Y{doi:A} · Z{pmid:1, doi:A}) collapse into one record.
3. **Conflict guard**: records with different non-empty PMIDs or DOIs (multi-part papers, extension studies) are never merged, including transitively.
4. **The PICO / custom query is what every source runs** (translated to native syntax); the exact executed string, endpoint, timestamp, hits and retrieved counts are logged per source.

### `index.html`
- Source checkboxes, *Select all*, *Dual core* and *Clear all*, and `STATE.selectedDatabases` / `STATE.searchSource` with all their handlers removed; replaced by a read-only *Mandatory literature sources* board with live status and per-source Retry.
- `addRecordsToPool()` is the single entry point into `STATE.papers` (search, retry, CENTRAL RIS import, Step 5 full-text import, project load). The pool is rebuilt from raw per-source batches, so retries, RIS re-imports and reloads are idempotent. Reviewer *Remove* no longer splices the pool.
- Step 3: multi-source badges and "Also reported as" chips; *Existing Cochrane evidence* panel and PICO-match banner; *Duplicates & linked reports* panel with "Not a duplicate — split" override and CSV export; visible integrity error if Σ retrieved ≠ identified ≠ unique + removed or any identifier is shared.
- Screening rules: retracted → EXCLUDED ("Retracted publication"); Cochrane reviews → EXCLUDED (background/citation searching); Google Scholar records without an abstract → BORDERLINE, never auto-included; preprints and unlinked registrations → BORDERLINE.
- Manuscript: Methods/Abstract name only sources whose status is `ok`, with interface labels and Table S1 (exact queries, dates, hits, retrieved); Limitations list failed / not-configured / not-searched sources with reasons; non-dismissable CENTRAL gate with acknowledgement printed in Limitations; matching Cochrane reviews cited in the Introduction only when referenced; reference lists de-duplicated in every citation style.
- Project save/load and JSON export include `searchStrategy`, `searchLog`, `sourceStatus`, `sourceRecords`, `dedupLog`, `dedupOverrides` and the CENTRAL import file name/date.

### `prisma-generator.js`
- Automatically uses **Template B**: per-database counts, ClinicalTrials.gov under Registers, Google Scholar under Other methods (search engines). Duplicates removed vs. reports linked to their study ("removed for other reasons") are reported separately and reconcile exactly.

### `meta-analysis-engine.js`
- Step 5 custom PDF/DOCX study import is routed through `addRecordsToPool` (DOI/PMID/NCT read from the document); a report that matches a study already in the meta-analysis pool is linked, not added twice. No statistical code changed.

