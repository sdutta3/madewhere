/*
 * Named-entity recognition for countries, plus context scoring.
 *
 * Stage 1 (recognition): a gazetteer lookup finds COUNTRY entities in text:
 *   - full names and aliases        "Viet Nam", "Czech Republic", "Ivory Coast"
 *   - unambiguous abbreviations     "USA", "UK", "UAE", "PRC"
 *   - ISO codes and "US"/"U.S."     only trusted straight after "Made in" etc.
 *
 * Stage 2 (disambiguation / role labelling): the words just before and after
 * each entity decide what role the country plays:
 *   "Made in China", "Country of Origin: China"  -> manufacturing origin (strong)
 *   "Designed in Italy"                           -> design, not origin (weak)
 *   "Ships from ... United States"                -> logistics (ignored)
 *   "Atlanta, Georgia", "New Mexico", "turkey"    -> not a country (dropped)
 */
(function () {
  'use strict';
  const root = globalThis;
  const COO = (root.COO = root.COO || {});
  const { COUNTRIES, CUE_ONLY_NAMES } = COO;
  if (!COUNTRIES) throw new Error('countries.js must be loaded before ner.js');

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---------------------------------------------------------------- gazetteer
  const names = new Map(); // lower-case surface form -> { iso2, cueOnly }
  const safeAbbr = new Map(); // exact abbreviation -> iso2
  const cueAbbr = new Map(); // exact abbreviation / ISO code -> iso2
  const displayName = new Map(); // iso2 -> common name

  for (const [iso2, iso3, name, aliases = []] of COUNTRIES) {
    displayName.set(iso2, name);
    const addName = (s) => names.set(s.toLowerCase(), { iso2, cueOnly: CUE_ONLY_NAMES.has(s) });
    addName(name);
    for (const a of aliases) {
      if (a[0] === '!') safeAbbr.set(a.slice(1), iso2);
      else if (a[0] === '#') cueAbbr.set(a.slice(1), iso2);
      else addName(a);
    }
    cueAbbr.set(iso2, iso2);
    if (!safeAbbr.has(iso3)) cueAbbr.set(iso3, iso2);
  }

  const BOUND_L = '(?<![\\p{L}\\p{N}_])';
  const BOUND_R = '(?![\\p{L}\\p{N}_])';
  const alternation = (keys) =>
    [...keys]
      .sort((a, b) => b.length - a.length) // longest first: "Papua New Guinea" beats "Guinea"
      .map((k) => escapeRe(k).replace(/ /g, '\\s+'))
      .join('|');
  const build = (keys, flags) => new RegExp(`${BOUND_L}(?:${alternation(keys)})${BOUND_R}`, flags);

  const NAME_RE = build(names.keys(), 'giu');
  const SAFE_ABBR_RE = build(safeAbbr.keys(), 'gu');
  const CUE_ABBR_RE = build(cueAbbr.keys(), 'gu');

  // ------------------------------------------------------------ context cues
  const VERB =
    '(?:made|manufactured|produced|assembled|handmade|hand-made|handcrafted|hand-crafted|crafted|built|fabricated|printed|sewn|packed|packaged|finished|processed|grown|roasted)';

  // Text immediately before the entity that announces a manufacturing origin.
  const CUE_ADJACENT = new RegExp(
    `(?:\\b${VERB}(?:\\s+(?:and|&)\\s+${VERB})?\\s+(?:in|within)` +
      `|\\b(?:products?|goods|items?)\\s+of` +
      `|\\b(?:imported|sourced)\\s+from` +
      `|\\b(?:country|place)(?:\\s*/\\s*region)?\\s+of\\s+(?:origin|manufacture|production)` +
      `|\\borigin(?:\\s+country)?` +
      `|\\bmanufactur(?:ed|ing)\\s+(?:country|location))` +
      `\\s*[:\\-]?\\s*(?:the\\s+)?$`,
    'i'
  );
  const CUE_NEAR =
    /\b(?:made|manufactured|manufacture|manufacturer|produced|production|assembled|handmade|crafted|built|fabricated|imported|sourced|origin|factory|factories|workshop)\b/i;
  const DESIGN =
    /\b(?:designed|engineered|developed|founded|headquartered|based|owned|created|invented|inspired|tested|brand|company)\b/i;
  // Logistics / sales wording before the entity ("Ships to ... United States").
  const NEG_BEFORE =
    /\b(?:ships?|shipped|shipping|sold|sells?|deliver(?:s|ed|y|ing)?|available|valid|usable|compatible|warranty|returns?|customers?|reviewed|reviews?|currency|language|import\s+fees?|located|eligible|supported|certified|approved|only|use|used|plug|voltage|sale|buyers?|addresses|residents?|seller|visit|store|exclusive)\b[^.!?;|]{0,30}$/i;
  const AFTER_NEG =
    /^\s*(?:only|version|edition|market|warranty|plug|compatible|customers?|shipping|delivery|region|residents|addresses|orders|stores?|dollars?|currency|voltage|standard|certified|import)\b/i;
  const CHINA_TABLEWARE =
    /^\s*(?:plates?|dinnerware|cups?|teapots?|dolls?|bowls?|mugs?|saucers?|cabinets?|pattern|dishes|figurines?|set)\b/i;

  // A row such as "Country of Origin : China" (Amazon's product-details tables).
  const STRUCT_RE =
    /^(?:(?:country|place)(?:\s*\/\s*region)?\s+of\s+(?:origin|manufacture|production)|manufacturing\s+country)\s*:?\s*-?\s*(.{1,80})$/i;

  // Review dates / headings contain the *reviewer's* country, not the product's.
  const REVIEW_LOCATION =
    /\b(?:Reviewed in|Top reviews from)\s+(?:the\s+)?\p{Lu}[\p{L}'. &-]{1,40}?(?=\s+on\b|\s*$|\s*\|)/gu;

  // -------------------------------------------------------------- utilities
  function clean(raw) {
    return String(raw)
      .normalize('NFC')
      .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '') // zero-width + bidi marks
      .replace(/[\u00a0\u2007\u202f]/g, ' ')
      .replace(/[\u2018\u2019\u201b\u02bc`\u00b4]/g, "'")
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(REVIEW_LOCATION, ' | ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function contextBefore(text, start) {
    let ctx = text.slice(Math.max(0, start - 70), start);
    const cut = Math.max(
      ctx.lastIndexOf('. '),
      ctx.lastIndexOf('! '),
      ctx.lastIndexOf('? '),
      ctx.lastIndexOf('; '),
      ctx.lastIndexOf(' | ')
    );
    if (cut >= 0) ctx = ctx.slice(cut + 2);
    return ctx;
  }

  // ----------------------------------------------------------- stage 1: NER
  function findEntities(text) {
    const found = [];
    const run = (re, kind) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        let iso2;
        let cueOnly = false;
        if (kind === 'name') {
          const e = names.get(m[0].toLowerCase());
          if (!e) continue;
          iso2 = e.iso2;
          cueOnly = e.cueOnly;
        } else {
          iso2 = (kind === 'abbr' ? safeAbbr : cueAbbr).get(m[0]);
        }
        found.push({ iso2, kind, text: m[0], start: m.index, end: m.index + m[0].length, cueOnly });
      }
    };
    run(NAME_RE, 'name');
    run(SAFE_ABBR_RE, 'abbr');
    run(CUE_ABBR_RE, 'code');

    // Resolve overlaps: keep the earliest, longest span.
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept = [];
    let lastEnd = -1;
    for (const f of found) {
      if (f.start >= lastEnd) {
        kept.push(f);
        lastEnd = f.end;
      }
    }
    return kept;
  }

  // ------------------------------------------- stage 2: role / disambiguation
  /**
   * @param {string} raw                 text of one DOM segment (row, bullet, paragraph…)
   * @param {{allowStructured?:boolean}} opts
   * @returns {{text:string, structured:boolean, mentions:Array}}
   *   mention = { iso2, text, start, end, mult, cue, snippet }
   */
  function analyzeSegment(raw, opts = {}) {
    const text = clean(raw);
    const result = { text, structured: false, mentions: [] };
    if (!text) return result;

    let valueStart = Infinity;
    if (opts.allowStructured) {
      const m = STRUCT_RE.exec(text);
      if (m) {
        valueStart = text.length - m[1].length;
        result.structured = true;
      }
    }

    const entities = findEntities(text);
    const structuredHits = entities.filter((e) => e.start >= valueStart).length;
    const snippet = (e) =>
      (e.start > 45 ? '…' : '') +
      text.slice(Math.max(0, e.start - 45), Math.min(text.length, e.end + 45)) +
      (e.end + 45 < text.length ? '…' : '');

    for (const e of entities) {
      const base = { iso2: e.iso2, text: e.text, start: e.start, end: e.end, snippet: snippet(e) };

      // Value of an explicit "Country of Origin" field: strongest evidence there is.
      if (e.start >= valueStart) {
        result.mentions.push({ ...base, mult: 100 / structuredHits, cue: 'origin-field' });
        continue;
      }

      const ctx = contextBefore(text, e.start);
      const adjacent = CUE_ADJACENT.test(ctx);
      const near = adjacent || CUE_NEAR.test(ctx);

      if (e.kind === 'code' && !adjacent) continue; // "IN", "IT", "CAN"… are just words
      if (e.cueOnly && !near) continue; // "Atlanta, Georgia", "turkey breast"
      if (e.kind === 'name' && e.text === e.text.toLowerCase() && !adjacent) continue; // "china plate"
      if (e.iso2 === 'MX' && /\bnew\s+$/i.test(ctx)) continue; // New Mexico

      let mult;
      let cue;
      if (adjacent) {
        mult = 8;
        cue = 'origin-phrase';
      } else if (DESIGN.test(ctx)) {
        mult = 0.15;
        cue = 'design-phrase';
      } else if (near) {
        mult = 3;
        cue = 'origin-context';
      } else {
        mult = 1;
        cue = 'mention';
      }

      if (!adjacent) {
        const after = text.slice(e.end, e.end + 30);
        if (NEG_BEFORE.test(ctx) || AFTER_NEG.test(after)) {
          mult *= 0.05;
          cue = 'sales-or-shipping';
        } else if (e.iso2 === 'CN' && CHINA_TABLEWARE.test(after)) {
          mult *= 0.1;
          cue = 'tableware';
        }
      }
      result.mentions.push({ ...base, mult, cue });
    }
    return result;
  }

  COO.analyzeSegment = analyzeSegment;
  COO.findEntities = findEntities;
  COO.cleanText = clean;
  COO.nameOf = (iso2) => displayName.get(iso2) || iso2;
  COO.gazetteerStats = () => ({ countries: COUNTRIES.length, names: names.size, abbreviations: safeAbbr.size + cueAbbr.size });
})();
