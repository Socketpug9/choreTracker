'use strict';

/* ============================================================
   Chores: a one-person chore tracker that lives on your phone.
   Everything is saved in this browser's localStorage.
   ============================================================ */

const STORE_KEY = 'choretracker.v1';
const TIP_KEY = 'choretracker.tipDismissed';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
const CHEV_SVG = '<svg class="chev" viewBox="0 0 9 14" aria-hidden="true"><path d="M1.5 1.5L7 7l-5.5 5.5"/></svg>';

/* ---------- Dates (all as local "YYYY-MM-DD" keys) ---------- */

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (k, n) => {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
};
const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);
const todayKey = () => toKey(new Date());
const isDateKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);

function relDay(k, today) {
  const diff = daysBetween(today, k);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return DAY_SHORT[fromKey(k).getDay()];
  const d = fromKey(k);
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

// "Tomorrow" becomes "tomorrow" mid-sentence; day names and dates keep their capitals.
const inSentence = (s) => (['Today', 'Tomorrow', 'Yesterday'].includes(s) ? s.toLowerCase() : s);

/* ---------- Storage ---------- */

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY));
    if (data && Array.isArray(data.chores)) {
      return { version: 1, chores: data.chores.map(cleanChore).filter(Boolean) };
    }
  } catch (e) { /* fall through to a fresh start */ }
  return { version: 1, chores: [] };
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

