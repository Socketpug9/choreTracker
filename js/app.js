/* ============================================================
   Stash: keep track of your money on your phone.
   Everything is saved in this browser's localStorage, in cents.
   ============================================================ */

const STORE_KEY = 'stash.v1';
const MOTION_KEY = 'stash.liquid';
const PAGE = 25;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/* ---------- Dates (local "YYYY-MM-DD" keys) ---------- */

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);
const todayKey = () => toKey(new Date());
const isDateKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortDate = (k) => { const d = fromKey(k); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
function dayHeading(k, today) {
  const diff = daysBetween(k, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${DAYS[fromKey(k).getDay()]}, ${shortDate(k)}`;
}

/* ---------- Money (stored as whole cents) ---------- */

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (c) => (c < 0 ? '-' : '') + usd.format(Math.abs(c) / 100);
const signed = (c) => (c < 0 ? '−' : '+') + usd.format(Math.abs(c) / 100);
function compact(c) {
  const v = Math.abs(c) / 100;
  const s = c < 0 ? '-' : '';
  if (v >= 1e6) return `${s}$${+(v / 1e6).toFixed(1)}m`;
  if (v >= 1e4) return `${s}$${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${s}$${+(v / 1e3).toFixed(1)}k`;
  return `${s}$${Math.round(v)}`;
}
function parseMoney(str) {
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/* ---------- Storage ---------- */

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const okId = (id) => typeof id === 'string' && /^[a-z0-9]{1,40}$/i.test(id);

function cleanTxn(t) {
  if (!t || !Number.isInteger(t.amt) || !Number.isFinite(t.ts)) return null;
  return {
    id: okId(t.id) ? t.id : newId(),
    amt: Math.max(-1e11, Math.min(1e11, t.amt)),
    note: typeof t.note === 'string' ? t.note.slice(0, 40) : '',
    ts: t.ts,
    timed: t.timed !== false,
    kind: t.kind === 'set' ? 'set' : 'move',
  };
}
function cleanGoal(g) {
  if (!g || typeof g.name !== 'string' || !g.name.trim() || !Number.isInteger(g.target) || g.target <= 0) return null;
  return { id: okId(g.id) ? g.id : newId(), name: g.name.trim().slice(0, 32), target: g.target, date: isDateKey(g.date) ? g.date : null };
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d && Array.isArray(d.txns)) {
      const goals = Array.isArray(d.goals) ? d.goals.map(cleanGoal).filter(Boolean) : [];
      return {
        txns: d.txns.map(cleanTxn).filter(Boolean).sort((a, b) => a.ts - b.ts),
        goals,
        chartGoal: goals.some((g) => g.id === d.chartGoal) ? d.chartGoal : (goals[0] ? goals[0].id : null),
        range: d.range === 14 ? 14 : 28,
      };
    }
  } catch (e) { /* start fresh */ }
  return { txns: [], goals: [], chartGoal: null, range: 28 };
}
let state = load();
const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));
const keyOf = (t) => toKey(new Date(t.ts));

/* ---------- Numbers behind the screen ---------- */

const balanceNow = () => state.txns.reduce((s, t) => s + t.amt, 0);

// End-of-day balances for every day from `start` to `end`. Days before the first entry are null.
// With movesOnly, balance corrections are left out (used for the trend, since a
// correction is a fix, not money earned or spent).
function dailyBalances(start, end, movesOnly = false) {
  if (!state.txns.length) return [];
  const first = keyOf(state.txns[0]);
  const net = new Map();
  let before = 0;
  for (const t of state.txns) {
    if (movesOnly && t.kind === 'set') continue;
    const k = keyOf(t);
    if (k < start) before += t.amt;
    else net.set(k, (net.get(k) || 0) + t.amt);
  }
  const out = [];
  let bal = before;
  for (let k = start, i = 0; k <= end; k = addDays(k, 1), i++) {
    bal += net.get(k) || 0;
    out.push({ k, i, v: k < first ? null : bal });
  }
  return out;
}

// Average change per day (cents), from a straight line fitted through money in and out
// over the last 4 weeks. null if there are fewer than 3 days of history.
function trendPerDay(today) {
  const pts = dailyBalances(addDays(today, -27), today, true).filter((p) => p.v !== null);
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.i, 0) / n;
  const my = pts.reduce((s, p) => s + p.v, 0) / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.i - mx) * (p.v - my); den += (p.i - mx) ** 2; }
  return den ? num / den : 0;
}

function goalOutlook(g, bal, slope, today) {
  const need = g.target - bal;
  if (need <= 0) return { tone: 'done', text: "You've reached this goal." };
  if (slope === null) return { tone: 'wait', text: 'After a few days of activity, this shows when you will get there.' };
  if (g.date) {
    const days = daysBetween(today, g.date);
    if (days <= 0) return { tone: 'late', text: `The date has passed. ${money(need)} to go.` };
    const projected = bal + slope * days;
    if (projected >= g.target) return { tone: 'on', text: `<strong>On track.</strong> At this pace you'll have ${money(Math.round(projected))} by ${shortDate(g.date)}.` };
    const perWeek = need / (days / 7);
    const extra = perWeek - slope * 7;
    return { tone: 'behind', text: `<strong>Behind pace.</strong> Save about ${money(Math.ceil(extra / 100) * 100)} more a week to make it by ${shortDate(g.date)}.` };
  }
  if (slope <= 0) return { tone: 'stalled', text: "Your balance isn't growing right now, so there's no finish date yet." };
  const days = Math.ceil(need / slope);
  if (days > 365 * 3) return { tone: 'slow', text: 'At this pace it will take more than 3 years.' };
  return { tone: 'on', text: `At this pace you'll get there around <strong>${shortDate(addDays(today, days))}</strong>.`, date: addDays(today, days) };
}

/* ---------- Rendering ---------- */

let shown = PAGE;

function render() {
  const today = todayKey();
  const bal = balanceNow();
  const slope = trendPerDay(today);

  // Hero
  const text = money(bal);
  $('#balance-text').textContent = text;
  fitBalance();

  const weekStart = addDays(today, -6);
  const week = state.txns.filter((t) => t.kind !== 'set' && keyOf(t) >= weekStart).reduce((s, t) => s + t.amt, 0);
  const hasMoves = state.txns.some((t) => t.kind !== 'set');
  const weekEl = $('#week-change');
  if (!hasMoves) weekEl.innerHTML = '';
  else if (week === 0) weekEl.textContent = 'No change this week';
  else weekEl.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="${week > 0 ? 'M6 1l5 9H1z' : 'M6 11L1 2h10z'}"/></svg>${signed(week)} this week`;

  $('#start-card').hidden = state.txns.length > 0;

  renderChart(today, bal, slope);
  renderGoals(today, bal, slope);
  renderActivity(today);
}

function fitBalance() {
  const p = document.querySelector('.balance');
  const span = $('#balance-text');
  const max = p.parentElement.clientWidth - 40;
  let size = 84;
  p.style.fontSize = `${size}px`;
  while (span.offsetWidth > max && size > 36) {
    size -= 2;
    p.style.fontSize = `${size}px`;
  }
}

/* ----- Chart ----- */

let chartModel = null;

function renderChart(today, bal, slope) {
  const range = state.range;
  document.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.range) === range)));
  $('#chart-title').textContent = range === 14 ? 'Last 2 weeks' : 'Last 4 weeks';

  const box = $('#chart');
  const start = addDays(today, -(range - 1));
  const end = addDays(today, range); // forecast as far ahead as we look back
  const past = dailyBalances(start, today);
  const goal = state.goals.find((g) => g.id === state.chartGoal) || null;
  $('#legend-goal').hidden = !goal;

  if (!state.txns.length) {
    chartModel = null;
    box.innerHTML = '<div class="chart-empty">Your balance over time shows up here, with a forecast of where it\'s heading.</div>';
    $('#chart-value').textContent = '';
    $('#insight').innerHTML = '';
    return;
  }

  const todayIdx = range - 1;
  const total = range * 2;
  const forecast = slope === null ? [] : Array.from({ length: range + 1 }, (_, j) => ({ i: todayIdx + j, k: addDays(today, j), v: bal + slope * j }));

  // Header: change over the window, unless you're scrubbing.
  // Change over the window from real money moves (not balance corrections).
  const change = state.txns.filter((t) => t.kind !== 'set' && keyOf(t) >= start).reduce((sum, t) => sum + t.amt, 0);
  chartModel = { past, forecast, todayIdx, total, start, bal, change };
  showChartHeader();

  // Scale
  const W = Math.max(280, box.clientWidth);
  const H = box.clientHeight || 230;
  const L = 6, R = 46, T = 30, B = 26;
  const vals = past.filter((p) => p.v !== null).map((p) => p.v).concat(forecast.map((p) => p.v));
  if (goal) vals.push(goal.target);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 2000) { hi += 1000; lo -= 1000; }
  const step = niceStep(hi - lo, 3);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const x = (i) => L + (i / (total - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  chartModel.x = x; chartModel.y = y; chartModel.W = W; chartModel.H = H; chartModel.T = T; chartModel.B = B;

  const parts = [];
  for (let v = lo; v <= hi + 1; v += step) {
    parts.push(`<line x1="${L}" x2="${W - R + 6}" y1="${y(v)}" y2="${y(v)}" stroke="#2C2B27" stroke-width="1"/>`);
    parts.push(`<text x="${W}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`);
  }
  // Today marker
  parts.push(`<line x1="${x(todayIdx)}" x2="${x(todayIdx)}" y1="${T - 6}" y2="${H - B}" stroke="#5A564B" stroke-width="1.5" stroke-dasharray="2 4" stroke-linecap="round"/>`);
  parts.push(`<text x="${L}" y="${H - 6}">${shortDate(start)}</text>`);
  parts.push(`<text x="${x(todayIdx)}" y="${H - 6}" text-anchor="middle" style="fill:#FFF8E0">Today</text>`);
  parts.push(`<text x="${W - R + 6}" y="${H - 6}" text-anchor="end">${shortDate(end)}</text>`);

  // Goal line
  if (goal) {
    const gy = y(goal.target);
    parts.push(`<line x1="${L}" x2="${W - R + 6}" y1="${gy}" y2="${gy}" stroke="#FFF8E0" stroke-width="2" stroke-dasharray="6 6" stroke-linecap="round"/>`);
    parts.push(`<g class="goal-tag"><rect x="${L}" y="${gy - 26}" height="20" rx="10" fill="#FFF8E0"/><text class="goal-label" x="${L + 9}" y="${gy - 12}">${esc(goal.name)} ${compact(goal.target)}</text></g>`);
  }

  // Real balance: flat fill + line
  const real = past.filter((p) => p.v !== null);
  if (real.length) {
    const line = real.map((p, n) => `${n ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    if (real.length > 1) parts.push(`<path d="${line} L${x(real[real.length - 1].i)} ${H - B} L${x(real[0].i)} ${H - B} Z" fill="#F6D33C" fill-opacity="0.13"/>`);
    parts.push(`<path d="${line}" fill="none" stroke="#F6D33C" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
  }

  // Forecast
  if (forecast.length) {
    const f = forecast.map((p, n) => `${n ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    parts.push(`<path d="${f}" fill="none" stroke="#F6D33C" stroke-opacity="0.7" stroke-width="3" stroke-dasharray="1 7" stroke-linecap="round"/>`);
    // Where the forecast reaches the goal
    if (goal && bal < goal.target && slope > 0) {
      const d = (goal.target - bal) / slope;
      if (d <= range) {
        const cx = x(todayIdx + d);
        const cy = y(goal.target);
        parts.push(`<circle cx="${cx}" cy="${cy}" r="7" fill="#000" stroke="#FFF8E0" stroke-width="3"/>`);
        parts.push(`<text x="${Math.min(cx, W - R - 4)}" y="${cy + 24}" text-anchor="middle" style="fill:#FFF8E0">${shortDate(addDays(today, Math.ceil(d)))}</text>`);
      }
    }
  }

  // Today's dot
  parts.push(`<circle cx="${x(todayIdx)}" cy="${y(bal)}" r="7" fill="#F6D33C" stroke="#000" stroke-width="3"/>`);
  // Scrub marker (moved by touch)
  parts.push(`<g id="scrub" visibility="hidden"><line y1="${T - 6}" y2="${H - B}" stroke="#FFF8E0" stroke-width="1.5"/><circle r="6" fill="#FFF8E0" stroke="#000" stroke-width="3"/></g>`);

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(chartSummary(goal, bal, slope, today))}">${parts.join('')}</svg>`;
  // Fit the goal tag's pill to its text.
  const tag = box.querySelector('.goal-tag');
  if (tag) {
    const t = tag.querySelector('text').getBBox();
    tag.querySelector('rect').setAttribute('width', String(Math.ceil(t.width + 18)));
  }

  // Insight line under the chart
  const bits = [];
  if (slope === null) bits.push('The forecast starts once you have 3 days of history.');
  else if (Math.abs(slope * 7) < 50) bits.push('Your balance is holding steady.');
  else bits.push(`You're trending <strong>${signed(Math.round(slope * 7))}</strong> a week.`);
  if (goal) bits.push(`${esc(goal.name)}: ${goalOutlook(goal, bal, slope, today).text}`);
  $('#insight').innerHTML = bits.join(' ');
}

function chartSummary(goal, bal, slope, today) {
  let s = `Balance chart. Now ${money(bal)}.`;
  if (slope !== null) s += ` Trending ${signed(Math.round(slope * 7))} a week.`;
  if (goal) s += ` Goal ${goal.name}, ${money(goal.target)}. ${goalOutlook(goal, bal, slope, today).text.replace(/<[^>]+>/g, '')}`;
  return s;
}

function niceStep(span, count) {
  const raw = Math.max(span / count, 100);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function showChartHeader(point) {
  const v = $('#chart-value');
  if (!chartModel) { v.textContent = ''; return; }
  if (!point) {
    v.innerHTML = `${signed(chartModel.change)}<small>${state.range === 14 ? 'in 2 weeks' : 'in 4 weeks'}</small>`;
    return;
  }
  const label = point.future ? `forecast, ${shortDate(point.k)}` : (point.i === chartModel.todayIdx ? 'today' : shortDate(point.k));
  v.innerHTML = `${money(Math.round(point.v))}<small>${label}</small>`;
}

function scrubAt(clientX) {
  const m = chartModel;
  if (!m || !m.x) return;
  const r = $('#chart svg').getBoundingClientRect();
  const px = ((clientX - r.left) / r.width) * m.W;
  let i = Math.round(((px - 6) / (m.W - 6 - 46)) * (m.total - 1));
  i = Math.max(0, Math.min(m.total - 1, i));
  let point = null;
  if (i <= m.todayIdx) {
    const p = m.past[i];
    if (p && p.v !== null) point = { ...p, future: false };
  } else if (m.forecast.length) {
    const p = m.forecast[i - m.todayIdx];
    if (p) point = { ...p, future: true };
  }
  const g = $('#scrub');
  if (!point) { g.setAttribute('visibility', 'hidden'); showChartHeader(); return; }
  g.setAttribute('visibility', 'visible');
  g.querySelector('line').setAttribute('x1', m.x(point.i));
  g.querySelector('line').setAttribute('x2', m.x(point.i));
  g.querySelector('circle').setAttribute('cx', m.x(point.i));
  g.querySelector('circle').setAttribute('cy', m.y(point.v));
  showChartHeader(point);
}
function endScrub() {
  const g = $('#scrub');
  if (g) g.setAttribute('visibility', 'hidden');
  showChartHeader();
}
{
  const chart = $('#chart');
  let active = false;
  chart.addEventListener('pointerdown', (e) => { active = true; scrubAt(e.clientX); });
  chart.addEventListener('pointermove', (e) => { if (active || e.pointerType === 'mouse') scrubAt(e.clientX); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => chart.addEventListener(ev, () => { active = false; endScrub(); }));
}

/* ----- Goals ----- */

function renderGoals(today, bal, slope) {
  $('#goals-empty').hidden = state.goals.length > 0;
  $('#goals').innerHTML = state.goals.map((g) => {
    const pct = Math.max(0, Math.min(100, (bal / g.target) * 100));
    const o = goalOutlook(g, bal, slope, today);
    const onChart = state.chartGoal === g.id;
    return `
      <li class="goal" data-id="${g.id}">
        <div class="goal-top">
          <h3 class="goal-name">${esc(g.name)}</h3>
          <button type="button" class="goal-edit" data-action="edit-goal">Edit</button>
        </div>
        <p class="goal-nums"><b>${money(Math.max(0, bal))}</b> of ${money(g.target)}${g.date ? ` by ${shortDate(g.date)}` : ''}</p>
        <div class="bar" role="progressbar" aria-label="${esc(g.name)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct}%"></i></div>
        <p class="goal-forecast">${o.text}</p>
        <button type="button" class="goal-show" data-action="chart-goal" aria-pressed="${onChart}">
          ${onChart ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>On the graph' : 'Show on graph'}
        </button>
      </li>`;
  }).join('');
}

/* ----- Activity ----- */

function entryLabel(t) {
  if (t.note) return t.note;
  if (t.kind === 'set') return 'Balance corrected';
  return t.amt >= 0 ? 'Added money' : 'Spent money';
}
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

function renderActivity(today) {
  const list = [...state.txns].sort((a, b) => b.ts - a.ts);
  $('#activity-empty').hidden = list.length > 0;
  $('#show-more').hidden = list.length <= shown;
  const groups = [];
  for (const t of list.slice(0, shown)) {
    const k = keyOf(t);
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, items: [] });
    groups[groups.length - 1].items.push(t);
  }
  $('#activity').innerHTML = groups.map((g) => `
    <h3 class="day">${dayHeading(g.k, today)}</h3>
    <ul class="entries">${g.items.map((t) => `
      <li><button type="button" class="entry" data-action="edit-entry" data-id="${t.id}">
        <span class="entry-main">
          <span class="entry-note">${esc(entryLabel(t))}</span>
          ${t.timed ? `<span class="entry-time">${timeFmt.format(new Date(t.ts))}</span>` : ''}
        </span>
        <span class="entry-amt${t.amt >= 0 ? ' plus' : ''}">${signed(t.amt)}</span>
      </button></li>`).join('')}
    </ul>`).join('');
}

/* ---------- Money sheet (add / spend / set / edit) ---------- */

const sheet = $('#money');
const ms = { mode: 'add', sign: 1, str: '', editId: null, from: null };

function amountCents() { return ms.str ? Math.round(parseFloat(ms.str) * 100) || 0 : 0; }

function drawAmount() {
  const [i, d] = ms.str.split('.');
  const int = Number(i || '0').toLocaleString('en-US');
  $('#amount').textContent = `${ms.mode === 'set' && ms.neg ? '-' : ''}$${int}${d !== undefined ? '.' + d : ''}`;
  const c = amountCents();
  const btn = $('#money-save');
  if (ms.mode === 'set') {
    btn.textContent = `Set balance to ${money(ms.neg ? -c : c)}`;
    btn.disabled = ms.str === '';
  } else if (ms.mode === 'edit') {
    btn.textContent = 'Save changes';
    btn.disabled = c === 0;
  } else {
    btn.textContent = `${ms.sign > 0 ? 'Add' : 'Spend'} ${money(c)}`;
    btn.disabled = c === 0;
  }
  document.querySelectorAll('#sign button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.sign) === ms.sign)));
}

function press(key) {
  let s = ms.str;
  if (key === 'back') s = s.slice(0, -1);
  else if (key === '.') { if (!s.includes('.')) s = (s || '0') + '.'; }
  else if (/^\d$/.test(key)) {
    const [i, d] = s.split('.');
    if (d !== undefined && d.length >= 2) return nudge();
    if (d === undefined && (i || '').replace(/^0+/, '').length >= 7) return nudge();
    s = s === '0' ? key : s + key;
  }
  ms.str = s;
  drawAmount();
}
function nudge() {
  const a = $('#amount');
  a.classList.remove('nudge');
  void a.offsetWidth;
  a.classList.add('nudge');
}

function openMoney(mode, from, entry) {
  const today = todayKey();
  ms.mode = mode;
  ms.from = from || null;
  ms.editId = entry ? entry.id : null;
  ms.neg = false;
  ms.sign = mode === 'spend' ? -1 : 1;
  ms.str = '';
  $('#note').value = '';
  $('#when').value = today;
  $('#when').max = today;

  if (mode === 'set') {
    const b = balanceNow();
    ms.neg = b < 0;
    ms.str = b ? (Math.abs(b) / 100).toFixed(2).replace(/\.00$/, '') : '';
  }
  if (entry) {
    ms.sign = entry.amt < 0 ? -1 : 1;
    ms.str = (Math.abs(entry.amt) / 100).toFixed(2).replace(/\.00$/, '');
    $('#note').value = entry.note;
    $('#when').value = keyOf(entry);
  }
  $('#money-title').textContent = { add: 'Add money', spend: 'Spend money', set: 'Correct balance', edit: 'Edit entry' }[mode];
  $('#sign').hidden = mode === 'set';
  $('#meta-row').hidden = mode === 'set';
  $('#chips').hidden = mode === 'set';
  $('#money-delete').hidden = mode !== 'edit';
  drawAmount();
  openSheet(sheet);
}

/* ----- Opening and closing sheets ----- */

// With the liquid on, black ink flows in and forms the sheet, and closing melts it
// back into ink that soaks into the background. Otherwise sheets just slide up.
let ink = null;

function openSheet(d) {
  d.classList.remove('formed', 'slide', 'forming');
  d.classList.add(ink ? 'forming' : 'slide');
  d.showModal();
  // Start focus on the title, so no button starts out highlighted.
  d.querySelector('h2').focus({ preventScroll: true });
  hideDock(true);
  if (!ink) return;
  ink.form(d.getBoundingClientRect()).then(() => {
    if (!d.open) return;
    d.classList.remove('forming');
    d.classList.add('formed');
  });
}

function closeSheet(d) {
  if (!d.open) return;
  const rect = d.getBoundingClientRect();
  d.close();
  d.classList.remove('forming', 'formed', 'slide');
  if (ink) {
    ink.dissolve(rect);
    if (fluid) setTimeout(() => fluid.pool(rect), 280);
  }
}

function saveMoney() {
  const c = amountCents();
  const today = todayKey();
  const day = isDateKey($('#when').value) && $('#when').value <= today ? $('#when').value : today;
  const note = $('#note').value.trim().slice(0, 40);
  const when = () => (day === today ? { ts: Date.now(), timed: true } : { ts: fromKey(day).getTime() + 12 * 3600e3, timed: false });

  if (ms.mode === 'set') {
    const target = ms.neg ? -c : c;
    const diff = target - balanceNow();
    closeSheet(sheet);
    if (!diff) return toast(`Your balance is already ${money(target)}`);
    const t = { id: newId(), amt: diff, note: '', ts: Date.now(), timed: true, kind: 'set' };
    state.txns.push(t);
    commit();
    celebrate(diff > 0 ? 1 : -1);
    return toast(`Balance set to ${money(target)}`, () => removeTxn(t.id));
  }
  if (!c) return nudge();

  if (ms.mode === 'edit') {
    const t = state.txns.find((x) => x.id === ms.editId);
    if (t) {
      const before = { ...t };
      t.amt = ms.sign * c;
      t.note = note;
      if (day !== keyOf(t)) Object.assign(t, when());
      state.txns.sort((a, b) => a.ts - b.ts);
      closeSheet(sheet);
      commit();
      toast('Entry saved', () => { Object.assign(t, before); state.txns.sort((a, b) => a.ts - b.ts); commit(); });
    }
    return;
  }

  const t = { id: newId(), amt: ms.sign * c, note, kind: 'move', ...when() };
  state.txns.push(t);
  state.txns.sort((a, b) => a.ts - b.ts);
  closeSheet(sheet);
  commit();
  celebrate(ms.sign);
  toast(`${ms.sign > 0 ? 'Added' : 'Spent'} ${money(c)}`, () => removeTxn(t.id));
}

function removeTxn(id) {
  state.txns = state.txns.filter((t) => t.id !== id);
  commit();
}

function deleteEntry() {
  const t = state.txns.find((x) => x.id === ms.editId);
  if (!t) return;
  removeTxn(t.id);
  closeSheet(sheet);
  toast('Entry deleted', () => { state.txns.push(t); state.txns.sort((a, b) => a.ts - b.ts); commit(); });
}

$('#money-form').addEventListener('submit', (e) => { e.preventDefault(); saveMoney(); });
sheet.addEventListener('close', () => hideDock(false));

document.addEventListener('keydown', (e) => {
  if (!sheet.open || e.target.id === 'note' || e.target.type === 'date') return;
  if (/^\d$/.test(e.key) || e.key === '.') { press(e.key); e.preventDefault(); }
  else if (e.key === 'Backspace') { press('back'); e.preventDefault(); }
});

/* ---------- Goal sheet ---------- */

const goalSheet = $('#goal');
let goalEditing = null;

function openGoal(id) {
  const g = state.goals.find((x) => x.id === id) || null;
  goalEditing = g ? g.id : null;
  $('#goal-title').textContent = g ? 'Edit goal' : 'New goal';
  $('#goal-name').value = g ? g.name : '';
  $('#goal-amount').value = g ? money(g.target) : '';
  $('#goal-date').value = g && g.date ? g.date : '';
  $('#goal-date').min = todayKey();
  $('#goal-error').hidden = true;
  $('#goal-delete').hidden = !g;
  openSheet(goalSheet);
}

function saveGoal() {
  const name = $('#goal-name').value.trim();
  const target = parseMoney($('#goal-amount').value);
  const date = isDateKey($('#goal-date').value) ? $('#goal-date').value : null;
  const err = $('#goal-error');
  if (!name) { err.textContent = 'Give the goal a name.'; err.hidden = false; return $('#goal-name').focus(); }
  if (target <= 0) { err.textContent = 'Enter how much you want to reach, like 1,000.'; err.hidden = false; return $('#goal-amount').focus(); }
  const existing = state.goals.find((g) => g.id === goalEditing);
  if (existing) Object.assign(existing, { name, target, date });
  else {
    const g = { id: newId(), name: name.slice(0, 32), target, date };
    state.goals.push(g);
    state.chartGoal = g.id;
  }
  closeSheet(goalSheet);
  commit();
  toast(existing ? 'Goal saved' : 'Goal added');
}

function deleteGoal() {
  const i = state.goals.findIndex((g) => g.id === goalEditing);
  if (i < 0) return;
  const [g] = state.goals.splice(i, 1);
  const wasChart = state.chartGoal === g.id;
  if (wasChart) state.chartGoal = state.goals[0] ? state.goals[0].id : null;
  closeSheet(goalSheet);
  commit();
  toast('Goal deleted', () => { state.goals.splice(i, 0, g); if (wasChart) state.chartGoal = g.id; commit(); });
}

$('#goal-form').addEventListener('submit', (e) => { e.preventDefault(); saveGoal(); });
$('#goal-amount').addEventListener('blur', (e) => { const c = parseMoney(e.target.value); if (c > 0) e.target.value = money(c); });
goalSheet.addEventListener('close', () => hideDock(false));

// Tapping the dimmed area above a sheet closes it, and so does Escape on a keyboard.
[sheet, goalSheet].forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target === d && e.clientY < d.getBoundingClientRect().top) closeSheet(d);
  });
  d.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(d); });
});

