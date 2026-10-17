(function () {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const app = document.getElementById('app');

  const LEVELS = {
    high: ['Amazon’s listing states the country of origin.', 'var(--high)'],
    medium: ['Strong hints in the product text.', 'var(--medium)'],
    low: ['Weak hints only. Treat this as a guess.', 'var(--low)'],
    assumed: ['', 'var(--assumed)'],
    none: ['', 'var(--none)']
  };
  const CUES = {
    'origin-field': 'listed as country of origin',
    'origin-phrase': '“made in”-style phrase',
    'origin-context': 'near manufacturing words',
    'design-phrase': 'designed there (weak)',
    'mention': 'plain mention',
    'default-assumption': 'default guess, not found on the page',
    'sales-or-shipping': 'shipping/sales wording (ignored)',
    'tableware': 'probably tableware (ignored)'
  };

  const el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
  };

  function message(text, hint) {
    app.replaceChildren(el('p', { className: 'status', textContent: text }));
    if (hint) app.append(el('p', { className: 'hint', textContent: hint }));
  }

  function render(res) {
    if (!res || !res.isProductPage) {
      return message('This doesn’t look like an Amazon product page.', 'Open a product page (a URL containing /dp/) and click the icon again.');
    }
    const assumed = res.confidence === 'assumed';
    const [fixedText, color] = LEVELS[res.confidence];
    const levelText = assumed ? res.assumption : fixedText;
    const top = res.results[0];

    if (!top || res.confidence === 'none') {
      return message(
        'No origin clues found yet.',
        'Scroll to the “Product information” section so Amazon loads it, then reopen this popup. Many listings never state where an item is made.'
      );
    }

    const stamp = el('section', { className: 'stamp' }, 
      el('p', { className: 'label', textContent: assumed ? 'Assumed made in' : 'Probably made in' }),
      el('p', { className: 'country', textContent: top.name }),
      el('p', { className: 'level', textContent: levelText })
    );
    stamp.style.setProperty('--c', color);

    const list = el('ol');
    for (const r of res.results) {
      const pct = Math.round(r.share * 100);
      const bar = el('span');
      bar.style.width = pct + '%';
      const evidence = el('ul', { className: 'evidence' });
      evidence.style.padding = '0';
      for (const ev of r.evidence.slice(0, 4)) {
        evidence.append(el('li', {}, el('q', { textContent: ev.snippet }), el('small', { textContent: `${ev.zone} · ${CUES[ev.cue] || ev.cue}` })));
      }
      list.append(
        el('li', {}, el('details', { className: 'row' },
          el('summary', {}, el('span', { className: 'name', textContent: r.name }), el('span', { className: 'pct', textContent: pct + '%' }), el('div', { className: 'bar' }, bar)),
          evidence
        ))
      );
    }

    app.replaceChildren(
      stamp,
      el('p', { className: 'product', textContent: res.title }),
      el('h2', { textContent: 'Candidates and the text behind them' }),
      list,
      el('p', { className: 'hint', textContent: 'An estimate from text on the page, not a customs record.' })
    );
  }

  async function main() {
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      render(await api.tabs.sendMessage(tab.id, { type: 'COO_ANALYZE' }));
    } catch (err) {
      message('Open an Amazon.com product page first.', 'This extension only runs on amazon.com. If you just installed it, reload the tab.');
    }
  }
  main();
})();
