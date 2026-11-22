// Token Radar's dashboard. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the board, the filters, the detail
// view and the live-token view. No network: every byte it shows is in
// data.js, and every farm step it shows is the board's own step for that
// protocol — the page generates nothing the board does not already say.

var DATA = window.RADAR || { rows: [], live: [], as_of: '', model_version: '', watchlist_size: 0, board_size: 0 };
var watchlist = {};
var view = 'board';
var selected = null;

function money(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}
function pct(n) {
  if (n === null || n === undefined) return '—';
  var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  return s;
}
function ageText(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days < 30) return days + 'd';
  if (days < 365) return Math.round(days / 30) + 'mo';
  return (days / 365).toFixed(1) + 'y';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function byId(id) { return document.getElementById(id); }
function chainsText(chains) {
  chains = chains || [];
  if (chains.length <= 3) return chains.join(', ') || '—';
  return chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3) + ' more';
}

function fillSelects() {
  var cats = {}, chains = {};
  DATA.rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    (r.chains || []).forEach(function (c) { chains[c] = true; });
  });
  var cat = byId('cat');
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; cat.appendChild(o);
  });
  var ch = byId('chain');
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; ch.appendChild(o);
  });
}

function filteredRows() {
  var q = byId('q').value.trim().toLowerCase();
  var cat = byId('cat').value;
  var chain = byId('chain').value;
  var minTvl = Number(byId('minTvl').value || 0);
  var watchOnly = byId('watch').checked;
  var sort = byId('sort').value;
  var rows = DATA.rows.filter(function (r) {
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
    if (cat && r.category !== cat) return false;
    if (chain && (r.chains || []).indexOf(chain) < 0) return false;
    if (r.tvl_usd < minTvl) return false;
    if (watchOnly && !watchlist[r.slug]) return false;
    return true;
  });
  var key = {
    rank: function (a, b) { return a.rank - b.rank; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
    age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
  }[sort] || function (a, b) { return a.rank - b.rank; };
  return rows.sort(key);
}

function renderBoard() {
  var rows = filteredRows();
  var tbody = byId('rows');
  var head = document.querySelector('#board thead tr');
  head.innerHTML = '<th>Rank</th><th>Protocol</th><th>Category</th><th>Chains</th>' +
    '<th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Implied value</th>';
  tbody.innerHTML = rows.map(function (r) {
    var g = r.change_7d === null ? '<td class="num">—</td>' :
      '<td class="num ' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>';
    return '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="sel"' : '') + '>' +
      '<td class="rank">' + r.rank + '</td>' +
      '<td class="name">' + esc(r.name) + '<small>' + esc(r.slug) + '</small></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc(chainsText(r.chains)) + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' + g +
      '<td class="num">' + ageText(r.age_days) + '</td>' +
      '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td></tr>';
  }).join('');
  byId('count').textContent = rows.length + ' of ' + DATA.rows.length +
    ' pre-token protocols shown · ranked by implied value';
  tbody.querySelectorAll('tr').forEach(function (tr) {
    tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
  });
}

function renderLive() {
  var tbody = byId('rows');
  var head = document.querySelector('#board thead tr');
  head.innerHTML = '<th>#</th><th>Protocol</th><th>Category</th><th>Chains</th>' +
    '<th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Market cap</th>';
  tbody.innerHTML = DATA.live.map(function (r, i) {
    var g = r.change_7d === null ? '<td class="num">—</td>' :
      '<td class="num ' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>';
    return '<tr><td class="rank">' + (i + 1) + '</td>' +
      '<td class="name">' + esc(r.name) + '<small>' + esc(r.slug) + '</small></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc(chainsText(r.chains)) + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' + g +
      '<td class="num">—</td>' +
      '<td class="num"><b>' + money(r.mcap_usd) + '</b></td></tr>';
  }).join('');
  byId('count').textContent = DATA.live.length +
    ' live-token protocols by market cap — the market\u2019s own values, kept apart from the ranked board';
}