// Make sure a chore (from storage or a backup file) has every field we rely on.
function cleanChore(c) {
  if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.name.trim()) return null;
  const type = ['daily', 'weekdays', 'interval', 'once'].includes(c.type) ? c.type : 'daily';
  const today = todayKey();
  const done = Array.isArray(c.done) ? [...new Set(c.done.filter(isDateKey))].sort() : [];
  return {
    // IDs end up in the page's markup, so only allow plain letters and numbers.
    id: typeof c.id === 'string' && /^[a-z0-9]{1,40}$/i.test(c.id) ? c.id : newId(),
    name: c.name.trim().slice(0, 60),
    type,
    days: Array.isArray(c.days) ? [...new Set(c.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [],
    every: Number.isInteger(c.every) && c.every >= 2 && c.every <= 90 ? c.every : 3,
    next: isDateKey(c.next) ? c.next : today,
    undoNext: isDateKey(c.undoNext) ? c.undoNext : null,
    date: isDateKey(c.date) ? c.date : today,
    since: isDateKey(c.since) ? c.since : today,
    done,
  };
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let state = load();

/* ---------- Chore rules ---------- */

const isDoneOn = (c, k) => c.done.includes(k);

// For "every day" and "some days" chores: is it on the schedule for day k?
function isScheduledOn(c, k) {
  if (k < c.since) return false;
  if (c.type === 'daily') return true;
  if (c.type === 'weekdays') return c.days.includes(fromKey(k).getDay());
  return false;
}

// Should this chore appear in today's list? Returns null if not, otherwise info about it.
function todayStatus(c, today) {
  const doneToday = isDoneOn(c, today);
  switch (c.type) {
    case 'daily':
    case 'weekdays':
      return isScheduledOn(c, today) ? { done: doneToday, late: 0 } : null;
    // "late" is kept for chores done today too, so checking one off doesn't move it in the list.
    case 'interval':
      if (doneToday) return { done: true, late: c.undoNext ? Math.max(0, daysBetween(c.undoNext, today)) : 0 };
      return c.next <= today ? { done: false, late: daysBetween(c.next, today) } : null;
    case 'once':
      if (doneToday) return { done: true, late: Math.max(0, daysBetween(c.date, today)) };
      if (c.done.length) return null;
      return c.date <= today ? { done: false, late: daysBetween(c.date, today) } : null;
  }
  return null;
}

// Next day after today this chore is due (within the next week), or null.
// Every-day chores are left out on purpose: they'd fill the whole list.
function nextUpcoming(c, today) {
  switch (c.type) {
    case 'weekdays':
      for (let i = 1; i <= 7; i++) {
        const k = addDays(today, i);
        if (isScheduledOn(c, k)) return k;
      }
      return null;
    case 'interval':
      return c.next > today ? c.next : null;
    case 'once':
      return !c.done.length && c.date > today ? c.date : null;
  }
  return null;
}

// How many scheduled days in a row this was done. Today only counts once it's done.
function streak(c, today) {
  if (c.type !== 'daily' && c.type !== 'weekdays') return 0;
  const done = new Set(c.done);
  let k = done.has(today) ? today : addDays(today, -1);
  let n = 0;
  for (let i = 0; i < 1000 && k >= c.since; i++) {
    if (isScheduledOn(c, k)) {
      if (!done.has(k)) break;
      n++;
    }
    k = addDays(k, -1);
  }
  return n;
}

function describeSchedule(c) {
  switch (c.type) {
    case 'daily': return 'Every day';
    case 'weekdays': {
      const d = c.days;
      if (d.length === 7) return 'Every day';
      if (d.length === 5 && [1, 2, 3, 4, 5].every((x) => d.includes(x))) return 'Weekdays';
      if (d.length === 2 && d.includes(0) && d.includes(6)) return 'Weekends';
      // Show Monday first, Sunday last.
      return [...d].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((x) => DAY_SHORT[x]).join(', ');
    }
    case 'interval': return `Every ${c.every} days`;
    case 'once': return 'One time';
  }
  return '';
}

function lateText(n) {
  if (n <= 0) return '';
  return n === 1 ? '1 day late' : `${n} days late`;
}

/* ---------- Actions ---------- */

function toggleDone(id) {
  const c = state.chores.find((x) => x.id === id);
  if (!c) return;
  const today = todayKey();
  if (isDoneOn(c, today)) {
    c.done = c.done.filter((k) => k !== today);
    if (c.type === 'interval' && c.undoNext) {
      c.next = c.undoNext;
      c.undoNext = null;
    }
  } else {
    c.done = [...c.done, today].sort();
    if (c.type === 'interval') {
      c.undoNext = c.next;
      c.next = addDays(today, c.every);
    }
  }
  save();
  render();

  if (isDoneOn(c, today)) {
    const items = state.chores.map((x) => todayStatus(x, today)).filter(Boolean);
    if (items.length && items.every((s) => s.done)) toast('All done for today');
  }
}

/* ---------- Rendering ---------- */

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

let renderedDay = todayKey();

function render() {
  const today = todayKey();
  renderedDay = today;
  renderToday(today);
  renderAll(today);
}

function renderToday(today) {
  const d = fromKey(today);
  $('#today-date').textContent = `${DAY_NAMES[d.getDay()]}, ${MONTH_LONG[d.getMonth()]} ${d.getDate()}`;

  // Overdue first, then in the order the chores were added. Checking one off never moves it.
  const items = state.chores
    .map((c, i) => ({ c, i, s: todayStatus(c, today) }))
    .filter((x) => x.s)
    .sort((a, b) => (b.s.late > 0) - (a.s.late > 0) || a.i - b.i);

  const left = items.filter((x) => !x.s.done).length;
  const title = $('#today-title');
  if (!state.chores.length) title.textContent = 'Your chores';
  else if (!items.length) title.textContent = 'Nothing due today';
  else if (!left) title.textContent = 'All done for today';
  else title.textContent = `${left} ${left === 1 ? 'chore' : 'chores'} left`;

  $('#today-progress').innerHTML = items.map((x) => `<span class="${x.s.done ? 'on' : ''}"></span>`).join('');

  if (!state.chores.length) {
    $('#today-list').innerHTML = '';
    showEmpty('today', 'No chores yet', 'Add the things you need to do around the house, and how often.', true);
  } else if (!items.length) {
    $('#today-list').innerHTML = '';
    showEmpty('today', 'Free day', 'Nothing is due today. Check below for what is coming up.', false);
  } else {
    hideEmpty('today');
    $('#today-list').innerHTML = items.map(({ c, s }) => {
      const bits = [];
      if (s.late && !s.done) bits.push(`<span class="late">${lateText(s.late)}</span>`);
      bits.push(esc(describeSchedule(c)));
      const st = streak(c, today);
      if (st >= 2) bits.push(`<span class="streak">${st} in a row</span>`);
      return `
        <li class="row${s.done ? ' is-done' : ''}" data-id="${c.id}">
          <button type="button" class="check" data-action="toggle" aria-pressed="${s.done}" aria-label="${esc(c.name)}: ${s.done ? 'done' : 'not done'}">${CHECK_SVG}</button>
          <button type="button" class="row-main" data-action="edit">
            <span class="row-name">${esc(c.name)}</span>
            <span class="row-meta">${bits.join(', ')}</span>
          </button>
        </li>`;
    }).join('');
  }

  const upcoming = state.chores
    .map((c) => ({ c, k: nextUpcoming(c, today) }))
    .filter((x) => x.k)
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  $('#upcoming-title').hidden = !upcoming.length;
  $('#upcoming-list').innerHTML = upcoming.map(({ c, k }) => `
    <li class="row" data-id="${c.id}">
      <button type="button" class="row-main" data-action="edit">
        <span class="row-name">${esc(c.name)}</span>
        <span class="row-meta">${esc(describeSchedule(c))}</span>
      </button>
      <span class="row-when">${relDay(k, today)}</span>
    </li>`).join('');
}

function renderAll(today) {
  const sorted = [...state.chores].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (!sorted.length) {
    $('#all-list').innerHTML = '';
    showEmpty('all', 'No chores yet', 'Tap + to add your first one.', true);
    return;
  }
  hideEmpty('all');
  $('#all-list').innerHTML = sorted.map((c) => {
    const bits = [esc(describeSchedule(c))];
    const s = todayStatus(c, today);
    if (s && s.done) bits.push('done today');
    else if (s && s.late) bits.push(`<span class="late">${lateText(s.late)}</span>`);
    else if (s) bits.push('due today');
    else if (c.type === 'once' && c.done.length) bits.push(`done ${inSentence(relDay(c.done[c.done.length - 1], today))}`);
    else {
      const k = nextUpcoming(c, today);
      if (k) bits.push(`next ${inSentence(relDay(k, today))}`);
    }
    return `
      <li class="row" data-id="${c.id}">
        <button type="button" class="row-main" data-action="edit">
          <span class="row-name">${esc(c.name)}</span>
          <span class="row-meta">${bits.join(', ')}</span>
        </button>
        ${CHEV_SVG}
      </li>`;
  }).join('');
}

function showEmpty(view, title, text, withButton) {
  const id = `empty-${view}`;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'empty';
    $(`#${view}-list`).after(el);
  }
  el.innerHTML = `<strong>${esc(title)}</strong>${esc(text)}${withButton ? '<br><button type="button" class="btn btn-main" data-action="add">Add a chore</button>' : ''}`;
  el.hidden = false;
}

function hideEmpty(view) {
  const el = document.getElementById(`empty-${view}`);
  if (el) el.hidden = true;
}

/* ---------- Tabs ---------- */

function showTab(name) {
  $('#view-today').hidden = name !== 'today';
  $('#view-all').hidden = name !== 'all';
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.tab === name) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

/* ---------- Editor sheet ---------- */

const editor = $('#editor');
const form = $('#editor-form');
let editingId = null;

// Day toggles, Sunday to Saturday.
$('#f-days').innerHTML = DAY_LETTER.map((letter, i) => `
  <label><input type="checkbox" name="days" value="${i}" aria-label="${DAY_NAMES[i]}"><span aria-hidden="true">${letter}</span></label>
`).join('');

function setEvery(n) {
  const v = Math.max(2, Math.min(90, n));
  $('#f-every').value = v;
  $('#f-every-out').textContent = `Every ${v} days`;
}

function showTypeOptions() {
  const type = form.elements.type.value;
  form.querySelectorAll('.opt').forEach((el) => { el.hidden = el.dataset.for !== type; });
}

function openEditor(id) {
  const today = todayKey();
  const c = id ? state.chores.find((x) => x.id === id) : null;
  editingId = c ? c.id : null;

  $('#editor-title').textContent = c ? 'Edit chore' : 'New chore';
  $('#f-delete').hidden = !c;
  $('#f-error').hidden = true;

  $('#f-name').value = c ? c.name : '';
  form.elements.type.value = c ? c.type : 'daily';
  const days = c && c.type === 'weekdays' ? c.days : [fromKey(today).getDay()];
  form.querySelectorAll('input[name="days"]').forEach((box) => { box.checked = days.includes(Number(box.value)); });
  setEvery(c ? c.every : 3);
  $('#f-start').value = c && c.type === 'interval' ? c.next : today;
  $('#f-date').value = c && c.type === 'once' ? c.date : today;
  showTypeOptions();

  editor.showModal();
  if (!c) setTimeout(() => $('#f-name').focus(), 50);
}

function closeEditor() {
  editor.close();
  editingId = null;
}

function saveEditor() {
  const name = $('#f-name').value.trim();
  const type = form.elements.type.value;
  const days = [...form.querySelectorAll('input[name="days"]:checked')].map((b) => Number(b.value));
  const err = $('#f-error');

  if (!name) {
    err.textContent = 'Give the chore a name.';
    err.hidden = false;
    $('#f-name').focus();
    return;
  }
  if (type === 'weekdays' && !days.length) {
    err.textContent = 'Pick at least one day.';
    err.hidden = false;
    return;
  }

  const today = todayKey();
  const fields = {
    name,
    type,
    days: type === 'weekdays' ? days : [],
    every: Number($('#f-every').value),
    next: isDateKey($('#f-start').value) ? $('#f-start').value : today,
    date: isDateKey($('#f-date').value) ? $('#f-date').value : today,
  };

  const existing = editingId && state.chores.find((x) => x.id === editingId);
  if (existing) {
    const nextChanged = existing.type !== 'interval' || existing.next !== fields.next;
    Object.assign(existing, fields);
    if (nextChanged) existing.undoNext = null;
    toast('Chore saved');
  } else {
    state.chores.push(cleanChore({ ...fields, id: newId(), since: today, done: [] }));
    toast('Chore added');
  }
  save();
  closeEditor();
  render();
}

function deleteEditing() {
  const c = state.chores.find((x) => x.id === editingId);
  if (!c) return;
  if (!confirm(`Delete "${c.name}"? Its history goes too.`)) return;
  state.chores = state.chores.filter((x) => x.id !== c.id);
  save();
  closeEditor();
  render();
  toast('Chore deleted');
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  saveEditor();
});
form.addEventListener('change', (e) => {
  if (e.target.name === 'type') showTypeOptions();
});
editor.addEventListener('click', (e) => {
  // Tapping the dimmed area above the sheet closes it.
  if (e.target === editor) {
    const r = editor.getBoundingClientRect();
    if (e.clientY < r.top) closeEditor();
  }
});