/* ---------- Backup ---------- */

async function exportBackup() {
  const data = JSON.stringify({ app: 'stash', version: 1, saved: new Date().toISOString(), ...state }, null, 2);
  const name = `stash-backup-${todayKey()}.json`;
  const file = new File([data], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Stash backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!d || !Array.isArray(d.txns)) throw new Error('not a backup');
    if (!confirm(`Replace what's on this phone with the backup from ${d.saved ? shortDate(toKey(new Date(d.saved))) : 'that file'}?`)) return;
    localStorage.setItem(STORE_KEY, JSON.stringify(d));
    state = load();
    commit();
    toast('Backup restored');
  } catch (err) {
    toast("That file isn't a Stash backup");
  }
});

/* ---------- Feedback ---------- */

let toastTimer;
let undoFn = null;
function toast(msg, undo) {
  $('#toast-text').textContent = msg;
  undoFn = undo || null;
  $('#toast-undo').hidden = !undo;
  const el = $('#toast');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); undoFn = null; }, undo ? 4500 : 2200);
}

let fluid = null;
function celebrate(dir) {
  if (fluid && ms.from) {
    const r = ms.from.getBoundingClientRect();
    if (r.bottom > 0 && r.top < innerHeight) fluid.burst(r.left + r.width / 2, r.top + r.height / 2, dir > 0);
  }
}

