import * as studio from './studio.js';

const $ = (s) => document.querySelector(s);
const coarse = matchMedia('(pointer: coarse)').matches;
const MAX = coarse ? { head: 1400, full: 1750 } : { head: 1600, full: 2000 };

const state = {
  src: { face: null, full: null },
  frames: { head: null, full: null },
  outs: { head: null, full: null, card: null },
  dirty: { head: false, full: false, card: false },
  look: { backdrop: 'gray', retouch: 0.55, light: 0.6, eyes: 0.65, bw: false },
  tab: 'head', headFromFull: false,
};
window.__book = { state, studio }; // debug hook

// ---------- capture ----------
async function pick(slot, file) {
  if (!file) return;
  const err = $('#shoot-err'); err.hidden = true;
  try {
    const src = await studio.loadSource(file);
    if (state.src[slot]) URL.revokeObjectURL(state.src[slot].url);
    state.src[slot] = src;
    const img = document.querySelector(`.frame[data-slot="${slot}"] .well img`);
    img.src = src.url; img.hidden = false;
  } catch (e) { err.textContent = 'לא הצלחתי לפתוח את הקובץ. נסה לצלם שוב או לבחור JPG.'; err.hidden = false; }
  $('#go').disabled = !(state.src.face || state.src.full);
}
for (const slot of ['face', 'full']) for (const kind of ['cam', 'lib']) {
  const el = $(`#${slot}-${kind}`);
  el.addEventListener('change', () => { pick(slot, el.files[0]); el.value = ''; });
}
studio.init().catch(() => {}); // warm the models while the user is shooting

// ---------- processing ----------
const busy = (text, sub) => { $('#busy').hidden = false; if (text) $('#busy-text').textContent = text; if (sub !== undefined) $('#busy-sub').textContent = sub; };
const idle = () => { $('#busy').hidden = true; };
const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function develop() {
  const err = $('#shoot-err'); err.hidden = true;
  const firstRun = !state.frames.head && !state.frames.full;
  busy('מדליק את הפנסים…', firstRun ? 'בפעם הראשונה נטענים המודלים (כ־30MB). אחר כך זה מהיר.' : '');
  try {
    await studio.init((t) => busy(t));
    state.frames = { head: null, full: null }; state.outs = { head: null, full: null, card: null }; state.headFromFull = false;
    let headSrc = null, headRect = null;
    if (state.src.face) {
      busy('מחפש את הפנים…', ''); await tick();
      const loc = await studio.locate(state.src.face);
      headRect = studio.frameHeadshot(state.src.face, loc);
      if (headRect) headSrc = state.src.face;
    }
    let fullRect = null;
    if (state.src.full) {
      busy('ממסגר את הגוף המלא…', ''); await tick();
      const loc = await studio.locate(state.src.full);
      fullRect = studio.frameFull(state.src.full, loc);
      if (!headRect) { headRect = studio.frameHeadshot(state.src.full, loc); if (headRect) { headSrc = state.src.full; state.headFromFull = true; } }
    }
    if (!headRect && !fullRect) throw new Error(state.src.face && !state.src.full ? 'לא זיהיתי פנים בקלוז־אפ. צלם שוב מקרוב, פנים לעדשה.' : 'לא מצאתי אדם בתמונה. צלם שוב כשהוא במרכז הפריים.');
    if (headRect) {
      state.frames.head = await studio.prepareFrame(headSrc, headRect, MAX.head, (t) => busy(t, 'פורטרט'));
      busy('תאורה, עור, עיניים…', 'פורטרט'); await tick();
      state.outs.head = studio.renderFrame(state.frames.head, state.look);
    }
    if (fullRect) {
      state.frames.full = await studio.prepareFrame(state.src.full, fullRect, MAX.full, (t) => busy(t, 'גוף מלא'));
      busy('תאורה ורקע…', 'גוף מלא'); await tick();
      state.outs.full = studio.renderFrame(state.frames.full, state.look);
    }
    state.dirty = { head: false, full: false, card: true };
    state.tab = state.outs.head ? 'head' : 'full';
    $('#shoot').hidden = true; $('#result').hidden = false;
    syncTabs(); await show();
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    err.textContent = e && e.message && /[֐-׿]/.test(e.message) ? e.message : 'משהו השתבש בעיבוד. בדוק חיבור לאינטרנט (לטעינת המודלים) ונסה שוב.';
    err.hidden = false;
  } finally { idle(); }
}
$('#go').addEventListener('click', develop);