/* ---------- Backup ---------- */

async function exportBackup() {
  const data = JSON.stringify({ app: 'choretracker', version: 1, saved: new Date().toISOString(), chores: state.chores }, null, 2);
  const fileName = `chores-backup-${todayKey()}.json`;
  const file = new File([data], fileName, { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Chores backup' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data && data.chores;
    if (!Array.isArray(list)) throw new Error('no chores');
    const chores = list.map(cleanChore).filter(Boolean);
    if (!confirm(`Replace your ${state.chores.length} chores with the ${chores.length} in this backup?`)) return;
    state = { version: 1, chores };
    save();
    render();
    toast('Backup restored');
  } catch (e) {
    toast("That file isn't a chores backup");
  }
}

$('#import-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) importBackup(file);
  e.target.value = '';
});

/* ---------- Toast ---------- */

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- Taps ---------- */

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) return showTab(tab.dataset.tab);

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const row = el.closest('[data-id]');
  switch (el.dataset.action) {
    case 'toggle': return toggleDone(row.dataset.id);
    case 'edit': return openEditor(row.dataset.id);
    case 'add': return openEditor(null);
    case 'close': return closeEditor();
    case 'delete': return deleteEditing();
    case 'step': return setEvery(Number($('#f-every').value) + Number(el.dataset.step));
    case 'export': return exportBackup();
    case 'dismiss-tip':
      localStorage.setItem(TIP_KEY, '1');
      $('#install-tip').hidden = true;
      return;
  }
});

/* ---------- Start ---------- */

// If the day rolls over while the app is open (or comes back from the background), refresh.
function checkDay() {
  if (todayKey() !== renderedDay) render();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
setInterval(checkDay, 60 * 1000);

render();

const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS && !isStandalone && !localStorage.getItem(TIP_KEY)) $('#install-tip').hidden = false;

// Ask the browser not to clear our data when space is low.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
