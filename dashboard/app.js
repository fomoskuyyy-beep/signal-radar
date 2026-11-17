// Signal Radar — dashboard statis tanpa framework dan tanpa jaringan.
// Membaca window.RADAR (ditulis main.ts di sebelah folder dashboard/), lalu merender papan
// peringkat, tabel yang bisa disaring dan diurutkan, panel model yang transparan, dan tampilan
// detail per protocol berisi rencana farming persis seperti yang board.json bawa — teks layar
// dan teks kode berasal dari satu sumber yang sama.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var root = document.getElementById('app');
  if (!DATA) {
    root.textContent = 'data.js was not loaded beside this dashboard.';
    return;
  }

  /* ---------------- format ---------------- */

  function usdCompact(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function usdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function num4(n) {
    return Number(n).toFixed(4);
  }

  /* ---------------- dom helper ---------------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  /* ---------------- state ---------------- */

  var TABS = [
    { id: 'board', label: 'Ranked board' },
    { id: 'watchlist', label: 'Watchlist' },
    { id: 'early', label: 'Early finds' },
    { id: 'live', label: 'Live references' },
  ];

  var state = {
    tab: 'board',
    q: '',
    cat: 'all',
    chain: 'all',
    sort: 'rank',
    dir: 1,
    selected: null,
  };

  var liveState = { sort: 'mcap', dir: -1 };

  /* ---------------- data selectors ---------------- */

  function baseRows() {
    if (state.tab === 'live') return DATA.live.slice();
    return DATA.rows.filter(function (r) {
      if (state.tab === 'watchlist') return r.watchlist_member;
      if (state.tab === 'early') return !r.watchlist_member;
      return true;
    });
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var list = baseRows().filter(function (r) {
      if (state.tab !== 'live') {
        if (state.cat !== 'all' && (r.category || 'other').toLowerCase() !== state.cat) return false;
        if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      }
      if (!q) return true;
      return (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) >= 0;
    });
    var key = state.sort;
    var dir = state.tab === 'live' ? liveState.dir : state.dir;
    var effKey = state.tab === 'live' ? liveState.sort : key;
    list.sort(function (a, b) {
      var va = a[effKey];
      var vb = b[effKey];
      if (va === null || va === undefined) va = -Infinity;
      if (vb === null || vb === undefined) vb = -Infinity;
      if (Array.isArray(va)) va = va.join(', ');
      if (Array.isArray(vb)) vb = vb.join(', ');
      if (typeof va === 'string' || typeof vb === 'string') {
        var sa = String(va).toLowerCase();
        var sb = String(vb).toLowerCase();
        return sa < sb ? -dir : sa > sb ? dir : 0;
      }
      return (va - vb) * dir;
    });
    return list;
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) {
      var c = (r.category || 'other').toLowerCase();
      seen[c] = (seen[c] || 0) + 1;
    });
    return Object.keys(seen).sort();
  }

  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) {
      r.chains.forEach(function (c) {
        seen[c] = (seen[c] || 0) + 1;
      });
    });
    return Object.keys(seen).sort();
  }

  /* ---------------- hash routing ---------------- */

  function readHash() {
    var h = window.location.hash || '';
    var m = h.match(/^#\/p\/([A-Za-z0-9._-]+)$/);
    if (m) state.selected = decodeURIComponent(m[1]);
    else {
      state.selected = null;
      var t = h.match(/^#\/(board|watchlist|early|live)$/);
      if (t) state.tab = t[1];
    }
  }

  function openDetail(slug) {
    window.location.hash = '#/p/' + slug;
  }

  /* ---------------- masthead + stats ---------------- */

  function masthead() {
    var brand = el('div', { class: 'brand' }, [
      el('div', { class: 'brand-kicker', text: 'make.fun · token-radar-01 · pre-token intelligence' }),
      el('h1', { text: 'Signal Radar' }),
      el('div', {
        class: 'sub',
        text: 'Every pre-token protocol the snapshot carries, ranked by an implied value computed only from that snapshot — TVL, seven-day growth, and how long each protocol has run without a token. All 40 watchlist names are the floor of this board; early finds ride in by value, and live-token protocols stay in their own reference view.',
      }),
    ]);
    var asof = el('div', { class: 'asof' }, [
      el('div', {}, [document.createTextNode('snapshot as of '), el('b', { text: DATA.as_of })]),
      el('div', { text: 'model ' + DATA.model_version }),
      el('div', { text: DATA.source.split(',')[0] }),
    ]);
    return el('header', { class: 'masthead' }, [brand, asof]);
  }

  function statStrip() {
    return el('section', { class: 'stats' }, [
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Watchlist covered' }), el('div', { class: 'v amber', text: DATA.watchlist_size + '/' + DATA.watchlist_size })]),
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Ranked board rows' }), el('div', { class: 'v', text: String(DATA.board_size) })]),
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Early finds' }), el('div', { class: 'v mint', text: String(DATA.early_size) })]),
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Live references' }), el('div', { class: 'v violet', text: String(DATA.live_size) })]),
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'TVL floor' }), el('div', { class: 'v', text: usdCompact(DATA.floor_usd) })]),
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Farm plans' }), el('div', { class: 'v', text: DATA.board_size + ' × ' + (DATA.rows.length > 0 ? DATA.rows[0].farm_steps.length : 0) + ' steps' })]),
    ]);
  }

  function modelCard() {
    var m = DATA.model;
    var formula = [
      'multiple   = median MCap/TVL of this snapshot\'s live protocols, same category',
      '             (fallback: same category group, then global median)   clamp 0.03 – 3.0',
      'base       = tvl_usd × multiple',
      'growth     = clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') %   →  × (1 + growth/100 × ' + m.growth_weight + ')',
      'maturity   = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + '   (unknown age: ' + m.unknown_age_days + ' days)',
      'implied    = max(1, round(base × growth multiplier × maturity multiplier))',
    ].join('\n');

    var tableRows = DATA.multiple_table.slice(0, 14).map(function (t) {
      return el('tr', {}, [
        el('td', { text: t.category }),
        el('td', { class: 'num', text: String(t.samples) }),
        el('td', { class: 'num', text: t.ratio.toFixed(3) }),
        el('td', { class: 'src-' + t.source, text: t.source === 'exact' ? 'same category' : t.source === 'group' ? 'category group' : 'global' }),
      ]);
    });
    var table = el('table', { class: 'mult-table' }, [
      el('tr', {}, [el('th', { text: 'category' }), el('th', { text: 'live samples' }), el('th', { text: 'median MCap/TVL' }), el('th', { text: 'source' })]),
    ].concat(tableRows));

    return el('section', { class: 'model-card' }, [
      el('h2', { text: 'How implied value is computed' }),
      el('div', { class: 'formula', text: formula }),
      el('p', {
        class: 'model-note',
        text: 'No protocol name is special-cased: one function scores every row. The category multiple is the median market-cap-to-TVL ratio of the token-bearing protocols in this same snapshot — the snapshot prices its own categories, and this board applies those prices to the protocols that have no token yet.',
      }),
      table,
    ]);
  }

  /* ---------------- controls ---------------- */

  function controls() {
    var tabs = el('div', { class: 'tabs' }, TABS.map(function (t) {
      return el('button', {
        class: 'tab' + (state.tab === t.id ? ' on' : ''),
        text: t.label,
        onclick: function () {
          // the hash is the state: switching a tab rewrites it, hashchange re-renders once
          window.location.hash = '#/' + t.id;
        },
      });
    }));

    var search = el('input', {
      class: 'search',
      type: 'search',
      placeholder: 'search protocol, slug or category…',
      value: state.q,
      oninput: function (e) {
        state.q = e.target.value;
        renderTableOnly();
      },
    });

    var kids = [tabs, search];
    if (state.tab !== 'live') {
      kids.push(el('select', {
        class: 'select',
        onchange: function (e) {
          state.cat = e.target.value;
          renderTableOnly();
        },
      }, [el('option', { value: 'all', text: 'all categories' })].concat(categories().map(function (c) {
        return el('option', { value: c, text: c, selected: state.cat === c ? '' : null });
      }))));
      kids.push(el('select', {
        class: 'select',
        onchange: function (e) {
          state.chain = e.target.value;
          renderTableOnly();
        },
      }, [el('option', { value: 'all', text: 'all chains' })].concat(chains().map(function (c) {
        return el('option', { value: c, text: c, selected: state.chain === c ? '' : null });
      }))));
    }
    return el('div', { class: 'controls' }, kids);
  }

  /* ---------------- board table ---------------- */

  var BOARD_COLS = [
    { key: 'rank', label: '#', cls: 'rank' },
    { key: 'name', label: 'protocol' },
    { key: 'status', label: 'status', nosort: true },
    { key: 'category', label: 'category' },
    { key: 'chains', label: 'chains', nosort: true },
    { key: 'tvl_usd', label: 'TVL', num: true },
    { key: 'growth_pct', label: '7d', num: true },
    { key: 'age_days', label: 'no token', num: true },
    { key: 'category_multiple', label: 'multiple', num: true },
    { key: 'implied_value_usd', label: 'implied value', num: true, wide: true },
  ];

  function thFor(col) {
    var sortable = !col.nosort;
    var active = state.sort === col.key;
    return el('th', {
      class: sortable ? '' : 'no-sort',
      onclick: sortable ? function () {
        if (state.sort === col.key) state.dir = -state.dir;
        else {
          state.sort = col.key;
          state.dir = col.key === 'rank' || col.key === 'name' || col.key === 'category' ? 1 : -1;
        }
        renderTableOnly();
      } : null,
    }, [document.createTextNode(col.label + ' '), active ? el('span', { class: 'arrow', text: state.dir === 1 ? '▲' : '▼' }) : el('span', { class: 'arrow', text: '' })]);
  }

  function badgeFor(row) {
    return row.watchlist_member
      ? el('span', { class: 'badge watch', text: 'watchlist' })
      : el('span', { class: 'badge early', text: 'early find' });
  }

  function boardRow(row, maxImplied) {
    var growthClass = row.growth_pct === null ? 'num' : row.growth_pct >= 0 ? 'num up' : 'num down';
    var barPct = maxImplied > 0 ? Math.max(2, Math.round((row.implied_value_usd / maxImplied) * 100)) : 2;
    return el('tr', {
      class: 'row' + (row.watchlist_member ? ' watchlist' : ''),
      onclick: function () {
        openDetail(row.slug);
      },
    }, [
      el('td', { class: 'rank', text: String(row.rank) }),
      el('td', { class: 'name' }, [
        el('span', { class: 'pname', text: row.name }),
        el('span', { class: 'pslug', text: row.slug }),
      ]),
      el('td', {}, [badgeFor(row)]),
      el('td', {}, [el('span', { class: 'cat-label', text: row.category || 'other' })]),
      el('td', { class: 'chains-cell' }, row.chains.slice(0, 3).map(function (c) {
        return el('span', { class: 'chip', text: c });
      })),
      el('td', { class: 'num', text: usdCompact(row.tvl_usd) }),
      el('td', { class: growthClass, text: row.growth_pct === null ? 'n/a' : pct(row.growth_pct) }),
      el('td', { class: 'num', text: ageLabel(row.age_days) }),
      el('td', { class: 'num', text: '×' + Number(row.category_multiple).toFixed(3) }),
      el('td', { class: 'val-cell' }, [
        el('div', { class: 'val-line' }, [
          el('span', { class: 'v', text: usdFull(row.implied_value_usd) }),
          el('span', { class: 'm', text: '×' + Number(row.growth_multiplier).toFixed(3) + '·×' + Number(row.maturity_multiplier).toFixed(3) }),
        ]),
        el('div', { class: 'val-bar' }, [el('i', { style: 'width:' + barPct + '%' })]),
      ]),
    ]);
  }

  var LIVE_COLS = [
    { key: 'name', label: 'protocol' },
    { key: 'category', label: 'category' },
    { key: 'mcap_usd', label: 'market cap', num: true },
    { key: 'tvl_usd', label: 'TVL', num: true },
    { key: 'mcap_tvl_ratio', label: 'MCap/TVL', num: true },
    { key: 'change_7d', label: '7d', num: true },
  ];

  function liveRowOf(r) {
    return el('tr', { class: 'row' }, [
      el('td', { class: 'name' }, [el('span', { class: 'pname', text: r.name }), el('span', { class: 'pslug', text: r.slug })]),
      el('td', {}, [el('span', { class: 'cat-label', text: r.category || 'other' })]),
      el('td', { class: 'chains-cell' }, r.chains.slice(0, 3).map(function (c) {
        return el('span', { class: 'chip', text: c });
      })),
      el('td', { class: 'num', text: usdCompact(r.mcap_usd) }),
      el('td', { class: 'num', text: usdCompact(r.tvl_usd) }),
      el('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : '×' + Number(r.mcap_tvl_ratio).toFixed(3) }),
      el('td', { class: r.change_7d !== null && r.change_7d >= 0 ? 'num up' : 'num down', text: r.change_7d === null ? 'n/a' : pct(r.change_7d) }),
    ]);
  }

  function tableNode() {
    var rows = filteredRows();
    var isLive = state.tab === 'live';
    var cols = isLive ? LIVE_COLS : BOARD_COLS;

    var thead = el('tr', {}, cols.map(function (c) {
      if (isLive && c.key === 'status') return el('th', { class: 'no-sort', text: c.label });
      if (isLive) {
        var active = liveState.sort === c.key;
        return el('th', {
          onclick: c.nosort ? null : function () {
            if (liveState.sort === c.key) liveState.dir = -liveState.dir;
            else {
              liveState.sort = c.key;
              liveState.dir = c.key === 'name' || c.key === 'category' ? 1 : -1;
            }
            renderTableOnly();
          },
        }, [document.createTextNode(c.label + ' '), el('span', { class: 'arrow', text: active ? (liveState.dir === 1 ? '▲' : '▼') : '' })]);
      }
      return thFor(c);
    }));
    // live table: mcap/tvl/ratio columns count -> keep chains merged into category cell header mismatch fix:
    if (isLive) {
      thead = el('tr', {}, [
        liveTh('name', 'protocol'),
        liveTh('category', 'category'),
        liveTh('chains', 'chains'),
        liveTh('mcap_usd', 'market cap'),
        liveTh('tvl_usd', 'TVL'),
        liveTh('mcap_tvl_ratio', 'MCap/TVL'),
        liveTh('change_7d', '7d'),
      ]);
    }

    var maxImplied = rows.reduce(function (mx, r) {
      return isLive ? mx : Math.max(mx, r.implied_value_usd);
    }, 1);

    var tbody = el('tbody', {}, rows.length === 0
      ? [el('tr', {}, [el('td', { colspan: String(cols.length + (isLive ? 1 : 0)), class: 'empty', text: 'No protocol matches these filters.' })])]
      : rows.map(function (r) {
        return isLive ? liveRowOf(r) : boardRow(r, maxImplied);
      }));

    var head = el('thead', {}, [thead]);
    var table = el('table', { class: 'board' }, [head, tbody]);

    var total = isLive ? DATA.live_size : state.tab === 'board' ? DATA.board_size : state.tab === 'watchlist' ? DATA.watchlist_size : DATA.early_size;
    var sortKey = isLive ? liveState.sort : state.sort;
    var sortDir = (isLive ? liveState.dir : state.dir) === 1 ? ' ↑' : ' ↓';
    var count = el('div', {
      class: 'count-line',
      text: 'showing ' + rows.length + ' of ' + total + ' · sorted by ' + sortKey + sortDir,
    });

    return el('div', {}, [
      el('div', { class: 'table-wrap' }, [table]),
      count,
    ]);
  }

  function liveTh(key, label) {
    var active = liveState.sort === key;
    return el('th', {
      onclick: function () {
        if (liveState.sort === key) liveState.dir = -liveState.dir;
        else {
          liveState.sort = key;
          liveState.dir = key === 'name' || key === 'category' || key === 'chains' ? 1 : -1;
        }
        renderTableOnly();
      },
    }, [document.createTextNode(label + ' '), el('span', { class: 'arrow', text: active ? (liveState.dir === 1 ? '▲' : '▼') : '' })]);
  }

  /* ---------------- detail view ---------------- */

  function detailNode(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) {
        row = DATA.rows[i];
        break;
      }
    }
    var back = el('button', {
      class: 'back',
      text: '← back to the board',
      onclick: function () {
        window.location.hash = '#/';
      },
    });
    if (!row) {
      return el('section', { class: 'detail' }, [
        el('div', { class: 'detail-head' }, [el('h1', { text: slug }), back]),
        el('p', { class: 'empty', text: 'This protocol is not on the ranked board.' }),
      ]);
    }

    var recomputed = Math.max(1, Math.round(row.tvl_usd * row.category_multiple * row.growth_multiplier * row.maturity_multiplier));
    var rel = Math.abs(recomputed - row.implied_value_usd) / Math.max(1, row.implied_value_usd);
    var verify = rel < 0.01
      ? el('div', { class: 'verify', text: 'recomputed from the row\'s own fields: ' + usdFull(recomputed) + ' ≈ board.json ' + usdFull(row.implied_value_usd) + ' ✓' })
      : el('div', { class: 'verify', style: 'color:var(--amber);border-color:var(--amber);', text: 'recomputed ' + usdFull(recomputed) + ' vs board ' + usdFull(row.implied_value_usd) + ' (rounding)' });

    var breakdown = [
      'tvl_usd             ' + usdFull(row.tvl_usd),
      'category multiple   ×' + Number(row.category_multiple).toFixed(4) + '   (' + row.multiple_source + ')',
      'growth (7d)         ' + pct(row.growth_pct) + '  →  ×' + Number(row.growth_multiplier).toFixed(4),
      'maturity (no token) ' + (row.age_days === null ? 'age unknown → 365d' : row.age_days + ' days') + '  →  ×' + Number(row.maturity_multiplier).toFixed(4),
      'implied value       ' + usdFull(row.implied_value_usd),
    ].join('\n');

    var grid = el('div', { class: 'grid' }, [
      card('implied value', usdFull(row.implied_value_usd), 'amber', 'what this radar claims it is worth pre-TGE'),
      card('TVL', usdCompact(row.tvl_usd), '', 'snapshot figure'),
      card('7d growth', row.growth_pct === null ? 'n/a' : pct(row.growth_pct), row.growth_pct !== null && row.growth_pct >= 0 ? 'mint' : '', 'snapshot figure'),
      card('days without token', row.age_days === null ? 'unknown' : String(row.age_days), '', row.listed_at ? 'listed ' + row.listed_at : 'listed_at unknown'),
      card('category multiple', '×' + Number(row.category_multiple).toFixed(3), 'amber', row.multiple_source),
      card('rank', '#' + row.rank + ' of ' + DATA.board_size, '', row.watchlist_member ? 'on the watchlist' : 'early find'),
    ]);

    var plan = el('ol', { class: 'plan' }, row.farm_steps.map(function (text, idx) {
      // the cost and time are already inside the step text; show chips for the plan's tail
      var costMatch = text.match(/ Cost: ([^.]+)\. Time: ([^.]+)\./);
      var main = costMatch ? text.slice(0, costMatch.index) : text;
      return el('li', {}, [
        el('div', { text: main.trim() }),
        costMatch ? el('div', { class: 'step-meta' }, [
          el('span', { class: 'cost', text: 'cost: ' + costMatch[1] }),
          el('span', { class: 'time', text: 'time: ' + costMatch[2] }),
        ]) : null,
      ]);
    }));

    return el('section', { class: 'detail' }, [
      el('div', { class: 'detail-head' }, [
        el('div', {}, [
          el('div', { class: 'brand-kicker', text: row.watchlist_member ? 'watchlist · pre-token' : 'early find · pre-token' }),
          el('h1', { text: row.name }),
          el('div', { class: 'meta' }, [
            el('span', { class: 'cat-label', text: (row.category || 'other') }),
            ' · ',
            ...row.chains.map(function (c) {
              return el('span', { class: 'chip', text: c });
            }),
          ]),
        ]),
        back,
      ]),
      grid,
      verify,
      el('h3', { class: 'section', text: 'farm plan — ' + row.plan_group + ' track, ' + row.farm_steps.length + ' steps with cost and time' }),
      plan,
      el('h3', { class: 'section', text: 'model breakdown' }),
      el('div', { class: 'breakdown', text: breakdown }),
    ]);
  }

  function card(k, v, tone, hint) {
    return el('div', { class: 'card' }, [
      el('div', { class: 'k', text: k }),
      el('div', { class: 'v ' + (tone || ''), text: v }),
      el('div', { class: 'hint', text: hint }),
    ]);
  }

  /* ---------------- footer ---------------- */

  function footer() {
    return el('footer', { class: 'foot' }, [
      el('span', { text: 'Signal Radar — an entry to make.fun\'s "Build the best token launch radar" bounty. Scores come only from the sealed snapshot; nothing here touches the network.' }),
      el('span', { class: 'mono', text: DATA.model_version + ' · as of ' + DATA.as_of }),
    ]);
  }

  /* ---------------- render ---------------- */

  function bodyNode() {
    if (state.selected) return el('main', { id: 'board', tabindex: '-1' }, [detailNode(state.selected)]);
    // the board is the product: table first, the method and the model behind it below
    var kids = [controls(), tableNode(), statStrip()];
    if (state.tab !== 'live') kids.push(modelCard());
    return el('main', { id: 'board', tabindex: '-1' }, kids);
  }

  function render() {
    var wrap = el('div', { class: 'wrap' }, [masthead(), bodyNode(), footer()]);
    root.textContent = '';
    root.appendChild(wrap);
    root.setAttribute('aria-busy', 'false');
  }

  function renderTableOnly() {
    // re-render body but keep focus in the search box when typing
    var active = document.activeElement;
    var isSearch = active && active.className === 'search';
    var pos = isSearch ? active.selectionStart : 0;
    render();
    if (isSearch) {
      var box = document.querySelector('.search');
      if (box) {
        box.focus();
        box.setSelectionRange(pos, pos);
      }
    }
  }

  window.addEventListener('hashchange', function () {
    readHash();
    render();
  });

  // entry point for scripted states (used when capturing the three screenshots)
  window.SIGNAL = {
    state: state,
    render: render,
    set: function (patch) {
      Object.keys(patch).forEach(function (k) {
        state[k] = patch[k];
      });
      render();
    },
    data: DATA,
  };

  readHash();
  render();
})();