// ---------- comp card ----------
function cover(g, c, x, y, w, h, anchorTop = 0.5) {
  const k = Math.max(w / c.width, h / c.height), sw = w / k, sh = h / k;
  g.drawImage(c, (c.width - sw) / 2, (c.height - sh) * anchorTop, sw, sh, x, y, w, h);
}
async function composeCard() {
  const head = state.outs.head, full = state.outs.full; if (!head || !full) return null;
  try { await Promise.all([document.fonts.load('700 120px "Frank Ruhl Libre"'), document.fonts.load('400 44px Heebo')]); } catch (e) { /* fallback fonts */ }
  const W = 2400, H = 1560, m = 64, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f2ee'; g.fillRect(0, 0, W, H);
  const hh = H - 2 * m, hw = Math.round(hh * 0.8);
  cover(g, head, W - m - hw, m, hw, hh, 0.3);                       // headshot on the right (RTL lead)
  const lw = W - 3 * m - hw, textH = 250, fh = H - 2 * m - textH;
  cover(g, full, m, m, lw, fh, 0.12);
  const name = $('#f-name').value.trim() || 'שם השחקן', details = $('#f-details').value.trim();
  g.direction = 'rtl'; g.textAlign = 'right'; g.fillStyle = '#141414'; g.textBaseline = 'alphabetic';
  let size = 128; g.font = `700 ${size}px "Frank Ruhl Libre", serif`;
  while (g.measureText(name).width > lw && size > 60) { size -= 6; g.font = `700 ${size}px "Frank Ruhl Libre", serif`; }
  g.fillText(name, m + lw, H - m - 92);
  if (details) { g.font = '400 44px Heebo, sans-serif'; g.fillStyle = '#55524d'; g.fillText(details, m + lw, H - m - 18, lw); }
  return c;
}

// ---------- result view ----------
function syncTabs() {
  for (const t of document.querySelectorAll('.tab')) {
    const k = t.dataset.tab, has = k === 'card' ? !!(state.frames.head && state.frames.full) : !!state.frames[k];
    t.hidden = !has; t.setAttribute('aria-selected', String(k === state.tab));
  }
  const card = state.tab === 'card';
  $('#card-fields').hidden = !card; $('#hold').hidden = card;
  const warn = $('#res-warn');
  const fr = state.frames.head, soft = state.tab === 'head' && fr && fr.sourceScale > 1.15;
  warn.hidden = !soft;
  if (soft) warn.textContent = state.headFromFull ? 'הפנים בפריים הזה קטנות, אז הפורטרט יוצא רך. צלם גם קלוז־אפ נפרד ותקבל פנים חדות.' : 'התמונה קטנה, אז הפורטרט יוצא רך. צלם מקרוב יותר.';
}
function paint(c) {
  const v = $('#view'); if (!c) return;
  if (v.width !== c.width || v.height !== c.height) { v.width = c.width; v.height = c.height; }
  v.getContext('2d').drawImage(c, 0, 0);
}
async function show() {
  const k = state.tab;
  if (k === 'card') {
    for (const p of ['head', 'full']) if (state.dirty[p]) { state.outs[p] = studio.renderFrame(state.frames[p], state.look); state.dirty[p] = false; state.dirty.card = true; }
    if (state.dirty.card || !state.outs.card) { state.outs.card = await composeCard(); state.dirty.card = false; }
  } else if (state.dirty[k]) { state.outs[k] = studio.renderFrame(state.frames[k], state.look); state.dirty[k] = false; state.dirty.card = true; }
  const c = state.outs[k]; paint(c);
  $('#cap-text').textContent = c ? `${k === 'head' ? 'פורטרט' : k === 'full' ? 'גוף מלא' : 'קומפ־קארד'} · ${c.width}×${c.height}` : '';
}
let pending = null;
function relook() {
  state.dirty.head = state.dirty.full = true;
  clearTimeout(pending);
  pending = setTimeout(async () => { busy('מפתח מחדש…', ''); await tick(); try { await show(); } finally { idle(); } }, 180);
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', async () => {
  if (state.tab === t.dataset.tab) return;
  state.tab = t.dataset.tab; syncTabs();
  const heavy = state.tab === 'card' ? state.dirty.head || state.dirty.full : state.dirty[state.tab];
  if (heavy) { busy('מפתח מחדש…', ''); await tick(); }
  try { await show(); } finally { idle(); }
});

