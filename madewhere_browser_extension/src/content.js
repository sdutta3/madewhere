/*
 * Content script. Runs inside the Amazon page, so it reads the *rendered* DOM,
 * including everything Amazon's own JavaScript has already injected. It makes
 * no network requests of its own.
 */
(function () {
  'use strict';
  const root = globalThis;
  const COO = root.COO;
  const api = root.browser || root.chrome; // `browser` in Firefox, `chrome` in Chromium
  const RESCAN_THROTTLE_MS = 3000;
  const MAX_SEGMENT_CHARS = 3000;

  // When the page states no origin we assume China. This is only a small prior:
  // any real "made in" phrase (8+) or origin field (100) outweighs it.
  const DEFAULT_ISO2 = 'CN';
  const DEFAULT_NOTE = 'No origin stated. Most consumer products sold on Amazon are made in China.';
  const PRIOR_WEIGHT = 2;

  // Page regions that describe the shopper, the seller or *other* products.
  const EXCLUDE_SELECTOR = [
    '#navbar', '#nav-belt', '#nav-main', '#nav-subnav', '#nav-flyout-anchor', '#navFooter', 'footer',
    '#glow-ingress-block', '#nav-global-location-slot',
    '#rightCol', '#desktop_buybox', '#buybox', '#mbc', '#olp_feature_div',
    '#deliveryBlockMessage', '#mir-layout-DELIVERY_BLOCK', '#amazonGlobal_feature_div',
    '#sims-consolidated-1_feature_div', '#sims-consolidated-2_feature_div', '#sims-consolidated-3_feature_div',
    '#sp_detail', '#sp_detail2', '#similarities_feature_div', '#anonCarousel1', '#anonCarousel2',
    '#rhf', '#rhf-container',
    '[data-hook="review-date"]', '[data-hook="arp-local-reviews-header"]',
    '[data-hook="arp-global-reviews-header"]', '[data-hook="cr-filter-info-section"]',
    '#coo-badge-host'
  ].join(',');

  // Where on the page text appears changes how much we trust it.
  const ZONES = [
    {
      name: 'product details', weight: 3, allowStructured: true,
      selector: '#productDetails_feature_div, #detailBullets_feature_div, #detailBulletsWrapper_feature_div, #productOverview_feature_div, #prodDetails, #productDetails_techSpec_section_1, #productDetails_detailBullets_sections1, #technicalSpecifications_feature_div, #important-information'
    },
    { name: 'feature bullets', weight: 3, allowStructured: true, selector: '#feature-bullets, #featurebullets_feature_div' },
    {
      name: 'description', weight: 3, allowStructured: true,
      selector: '#productDescription, #productDescription_feature_div, #aplus, #aplus_feature_div, .aplus-v2'
    },
    { name: 'title', weight: 2, allowStructured: false, selector: '#productTitle, #title_feature_div, #title' },
    {
      name: 'reviews', weight: 1, cap: 6, allowStructured: false,
      selector: '#reviews-medley-footer, #customer-reviews_feature_div, #cm-cr-dp-review-list, #cm_cr-review_list, [data-hook="review"], #reviewsMedley'
    },
    { name: 'questions', weight: 1, cap: 4, allowStructured: false, selector: '#ask-btf_feature_div, #ask_feature_div' }
  ];
  const DEFAULT_ZONE = { name: 'other', weight: 0.7, cap: 6, allowStructured: false };
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON']);

  const isProductPage = () =>
    /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN)\/[A-Z0-9]{10}/i.test(location.pathname) ||
    !!document.getElementById('productTitle');

  // ----------------------------------------------------- DOM -> text segments
  // A "segment" is the smallest block that keeps a label and its value together
  // (a table row, a list item, a paragraph) so "Country of Origin" + "China"
  // arrive as one string even when Amazon puts them in separate <span>s/<td>s.
  function segmentElement(el) {
    const row = el.closest('tr, li');
    if (row && row.textContent.length <= 400) return row;
    return el.closest('p, h1, h2, h3, h4, h5, h6, dt, dd, div, section, article') || el;
  }

  function zoneOf(el) {
    for (const z of ZONES) if (el.closest(z.selector)) return z;
    return DEFAULT_ZONE;
  }

  function collectSegments() {
    const groups = new Map(); // element -> text pieces
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName.toUpperCase()) || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = segmentElement(n.parentElement);
      const bucket = groups.get(el);
      if (bucket) bucket.push(n.nodeValue);
      else groups.set(el, [n.nodeValue]);
    }

    const segments = [];
    for (const [el, pieces] of groups) {
      if (el.closest(EXCLUDE_SELECTOR)) continue;
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue; // display:none duplicates
      segments.push({ text: pieces.join(' ').slice(0, MAX_SEGMENT_CHARS), zone: zoneOf(el) });
    }
    return segments;
  }

  // ----------------------------------------------------------- aggregation
  function analyzePage() {
    const segments = collectSegments();
    const tally = new Map();
    const seen = new Set();
    const entryFor = (iso2) => {
      let entry = tally.get(iso2);
      if (!entry) {
        entry = { iso2, name: COO.nameOf(iso2), score: 0, priorScore: 0, zoneUse: {}, evidence: [] };
        tally.set(iso2, entry);
      }
      return entry;
    };

    for (const seg of segments) {
      const res = COO.analyzeSegment(seg.text, { allowStructured: seg.zone.allowStructured });
      for (const m of res.mentions) {
        const key = `${m.iso2}|${m.start}|${res.text.slice(0, 200)}`;
        if (seen.has(key)) continue; // same text rendered twice (desktop + mobile layouts)
        seen.add(key);

        const entry = entryFor(m.iso2);
        const raw = m.cue === 'origin-field' ? m.mult : m.mult * seg.zone.weight;
        const used = entry.zoneUse[seg.zone.name] || 0;
        const weight = Math.min(raw, (seg.zone.cap ?? Infinity) - used); // stop reviews drowning the listing
        if (weight <= 0) continue;
        entry.zoneUse[seg.zone.name] = used + weight;
        entry.score += weight;
        entry.evidence.push({ zone: seg.zone.name, cue: m.cue, weight: +weight.toFixed(2), snippet: m.snippet });
      }
    }

    // Default guess: China.
    const priorEntry = entryFor(DEFAULT_ISO2);
    priorEntry.score += PRIOR_WEIGHT;
    priorEntry.priorScore = PRIOR_WEIGHT;
    priorEntry.evidence.push({ zone: 'assumption', cue: 'default-assumption', weight: PRIOR_WEIGHT, snippet: DEFAULT_NOTE });

    const ranked = [...tally.values()].filter((e) => e.score >= 0.5).sort((a, b) => b.score - a.score);
    const total = ranked.reduce((s, e) => s + e.score, 0) || 1;
    for (const e of ranked) e.share = e.score / total;

    // Confidence is judged on real evidence only, i.e. without the default's own points.
    const real = (e) => e.score - e.priorScore;
    const top = ranked[0];
    const explicit = top.evidence.some((x) => x.cue === 'origin-field');
    let confidence;
    if (explicit && top.share >= 0.6) confidence = 'high';
    else if (real(top) >= 8 && top.share >= 0.6) confidence = 'medium';
    else if (real(top) >= 3) confidence = 'low';
    else {
      confidence = 'assumed'; // nothing solid found: fall back to the default guess
      ranked.splice(ranked.indexOf(priorEntry), 1);
      ranked.unshift(priorEntry);
    }

    for (const e of ranked) {
      e.score = +e.score.toFixed(2);
      e.evidence.sort((a, b) => b.weight - a.weight);
      e.evidence = e.evidence.slice(0, 6);
      delete e.zoneUse;
    }

    const titleEl = document.getElementById('productTitle');
    return {
      isProductPage: isProductPage(),
      title: titleEl ? titleEl.textContent.trim() : document.title,
      confidence,
      assumption: DEFAULT_NOTE,
      results: ranked.slice(0, 5),
      segmentsScanned: segments.length
    };
  }
  COO.analyzePage = analyzePage;

  // ------------------------------------------------------------ on-page badge
  let badge = null; // { host, label, detail, closed }
  let lastKey = '';

  const LEVEL_TEXT = { high: 'listing states origin', medium: 'good evidence', low: 'weak evidence', assumed: 'default guess' };
  const LEVEL_COLOR = { high: '#0b6e4f', medium: '#1f5fbf', low: '#9a6200', assumed: '#5b6b77' };

  function ensureBadge() {
    if (badge) return badge;
    const host = document.createElement('div');
    host.id = 'coo-badge-host';
    host.style.cssText = 'all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .pill{font:13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;background:#12202b;color:#f3f6f8;
        border-left:5px solid var(--c,#1f5fbf);border-radius:4px;padding:8px 10px 8px 12px;
        box-shadow:0 2px 10px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center;max-width:320px}
      .main{display:flex;flex-direction:column;gap:2px;cursor:pointer}
      .kicker{font-size:11px;opacity:.75}
      .country{font-weight:700;font-size:15px}
      .detail{display:none;font-size:12px;margin-top:4px;opacity:.9}
      .detail.open{display:block}
      button{all:unset;cursor:pointer;opacity:.6;padding:2px 4px;font-size:16px}
      button:hover,button:focus-visible{opacity:1;outline:1px solid #f3f6f8}`;
    const pill = document.createElement('div');
    pill.className = 'pill';
    const main = document.createElement('div');
    main.className = 'main';
    main.title = 'Click for the runner-up countries';
    const kicker = document.createElement('div');
    kicker.className = 'kicker';
    const country = document.createElement('div');
    country.className = 'country';
    const detail = document.createElement('div');
    detail.className = 'detail';
    main.append(kicker, country, detail);
    main.addEventListener('click', () => detail.classList.toggle('open'));
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Hide made-in-what-country estimate');
    close.addEventListener('click', () => {
      badge.closed = true;
      host.remove();
    });
    pill.append(main, close);
    shadow.append(style, pill);
    badge = { host, pill, kicker, country, detail, closed: false };
    return badge;
  }

  function renderBadge(result) {
    if (!result.isProductPage) {
      if (badge) badge.host.remove();
      lastKey = '';
      return;
    }
    const key = JSON.stringify([result.confidence, result.results.map((r) => [r.iso2, r.score])]);
    if (key === lastKey) return;
    lastKey = key;

    const b = ensureBadge();
    if (b.closed) return;
    const top = result.results[0];
    const assumed = result.confidence === 'assumed';
    b.kicker.textContent = `${assumed ? 'Assumed made in' : 'Probably made in'} · ${LEVEL_TEXT[result.confidence]}`;
    b.country.textContent = top.name;
    b.pill.style.setProperty('--c', LEVEL_COLOR[result.confidence]);
    b.detail.textContent = assumed
      ? result.assumption
      : result.results.slice(0, 3).map((r) => `${r.name} ${Math.round(r.share * 100)}%`).join('  ·  ');
    if (!b.host.isConnected) document.documentElement.appendChild(b.host);
  }

  // --------------------------------------------------------------- lifecycle
  function refresh() {
    try {
      if (!isProductPage()) {
        renderBadge({ isProductPage: false });
      }
      else {
        renderBadge(analyzePage());
      }
    } catch (err) {
      console.debug('[madewhere]', err);
    }
  }

  function init() {
    // Popup asks for a fresh analysis on demand.
    if (api && api.runtime && api.runtime.onMessage) {
      api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg && msg.type === 'COO_ANALYZE') sendResponse(analyzePage());
      });
    }

    refresh();

    // Amazon fills in details lazily and re-renders on variant changes: re-scan (throttled).
    let pending = false;
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        refresh();
      }, RESCAN_THROTTLE_MS);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (!COO.noAutostart) init();
})();