function showDetail(slug) {
  selected = slug;
  var r = null;
  DATA.rows.forEach(function (x) { if (x.slug === slug) r = x; });
  if (!r) return;
  var base = r.fit_base_usd || r.tvl_usd * r.comp_multiple;
  var steps = (r.farm_steps || []).map(function (s, i) {
    return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(s) + '</li>';
  }).join('');
  byId('detail').innerHTML =
    '<h2>#' + r.rank + ' · ' + esc(r.name) + '</h2>' +
    '<p class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc((r.chains || []).join(', ') || '—') +
    ' · TVL ' + money(r.tvl_usd) + ' · 7-day ' + pct(r.change_7d) +
    ' · listed ' + ageText(r.age_days) + ' ago · records no token</p>' +
    '<h3>Implied value: ' + money(r.implied_value_usd) + '</h3>' +
    '<div class="math">' +
    '<div><b>' + money(base) + '</b><span>fitted base from TVL, log–log fit on ' + (DATA.fit ? DATA.fit.n_live : 0) + ' live tokens</span></div>' +
    '<div><b>&times; ' + r.comp_multiple.toFixed(3) + '</b><span>category factor (' + r.comp_n + ' live comparables)</span></div>' +
    '<div><b>&times; ' + r.growth_multiplier.toFixed(3) + '</b><span>growth factor, 7-day ' + pct(r.change_7d) + '</span></div>' +
    '<div><b>&times; ' + r.maturity_multiplier.toFixed(3) + '</b><span>age factor, ' + ageText(r.age_days) + ' with no token</span></div>' +
    '<div><b>&times; ' + r.chain_multiplier.toFixed(3) + '</b><span>chain factor, ' + (r.chains || []).length + ' chain(s)</span></div>' +
    '</div>' +
    '<h3>Farm plan</h3><ol>' + steps + '</ol>';
  document.querySelectorAll('#rows tr').forEach(function (tr) {
    tr.classList.toggle('sel', tr.getAttribute('data-slug') === slug);
  });
  // Note: no scrollIntoView here — headless screenshots capture the page
  // from the top, so a forced scroll leaves a blank band above the card.
  // Clicking a row still shows the detail directly above the board.
}

function render() {
  if (view === 'live') { renderLive(); }
  else { renderBoard(); }
  byId('viewBoard').classList.toggle('on', view === 'board');
  byId('viewLive').classList.toggle('on', view === 'live');
  byId('viewBoard').setAttribute('aria-pressed', String(view === 'board'));
  byId('viewLive').setAttribute('aria-pressed', String(view === 'live'));
}

function init() {
  (DATA.watchlist || []).forEach(function (s) { watchlist[s] = true; });
  fillSelects();
  // Deep links, so a view can be opened exactly as it is screenshotted:
  // ?q=…&cat=…&chain=…&minTvl=…&sort=…&watch=1&view=live&detail=<slug>
  var params = new URLSearchParams(window.location.search || '');
  var set = function (id, v) { if (v !== null && v !== '') byId(id).value = v; };
  set('q', params.get('q')); set('cat', params.get('cat')); set('chain', params.get('chain'));
  set('minTvl', params.get('minTvl')); set('sort', params.get('sort'));
  if (params.get('watch') === '1') byId('watch').checked = true;
  if (params.get('view') === 'live') view = 'live';
  var top = DATA.rows.length ? DATA.rows[0] : null;
  byId('meta').textContent = 'Snapshot ' + (DATA.as_of || '—') + ' · ' +
    DATA.board_size + ' pre-token protocols ranked · watchlist ' + DATA.watchlist_size +
    ' · model ' + (DATA.model_version || '—') +
    (top ? ' · top implied value ' + money(top.implied_value_usd) : '');
  var fit = DATA.fit, val = DATA.validation;
  if (fit && val && byId('fitline')) {
    byId('fitline').textContent = 'Fitted on ' + fit.n_live +
      ' live-token protocols in this snapshot: log10 market cap = ' + fit.intercept.toFixed(4) +
      ' + ' + fit.slope_logtvl.toFixed(4) + ' · log10 TVL' +
      (fit.coef_growth >= 0 ? ' + ' : ' − ') + Math.abs(fit.coef_growth).toFixed(4) + ' · 7-day growth' +
      (fit.coef_logage >= 0 ? ' + ' : ' − ') + Math.abs(fit.coef_logage).toFixed(4) + ' · log10 days listed' +
      (fit.coef_logchains >= 0 ? ' + ' : ' − ') + Math.abs(fit.coef_logchains).toFixed(4) + ' · log chains' +
      ', plus the category correction. Held out ' + val.folds + '-fold: RMSE ' +
      val.rmse_log10.toFixed(3) + ' on log10 market cap, R² ' + val.r2.toFixed(3) +
      ' — against 1.01 for the previous shrunk-median model.';
  }
  ['q', 'cat', 'chain', 'minTvl', 'sort', 'watch'].forEach(function (id) {
    byId(id).addEventListener('input', render);
    byId(id).addEventListener('change', render);
  });
  byId('viewBoard').addEventListener('click', function () { view = 'board'; render(); });
  byId('viewLive').addEventListener('click', function () { view = 'live'; render(); });
  render();
  var detail = params.get('detail');
  if (detail) showDetail(detail);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