// look controls
const sw = $('#swatches');
for (const [key, b] of Object.entries(studio.BACKDROPS)) {
  const el = document.createElement('button'); el.className = 'sw'; el.type = 'button'; el.title = b.name; el.setAttribute('aria-label', `רקע ${b.name}`);
  const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
  el.style.background = `radial-gradient(circle at 50% 40%, ${rgb(b.c0)}, ${rgb(b.c1)})`;
  el.setAttribute('aria-pressed', String(key === state.look.backdrop));
  el.addEventListener('click', () => { state.look.backdrop = key; for (const x of sw.querySelectorAll('.sw:not(.bw)')) x.setAttribute('aria-pressed', String(x === el)); relook(); });
  sw.appendChild(el);
}
{
  const el = document.createElement('button'); el.className = 'sw bw'; el.type = 'button'; el.title = 'שחור־לבן'; el.setAttribute('aria-label', 'שחור־לבן'); el.setAttribute('aria-pressed', 'false');
  el.addEventListener('click', () => { state.look.bw = !state.look.bw; el.setAttribute('aria-pressed', String(state.look.bw)); relook(); });
  sw.appendChild(el);
}
for (const k of ['light', 'retouch', 'eyes']) $(`#s-${k}`).addEventListener('change', (e) => { state.look[k] = e.target.value / 100; relook(); });
for (const id of ['#f-name', '#f-details']) $(id).addEventListener('input', () => { state.dirty.card = true; clearTimeout(pending); pending = setTimeout(show, 250); });

// hold to compare
const hold = $('#hold');
const down = (e) => { e.preventDefault(); const fr = state.frames[state.tab]; if (fr) paint(fr.before); };
const upEv = () => paint(state.outs[state.tab]);
hold.addEventListener('pointerdown', down); hold.addEventListener('pointerup', upEv); hold.addEventListener('pointercancel', upEv); hold.addEventListener('pointerleave', upEv);
hold.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') down(e); }); hold.addEventListener('keyup', upEv);
hold.addEventListener('contextmenu', (e) => e.preventDefault());

// save / share
const fileName = () => `book-${{ head: 'portrait', full: 'full-body', card: 'comp-card' }[state.tab]}.jpg`;
const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/jpeg', 0.93));
async function currentFile() { const c = state.outs[state.tab]; if (!c) return null; return new File([await toBlob(c)], fileName(), { type: 'image/jpeg' }); }
$('#save').addEventListener('click', async () => {
  const f = await currentFile(); if (!f) return;
  const url = URL.createObjectURL(f), a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});
try { if (navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'a.jpg', { type: 'image/jpeg' })] })) $('#share').hidden = false; } catch (e) { /* no share */ }
$('#share').addEventListener('click', async () => { const f = await currentFile(); if (!f) return; try { await navigator.share({ files: [f] }); } catch (e) { /* cancelled */ } });
$('#again').addEventListener('click', () => { $('#result').hidden = true; $('#shoot').hidden = false; window.scrollTo(0, 0); });