function commit() {
  save();
  render();
}

/* ---------- Dock ---------- */

const dock = $('#dock');
let heroButtonsVisible = true;
let dockSuppressed = false;
function updateDock() {
  const show = !heroButtonsVisible && !dockSuppressed;
  dock.classList.toggle('show', show);
  dock.setAttribute('aria-hidden', String(!show));
  dock.querySelectorAll('button').forEach((b) => { b.tabIndex = show ? 0 : -1; });
}
function hideDock(v) { dockSuppressed = v; updateDock(); }
new IntersectionObserver(([e]) => { heroButtonsVisible = e.isIntersecting; updateDock(); }).observe($('#actions'));

/* ---------- Taps ---------- */

document.addEventListener('click', (e) => {
  const rangeBtn = e.target.closest('[data-range]');
  if (rangeBtn) { state.range = Number(rangeBtn.dataset.range); commit(); return; }
  const key = e.target.closest('[data-key]');
  if (key) return press(key.dataset.key);
  const chip = e.target.closest('[data-chip]');
  if (chip) { ms.str = chip.dataset.chip; return drawAmount(); }
  const sign = e.target.closest('[data-sign]');
  if (sign) { ms.sign = Number(sign.dataset.sign); if (ms.mode !== 'edit') ms.mode = ms.sign > 0 ? 'add' : 'spend'; $('#money-title').textContent = ms.mode === 'edit' ? 'Edit entry' : ms.sign > 0 ? 'Add money' : 'Spend money'; return drawAmount(); }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'add': return openMoney('add', el);
    case 'spend': return openMoney('spend', el);
    case 'set-balance': return openMoney('set', el);
    case 'edit-entry': {
      const t = state.txns.find((x) => x.id === el.dataset.id);
      if (t) openMoney('edit', el, t);
      return;
    }
    case 'delete-entry': return deleteEntry();
    case 'close': return closeSheet(el.closest('dialog'));
    case 'new-goal': return openGoal(null);
    case 'edit-goal': return openGoal(el.closest('[data-id]').dataset.id);
    case 'delete-goal': return deleteGoal();
    case 'chart-goal': {
      const id = el.closest('[data-id]').dataset.id;
      state.chartGoal = state.chartGoal === id ? null : id;
      return commit();
    }
    case 'more': shown += PAGE; return render();
    case 'export': return exportBackup();
    case 'undo': {
      const fn = undoFn;
      undoFn = null;
      $('#toast').classList.remove('show');
      if (fn) fn();
      return;
    }
    case 'toggle-motion': {
      const off = localStorage.getItem(MOTION_KEY) === 'off';
      localStorage.setItem(MOTION_KEY, off ? 'on' : 'off');
      location.reload();
    }
  }
});

/* ---------- Start ---------- */

let renderedDay = todayKey();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && todayKey() !== renderedDay) { renderedDay = todayKey(); render(); }
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });

render();
if (document.fonts) document.fonts.ready.then(() => render());

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const liquidOff = localStorage.getItem(MOTION_KEY) === 'off';
$('#motion-btn').textContent = liquidOff ? 'Turn on liquid' : 'Turn off liquid';

if (!liquidOff) {
  import('./fluid.js')
    .then(({ startFluid, startInk }) => {
      fluid = startFluid($('#fluid'), { reducedMotion });
      if (!reducedMotion) {
        ink = startInk($('#ink'));
        window.addEventListener('resize', () => ink.resize());
      }
    })
    .catch((err) => { console.warn('Liquid background unavailable:', err); $('#fluid').hidden = true; });
} else {
  $('#fluid').hidden = true;
}


if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
