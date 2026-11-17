/**
 * SysRevAI — Mandatory literature source registry, shared search strategy,
 * per-source query translation and retrieval adapters.
 *
 * Rules enforced here (see CHANGELOG Phase 9):
 *  - Every source in SOURCE_REGISTRY is searched on every run; nothing can be deselected.
 *  - A source only ever reports ITS OWN records and ITS OWN status. There is no
 *    cross-source substitution: if Europe PMC fails, it is reported as failed.
 *  - The exact query string executed against every interface is logged (PRISMA-S).
 *  - API keys never live here; keyed sources go through /api/* proxies.
 *
 * Works as a classic <script> (exports onto window) and as a CommonJS module.
 */
(function (root) {
  'use strict';
  const G = name => (root && typeof root[name] === 'function') ? root[name] : ((typeof globalThis !== 'undefined' && typeof globalThis[name] === 'function') ? globalThis[name] : null);

  const EPMC_SEARCH = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
  const STOPWORDS = /^(the|for|with|from|between|into|through|during|before|after|above|below|to|of|in|on|at|by|a|an)$/i;
  const MAX_PER_SOURCE = 100;

  // ─────────────────────────────────────────────────────────────
  // Generic helpers
  // ─────────────────────────────────────────────────────────────
  function clean(str) {
    if (!str) return '';
    if (G('cleanHtmlText')) return G('cleanHtmlText')(str);
    return String(str).replace(/<\/?[a-z][a-z0-9:-]*[^>]*>/gi, ' ')
      .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim();
  }

  function nowIso() { return new Date().toISOString(); }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); }, { once: true });
    });
  }

  function combineSignals(signals) {
    const list = signals.filter(Boolean);
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') return AbortSignal.any(list);
    const ctrl = new AbortController();
    list.forEach(s => { if (s.aborted) ctrl.abort(); else s.addEventListener('abort', () => ctrl.abort(), { once: true }); });
    return ctrl.signal;
  }

  /**
   * fetch → JSON with a strict timeout and retry-with-backoff on HTTP 429
   * (same source only — never another source).
   */
  async function fetchJson(url, { signal, timeoutMs = 9000, headers = {}, retries = 2 } = {}) {
    let attempt = 0;
    for (;;) {
      const timeoutCtrl = new AbortController();
      const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
      try {
        const res = await G('fetch')(url, { headers, signal: combineSignals([signal, timeoutCtrl.signal]) });
        clearTimeout(timer);
        if (res.status === 429 && attempt < retries) {
          const ra = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : 0);
          await sleep(Math.min(5000, ra > 0 ? ra * 1000 : 800 * Math.pow(2, attempt)), signal);
          attempt++;
          continue;
        }
        let json = null;
        try { json = await res.json(); } catch (e) { json = null; }
        return { ok: !!res.ok, status: res.status, json };
      } catch (err) {
        clearTimeout(timer);
        if (signal && signal.aborted) throw err;
        const timedOut = timeoutCtrl.signal.aborted;
        return { ok: false, status: 0, json: null, error: timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : (err.message || 'network error') };
      }
    }
  }

  function httpError(r, label) {
    if (r.error) return `${label}: ${r.error}`;
    const detail = r.json && (r.json.error || r.json.message) ? ` (${String(r.json.error || r.json.message).slice(0, 120)})` : '';
    return `HTTP ${r.status || 'unavailable'}${detail}`;
  }

  function yearBounds(yearRange) {
    const currentYear = new Date().getFullYear();
    if (!yearRange || Number(yearRange) >= 99) return { yearFrom: null, yearTo: currentYear };
    return { yearFrom: currentYear - Number(yearRange), yearTo: currentYear };
  }

  // ─────────────────────────────────────────────────────────────
  // Shared search strategy (spec 2.7)
  // ─────────────────────────────────────────────────────────────
  function tokenizeQuery(q) {
    const out = [];
    const rx = /\(|\)|"[^"]*"|[^\s()]+/g;
    let m;
    while ((m = rx.exec(String(q || ''))) !== null) {
      const t = m[0];
      if (t === '(' || t === ')') { out.push({ type: t }); continue; }
      if (t.startsWith('"')) {
        const inner = t.replace(/"/g, '').replace(/\[[^\]]*\]/g, '').trim();
        // Age / numeric limits such as ">= 18 years" are eligibility limits, not search terms
        if (/^[<>=≥≤]/.test(inner) || !/[a-z]{3,}/i.test(inner.replace(/\byears?\b|\bmonths?\b|\bdays?\b/gi, ''))) continue;
        if (inner.length >= 2) out.push({ type: 'term', value: inner, phrase: /\s/.test(inner) });
        continue;
      }
      const up = t.toUpperCase();
      if (up === 'AND' || up === 'OR' || up === 'NOT') { out.push({ type: 'op', value: up }); continue; }
      const cleaned = t.replace(/\[[^\]]*\]/g, '').replace(/[^\w*-]/g, '').replace(/^-+|-+$/g, '');
      if (cleaned && !STOPWORDS.test(cleaned)) out.push({ type: 'term', value: cleaned, phrase: false });
    }
    return normalizeTokens(out);
  }

  function normalizeTokens(tokens) {
    // Balance parentheses; if unbalanced, drop all of them.
    let depth = 0; let balanced = true;
    tokens.forEach(t => { if (t.type === '(') depth++; if (t.type === ')') { depth--; if (depth < 0) balanced = false; } });
    if (depth !== 0) balanced = false;
    let list = balanced ? tokens.slice() : tokens.filter(t => t.type !== '(' && t.type !== ')');
    // Remove empty groups, dangling / doubled operators
    const out = [];
    list.forEach(t => {
      const prev = out[out.length - 1];
      if (t.type === 'op') {
        if (!prev || prev.type === 'op' || prev.type === '(') return;
      }
      if (t.type === ')' && prev && prev.type === 'op') out.pop();
      if (t.type === ')' && out.length && out[out.length - 1].type === '(') { out.pop(); return; }
      out.push(t);
    });
    while (out.length && out[out.length - 1].type === 'op') out.pop();
    return out;
  }

  /** Split top-level AND into concept blocks. */
  function conceptBlocks(tokens) {
    const blocks = [[]];
    let depth = 0;
    tokens.forEach(t => {
      if (t.type === '(') depth++;
      if (t.type === ')') depth--;
      if (t.type === 'op' && t.value === 'AND' && depth === 0) { blocks.push([]); return; }
      blocks[blocks.length - 1].push(t);
    });
    return blocks.map(b => b.filter(t => t.type === 'term').map(t => t.value)).filter(b => b.length);
  }

  /**
   * Build the ONE shared search strategy every source translates.
   * @param {object} p { baseQuery, topic, pico, yearRange, perSourceLimit, searchDate }
   */
  function buildSearchStrategy(p = {}) {
    const base = String(p.baseQuery || p.topic || '').trim();
    const tokens = tokenizeQuery(base);
    const blocks = conceptBlocks(tokens);
    const terms = Array.from(new Set(tokens.filter(t => t.type === 'term').map(t => t.value)));
    const { yearFrom, yearTo } = yearBounds(p.yearRange);
    return {
      baseQuery: base,
      tokens,
      blocks,
      terms,
      pTerms: blocks.length >= 2 ? blocks[0] : [],
      iTerms: blocks.length >= 2 ? blocks[1] : [],
      yearRange: p.yearRange,
      yearFrom,
      yearTo,
      perSourceLimit: Math.max(1, Math.min(MAX_PER_SOURCE, Number(p.perSourceLimit) || 35)),
      topic: p.topic || '',
      pico: p.pico || {},
      searchDate: p.searchDate || nowIso().split('T')[0]
    };
  }

  function quote(v) { return /[\s]/.test(v) ? `"${v}"` : v; }

  function renderTokens(tokens, fmt, { dropAnd = false, notPrefix = null, dropParens = false } = {}) {
    const parts = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'term') parts.push(fmt(t));
      else if (t.type === 'op') {
        if (t.value === 'AND' && dropAnd) continue;
        if (t.value === 'NOT' && notPrefix) {
          const next = tokens[i + 1];
          if (next && next.type === 'term') { parts.push(`${notPrefix}${fmt(next)}`); i++; }
          continue;
        }
        parts.push(t.value);
      } else if (!dropParens) parts.push(t.type);
    }
    return parts.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  }

  const T = {
    /** Europe PMC / OpenAlex / CT.gov Essie: native Boolean + phrases */
    boolean: s => renderTokens(s.tokens, t => quote(t.value)),
    pubmed: s => renderTokens(s.tokens, t => `${quote(t.value)}[tiab]`),
    plain: s => s.terms.map(t => t.replace(/-/g, ' ')).join(' '),
    scholar: s => renderTokens(s.tokens, t => quote(t.value), { dropAnd: true, notPrefix: '-' }),
    cochraneLibrary: s => renderTokens(s.tokens, t => `${quote(t.value)}:ti,ab,kw`)
  };

  const PUBMED_EXCLUDE = 'NOT (review[pt] OR editorial[pt] OR letter[pt] OR comment[pt])';
  const EPMC_EXCLUDE = 'NOT (PUB_TYPE:"Review" OR PUB_TYPE:"Editorial" OR PUB_TYPE:"Letter" OR PUB_TYPE:"Comment")';

  function epmcYear(s) { return s.yearFrom ? ` AND (PUB_YEAR:[${s.yearFrom} TO ${s.yearTo}])` : ''; }

  const translators = {
    pubmed: s => `(${T.pubmed(s)}) ${PUBMED_EXCLUDE}`,
    epmc: s => `(${T.boolean(s)})${epmcYear(s)} AND (SRC:MED OR SRC:PMC) ${EPMC_EXCLUDE}`,
    epmc_preprints: s => `(${T.boolean(s)})${epmcYear(s)} AND SRC:PPR`,
    cochrane_cdsr_pubmed: s => `(${T.pubmed(s)}) AND "Cochrane Database Syst Rev"[ta]`,
    cochrane_cdsr_epmc: s => `(${T.boolean(s)}) AND JOURNAL:"Cochrane Database Syst Rev"${epmcYear(s)}`,
    cochrane_central: s => T.cochraneLibrary(s),
    s2: s => T.plain(s),
    openalex: s => T.boolean(s),
    crossref: s => T.plain(s),
    scholar: s => T.scholar(s),
    ctgov: s => {
      if (s.pTerms.length && s.iTerms.length) {
        return { cond: s.pTerms.map(quote).join(' OR '), intr: s.iTerms.map(quote).join(' OR ') };
      }
      return { term: T.boolean(s) };
    }
  };

  /** Copy-ready Cochrane Library Advanced Search (Search manager) string. */
  function buildCochraneLibrarySearch(strategy) {
    const lines = [];
    strategy.blocks.forEach((block, i) => {
      lines.push(`#${i + 1}\t(${block.map(t => `${quote(t)}:ti,ab,kw`).join(' OR ')})`);
    });
    if (strategy.blocks.length > 1) lines.push(`#${strategy.blocks.length + 1}\t${strategy.blocks.map((_, i) => `#${i + 1}`).join(' AND ')}`);
    if (!lines.length) lines.push(`#1\t${T.cochraneLibrary(strategy)}`);
    const limit = strategy.yearFrom
      ? `Limits: Cochrane Library publication date from ${strategy.yearFrom} to ${strategy.yearTo}; restrict results to Trials (CENTRAL).`
      : 'Limits: none (all years); restrict results to Trials (CENTRAL).';
    return { searchManager: lines.join('\n'), singleLine: T.cochraneLibrary(strategy), limitsNote: limit };
  }

  // ─────────────────────────────────────────────────────────────
  // Record mappers
  // ─────────────────────────────────────────────────────────────
  function mapEuropePmcItem(item, sourceKey, sourceName) {
    const isPreprint = sourceKey === 'epmc_preprints' || item.source === 'PPR';
    return {
      sourceKey, source: sourceKey, sources: [sourceName],
      id: item.id || item.pmid || item.doi || '',
      pmid: item.pmid || '',
      doi: item.doi || '',
      pmcid: item.pmcid || '',
      title: clean(item.title) || 'Untitled Publication',
      authors: item.authorString ? clean(item.authorString) : (Array.isArray(item.authorList?.author) ? item.authorList.author.map(a => a.fullName || `${a.lastName || ''} ${a.firstName || ''}`.trim()).filter(Boolean).join(', ') : 'Unknown Authors') || 'Unknown Authors',
      authorObjects: Array.isArray(item.authorList?.author) ? item.authorList.author.map(a => ({
        family: a.lastName || '', given: a.firstName || '', initials: a.initials || '',
        displayName: a.fullName || `${a.lastName || ''} ${a.firstName || ''}`.trim()
      })) : [],
      journal: clean(item.journalInfo?.journal?.title || item.journalTitle || item.bookOrReportDetails?.publisher || (isPreprint ? 'Preprint' : 'Scholarly Journal')),
      journalAbbr: clean(item.journalInfo?.journal?.medlineAbbreviation || item.journalInfo?.journal?.isoabbreviation || ''),
      volume: item.journalInfo?.volume || '',
      issue: item.journalInfo?.issue || '',
      pages: item.pageInfo || item.journalInfo?.pageInfo || '',
      year: Number(item.pubYear) || (item.journalInfo?.yearOfPublication ? Number(item.journalInfo.yearOfPublication) : null),
      abstract: clean(item.abstractText || ''),
      abstractSource: item.abstractText ? sourceKey : 'none',
      citationCount: Number(item.citedByCount || 0),
      isOpenAccess: item.isOpenAccess === 'Y',
      meshHeadings: Array.isArray(item.meshHeadingList?.meshHeading) ? item.meshHeadingList.meshHeading.map(m => m.descriptorName).filter(Boolean) : [],
      keywords: Array.isArray(item.keywordList?.keyword) ? item.keywordList.keyword.filter(Boolean) : (item.keywordList?.keyword ? [item.keywordList.keyword] : []),
      pubType: item.pubType ? String(item.pubType).split(';').map(s => s.trim().toLowerCase()) : (Array.isArray(item.pubTypeList?.pubType) ? item.pubTypeList.pubType.map(s => String(s).toLowerCase()) : []),
      peerReviewed: !isPreprint,
      preprintServer: isPreprint ? (item.bookOrReportDetails?.publisher || item.journalTitle || '') : undefined
    };
  }

  function reconstructOpenAlexAbstract(inv) {
    if (!inv || typeof inv !== 'object') return '';
    const words = [];
    Object.entries(inv).forEach(([w, pos]) => { if (Array.isArray(pos)) pos.forEach(i => { words[i] = w; }); });
    return clean(words.filter(Boolean).join(' '));
  }

  function mapOpenAlexItem(item) {
    const doi = item.doi ? String(item.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim() : '';
    const pmidRaw = item.pmid || item.ids?.pmid || '';
    const pmid = pmidRaw ? String(pmidRaw).replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, '').replace(/\D/g, '') : '';
    const pmcidRaw = item.pmcid || item.ids?.pmcid || '';
    let abstract = item.abstract || '';
    if (!abstract && item.abstract_inverted_index) abstract = reconstructOpenAlexAbstract(item.abstract_inverted_index);
    let authors = 'Unknown Authors';
    if (typeof item.authors === 'string') authors = item.authors;
    else if (Array.isArray(item.authorships)) authors = item.authorships.map(a => a.author?.display_name).filter(Boolean).join(', ') || authors;
    const type = item.type || (Array.isArray(item.pubType) ? item.pubType[0] : 'journal-article');
    return {
      sourceKey: 'openalex', source: 'openalex', sources: ['OpenAlex'],
      id: item.openalex_id || item.id || doi || pmid,
      openalexId: item.openalex_id || item.paperId || item.id || '',
      pmid, doi,
      pmcid: pmcidRaw ? String(pmcidRaw).replace(/^https?:\/\/www\.ncbi\.nlm\.nih\.gov\/pmc\/articles\//i, '').replace(/\/$/, '') : '',
      title: clean(item.title) || 'Untitled Study',
      authors,
      authorObjects: Array.isArray(item.authorObjects) ? item.authorObjects : [],
      journal: clean(item.journal || item.primary_location?.source?.display_name || 'Academic Journal'),
      volume: item.volume || '', issue: item.issue || '', pages: item.pages || '',
      year: item.year != null ? Number(item.year) : (item.publication_year ? Number(item.publication_year) : null),
      abstract: clean(abstract),
      abstractSource: abstract ? 'openalex' : 'none',
      citationCount: Number(item.citationCount || item.cited_by_count || 0),
      isOpenAccess: Boolean(item.isOpenAccess || item.open_access?.is_oa),
      openAccessPdfUrl: item.openAccessPdfUrl || item.open_access?.oa_url || '',
      meshHeadings: Array.isArray(item.meshHeadings) ? item.meshHeadings : [],
      keywords: Array.isArray(item.keywords) ? item.keywords : [],
      pubType: Array.isArray(item.pubType) ? item.pubType : [type],
      peerReviewed: type !== 'preprint' && type !== 'posted-content'
    };
  }

  function mapCrossrefItem(item) {
    const title = typeof item.title === 'string' ? item.title : (Array.isArray(item.title) ? item.title[0] : '');
    const doi = item.DOI || item.doi ? String(item.DOI || item.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').trim() : '';
    let year = item.year ? Number(item.year) : null;
    if (!year) {
      const dp = item.published?.['date-parts']?.[0] || item['published-print']?.['date-parts']?.[0] || item['published-online']?.['date-parts']?.[0] || item.issued?.['date-parts']?.[0];
      if (Array.isArray(dp) && Number(dp[0]) > 1900) year = Number(dp[0]);
    }
    let authors = 'Unknown Authors';
    if (typeof item.authors === 'string') authors = item.authors;
    else if (Array.isArray(item.author)) authors = item.author.map(a => [a.given, a.family].filter(Boolean).join(' ') || a.name || '').filter(Boolean).join(', ') || authors;
    const abstract = clean(item.abstract || '').replace(/^(?:Abstract|Summary)\s*[:.-]?\s*/i, '');
    const type = Array.isArray(item.pubType) ? item.pubType[0] : (item.type || 'journal-article');
    return {
      sourceKey: 'crossref', source: 'crossref', sources: ['Crossref'],
      id: doi || item.URL || item.id || '',
      pmid: item.pmid || '', doi, pmcid: item.pmcid || '',
      title: clean(title) || 'Untitled Study',
      authors,
      authorObjects: Array.isArray(item.authorObjects) ? item.authorObjects : (Array.isArray(item.author) ? item.author.map(a => ({ family: a.family || '', given: a.given || '', displayName: [a.given, a.family].filter(Boolean).join(' ') })) : []),
      journal: clean(typeof item.journal === 'string' ? item.journal : ((Array.isArray(item['container-title']) && item['container-title'][0]) || item.publisher || 'Academic Journal')),
      volume: item.volume || '', issue: item.issue || '', pages: item.pages || item.page || '',
      year,
      abstract, abstractSource: abstract ? 'crossref' : 'none',
      citationCount: Number(item['is-referenced-by-count'] || item.citationCount || 0),
      isOpenAccess: Boolean(item.isOpenAccess || item.is_oa),
      openAccessPdfUrl: item.openAccessPdfUrl || '',
      meshHeadings: [],
      keywords: Array.isArray(item.subject) ? item.subject : (Array.isArray(item.keywords) ? item.keywords : []),
      pubType: [type],
      peerReviewed: type !== 'posted-content'
    };
  }

  function mapS2Item(item) {
    return {
      sourceKey: 's2', source: 's2', sources: ['Semantic Scholar'],
      id: item.paperId, paperId: item.paperId, s2PaperId: item.paperId,
      pmid: item.externalIds?.PubMed || '', doi: item.externalIds?.DOI || '', pmcid: item.externalIds?.PubMedCentral || '',
      title: clean(item.title) || 'Untitled Study',
      authors: Array.isArray(item.authors) ? item.authors.map(a => a.name).join(', ') : 'Unknown Authors',
      authorObjects: Array.isArray(item.authors) ? item.authors.map(a => ({ displayName: a.name || '' })) : [],
      journal: clean(item.venue || item.publicationVenue?.name || item.journal?.name || 'Academic Journal'),
      volume: item.journal?.volume || '', pages: item.journal?.pages || '',
      year: item.year || null,
      abstract: clean(item.abstract || ''), abstractSource: item.abstract ? 's2' : 'none',
      citationCount: Number(item.citationCount || 0),
      isOpenAccess: Boolean(item.openAccessPdf?.url),
      openAccessPdfUrl: item.openAccessPdf?.url || '',
      meshHeadings: [],
      keywords: Array.isArray(item.fieldsOfStudy) ? item.fieldsOfStudy.filter(Boolean) : [],
      pubType: Array.isArray(item.publicationTypes) ? item.publicationTypes.map(s => String(s).toLowerCase()) : []
    };
  }

  /** ClinicalTrials.gov API v2 study → SysRevAI record (registry record, PRISMA "Registers"). */
  function mapCtgovStudy(study) {
    const ps = study.protocolSection || {};
    const id = ps.identificationModule || {};
    const status = ps.statusModule || {};
    const design = ps.designModule || {};
    const refs = (ps.referencesModule?.references || []);
    const startDate = status.startDateStruct?.date || '';
    const allocation = design.designInfo?.allocation || '';
    const studyType = design.studyType || '';
    const pubType = ['clinical trial registration'];
    if (studyType) pubType.push(studyType.toLowerCase());
    if (allocation === 'RANDOMIZED' && studyType === 'INTERVENTIONAL') pubType.push('randomized controlled trial');
    const sponsor = ps.sponsorCollaboratorsModule?.leadSponsor?.name || '';
    const nctId = id.nctId || '';
    return {
      sourceKey: 'ctgov', source: 'ctgov', sources: ['ClinicalTrials.gov'],
      isRegistryRecord: true,
      id: nctId, nctId, nctIds: nctId ? [nctId] : [],
      secondaryIds: (id.secondaryIdInfos || []).map(s => s.id).filter(Boolean),
      title: clean(id.officialTitle || id.briefTitle || '') || 'Untitled registration',
      briefTitle: id.briefTitle || '',
      authors: sponsor || 'Unknown Authors',
      journal: 'ClinicalTrials.gov',
      year: startDate ? Number(String(startDate).slice(0, 4)) : null,
      startDate, completionDate: status.completionDateStruct?.date || '',
      overallStatus: status.overallStatus || '',
      abstract: clean(ps.descriptionModule?.briefSummary || ''),
      abstractSource: ps.descriptionModule?.briefSummary ? 'ctgov' : 'none',
      conditions: ps.conditionsModule?.conditions || [],
      interventions: (ps.armsInterventionsModule?.interventions || []).map(i => i.name).filter(Boolean),
      keywords: [...(ps.conditionsModule?.conditions || []), ...(ps.conditionsModule?.keywords || [])],
      studyType, phases: design.phases || [], allocation,
      enrollment: design.enrollmentInfo?.count ?? null,
      sponsor,
      hasResults: !!study.hasResults,
      referencePmids: refs.filter(r => r.pmid && (r.type === 'RESULT' || r.type === 'DERIVED')).map(r => String(r.pmid)),
      allReferencePmids: refs.filter(r => r.pmid).map(r => String(r.pmid)),
      url: nctId ? `https://clinicaltrials.gov/study/${nctId}` : '',
      pubType, meshHeadings: [], citationCount: 0, peerReviewed: false
    };
  }

  /** SerpApi google_scholar organic result → SysRevAI record (before enrichment). */
  function mapScholarResult(r) {
    const summary = r.publication_info?.summary || '';
    const segs = summary.split(/\s+-\s+/);
    const years = summary.match(/\b(19|20)\d{2}\b/g);
    const year = years ? Number(years[years.length - 1]) : null;
    let journal = segs.length >= 2 ? segs[1].replace(/,?\s*\b(19|20)\d{2}\b.*$/, '').replace(/…|\.\.\./g, '').trim() : '';
    const authorNames = Array.isArray(r.publication_info?.authors) && r.publication_info.authors.length
      ? r.publication_info.authors.map(a => a.name).filter(Boolean)
      : (segs[0] ? segs[0].replace(/…|\.\.\./g, '').split(',').map(s => s.trim()).filter(Boolean) : []);
    const pdf = (r.resources || []).find(x => /pdf/i.test(x.file_format || ''));
    return {
      sourceKey: 'scholar', source: 'scholar', sources: ['Google Scholar'],
      id: r.result_id || r.link || r.title,
      scholarResultId: r.result_id || '',
      scholarClusterId: r.inline_links?.versions?.cluster_id || '',
      title: clean(r.title || '') || 'Untitled Study',
      authors: authorNames.join(', ') || 'Unknown Authors',
      authorObjects: authorNames.map(n => ({ displayName: n, family: n.split(/\s+/).pop() })),
      journal: journal || 'Unknown source',
      year,
      abstract: '', abstractSource: 'none',
      scholarSnippet: clean(r.snippet || ''),
      link: r.link || '',
      citationCount: Number(r.inline_links?.cited_by?.total || 0),
      openAccessPdfUrl: pdf ? pdf.link : '',
      isOpenAccess: !!pdf,
      pubType: [], meshHeadings: [], keywords: []
    };
  }

  // ─────────────────────────────────────────────────────────────
  // RIS parser (Cochrane CENTRAL export)
  // ─────────────────────────────────────────────────────────────
  function parseRIS(text) {
    const records = [];
    let cur = null;
    let lastTag = null;
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(line => {
      const m = line.match(/^([A-Z][A-Z0-9])  -\s?(.*)$/);
      if (m) {
        const tag = m[1];
        const val = m[2].trim();
        if (tag === 'TY') { cur = { TY: [val] }; lastTag = 'TY'; return; }
        if (tag === 'ER') { if (cur) records.push(cur); cur = null; lastTag = null; return; }
        if (!cur) cur = {};
        (cur[tag] = cur[tag] || []).push(val);
        lastTag = tag;
      } else if (cur && lastTag && line.trim()) {
        const arr = cur[lastTag];
        arr[arr.length - 1] = `${arr[arr.length - 1]} ${line.trim()}`;
      }
    });
    if (cur && Object.keys(cur).length > 1) records.push(cur);

    return records.map((r, idx) => {
      const f = tag => (r[tag] && r[tag][0]) || '';
      const all = Object.values(r).flat().join(' ');
      const urls = r.UR || [];
      let pmid = '';
      const an = (r.AN || []).join(' ');
      const anPm = an.match(/pubmed\D{0,3}(\d{1,9})/i) || (an.trim().match(/^\d{1,9}$/) ? [null, an.trim()] : null);
      if (anPm) pmid = anPm[1];
      if (!pmid) {
        const u = urls.join(' ').match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})|ncbi\.nlm\.nih\.gov\/pubmed\/(\d{1,9})/i);
        if (u) pmid = u[1] || u[2];
      }
      const centralMatch = all.match(/CN-\d{6,9}/i);
      const sp = f('SP'); const ep = f('EP');
      const journal = f('JO') || f('T2') || f('JF') || f('JA');
      const doiRaw = f('DO') || ((urls.join(' ').match(/doi\.org\/(10\.[^\s]+)/i) || [])[1] || '');
      const isRegistry = /clinicaltrials\.gov|ictrp|who international clinical trials|eu clinical trials register|isrctn|ctri/i.test(journal) || (/^CTR$/i.test(f('TY')));
      const yearM = (f('PY') || f('Y1') || f('DA')).match(/(19|20)\d{2}/);
      return {
        sourceKey: 'cochrane_central', source: 'cochrane_central', sources: ['Cochrane CENTRAL'],
        id: centralMatch ? centralMatch[0].toUpperCase() : `ris-${idx + 1}`,
        centralId: centralMatch ? centralMatch[0].toUpperCase() : '',
        risType: f('TY'),
        title: clean(f('TI') || f('T1')) || 'Untitled record',
        authors: (r.AU || r.A1 || []).join(', ') || 'Unknown Authors',
        authorObjects: (r.AU || r.A1 || []).map(n => ({ displayName: n, family: n.split(',')[0].trim() })),
        journal: clean(journal) || 'Cochrane CENTRAL record',
        volume: f('VL'), issue: f('IS'), pages: sp ? (ep ? `${sp}-${ep}` : sp) : '',
        year: yearM ? Number(yearM[0]) : null,
        doi: doiRaw, pmid,
        abstract: clean((r.AB || r.N2 || []).join(' ')),
        abstractSource: (r.AB || r.N2) ? 'cochrane_central' : 'none',
        keywords: r.KW || [],
        nctIds: (all.toUpperCase().match(/NCT\d{8}/g) || []).filter((v, i, a) => a.indexOf(v) === i),
        url: urls[0] || '',
        isRegistryRecord: isRegistry,
        pubType: isRegistry ? ['clinical trial registration'] : [], meshHeadings: [], citationCount: 0
      };
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Result helpers
  // ─────────────────────────────────────────────────────────────
  function searchEntry(src, iface, endpoint, query, extra = {}) {
    return Object.assign({ sourceKey: src, interface: iface, endpoint, query, timestamp: nowIso(), hitCount: 0, retrievedCount: 0, status: 'ok', error: null }, extra);
  }

  function finalize(key, searches, records, extra = {}) {
    const okSearches = searches.filter(s => s.status === 'ok');
    const status = extra.status || (okSearches.length ? 'ok' : 'failed');
    const failures = searches.filter(s => s.status !== 'ok').map(s => `${s.interface}: ${s.error}`);
    return Object.assign({
      key,
      status,
      records: status === 'ok' ? records : [],
      hitCount: okSearches.reduce((a, s) => a + Number(s.hitCount || 0), 0),
      retrievedCount: status === 'ok' ? records.length : 0,
      searches,
      error: status === 'failed' ? (failures.join('; ') || 'search failed') : null,
      warnings: status === 'ok' && failures.length ? failures : []
    }, extra);
  }

  // ─────────────────────────────────────────────────────────────
  // Adapters
  // ─────────────────────────────────────────────────────────────
  async function searchEuropePmc(query, limit, signal, sourceKey, sourceName, iface) {
    const params = new URLSearchParams({ query, resultType: 'core', pageSize: String(limit), format: 'json' });
    const url = `${EPMC_SEARCH}?${params.toString()}`;
    const r = await fetchJson(url, { signal, timeoutMs: 9000 });
    const entry = searchEntry(sourceKey, iface, EPMC_SEARCH, query);
    if (!r.ok || !r.json) return { entry: Object.assign(entry, { status: 'failed', error: httpError(r, 'Europe PMC') }), records: [] };
    const results = r.json.resultList?.result || [];
    const records = results.map(it => mapEuropePmcItem(it, sourceKey, sourceName));
    entry.hitCount = Number(r.json.hitCount || results.length);
    entry.retrievedCount = records.length;
    return { entry, records };
  }

  async function searchPubmedProxy(term, s, limit, signal, sourceKey, sourceName, iface) {
    const params = new URLSearchParams({ term, retmax: String(limit) });
    if (s.yearFrom) { params.set('mindate', String(s.yearFrom)); params.set('maxdate', String(s.yearTo)); }
    const r = await fetchJson(`/api/pubmed?${params.toString()}`, { signal, timeoutMs: 15000 });
    const shownQuery = s.yearFrom ? `${term} — limits: publication date ${s.yearFrom}–${s.yearTo} (datetype=pdat)` : term;
    const entry = searchEntry(sourceKey, iface, 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi + efetch.fcgi', shownQuery);
    if (!r.ok || !r.json || !Array.isArray(r.json.records)) return { entry: Object.assign(entry, { status: 'failed', error: httpError(r, 'PubMed') }), records: [] };
    const records = r.json.records.map(rec => Object.assign({}, rec, { sourceKey, source: sourceKey, sources: [sourceName], abstractSource: rec.abstract ? sourceKey : 'none' }));
    entry.hitCount = Number(r.json.hitCount || records.length);
    entry.retrievedCount = records.length;
    return { entry, records };
  }

  const adapters = {
    async pubmed(s, opts, signal) {
      const q = translators.pubmed(s);
      const { entry, records } = await searchPubmedProxy(q, s, s.perSourceLimit, signal, 'pubmed', 'PubMed', 'PubMed via NCBI E-utilities');
      return finalize('pubmed', [entry], records);
    },

    async epmc(s, opts, signal) {
      const { entry, records } = await searchEuropePmc(translators.epmc(s), s.perSourceLimit, signal, 'epmc', 'Europe PMC', 'Europe PMC REST API');
      return finalize('epmc', [entry], records);
    },

    async epmc_preprints(s, opts, signal) {
      const { entry, records } = await searchEuropePmc(translators.epmc_preprints(s), s.perSourceLimit, signal, 'epmc_preprints', 'Europe PMC Preprints', 'Europe PMC REST API (SRC:PPR)');
      records.forEach(r => { r.peerReviewed = false; });
      return finalize('epmc_preprints', [entry], records);
    },

    async cochrane_cdsr(s, opts, signal) {
      const name = 'Cochrane Database of Systematic Reviews';
      const [pm, ep] = await Promise.all([
        searchPubmedProxy(translators.cochrane_cdsr_pubmed(s), s, s.perSourceLimit, signal, 'cochrane_cdsr', name, 'PubMed journal filter ("Cochrane Database Syst Rev"[ta])'),
        searchEuropePmc(translators.cochrane_cdsr_epmc(s), s.perSourceLimit, signal, 'cochrane_cdsr', name, 'Europe PMC journal filter (JOURNAL:"Cochrane Database Syst Rev")')
      ]);
      const records = [...pm.records, ...ep.records];
      records.forEach(r => { r.isCochraneReview = true; });
      return finalize('cochrane_cdsr', [pm.entry, ep.entry], records);
    },

    async cochrane_central(s, opts) {
      const generated = buildCochraneLibrarySearch(s);
      const imp = opts && opts.centralImport;
      if (!imp || !Array.isArray(imp.records)) {
        const entry = searchEntry('cochrane_central', 'Cochrane Library (CENTRAL) — user-exported RIS', 'https://www.cochranelibrary.com/advanced-search', generated.searchManager, { status: 'not_searched', error: 'CENTRAL export not provided', timestamp: null });
        return finalize('cochrane_central', [entry], [], { status: 'not_searched', reason: 'CENTRAL export not provided' });
      }
      const entry = searchEntry('cochrane_central', 'Cochrane Library (CENTRAL) — user-exported RIS', 'https://www.cochranelibrary.com/advanced-search', imp.query || generated.searchManager, {
        timestamp: imp.importedAt || nowIso(), hitCount: imp.records.length, retrievedCount: imp.records.length, fileName: imp.fileName || ''
      });
      return finalize('cochrane_central', [entry], imp.records.map(r => Object.assign({}, r)));
    },

    async ctgov(s, opts, signal) {
      const q = translators.ctgov(s);
      const params = new URLSearchParams({ pageSize: String(s.perSourceLimit) });
      if (q.term) params.set('term', q.term);
      if (q.cond) params.set('cond', q.cond);
      if (q.intr) params.set('intr', q.intr);
      if (s.yearFrom) params.set('startFrom', String(s.yearFrom));
      const shown = [q.term ? `query.term=${q.term}` : '', q.cond ? `query.cond=${q.cond}` : '', q.intr ? `query.intr=${q.intr}` : '', s.yearFrom ? `filter.advanced=AREA[StartDate]RANGE[${s.yearFrom}-01-01,MAX]` : ''].filter(Boolean).join(' & ');
      const entry = searchEntry('ctgov', 'ClinicalTrials.gov API v2', 'https://clinicaltrials.gov/api/v2/studies', shown);
      const r = await fetchJson(`/api/ctgov?${params.toString()}`, { signal, timeoutMs: 12000 });
      if (!r.ok || !r.json) return finalize('ctgov', [Object.assign(entry, { status: 'failed', error: httpError(r, 'ClinicalTrials.gov') })], []);
      const records = (r.json.studies || []).map(mapCtgovStudy);
      entry.hitCount = Number(r.json.totalCount ?? records.length);
      entry.retrievedCount = records.length;
      return finalize('ctgov', [entry], records);
    },

    async s2(s, opts, signal) {
      const q = translators.s2(s);
      const fields = 'paperId,title,authors,year,abstract,venue,publicationVenue,journal,externalIds,openAccessPdf,citationCount,publicationTypes,fieldsOfStudy';
      let qp = `query=${encodeURIComponent(q)}&limit=${s.perSourceLimit}&fields=${encodeURIComponent(fields)}`;
      if (s.yearFrom) qp += `&year=${s.yearFrom}-${s.yearTo}`;
      const entry = searchEntry('s2', 'Semantic Scholar Graph API v1 (relevance search; plain-text query, no Boolean support)', 'https://api.semanticscholar.org/graph/v1/paper/search', s.yearFrom ? `${q} — limits: year ${s.yearFrom}–${s.yearTo}` : q);
      const r = await fetchJson(`/api/s2?${qp}`, { signal, timeoutMs: 9000 });
      if (!r.ok || !r.json) return finalize('s2', [Object.assign(entry, { status: 'failed', error: httpError(r, 'Semantic Scholar') })], []);
      const records = (r.json.data || []).map(mapS2Item);
      entry.hitCount = Number(r.json.total || records.length);
      entry.retrievedCount = records.length;
      return finalize('s2', [entry], records);
    },

    async openalex(s, opts, signal) {
      const q = translators.openalex(s);
      const params = new URLSearchParams({ query: q, limit: String(s.perSourceLimit) });
      if (s.yearFrom) params.set('year', `${s.yearFrom}-${s.yearTo}`);
      const entry = searchEntry('openalex', 'OpenAlex Works API (search=)', 'https://api.openalex.org/works', s.yearFrom ? `${q} — limits: publication_year ${s.yearFrom}–${s.yearTo}` : q);
      const r = await fetchJson(`/api/openalex?${params.toString()}`, { signal, timeoutMs: 9500 });
      if (!r.ok || !r.json) return finalize('openalex', [Object.assign(entry, { status: 'failed', error: httpError(r, 'OpenAlex') })], []);
      const items = r.json.data || r.json.papers || r.json.results || [];
      const records = items.map(mapOpenAlexItem);
      entry.hitCount = Number(r.json.total || r.json.meta?.count || records.length);
      entry.retrievedCount = records.length;
      return finalize('openalex', [entry], records);
    },

    async crossref(s, opts, signal) {
      const q = translators.crossref(s);
      const params = new URLSearchParams({ query: q, rows: String(s.perSourceLimit) });
      if (s.yearFrom) params.set('year', `${s.yearFrom}-${s.yearTo}`);
      const entry = searchEntry('crossref', 'Crossref REST API (query=, relevance)', 'https://api.crossref.org/works', s.yearFrom ? `${q} — limits: from-pub-date ${s.yearFrom}-01-01, until-pub-date ${s.yearTo}-12-31` : q);
      const r = await fetchJson(`/api/crossref?${params.toString()}`, { signal, timeoutMs: 9500 });
      if (!r.ok || !r.json) return finalize('crossref', [Object.assign(entry, { status: 'failed', error: httpError(r, 'Crossref') })], []);
      const items = r.json.data || r.json.papers || r.json.message?.items || [];
      const records = items.map(mapCrossrefItem);
      entry.hitCount = Number(r.json.total || r.json.message?.['total-results'] || records.length);
      entry.retrievedCount = records.length;
      return finalize('crossref', [entry], records);
    },

    async scholar(s, opts, signal) {
      const q = translators.scholar(s);
      const shown = s.yearFrom ? `${q} — limits: as_ylo=${s.yearFrom}, as_yhi=${s.yearTo}, as_vis=1 (citations excluded)` : `${q} — as_vis=1 (citations excluded)`;
      const entry = searchEntry('scholar', 'Google Scholar via SerpApi (engine=google_scholar)', 'https://serpapi.com/search.json?engine=google_scholar', shown);
      const raw = [];
      let total = 0;
      for (let start = 0; start < s.perSourceLimit; start += 20) {
        const num = Math.min(20, s.perSourceLimit - start);
        const params = new URLSearchParams({ q, start: String(start), num: String(num) });
        if (s.yearFrom) { params.set('as_ylo', String(s.yearFrom)); params.set('as_yhi', String(s.yearTo)); }
        const r = await fetchJson(`/api/scholar?${params.toString()}`, { signal, timeoutMs: 12000 });
        if (r.json && r.json.error === 'not_configured') {
          Object.assign(entry, { status: 'not_configured', error: `not configured: ${r.json.missing || 'SERPAPI_KEY'} missing`, timestamp: null });
          return finalize('scholar', [entry], [], { status: 'not_configured', reason: `${r.json.missing || 'SERPAPI_KEY'} missing` });
        }
        if (!r.ok || !r.json) {
          if (start === 0) return finalize('scholar', [Object.assign(entry, { status: 'failed', error: httpError(r, 'Google Scholar') })], []);
          entry.note = `Pagination stopped at offset ${start}: ${httpError(r, 'Google Scholar')}`;
          break;
        }
        total = Number(r.json.total_results || total || 0);
        const page = (r.json.organic_results || []).map(mapScholarResult);
        raw.push(...page);
        if (page.length < num) break;
      }
      const enricher = opts && typeof opts.enrichScholar === 'function' ? opts.enrichScholar : enrichScholarRecords;
      const records = await enricher(raw, signal);
      entry.hitCount = total || records.length;
      entry.retrievedCount = records.length;
      return finalize('scholar', [entry], records);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Google Scholar enrichment (Crossref DOI match → Europe PMC / OpenAlex)
  // ─────────────────────────────────────────────────────────────
  function jaccard(a, b) {
    const ta = G('getTitleTokens') ? G('getTitleTokens')(a) : new Set(String(a).toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const tb = G('getTitleTokens') ? G('getTitleTokens')(b) : new Set(String(b).toLowerCase().split(/\W+/).filter(w => w.length > 2));
    if (!ta.size || !tb.size) return 0;
    let i = 0; ta.forEach(t => { if (tb.has(t)) i++; });
    return i / (ta.size + tb.size - i);
  }

  async function enrichScholarRecord(rec, signal) {
    const out = Object.assign({}, rec, { enrichment: { crossref: 'not attempted', abstract: 'none' } });
    if (!out.doi) {
      const firstAuthor = (out.authorObjects && out.authorObjects[0] && out.authorObjects[0].family) || '';
      const params = new URLSearchParams({ bibliographic: `${out.title} ${firstAuthor}`.trim(), rows: '3' });
      const r = await fetchJson(`/api/crossref?${params.toString()}`, { signal, timeoutMs: 8000, retries: 1 });
      const items = r.ok && r.json ? (r.json.data || r.json.papers || []) : [];
      const match = items.map(mapCrossrefItem).find(c => c.doi && out.year && c.year && Math.abs(out.year - c.year) <= 1 && jaccard(out.title, c.title) >= 0.90);
      out.enrichment.crossref = match ? `matched ${match.doi}` : (r.ok ? 'no match (Jaccard ≥ 0.90 and |Δyear| ≤ 1 required)' : `lookup failed (${httpError(r, 'Crossref')})`);
      if (match) {
        out.doi = match.doi;
        if (!out.volume && match.volume) out.volume = match.volume;
        if (!out.issue && match.issue) out.issue = match.issue;
        if (!out.pages && match.pages) out.pages = match.pages;
        if ((!out.journal || out.journal === 'Unknown source') && match.journal) out.journal = match.journal;
      }
    }
    if (out.doi) {
      const q = `DOI:"${out.doi}"`;
      const params = new URLSearchParams({ query: q, resultType: 'core', pageSize: '1', format: 'json' });
      const r = await fetchJson(`${EPMC_SEARCH}?${params.toString()}`, { signal, timeoutMs: 8000, retries: 1 });
      const hit = r.ok && r.json ? (r.json.resultList?.result || [])[0] : null;
      if (hit) {
        const m = mapEuropePmcItem(hit, 'epmc', 'Europe PMC');
        if (!out.pmid && m.pmid) out.pmid = m.pmid;
        if (!out.pmcid && m.pmcid) out.pmcid = m.pmcid;
        if (m.meshHeadings.length) out.meshHeadings = m.meshHeadings;
        if (m.pubType.length) out.pubType = m.pubType;
        if (m.abstract) { out.abstract = m.abstract; out.abstractSource = 'europepmc-enrichment'; out.enrichment.abstract = 'Europe PMC'; }
      }
      if (!out.abstract) {
        const r2 = await fetchJson(`/api/openalex?${new URLSearchParams({ doi: out.doi }).toString()}`, { signal, timeoutMs: 8000, retries: 1 });
        const item = r2.ok && r2.json ? (r2.json.data || [])[0] : null;
        if (item) {
          const m = mapOpenAlexItem(item);
          if (!out.pmid && m.pmid) out.pmid = m.pmid;
          if (m.abstract) { out.abstract = m.abstract; out.abstractSource = 'openalex-enrichment'; out.enrichment.abstract = 'OpenAlex'; }
        }
      }
    }
    if (!out.abstract) { out.abstract = ''; out.abstractSource = 'none'; }
    return out;
  }

  async function enrichScholarRecords(records, signal, concurrency = 4) {
    const out = new Array(records.length);
    let next = 0;
    async function worker() {
      while (next < records.length) {
        const i = next++;
        try { out[i] = await enrichScholarRecord(records[i], signal); }
        catch (e) {
          if (signal && signal.aborted) throw e;
          out[i] = Object.assign({}, records[i], { abstract: '', abstractSource: 'none', enrichment: { error: e.message } });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, records.length) }, worker));
    return out;
  }

  // ─────────────────────────────────────────────────────────────
  // Mandatory source registry (spec 2)
  // ─────────────────────────────────────────────────────────────
  const SOURCE_REGISTRY = [
    { key: 'pubmed', shortName: 'PubMed', displayName: 'PubMed / MEDLINE', icon: '🩺', interfaceLabel: 'PubMed via NCBI E-utilities', prismaCategory: 'database', requiresKey: null, optionalKey: 'NCBI_API_KEY', peerReviewed: true, description: 'NLM biomedical citation index (MEDLINE, PMC, in-process)' },
    { key: 'scholar', shortName: 'Google Scholar', displayName: 'Google Scholar', icon: '🎓', interfaceLabel: 'Google Scholar via SerpApi', prismaCategory: 'other', requiresKey: 'SERPAPI_KEY', peerReviewed: true, description: 'Web search engine (other methods); records enriched via Crossref/Europe PMC' },
    { key: 'cochrane_cdsr', shortName: 'Cochrane CDSR', displayName: 'Cochrane Library: Cochrane Database of Systematic Reviews', icon: '📘', interfaceLabel: 'Cochrane Database of Systematic Reviews via PubMed and Europe PMC journal filter', prismaCategory: 'database', requiresKey: null, peerReviewed: true, description: 'Existing Cochrane reviews (background / citation searching, not screened as primary studies)' },
    { key: 'cochrane_central', shortName: 'Cochrane CENTRAL', displayName: 'Cochrane Library: CENTRAL', icon: '📗', interfaceLabel: 'Cochrane CENTRAL via user-exported RIS from the Cochrane Library', prismaCategory: 'database', requiresKey: null, manual: true, peerReviewed: true, description: 'Cochrane Central Register of Controlled Trials (manual RIS export required)' },
    { key: 'ctgov', shortName: 'ClinicalTrials.gov', displayName: 'ClinicalTrials.gov', icon: '🧪', interfaceLabel: 'ClinicalTrials.gov API v2', prismaCategory: 'register', requiresKey: null, peerReviewed: false, description: 'Trial registrations (PRISMA "Registers")' },
    { key: 'epmc', shortName: 'Europe PMC', displayName: 'Europe PMC', icon: '🇪🇺', interfaceLabel: 'Europe PMC REST API (MEDLINE + PMC)', prismaCategory: 'database', requiresKey: null, peerReviewed: true, description: 'MEDLINE, PubMed Central & life-science literature' },
    { key: 'epmc_preprints', shortName: 'Preprints (EPMC)', displayName: 'Preprints (medRxiv / bioRxiv / Research Square)', icon: '📝', interfaceLabel: 'Europe PMC REST API preprint source (SRC:PPR)', prismaCategory: 'database', requiresKey: null, peerReviewed: false, description: 'Not peer reviewed; borderline by default' },
    { key: 's2', shortName: 'Semantic Scholar', displayName: 'Semantic Scholar', icon: '🧠', interfaceLabel: 'Semantic Scholar Graph API v1', prismaCategory: 'database', requiresKey: null, optionalKey: 'S2_API_KEY', peerReviewed: true, description: 'AI academic graph' },
    { key: 'openalex', shortName: 'OpenAlex', displayName: 'OpenAlex', icon: '🏛️', interfaceLabel: 'OpenAlex Works API', prismaCategory: 'database', requiresKey: null, optionalKey: 'OPENALEX_API_KEY', peerReviewed: true, description: 'Open global scholarly graph' },
    { key: 'crossref', shortName: 'Crossref', displayName: 'Crossref', icon: '🔍', interfaceLabel: 'Crossref REST API', prismaCategory: 'database', requiresKey: null, peerReviewed: true, description: 'DOI registration agency metadata' }
  ];
  SOURCE_REGISTRY.forEach(src => {
    src.fetch = (strategy, opts, signal) => adapters[src.key](strategy, opts || {}, signal);
    src.translateQuery = strategy => {
      if (src.key === 'cochrane_cdsr') return `PubMed: ${translators.cochrane_cdsr_pubmed(strategy)}\nEurope PMC: ${translators.cochrane_cdsr_epmc(strategy)}`;
      if (src.key === 'cochrane_central') return buildCochraneLibrarySearch(strategy).searchManager;
      const t = translators[src.key](strategy);
      return typeof t === 'string' ? t : Object.entries(t).map(([k, v]) => `query.${k}=${v}`).join(' & ');
    };
    Object.freeze(src);
  });
  Object.freeze(SOURCE_REGISTRY);

  function getSource(key) { return SOURCE_REGISTRY.find(s => s.key === key) || null; }

  const api = {
    SOURCE_REGISTRY, getSource, buildSearchStrategy, tokenizeQuery, translators, buildCochraneLibrarySearch,
    parseRIS, mapCtgovStudy, mapScholarResult, mapEuropePmcItem, mapOpenAlexItem, mapCrossrefItem, mapS2Item,
    enrichScholarRecord, enrichScholarRecords, fetchJson, MAX_PER_SOURCE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  Object.keys(api).forEach(k => { root[k] = api[k]; if (typeof globalThis !== 'undefined' && globalThis !== root) globalThis[k] = api[k]; });
  root.SysRevSources = api;
})(typeof window !== 'undefined' ? window : globalThis);
