/**
 * SysRevAI — Cluster-based deduplication & study-level linking engine.
 *
 * Guarantees (see CHANGELOG Phase 9):
 *  - Union-find clustering over every raw record, so duplicates are merged
 *    transitively (X{pmid:1} · Y{doi:A} · Z{pmid:1, doi:A} → one record).
 *  - Conflict guard: a cluster may never hold two distinct PMIDs, two distinct
 *    published DOIs, two distinct preprint DOIs or two distinct Cochrane review
 *    numbers. Reviewer "not a duplicate" overrides are honoured as cannot-link pairs.
 *  - Study-level linking: preprint ↔ published, registry ↔ publication,
 *    errata / retraction notices → parent (linked, never merged),
 *    Cochrane .pubN versions → latest version.
 *  - Every merge / link is written to an audit log.
 *
 * Works as a classic <script> (exports onto window) and as a CommonJS module.
 */
(function (root) {
  'use strict';
  const G = name => (root && typeof root[name] === 'function') ? root[name] : ((typeof globalThis !== 'undefined' && typeof globalThis[name] === 'function') ? globalThis[name] : null);

  // ─────────────────────────────────────────────────────────────
  // Source priority (lower = preferred primary record)
  // PubMed > Europe PMC > CENTRAL > Crossref > OpenAlex > S2 > Scholar > preprint > registry
  // ─────────────────────────────────────────────────────────────
  const SOURCE_PRIORITY = [
    'pubmed', 'epmc', 'cochrane_cdsr', 'cochrane_central', 'crossref', 'openalex', 's2',
    'scholar', 'manual_import', 'project_load', 'epmc_preprints', 'ctgov'
  ];

  const LEGACY_SOURCE_NAMES = {
    pubmed: 'PubMed', epmc: 'Europe PMC', s2: 'Semantic Scholar', openalex: 'OpenAlex',
    crossref: 'Crossref', scholar: 'Google Scholar', ctgov: 'ClinicalTrials.gov',
    epmc_preprints: 'Europe PMC Preprints', cochrane_cdsr: 'Cochrane Database of Systematic Reviews',
    cochrane_central: 'Cochrane CENTRAL', manual_import: 'Manual import'
  };

  const PREPRINT_DOI_PREFIXES = ['10.1101/', '10.21203/', '10.20944/', '10.31219/', '10.31234/', '10.2139/ssrn', '10.48550/', '10.22541/', '10.36227/', '10.1002/essoar'];

  // ─────────────────────────────────────────────────────────────
  // Text helpers (self-contained; no dependency on index.html)
  // ─────────────────────────────────────────────────────────────
  function stripHtml(str) {
    if (!str) return '';
    if (G('cleanHtmlText')) return G('cleanHtmlText')(str);
    return String(str)
      .replace(/<\/?[a-z][a-z0-9:-]*[^>]*>/gi, ' ')
      .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function asciiFold(str) {
    return String(str || '').normalize ? String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '') : String(str || '');
  }

  // ─────────────────────────────────────────────────────────────
  // Identifier normalisation (spec 3.2)
  // ─────────────────────────────────────────────────────────────
  function normalizeDOI(doi) {
    if (!doi || typeof doi !== 'string') return '';
    let d = doi.trim();
    try { if (/%[0-9a-f]{2}/i.test(d)) d = decodeURIComponent(d); } catch (e) { /* keep raw */ }
    return d
      .toLowerCase()
      .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*|https?:\/\/)/i, '')
      .replace(/^(?:dx\.)?doi\.org\//i, '')
      .replace(/[.;,\/\s]+$/, '')
      .trim();
  }

  function normalizePMID(pmid) {
    if (!pmid) return '';
    const s = String(pmid).replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, '');
    const m = s.match(/\d{1,9}/);
    return m ? String(Number(m[0])) : '';
  }

  function normalizePMCID(pmcid) {
    if (!pmcid) return '';
    const m = String(pmcid).toUpperCase().match(/(?:PMC)?(\d{3,10})/);
    return m ? `PMC${m[1]}` : '';
  }

  function normalizeOpenAlexId(id) {
    if (!id) return '';
    const m = String(id).match(/W\d{3,}/i);
    return m ? m[0].toUpperCase() : '';
  }

  function normalizeS2Id(id) {
    if (!id) return '';
    const m = String(id).match(/^[0-9a-f]{40}$/i);
    return m ? m[0].toLowerCase() : '';
  }

  function extractNctIds(...values) {
    const out = new Set();
    values.flat(Infinity).forEach(v => {
      if (!v) return;
      const matches = String(v).toUpperCase().match(/NCT\d{8}/g);
      if (matches) matches.forEach(m => out.add(m));
    });
    return Array.from(out);
  }

  function extractOtherRegistryIds(...values) {
    const out = new Set();
    const text = values.flat(Infinity).filter(Boolean).join(' ');
    (text.match(/ISRCTN\d{8}/gi) || []).forEach(m => out.add(m.toUpperCase()));
    (text.match(/\b\d{4}-\d{6}-\d{2}\b/g) || []).forEach(m => out.add(`EUDRACT:${m}`));
    (text.match(/CTRI\/\d{4}\/\d{2,3}\/\d{6}/gi) || []).forEach(m => out.add(m.toUpperCase()));
    return Array.from(out);
  }

  /** "10.1002/14651858.CD012345.pub3" → { id: 'CD012345', version: 3 } */
  function parseCochraneDoi(doi) {
    const d = normalizeDOI(doi);
    const m = d.match(/14651858\.(cd\d{6})(?:\.pub(\d+))?/i);
    if (!m) return null;
    return { id: m[1].toUpperCase(), version: m[2] ? Number(m[2]) : 1 };
  }

  function isPreprintDoi(doi) {
    const d = normalizeDOI(doi);
    return !!d && PREPRINT_DOI_PREFIXES.some(p => d.startsWith(p));
  }

  // ─────────────────────────────────────────────────────────────
  // Title helpers
  // ─────────────────────────────────────────────────────────────
  const RETRACTED_SELF_RX = /^\s*(?:\[\s*retracted\s*\]|retracted(?:\s+article)?\s*[:\-–])\s*/i;
  const NOTICE_RX = [
    { type: 'retraction', rx: /^\s*(?:notice\s+of\s+retraction|retraction\s+note|retraction\s+notice|retraction(?:\s+of)?(?:\s+publication)?)\s*(?:to|of|for)?\s*[:\-–]?\s*/i },
    { type: 'erratum', rx: /^\s*(?:erratum|errata|corrigendum|corrigenda|correction|publisher\s+correction|author\s+correction)\s*(?:to|of|for|in)?\s*[:\-–]\s*/i },
    { type: 'erratum', rx: /^\s*(?:erratum|errata|corrigendum|correction)\s+(?:to|of|for|in)\s+/i },
    { type: 'comment', rx: /^\s*(?:comment(?:ary)?\s+on|reply\s+to|response\s+to|expression\s+of\s+concern)\s*[:\-–]?\s*/i }
  ];

  function detectNotice(record) {
    const title = stripHtml(record.title || '');
    for (const n of NOTICE_RX) {
      if (n.rx.test(title)) {
        const stripped = title.replace(n.rx, '').replace(/^["'“”]+|["'“”.]+$/g, '').trim();
        if (stripped.length > 10) return { type: n.type, parentTitle: stripped };
      }
    }
    const pubTypes = (Array.isArray(record.pubType) ? record.pubType : [record.pubType]).filter(Boolean).map(s => String(s).toLowerCase());
    if (pubTypes.some(t => t === 'retraction of publication' || t === 'retraction notice')) return { type: 'retraction', parentTitle: title };
    if (pubTypes.some(t => t === 'published erratum' || t === 'erratum' || t === 'correction')) return { type: 'erratum', parentTitle: title };
    return null;
  }

  function titleForMatching(t) {
    return stripHtml(t || '').replace(RETRACTED_SELF_RX, '');
  }

  function normalizeTitle(t) {
    if (!t) return '';
    return asciiFold(titleForMatching(t))
      .replace(/&amp;/gi, ' and ')
      .replace(/&/g, ' and ')
      .replace(/&beta;|β/gi, 'beta')
      .replace(/&alpha;|α/gi, 'alpha')
      .replace(/&#8211;|&#x2013;|–|—/g, '-')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function getTitleTokens(t) {
    if (!t) return new Set();
    const cleaned = asciiFold(titleForMatching(t))
      .replace(/&amp;/gi, ' and ')
      .replace(/&/g, ' and ')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ');
    return new Set(cleaned.split(/\s+/).filter(w => w.length > 2));
  }

  function titleJaccard(tokensA, tokensB) {
    if (!tokensA || !tokensB || !tokensA.size || !tokensB.size) return 0;
    let intersection = 0;
    for (const token of tokensA) if (tokensB.has(token)) intersection++;
    const union = tokensA.size + tokensB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  // ─────────────────────────────────────────────────────────────
  // Author helpers
  // ─────────────────────────────────────────────────────────────
  function surnameTokens(record, maxAuthors = 1) {
    const names = [];
    if (Array.isArray(record.authorObjects) && record.authorObjects.length) {
      record.authorObjects.slice(0, maxAuthors).forEach(a => {
        if (!a) return;
        names.push(a.family || a.lastName || a.displayName || a.name || '');
      });
    }
    if (!names.filter(Boolean).length && typeof record.authors === 'string' && !/^unknown authors$/i.test(record.authors.trim())) {
      record.authors.split(/[,;]|\band\b/).slice(0, maxAuthors).forEach(n => names.push(n));
    } else if (!names.filter(Boolean).length && Array.isArray(record.authors)) {
      record.authors.slice(0, maxAuthors).forEach(n => names.push(typeof n === 'string' ? n : (n?.name || '')));
    }
    const out = new Set();
    names.filter(Boolean).forEach(n => {
      asciiFold(n).toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/)
        .filter(tok => tok.length >= 2 && !/^(jr|sr|ii|iii|md|phd|et|al)$/.test(tok))
        .forEach(tok => out.add(tok));
    });
    return out;
  }

  function setsOverlap(a, b) {
    for (const x of a) if (b.has(x)) return true;
    return false;
  }

  // ─────────────────────────────────────────────────────────────
  // Record helpers
  // ─────────────────────────────────────────────────────────────
  function sourceKeyOf(rec) {
    if (rec.sourceKey) return rec.sourceKey;
    if (rec.source && rec.source !== 'both' && LEGACY_SOURCE_NAMES[rec.source]) return rec.source;
    if (Array.isArray(rec.sources) && rec.sources.length) {
      const name = rec.sources[0];
      const key = Object.keys(LEGACY_SOURCE_NAMES).find(k => LEGACY_SOURCE_NAMES[k] === name);
      if (key) return key;
    }
    return 'epmc';
  }

  function sourceNamesOf(rec) {
    if (Array.isArray(rec.sources) && rec.sources.length) return rec.sources.slice();
    return [LEGACY_SOURCE_NAMES[sourceKeyOf(rec)] || 'Europe PMC'];
  }

  function isPreprintRecord(rec) {
    if (rec.peerReviewed === false) return true;
    if (rec.sourceKey === 'epmc_preprints') return true;
    const types = (Array.isArray(rec.pubType) ? rec.pubType : [rec.pubType]).filter(Boolean).map(s => String(s).toLowerCase());
    if (types.includes('preprint') || types.includes('posted-content')) return true;
    return isPreprintDoi(rec.doi);
  }

  function isRegistryRecord(rec) {
    return rec.isRegistryRecord === true || rec.sourceKey === 'ctgov';
  }

  function priorityRank(rec) {
    if (rec._isRegistry) return 1000;
    if (rec._isPreprint) return 900;
    const i = SOURCE_PRIORITY.indexOf(rec.sourceKey);
    return i === -1 ? 500 : i;
  }

  function recordLabel(rec) {
    return rec._rid || rec.id || rec.pmid || rec.doi || rec.title || '?';
  }

  /** Compute & cache normalised identifiers on a record (mutates). */
  function prepareRecord(rec, idx) {
    rec.sourceKey = sourceKeyOf(rec);
    rec.sources = sourceNamesOf(rec);
    rec.sourceKeys = Array.isArray(rec.sourceKeys) && rec.sourceKeys.length ? rec.sourceKeys.slice() : [rec.sourceKey];
    if (rec.source === 'both' || !rec.source) rec.source = rec.sourceKey;
    if (!rec._rid) rec._rid = `${rec.sourceKey}:${rec.id || rec.pmid || rec.doi || idx}`;

    rec.pmid = normalizePMID(rec.pmid);
    rec.pmcid = normalizePMCID(rec.pmcid);
    rec.doi = normalizeDOI(rec.doi);
    rec.openalexId = normalizeOpenAlexId(rec.openalexId || rec.openalex_id || (rec.sourceKey === 'openalex' ? (rec.paperId || rec.id) : ''));
    rec.s2PaperId = normalizeS2Id(rec.s2PaperId || (rec.sourceKey === 's2' ? (rec.paperId || rec.id) : ''));
    rec.scholarResultId = rec.scholarResultId ? String(rec.scholarResultId) : '';
    const cochrane = parseCochraneDoi(rec.doi);
    if (cochrane) {
      rec.cochraneId = cochrane.id;
      rec.cochraneVersion = cochrane.version;
      rec.isCochraneReview = true;
    } else if (rec.cochraneId) {
      rec.cochraneId = String(rec.cochraneId).toUpperCase();
    }
    if (rec.centralId) rec.centralId = String(rec.centralId).toUpperCase();
    rec.nctIds = extractNctIds(rec.nctIds || [], rec.nctId || '', rec.secondaryIds || [], rec.title || '', rec.abstract || '');
    const otherReg = extractOtherRegistryIds(rec.registryIds || [], rec.abstract || '');
    if (otherReg.length) rec.registryIds = otherReg;

    if (RETRACTED_SELF_RX.test(stripHtml(rec.title || ''))) rec.retracted = true;
    const types = (Array.isArray(rec.pubType) ? rec.pubType : [rec.pubType]).filter(Boolean).map(s => String(s).toLowerCase());
    if (types.includes('retracted publication')) rec.retracted = true;

    rec._isPreprint = isPreprintRecord(rec);
    rec._isRegistry = isRegistryRecord(rec);
    if (rec._isPreprint || rec._isRegistry) rec.peerReviewed = false;
    else if (rec.peerReviewed === undefined) rec.peerReviewed = true;
    rec._notice = rec._isRegistry ? null : detectNotice(rec);
    rec._normTitle = normalizeTitle(rec.title);
    rec._tokens = getTitleTokens(rec.title);
    rec._year = Number(rec.year) || null;
    rec._firstAuthor = surnameTokens(rec, 1);
    rec._authors3 = surnameTokens(rec, 3);
    rec._order = idx;
    return rec;
  }

  function yearsCompatible(a, b, tol = 1) {
    if (!a._year || !b._year) return true;
    return Math.abs(a._year - b._year) <= tol;
  }

  function strongIdKeys(rec) {
    const keys = [];
    if (rec.pmid) keys.push(['pmid', rec.pmid]);
    if (rec.pmcid) keys.push(['pmcid', rec.pmcid]);
    if (rec.doi) keys.push(['doi', rec.doi]);
    if (rec.openalexId) keys.push(['openalex', rec.openalexId]);
    if (rec.s2PaperId) keys.push(['s2', rec.s2PaperId]);
    if (rec.scholarResultId) keys.push(['scholar', rec.scholarResultId]);
    if (rec.cochraneId) keys.push(['cochrane', rec.cochraneId]);
    if (rec.centralId) keys.push(['central', rec.centralId]);
    return keys;
  }

  // ─────────────────────────────────────────────────────────────
  // Merge rules (spec 3.5)
  // ─────────────────────────────────────────────────────────────
  const PLACEHOLDER_JOURNAL = /^(scholarly journal|academic journal|unknown journal|)$/i;

  function realAbstract(rec) {
    if (!rec.abstract) return '';
    if (rec.abstractSource === 'none' || rec.abstractSource === 'scholar-snippet') return '';
    return rec.abstract;
  }

  function mergeInto(primary, other) {
    other.sources.forEach(s => { if (!primary.sources.includes(s)) primary.sources.push(s); });
    (other.sourceKeys || [other.sourceKey]).forEach(k => { if (!primary.sourceKeys.includes(k)) primary.sourceKeys.push(k); });
    primary.source = primary.sourceKey;

    if (!primary.pmid && other.pmid) primary.pmid = other.pmid;
    if (!primary.pmcid && other.pmcid) primary.pmcid = other.pmcid;
    if (other._isPreprint && !primary._isPreprint) {
      primary.relatedReports = primary.relatedReports || [];
      if (other.doi && !primary.relatedReports.some(r => r.doi === other.doi)) {
        primary.relatedReports.push({ type: 'preprint', doi: other.doi, title: other.title, server: other.preprintServer || other.journal || '', year: other.year || null });
      }
    } else if (!primary.doi && other.doi && !other._isPreprint) {
      primary.doi = other.doi;
    }
    ['openalexId', 's2PaperId', 'scholarResultId', 'cochraneId', 'centralId'].forEach(k => {
      if (!primary[k] && other[k]) primary[k] = other[k];
      else if (primary[k] && other[k] && primary[k] !== other[k]) {
        primary.altIds = primary.altIds || {};
        primary.altIds[k] = Array.from(new Set([...(primary.altIds[k] || []), other[k]]));
      }
    });
    ['volume', 'issue', 'pages', 'journalAbbr', 'year', 'publicationDate'].forEach(k => {
      if (!primary[k] && other[k]) primary[k] = other[k];
    });
    if (PLACEHOLDER_JOURNAL.test(String(primary.journal || '').trim()) && other.journal && !PLACEHOLDER_JOURNAL.test(String(other.journal).trim())) {
      primary.journal = other.journal;
    }
    if ((!primary.authors || /^unknown authors$/i.test(String(primary.authors))) && other.authors && !/^unknown authors$/i.test(String(other.authors))) {
      primary.authors = other.authors;
    }
    if ((!Array.isArray(primary.authorObjects) || primary.authorObjects.length === 0) && Array.isArray(other.authorObjects) && other.authorObjects.length) {
      primary.authorObjects = other.authorObjects;
    }
    const pa = realAbstract(primary);
    const oa = realAbstract(other);
    if (oa && oa.length > pa.length) {
      primary.abstract = oa;
      primary.abstract_summary = oa;
      primary.abstractSource = other.abstractSource || other.sourceKey;
    } else if (!pa && primary.abstract && (primary.abstractSource === 'none' || primary.abstractSource === 'scholar-snippet')) {
      primary.abstract = '';
    }
    if (!primary.scholarSnippet && other.scholarSnippet) primary.scholarSnippet = other.scholarSnippet;
    const cites = Math.max(Number(primary.citationCount || primary.citation_count || 0), Number(other.citationCount || other.citation_count || 0));
    primary.citationCount = cites;
    primary.citation_count = cites;
    if (other.isOpenAccess) primary.isOpenAccess = true;
    if (!primary.openAccessPdfUrl && other.openAccessPdfUrl) primary.openAccessPdfUrl = other.openAccessPdfUrl;
    if ((!primary.meshHeadings || !primary.meshHeadings.length) && Array.isArray(other.meshHeadings) && other.meshHeadings.length) primary.meshHeadings = other.meshHeadings.slice();
    if (Array.isArray(other.keywords) && other.keywords.length) {
      primary.keywords = Array.from(new Set([...(primary.keywords || []), ...other.keywords]));
    }
    primary.nctIds = Array.from(new Set([...(primary.nctIds || []), ...(other.nctIds || [])]));
    if (other.registryIds) primary.registryIds = Array.from(new Set([...(primary.registryIds || []), ...other.registryIds]));
    if (other.retracted) primary.retracted = true;
    if (other.isCochraneReview) primary.isCochraneReview = true;
    if (!other._isPreprint) primary.peerReviewed = primary._isPreprint ? primary.peerReviewed : true;
    if (Array.isArray(other.linkedNotices)) primary.linkedNotices = [...(primary.linkedNotices || []), ...other.linkedNotices];
    if (Array.isArray(other.registryRecords)) primary.registryRecords = [...(primary.registryRecords || []), ...other.registryRecords];
    if (Array.isArray(other.relatedReports)) {
      primary.relatedReports = primary.relatedReports || [];
      other.relatedReports.forEach(r => { if (!primary.relatedReports.some(x => x.doi === r.doi)) primary.relatedReports.push(r); });
    }
    primary.memberRids = Array.from(new Set([...(primary.memberRids || [primary._rid]), ...(other.memberRids || [other._rid])]));
  }

  // ─────────────────────────────────────────────────────────────
  // Union-find with cluster-level conflict guard
  // ─────────────────────────────────────────────────────────────
  function createUnionFind(records, cannotLink) {
    const parent = records.map((_, i) => i);
    const meta = records.map(r => ({
      pmids: new Set(r.pmid ? [r.pmid] : []),
      pubDois: new Set(r.doi && !r._isPreprint ? [r.doi] : []),
      ppDois: new Set(r.doi && r._isPreprint ? [r.doi] : []),
      cochrane: new Set(r.cochraneId ? [r.cochraneId] : []),
      rids: new Set([r._rid])
    }));
    const edges = [];
    const blocked = [];

    function find(i) {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    }

    function wouldConflict(ra, rb) {
      const A = meta[ra], B = meta[rb];
      const union = (x, y) => new Set([...x, ...y]).size;
      if (union(A.pmids, B.pmids) > 1) return 'different PMIDs';
      if (union(A.pubDois, B.pubDois) > 1) return 'different DOIs';
      if (union(A.ppDois, B.ppDois) > 1) return 'different preprint DOIs';
      if (union(A.cochrane, B.cochrane) > 1) return 'different Cochrane review numbers';
      for (const [x, y] of cannotLink) {
        if ((A.rids.has(x) && B.rids.has(y)) || (A.rids.has(y) && B.rids.has(x))) return 'reviewer split override';
      }
      return null;
    }

    function union(a, b, matchedOn, similarity) {
      const ra = find(a), rb = find(b);
      if (ra === rb) return true;
      const conflict = wouldConflict(ra, rb);
      if (conflict) {
        blocked.push({ a, b, matchedOn, reason: conflict });
        return false;
      }
      parent[rb] = ra;
      const A = meta[ra], B = meta[rb];
      B.pmids.forEach(x => A.pmids.add(x));
      B.pubDois.forEach(x => A.pubDois.add(x));
      B.ppDois.forEach(x => A.ppDois.add(x));
      B.cochrane.forEach(x => A.cochrane.add(x));
      B.rids.forEach(x => A.rids.add(x));
      edges.push({ a, b, matchedOn, similarity });
      return true;
    }

    return { find, union, edges, blocked };
  }

  function cloneRecord(rec) {
    const copy = JSON.parse(JSON.stringify(rec, (k, v) => (k.startsWith('_') && k !== '_rid' && k !== '_globalIndex' ? undefined : v)));
    return copy;
  }

  function cleanupInternal(rec) {
    Object.keys(rec).forEach(k => {
      if (k.startsWith('_') && k !== '_rid' && k !== '_globalIndex') delete rec[k];
    });
    if (!rec.memberRids) rec.memberRids = [rec._rid];
    return rec;
  }

  function logEntry(kept, removed, matchedOn, similarity) {
    return {
      keptId: recordLabel(kept),
      removedId: recordLabel(removed),
      keptTitle: kept.title || '',
      removedTitle: removed.title || '',
      matchedOn,
      similarity: similarity == null ? null : Math.round(similarity * 1000) / 1000,
      sourcesOfRemoved: (removed.sources || []).slice(),
      kind: /link|nct|registry|preprint/.test(matchedOn) ? 'link' : 'duplicate'
    };
  }

  /**
   * Cluster raw records into unique studies.
   * @param {object[]} rawRecords   raw per-source records (not mutated)
   * @param {object}   [opts]
   * @param {Array<[string,string]>} [opts.cannotLink]  reviewer split overrides (pairs of _rid)
   * @returns {{unique:object[], log:object[], duplicates:number, linked:number, removed:number, blocked:object[]}}
   */
  function clusterRecords(rawRecords, opts = {}) {
    const cannotLink = Array.isArray(opts.cannotLink) ? opts.cannotLink : [];
    const forbidden = (recA, recB) => {
      const ra = new Set(recA.memberRids || [recA._rid]);
      const rb = new Set(recB.memberRids || [recB._rid]);
      return cannotLink.some(([x, y]) => (ra.has(x) && rb.has(y)) || (ra.has(y) && rb.has(x)));
    };
    const log = [];
    let duplicates = 0;
    let linked = 0;

    const all = (rawRecords || []).filter(Boolean).map((r, i) => prepareRecord(cloneRecord(r), i));

    // Make _rid unique within the batch so audit entries are unambiguous
    const seenRid = new Map();
    all.forEach(r => {
      const n = seenRid.get(r._rid) || 0;
      seenRid.set(r._rid, n + 1);
      if (n > 0) r._rid = `${r._rid}#${n}`;
    });

    const notices = all.filter(r => r._notice);
    const registry = all.filter(r => !r._notice && r._isRegistry);
    let pubs = all.filter(r => !r._notice && !r._isRegistry);

    // ── 1. Cochrane .pubN versions → keep latest version only ──
    const byCochrane = new Map();
    pubs.forEach(r => {
      if (!r.cochraneId) return;
      if (!byCochrane.has(r.cochraneId)) byCochrane.set(r.cochraneId, []);
      byCochrane.get(r.cochraneId).push(r);
    });
    const superseded = new Set();
    byCochrane.forEach(group => {
      const maxV = Math.max(...group.map(r => r.cochraneVersion || 1));
      const keep = group.find(r => (r.cochraneVersion || 1) === maxV);
      group.forEach(r => {
        if ((r.cochraneVersion || 1) < maxV && !forbidden(keep, r)) {
          superseded.add(r);
          keep.supersededVersions = Array.from(new Set([...(keep.supersededVersions || []), r.doi]));
          r.sources.forEach(s => { if (!keep.sources.includes(s)) keep.sources.push(s); });
          r.sourceKeys.forEach(k => { if (!keep.sourceKeys.includes(k)) keep.sourceKeys.push(k); });
          keep.memberRids = Array.from(new Set([...(keep.memberRids || [keep._rid]), r._rid]));
          log.push(logEntry(keep, r, 'cochrane-version', null));
          duplicates++;
        }
      });
    });
    pubs = pubs.filter(r => !superseded.has(r));

    // ── 2. Union-find over publications ──
    const uf = createUnionFind(pubs, cannotLink);

    // 2a. identical identifiers
    const idIndex = new Map();
    pubs.forEach((r, i) => {
      strongIdKeys(r).forEach(([type, val]) => {
        const key = `${type}:${val}`;
        if (idIndex.has(key)) uf.union(idIndex.get(key), i, type, 1);
        else idIndex.set(key, i);
      });
    });

    // 2b. identical normalised title (len > 15) with |year diff| ≤ 1
    const titleIndex = new Map();
    pubs.forEach((r, i) => {
      if (r._normTitle.length <= 15) return;
      const list = titleIndex.get(r._normTitle) || [];
      list.forEach(j => {
        const o = pubs[j];
        const preprintPair = o._isPreprint !== r._isPreprint;
        if (yearsCompatible(o, r, preprintPair ? 2 : 1)) uf.union(j, i, preprintPair ? 'preprint-published' : 'title-exact', 1);
      });
      list.push(i);
      titleIndex.set(r._normTitle, list);
    });

    // 2c. fuzzy title (tokens precomputed once per record)
    for (let i = 0; i < pubs.length; i++) {
      const a = pubs[i];
      if (a._normTitle.length <= 15 || a._tokens.size === 0) continue;
      for (let j = i + 1; j < pubs.length; j++) {
        const b = pubs[j];
        if (b._normTitle.length <= 15 || b._tokens.size === 0) continue;
        if (uf.find(i) === uf.find(j)) continue;
        const preprintPair = a._isPreprint !== b._isPreprint;
        if (preprintPair) {
          // Preprint ↔ published: high similarity + overlapping authors (author evidence required)
          if (!yearsCompatible(a, b, 2)) continue;
          if (!a._authors3.size || !b._authors3.size || !setsOverlap(a._authors3, b._authors3)) continue;
          const sim = titleJaccard(a._tokens, b._tokens);
          // Preprints often gain/lose a subtitle (": a randomised trial"): accept full containment
          // of the shorter title when at least two author surnames overlap.
          let shared = 0;
          a._tokens.forEach(t => { if (b._tokens.has(t)) shared++; });
          const containment = shared / Math.min(a._tokens.size, b._tokens.size);
          let authorOverlap = 0;
          a._authors3.forEach(t => { if (b._authors3.has(t)) authorOverlap++; });
          if (sim >= 0.8 || (containment >= 0.9 && Math.min(a._tokens.size, b._tokens.size) >= 5 && authorOverlap >= 2)) {
            uf.union(i, j, 'preprint-published', sim);
          }
          continue;
        }
        if (!yearsCompatible(a, b, 1)) continue;
        const authorsOk = !a._firstAuthor.size || !b._firstAuthor.size || setsOverlap(a._firstAuthor, b._firstAuthor);
        if (!authorsOk) continue;
        const sim = titleJaccard(a._tokens, b._tokens);
        if (sim >= 0.88) uf.union(i, j, 'title-fuzzy', sim);
      }
    }

    // ── 3. Materialise clusters, pick primary, merge, log ──
    const clusters = new Map();
    pubs.forEach((r, i) => {
      const root = uf.find(i);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(i);
    });
    const edgeFor = new Map();
    uf.edges.forEach(e => {
      if (!edgeFor.has(e.b)) edgeFor.set(e.b, e);
      if (!edgeFor.has(e.a)) edgeFor.set(e.a, e);
    });

    const unique = [];
    clusters.forEach(members => {
      const recs = members.map(i => pubs[i]);
      recs.sort((x, y) => priorityRank(x) - priorityRank(y) || x._order - y._order);
      const primary = recs[0];
      primary.memberRids = Array.from(new Set([...(primary.memberRids || []), primary._rid]));
      recs.slice(1).forEach(other => {
        mergeInto(primary, other);
        const idx = pubs.indexOf(other);
        const e = edgeFor.get(idx) || { matchedOn: 'cluster', similarity: null };
        const preprintLink = other._isPreprint && !primary._isPreprint;
        log.push(logEntry(primary, other, preprintLink ? 'preprint-published' : e.matchedOn, e.similarity));
        if (preprintLink) linked++; else duplicates++;
      });
      unique.push(primary);
    });

    // ── 4. Registry records: collapse by NCT, then link to publications ──
    const regGroups = new Map();
    const regUnique = [];
    registry.forEach(r => {
      const nct = r.nctIds[0];
      if (nct && regGroups.has(nct) && !forbidden(regGroups.get(nct), r)) {
        const keep = regGroups.get(nct);
        mergeInto(keep, r);
        log.push(logEntry(keep, r, 'nct', 1));
        duplicates++;
      } else {
        if (nct) regGroups.set(nct, r);
        regUnique.push(r);
      }
    });
    regUnique.forEach(reg => {
      const nctSet = new Set(reg.nctIds);
      const refPmids = new Set((reg.referencePmids || []).map(normalizePMID).filter(Boolean));
      let target = null;
      let matchedOn = null;
      const candidates = unique.filter(u => !u._isPreprint && !u._isRegistry && !forbidden(u, reg));
      target = candidates.find(u => u.pmid && refPmids.has(u.pmid));
      if (target) matchedOn = 'registry-ref-pmid';
      if (!target) {
        target = candidates.find(u => (u.nctIds || []).some(n => nctSet.has(n)));
        if (target) matchedOn = 'nct';
      }
      if (target) {
        target.registryRecords = target.registryRecords || [];
        target.registryRecords.push({
          nctId: reg.nctIds[0] || '', title: reg.title || '', status: reg.overallStatus || '',
          hasResults: !!reg.hasResults, studyType: reg.studyType || '', phases: reg.phases || [],
          allocation: reg.allocation || '', enrollment: reg.enrollment || null,
          url: reg.nctIds[0] ? `https://clinicaltrials.gov/study/${reg.nctIds[0]}` : (reg.url || '')
        });
        target.nctIds = Array.from(new Set([...(target.nctIds || []), ...reg.nctIds]));
        reg.sources.forEach(s => { if (!target.sources.includes(s)) target.sources.push(s); });
        reg.sourceKeys.forEach(k => { if (!target.sourceKeys.includes(k)) target.sourceKeys.push(k); });
        target.memberRids = Array.from(new Set([...(target.memberRids || [target._rid]), ...(reg.memberRids || [reg._rid])]));
        if (!target.abstract && reg.abstract) { target.abstract = reg.abstract; target.abstractSource = 'ctgov'; }
        log.push(logEntry(target, reg, matchedOn, 1));
        linked++;
      } else {
        reg.memberRids = reg.memberRids || [reg._rid];
        unique.push(reg);
      }
    });

    // Mark publications that are reports of the same registered study
    const byNct = new Map();
    unique.forEach(u => (u.nctIds || []).forEach(n => {
      if (!byNct.has(n)) byNct.set(n, []);
      byNct.get(n).push(u);
    }));
    byNct.forEach((list, nct) => {
      if (list.length > 1) list.forEach(u => { u.studyId = u.studyId || nct; });
    });

    // ── 5. Notices (errata / retraction notices / comments): link, never merge ──
    notices.forEach(n => {
      const parentNorm = normalizeTitle(n._notice.parentTitle);
      const parentTokens = getTitleTokens(n._notice.parentTitle);
      const allowed = unique.filter(u => !u._notice && !forbidden(u, n));
      let parent = allowed.find(u => u._normTitle && u._normTitle === parentNorm);
      let sim = 1;
      if (!parent && parentTokens.size) {
        let best = null; let bestSim = 0;
        allowed.forEach(u => {
          const s = titleJaccard(parentTokens, u._tokens);
          if (s > bestSim) { bestSim = s; best = u; }
        });
        if (best && bestSim >= 0.88) { parent = best; sim = bestSim; }
      }
      if (parent) {
        parent.linkedNotices = parent.linkedNotices || [];
        parent.linkedNotices.push({ type: n._notice.type, title: n.title, doi: n.doi || '', pmid: n.pmid || '', sources: n.sources.slice() });
        if (n._notice.type === 'retraction') parent.retracted = true;
        n.sources.forEach(s => { if (!parent.sources.includes(s)) parent.sources.push(s); });
        parent.memberRids = Array.from(new Set([...(parent.memberRids || [parent._rid]), n._rid]));
        log.push(logEntry(parent, n, `${n._notice.type}-link`, sim));
        linked++;
      } else {
        n.noticeType = n._notice.type;
        n.memberRids = [n._rid];
        unique.push(n);
      }
    });

    // ── 6. Identifier conflicts left after the guard: keep id on the preferred record only ──
    const blocked = uf.blocked.map(b => ({ a: recordLabel(pubs[b.a]), b: recordLabel(pubs[b.b]), matchedOn: b.matchedOn, reason: b.reason }));
    const owner = new Map();
    const ordered = unique.slice().sort((x, y) => priorityRank(x) - priorityRank(y) || x._order - y._order);
    ordered.forEach(u => {
      strongIdKeys(u).forEach(([type, val]) => {
        const key = `${type}:${val}`;
        if (!owner.has(key)) { owner.set(key, u); return; }
        const field = { pmid: 'pmid', pmcid: 'pmcid', doi: 'doi', openalex: 'openalexId', s2: 's2PaperId', scholar: 'scholarResultId', cochrane: 'cochraneId', central: 'centralId' }[type];
        u.conflictingIds = u.conflictingIds || {};
        u.conflictingIds[field] = val;
        u[field] = '';
        log.push({ ...logEntry(owner.get(key), u, 'conflict-guard', null), kind: 'conflict', note: `Shared ${type} "${val}" but records were kept separate by the conflict guard; identifier retained on the preferred record only.` });
      });
    });

    unique.sort((x, y) => x._order - y._order);
    unique.forEach(cleanupInternal);

    return {
      unique,
      log,
      duplicates,
      linked,
      removed: all.length - unique.length,
      rawCount: all.length,
      blocked
    };
  }

  /** Backwards-compatible wrapper used by legacy callers & tests. */
  function deduplicatePapers(rawPapers, opts) {
    const r = clusterRecords(rawPapers, opts);
    return { unique: r.unique, duplicates: r.removed, log: r.log, linked: r.linked, trueDuplicates: r.duplicates };
  }

  /** Identifier collisions inside a pool (should always be empty). NCT IDs are study-level and excluded. */
  function findIdentifierCollisions(papers) {
    const seen = new Map();
    const collisions = [];
    (papers || []).forEach((p, idx) => {
      const keys = [
        ['pmid', normalizePMID(p.pmid)], ['pmcid', normalizePMCID(p.pmcid)], ['doi', normalizeDOI(p.doi)],
        ['openalex', normalizeOpenAlexId(p.openalexId)], ['s2', normalizeS2Id(p.s2PaperId)],
        ['scholar', p.scholarResultId || ''], ['cochrane', p.cochraneId || ''], ['central', p.centralId || '']
      ];
      keys.forEach(([type, val]) => {
        if (!val) return;
        const key = `${type}:${val}`;
        if (seen.has(key)) collisions.push({ type, value: val, a: seen.get(key), b: idx });
        else seen.set(key, idx);
      });
    });
    return collisions;
  }

  /** Remove repeated entries from a reference list (same identifiers / same normalised title). */
  function dedupeReferenceList(papers) {
    const seen = new Set();
    const out = [];
    (papers || []).forEach(p => {
      const keys = [
        p.pmid ? `pmid:${normalizePMID(p.pmid)}` : '',
        p.doi ? `doi:${normalizeDOI(p.doi)}` : '',
        normalizeTitle(p.title).length > 15 ? `t:${normalizeTitle(p.title)}` : ''
      ].filter(Boolean);
      if (keys.some(k => seen.has(k))) return;
      keys.forEach(k => seen.add(k));
      out.push(p);
    });
    return out;
  }

  const api = {
    SOURCE_PRIORITY,
    normalizeDOI, normalizePMID, normalizePMCID, normalizeOpenAlexId, normalizeS2Id,
    normalizeTitle, getTitleTokens, titleJaccard,
    extractNctIds, extractOtherRegistryIds, parseCochraneDoi, isPreprintDoi, detectNotice,
    clusterRecords, deduplicatePapers, mergeInto, findIdentifierCollisions, dedupeReferenceList
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  Object.keys(api).forEach(k => { root[k] = api[k]; if (typeof globalThis !== 'undefined' && globalThis !== root) globalThis[k] = api[k]; });
  root.SysRevDedup = api;
})(typeof window !== 'undefined' ? window : globalThis);
