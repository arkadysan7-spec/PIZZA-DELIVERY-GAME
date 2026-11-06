// Shower enclosure visualizer – client (vanilla JS, no build step).
import { db } from './db.js';
import { drawSketch, FINISH_COLORS } from './sketch.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------------- settings / server config ----------------
const settings = {
  get accessCode() { return ls('accessCode') || ''; },
  set accessCode(v) { ls('accessCode', v); },
  get provider() { return ls('provider') || ''; },
  set provider(v) { ls('provider', v); },
  get bizName() { return ls('bizName') || ''; },
  set bizName(v) { ls('bizName', v); },
};
function ls(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch { return null; }
}
let server = { providers: [], defaultProvider: 'mock', mock: true, accessCodeRequired: false, cloudLinks: false };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-access-code': settings.accessCode, ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `שגיאת שרת (${res.status})`);
    e.code = data.code; e.status = res.status;
    throw e;
  }
  return data;
}

// ---------------- labels ----------------
const FINISH_LABELS = { black_matte: 'שחור מט', chrome: 'כרום', nickel: 'ניקל', gold: 'זהב', brushed_steel: 'נירוסטה', white: 'לבן' };
const TYPE_LABELS = { all: 'הכל', walkin: 'Walk-in', niche: 'נישה', corner: 'פינתי', pentagon: 'מחומש', door: 'דלת', other: 'אחר' };
const GLASS_TYPES = { clear: 'שקופה', extra_clear: 'אקסטרה קליר', frosted: 'חלבית', fluted: 'מפוספסת', grey: 'אפורה' };
const LAYOUTS = { fixed: 'מחיצה קבועה (Walk-in)', fixed_door: 'קבועה + דלת', door: 'דלת בלבד' };
const SIDES = { right: 'ימין', left: 'שמאל' };
const FIXINGS = { wall_angles: 'זוויות קיר 90° (למעלה ולמטה)', u_wall: 'פרופיל U 1×1 בקיר', u_wall_floor: 'פרופיל U בקיר וברצפה' };
const STABS = { wall: 'מייצב לקיר', ceiling: 'מייצב לתקרה', none: 'ללא מייצב' };
const HINGES = { glass: 'ציר זכוכית-זכוכית', wall: 'ציר קיר-זכוכית' };
const WALLS = { keep: 'ללא שינוי', 'large-white': 'אריחים לבנים גדולים', marble: 'שיש', concrete: 'בטון אפור', 'subway-white': 'סאבווי לבן', terrazzo: 'טראצו', wood: 'דמוי עץ' };
const FLOORS = { keep: 'ללא שינוי', concrete: 'בטון אפור', marble: 'שיש', dark: 'אנטרציט כהה', wood: 'דמוי עץ', hex: 'משושים לבנים' };

// ---------------- state ----------------
const state = {
  customer: null,
  photo: null, // { blob, url, width, height, bitmap }
  catalog: [],
  product: null,
  typeFilter: 'all',
  spec: defaultSpec(),
  quad: defaultQuad(),
  step: 1,
  lastResult: null,
};
function defaultSpec() {
  return { layout: 'fixed_door', fixedSide: 'right', widthCm: 120, heightCm: 195, doorWidthCm: 60, glassMm: 8, glassType: 'clear',
    finish: 'black_matte', fixing: 'wall_angles', stabilizer: 'wall', hinge: 'glass', walls: 'keep', floor: 'keep', notes: '' };
}
function defaultQuad() {
  return [{ x: 0.3, y: 0.14 }, { x: 0.7, y: 0.14 }, { x: 0.7, y: 0.86 }, { x: 0.3, y: 0.86 }]; // tl, tr, br, bl
}

// ---------------- navigation ----------------
const navStack = [];
const TITLES = { customers: 'הדמיית מקלחונים', customer: 'לקוח', wizard: 'הדמיה חדשה', viewer: 'הדמיה' };
function show(view, { push = true } = {}) {
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (push) { navStack.push(view); history.pushState({ view }, ''); }
  $('#backBtn').hidden = navStack.length <= 1;
  $('#title').textContent = view === 'customer' && state.customer ? state.customer.name
    : view === 'wizard' && state.customer ? `הדמיה – ${state.customer.name}` : TITLES[view];
  window.scrollTo(0, 0);
}
function back() {
  if (navStack.length <= 1) return;
  navStack.pop();
  const v = navStack[navStack.length - 1];
  show(v, { push: false });
  if (v === 'customer') renderHistory();
  if (v === 'customers') renderCustomers();
}
window.addEventListener('popstate', () => back());
$('#backBtn').onclick = () => history.back();

// ---------------- toast ----------------
let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------------- object URLs ----------------
const urlPool = new Map();
function objUrl(key, blob) {
  if (!blob) return '';
  if (urlPool.has(key)) return urlPool.get(key);
  const u = URL.createObjectURL(blob);
  urlPool.set(key, u);
  return u;
}

// ---------------- customers ----------------
async function renderCustomers() {
  const q = $('#customerSearch').value.trim();
  const customers = (await db.customers()).filter((c) => !q || `${c.name} ${c.phone || ''} ${c.address || ''}`.includes(q));
  const counts = await db.renderCounts();
  const ul = $('#customerList');
  ul.replaceChildren(...customers.map((c) => {
    const li = el('li', {}, [
      el('div', { class: 'avatar' }, [c.name.trim().slice(0, 1)]),
      el('div', { class: 'meta' }, [el('b', {}, [c.name]), el('span', { class: 'muted small' }, [[c.phone, c.address].filter(Boolean).join(' · ') || '—'])]),
      el('span', { class: 'muted small' }, [`${counts[c.id] || 0} הדמיות`]),
    ]);
    li.onclick = () => openCustomer(c);
    return li;
  }));
  $('#customersEmpty').hidden = customers.length > 0 || Boolean(q);
}
$('#customerSearch').oninput = renderCustomers;
$('#addCustomerBtn').onclick = () => editCustomer(null);
$('#editCustomerBtn').onclick = () => editCustomer(state.customer);

function editCustomer(c) {
  const dlg = $('#customerDialog');
  const f = $('#customerForm');
  f.reset();
  $('#customerDialogTitle').textContent = c ? 'עריכת לקוח' : 'לקוח חדש';
  if (c) { f.name.value = c.name; f.phone.value = c.phone || ''; f.address.value = c.address || ''; }
  $('#deleteCustomerBtn').hidden = !c;
  dlg.returnValue = '';
  dlg.showModal();
  dlg.onclose = async () => {
    if (dlg.returnValue === 'ok' && f.name.value.trim()) {
      const rec = { ...(c || { id: uid(), createdAt: Date.now() }), name: f.name.value.trim(), phone: f.phone.value.trim(), address: f.address.value.trim() };
      await db.putCustomer(rec);
      if (c) { state.customer = rec; show('customer', { push: false }); renderHistory(); } else openCustomer(rec);
    } else if (dlg.returnValue === 'delete' && c && confirm(`למחוק את ${c.name} וכל ההדמיות שלו?`)) {
      await db.deleteCustomer(c.id);
      navStack.length = 0; show('customers'); renderCustomers();
    }
  };
}

async function openCustomer(c) {
  state.customer = c;
  show('customer');
  $('#custName').textContent = c.name;
  $('#custMeta').textContent = [c.phone, c.address].filter(Boolean).join(' · ');
  renderHistory();
}

async function renderHistory() {
  const c = state.customer;
  if (!c) return;
  $('#custName').textContent = c.name;
  const renders = await db.rendersFor(c.id);
  $('#historyGrid').replaceChildren(...renders.map((r) => {
    const b = el('button', { class: 'tile' }, [
      el('img', { src: objUrl(`a-${r.id}`, r.after), alt: '', loading: 'lazy' }),
      el('div', { class: 'cap' }, [el('b', {}, [r.product?.name || 'מקלחון']), `${FINISH_LABELS[r.spec.finish] || ''} · ${new Date(r.createdAt).toLocaleDateString('he-IL')}`]),
    ]);
    b.onclick = () => openViewer(r);
    return b;
  }));
  $('#historyEmpty').hidden = renders.length > 0;
}

// ---------------- wizard ----------------
$('#newRenderBtn').onclick = () => {
  state.photo = null; state.product = null; state.spec = defaultSpec(); state.quad = defaultQuad(); state.lastResult = null;
  $('#photoPreview').hidden = true; $('#photoHint').hidden = false; $('#toStep2').disabled = true;
  show('wizard');
  goStep(1);
};
function goStep(n) {
  if (n > 1 && !state.photo) return toast('קודם מצלמים את החדר');
  if (n > 2 && !state.product) return toast('בחרו מוצר');
  state.step = n;
  $$('.step').forEach((s) => (s.hidden = Number(s.dataset.step) !== n));
  $$('#steps li').forEach((li) => {
    const i = Number(li.dataset.step);
    li.className = i === n ? 'current' : i < n ? 'done' : '';
  });
  if (n === 2) renderCatalog();
  if (n === 3) setupEditor();
  window.scrollTo(0, 0);
}
$$('#steps li').forEach((li) => (li.onclick = () => {
  const n = Number(li.dataset.step);
  if (n < 4 || state.lastResult) goStep(n);
}));

// step 1: photo
for (const id of ['#cameraInput', '#galleryInput']) {
  $(id).onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      state.photo = await loadPhoto(file, 2048);
      $('#photoPreview').src = state.photo.url;
      $('#photoPreview').hidden = false; $('#photoHint').hidden = true;
      $('#toStep2').disabled = false;
    } catch (err) {
      console.error(err);
      toast('לא הצלחתי לקרוא את התמונה. נסו JPG/PNG.');
    }
  };
}
$('#toStep2').onclick = () => goStep(2);

async function loadPhoto(file, maxSide) {
  const bmp = await decodeImage(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await canvasBlob(c, 'image/jpeg', 0.9);
  const bitmap = await decodeImage(blob);
  return { blob, url: URL.createObjectURL(blob), width: w, height: h, bitmap };
}
async function decodeImage(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  }
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}
const canvasBlob = (c, type, q) => new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('toBlob failed'))), type, q));

// step 2: catalog
async function loadCatalog(force = false) {
  const cached = !force && ls('catalog');
  if (cached) {
    try { state.catalog = JSON.parse(cached).products; } catch { /* ignore */ }
  }
  try {
    const data = await api(`/api/catalog${force ? '?refresh=1' : ''}`, { headers: {} });
    state.catalog = data.products || [];
    ls('catalog', JSON.stringify({ products: state.catalog, note: data.note, at: Date.now() }));
    $('#catalogNote').hidden = !data.note;
    $('#catalogNote').textContent = data.note || '';
    if (force) toast(`נטענו ${state.catalog.length} מוצרים (${data.source})`);
  } catch (e) {
    if (!state.catalog.length) toast('אין חיבור לקטלוג');
  }
  if (state.step === 2 && !$('#view-wizard').hidden) renderCatalog();
}

function renderCatalog() {
  const types = ['all', ...new Set(state.catalog.map((p) => p.type))];
  $('#typeFilter').replaceChildren(...types.map((t) => chip(TYPE_LABELS[t] || t, state.typeFilter === t, () => { state.typeFilter = t; renderCatalog(); })));
  const list = state.catalog.filter((p) => state.typeFilter === 'all' || p.type === state.typeFilter);
  $('#productGrid').replaceChildren(...list.map((p) => {
    const dims = dimText(p);
    const b = el('button', { class: 'tile', 'aria-pressed': String(state.product?.id === p.id) }, [
      el('img', { src: p.images[0] || '', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
      el('div', { class: 'cap' }, [el('b', {}, [p.name]), [dims, p.glassThicknessMm?.length ? `${p.glassThicknessMm.join('/')} מ"מ` : ''].filter(Boolean).join(' · ')]),
    ]);
    b.onclick = () => selectProduct(p);
    return b;
  }));
  renderProductOptions();
}
function dimText(p) {
  const w = p.dimensions?.widthCm, h = p.dimensions?.heightCm;
  const r = (x) => (x.min === x.max ? `${x.min}` : `${x.min}–${x.max}`);
  return [w && `ר׳ ${r(w)}`, h && `ג׳ ${r(h)}`].filter(Boolean).join(' × ');
}
function selectProduct(p) {
  state.product = p;
  const s = state.spec;
  const d = p.defaults || {};
  s.layout = d.layout || { walkin: 'fixed', door: 'door' }[p.type] || 'fixed_door';
  const w = p.dimensions?.widthCm, h = p.dimensions?.heightCm;
  s.widthCm = d.widthCm || (w ? Math.round((w.min + w.max) / 2) : 120);
  s.heightCm = h ? h.max : 195;
  s.doorWidthCm = d.doorWidthCm || (s.layout === 'door' ? s.widthCm : Math.min(60, s.widthCm - 30));
  if (d.fixing) s.fixing = d.fixing;
  if (!p.finishes.includes(s.finish)) s.finish = p.finishes[0];
  if (!p.glassThicknessMm.includes(s.glassMm)) s.glassMm = p.glassThicknessMm[p.glassThicknessMm.length - 1];
  renderCatalog();
  $('#productOptions').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function renderProductOptions() {
  const p = state.product;
  $('#productOptions').hidden = !p;
  if (!p) return;
  $('#selProduct').replaceChildren(
    el('img', { src: p.images[0] || '', alt: '', referrerpolicy: 'no-referrer' }),
    el('div', {}, [el('b', {}, [p.name]), el('div', { class: 'muted small' }, [p.price || '', p.url ? ' ' : '', p.url ? el('a', { href: p.url, target: '_blank', rel: 'noopener' }, ['לעמוד המוצר']) : ''])]),
  );
  const s = state.spec;
  $('#finishChips').replaceChildren(...p.finishes.map((f) => chip(FINISH_LABELS[f] || f, s.finish === f, () => { s.finish = f; renderProductOptions(); }, FINISH_COLORS[f])));
  $('#glassChips').replaceChildren(...p.glassThicknessMm.map((g) => chip(`${g} מ"מ`, s.glassMm === g, () => { s.glassMm = g; renderProductOptions(); })));
  $('#glassTypeChips').replaceChildren(...Object.entries(GLASS_TYPES).map(([k, v]) => chip(v, s.glassType === k, () => { s.glassType = k; renderProductOptions(); })));
}
$('#toStep3').onclick = () => goStep(3);

// step 3: placement editor + hardware form
const editor = { canvas: $('#editorCanvas'), drag: -1 };
function setupEditor() {
  renderSpecForm();
  requestAnimationFrame(drawEditor);
}
function drawEditor() {
  const { canvas } = editor;
  const p = state.photo;
  if (!p) return;
  const cssW = canvas.parentElement.clientWidth || 360;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssH = cssW * (p.height / p.width);
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(p.bitmap, 0, 0, canvas.width, canvas.height);
  if ($('#showSketch').checked) drawSketch(ctx, canvas.width, canvas.height, state.quad, state.spec);
  // handles
  const pts = state.quad.map((q) => ({ x: q.x * canvas.width, y: q.y * canvas.height }));
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]);
  ctx.beginPath(); pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y))); ctx.closePath(); ctx.stroke();
  ctx.setLineDash([]);
  pts.forEach((pt, i) => {
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 13 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = i === editor.drag ? '#ffcc00' : 'rgba(255,255,255,.92)'; ctx.fill();
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = '#1b7a8c'; ctx.stroke();
  });
}
function pointerPos(e) {
  const r = editor.canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r };
}
editor.canvas.addEventListener('pointerdown', (e) => {
  const { x, y, r } = pointerPos(e);
  let best = -1, bestD = 44; // px
  state.quad.forEach((q, i) => {
    const d = Math.hypot((q.x - x) * r.width, (q.y - y) * r.height);
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best < 0) return;
  editor.drag = best;
  editor.canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
  drawEditor();
});
editor.canvas.addEventListener('pointermove', (e) => {
  if (editor.drag < 0) return;
  const { x, y } = pointerPos(e);
  state.quad[editor.drag] = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  drawEditor();
});
const endDrag = () => { if (editor.drag >= 0) { editor.drag = -1; drawEditor(); } };
editor.canvas.addEventListener('pointerup', endDrag);
editor.canvas.addEventListener('pointercancel', endDrag);
window.addEventListener('resize', () => state.step === 3 && drawEditor());
$('#resetQuad').onclick = () => { state.quad = defaultQuad(); drawEditor(); };
$('#showSketch').onchange = drawEditor;

function renderSpecForm() {
  const s = state.spec;
  const rerender = () => { renderSpecForm(); drawEditor(); };
  const group = (sel, map, key) => $(sel).replaceChildren(...Object.entries(map).map(([k, v]) => chip(v, s[key] === k, () => { s[key] = k; rerender(); })));
  group('#layoutChips', LAYOUTS, 'layout');
  group('#sideChips', SIDES, 'fixedSide');
  group('#fixingChips', FIXINGS, 'fixing');
  group('#stabChips', STABS, 'stabilizer');
  group('#hingeChips', HINGES, 'hinge');
  group('#wallsChips', WALLS, 'walls');
  group('#floorChips', FLOORS, 'floor');
  $('#fixedHardware').hidden = s.layout === 'door';
  $('#hingeWrap').hidden = s.layout !== 'fixed_door';
  $('#doorWidthWrap').hidden = s.layout === 'fixed';
  for (const k of ['widthCm', 'heightCm', 'doorWidthCm']) {
    const inp = $(`#${k}`);
    if (document.activeElement !== inp) inp.value = s[k];
  }
  $('#notes').value = s.notes;
}
for (const k of ['widthCm', 'heightCm', 'doorWidthCm']) {
  $(`#${k}`).oninput = (e) => {
    const v = Number(e.target.value);
    if (v > 0) { state.spec[k] = v; if (state.spec.layout === 'door') state.spec.doorWidthCm = state.spec.widthCm; drawEditor(); }
  };
}
$('#notes').oninput = (e) => (state.spec.notes = e.target.value);
$('#toStep4').onclick = () => { goStep(4); runRender(); };

// step 4: render
async function buildGuide() {
  const p = state.photo;
  const maxSide = 1280;
  const sc = Math.min(1, maxSide / Math.max(p.width, p.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(p.width * sc), height: Math.round(p.height * sc) });
  const ctx = c.getContext('2d');
  ctx.drawImage(p.bitmap, 0, 0, c.width, c.height);
  drawSketch(ctx, c.width, c.height, state.quad, state.spec);
  return canvasBlob(c, 'image/jpeg', 0.85);
}
const blobToB64 = (b) => new Promise((r, j) => {
  const fr = new FileReader();
  fr.onload = () => r(String(fr.result).split(',')[1]);
  fr.onerror = j;
  fr.readAsDataURL(b);
});

let rendering = false;
async function runRender() {
  if (rendering) return;
  rendering = true;
  $('#renderWait').hidden = false; $('#renderError').hidden = true; $('#resultWrap').hidden = true;
  const started = Date.now();
  const timer = setInterval(() => ($('#waitText').textContent = `מייצר הדמיה פוטוריאליסטית… ${Math.round((Date.now() - started) / 1000)} שניות (בדרך כלל 30–90)`), 1000);
  try {
    if (state.photo.width * state.photo.height > 2048 * 2048) throw new Error('תמונה גדולה מדי');
    const [photo, guideBlob] = [await blobToB64(state.photo.blob), await buildGuide()];
    const guide = await blobToB64(guideBlob);
    const productImageUrl = state.product.images.find((u) => /^https?:/.test(u)) || null;
    const res = await api('/api/render', {
      method: 'POST',
      body: JSON.stringify({
        photo, guide, productImageUrl, width: state.photo.width, height: state.photo.height,
        provider: settings.provider || server.defaultProvider,
        spec: { ...state.spec, productName: state.product.name },
      }),
    });
    const after = await (await fetch(res.image)).blob();
    const rec = {
      id: uid(), customerId: state.customer.id, createdAt: Date.now(),
      before: state.photo.blob, after, guide: guideBlob,
      spec: { ...state.spec }, quad: state.quad.map((q) => ({ ...q })),
      product: { id: state.product.id, name: state.product.name, image: state.product.images[0] || null, url: state.product.url },
      provider: res.provider, model: res.model, url: res.url || null, prompt: res.prompt, mock: Boolean(res.mock),
    };
    await db.putRender(rec);
    state.lastResult = rec;
    showResult($('#resultWrap'), rec, { wizard: true });
    $('#resultWrap').hidden = false;
    if (res.mock) toast('מצב הדגמה: אין מפתח API בשרת – מוצגת הסקיצה', 4500);
  } catch (e) {
    console.error(e);
    $('#renderError').hidden = false;
    $('#renderError').replaceChildren(
      el('div', {}, [e.code === 'bad_access_code' ? 'קוד גישה שגוי – עדכנו בהגדרות.' : `ההדמיה נכשלה: ${e.message}`]),
      Object.assign(el('button', { class: 'btn small', style: 'margin-top:8px' }, ['נסו שוב']), { onclick: runRender }),
    );
    if (e.code === 'bad_access_code') openSettings();
  } finally {
    clearInterval(timer);
    rendering = false;
    $('#renderWait').hidden = true;
  }
}

// ---------------- result + viewer ----------------
function showResult(container, rec, { wizard = false } = {}) {
  const beforeUrl = objUrl(`b-${rec.id}`, rec.before);
  const afterUrl = objUrl(`a-${rec.id}`, rec.after);
  const cmp = el('div', { class: 'compare' }, [
    el('img', { src: afterUrl, alt: 'אחרי' }),
    el('div', { class: 'before' }, [el('img', { src: beforeUrl, alt: 'לפני' })]),
    el('div', { class: 'handle' }),
    el('span', { class: 'lbl r' }, ['לפני']),
    el('span', { class: 'lbl l' }, ['אחרי']),
  ]);
  const setPos = (clientX) => {
    const r = cmp.getBoundingClientRect();
    cmp.style.setProperty('--pos', `${clamp(((clientX - r.left) / r.width) * 100, 0, 100)}%`);
  };
  cmp.addEventListener('pointerdown', (e) => { cmp.setPointerCapture(e.pointerId); setPos(e.clientX); });
  cmp.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') setPos(e.clientX); });

  const s = rec.spec;
  const meta = el('div', { class: 'result-meta' }, [
    `${rec.product?.name || ''} · ${LAYOUTS[s.layout]} · ${FINISH_LABELS[s.finish]} · זכוכית ${s.glassMm} מ"מ ${GLASS_TYPES[s.glassType] || ''} · ${s.widthCm}×${s.heightCm} ס"מ`,
    el('br'), `${new Date(rec.createdAt).toLocaleString('he-IL')} · ${rec.model}${rec.mock ? ' (הדגמה)' : ''}`,
  ]);
  const btn = (label, cls, fn) => Object.assign(el('button', { class: `btn ${cls}` }, [label]), { onclick: fn });
  const actions = el('div', { class: 'result-actions' }, [
    btn('📤 שליחה בוואטסאפ', 'wa full', () => shareImage(rec)),
    btn('💬 צ׳אט עם הלקוח', '', () => openWhatsApp(rec)),
    btn('⬇ הורדה', '', () => download(rec)),
    ...(wizard ? [btn('🔄 צור שוב', '', runRender), btn('✏️ שינוי מיקום', '', () => goStep(3))] : [
      btn('🗑 מחיקה', '', async () => { if (confirm('למחוק את ההדמיה?')) { await db.deleteRender(rec.id); history.back(); } }),
      btn('🔁 הדמיה דומה', '', () => reuse(rec)),
    ]),
  ]);
  const promptBox = el('details', { class: 'prompt' }, [el('summary', { class: 'muted small' }, ['ההנחיה שנשלחה למודל']), el('pre', {}, [rec.prompt || ''])]);
  container.replaceChildren(cmp, actions, meta, promptBox);
}

function openViewer(rec) {
  show('viewer');
  showResult($('#viewerWrap'), rec);
}

async function reuse(rec) {
  state.photo = await loadPhoto(rec.before, 2048);
  state.spec = { ...defaultSpec(), ...rec.spec };
  state.quad = rec.quad?.length === 4 ? rec.quad.map((q) => ({ ...q })) : defaultQuad();
  state.product = state.catalog.find((p) => p.id === rec.product?.id) || { ...rec.product, images: rec.product?.image ? [rec.product.image] : [], finishes: Object.keys(FINISH_LABELS).slice(0, 3), glassThicknessMm: [rec.spec.glassMm] };
  state.lastResult = null;
  $('#photoPreview').src = state.photo.url; $('#photoPreview').hidden = false; $('#photoHint').hidden = true; $('#toStep2').disabled = false;
  show('wizard');
  goStep(3);
}

function fileFor(rec) {
  const name = `${(state.customer?.name || 'לקוח').replace(/[^\p{L}\p{N}]+/gu, '-')}-מקלחון-${new Date(rec.createdAt).toISOString().slice(0, 10)}.jpg`;
  return new File([rec.after], name, { type: rec.after.type || 'image/jpeg' });
}
function shareText(rec) {
  const c = state.customer;
  const lines = [
    `שלום${c?.name ? ` ${c.name.split(' ')[0]}` : ''}, מצורפת הדמיה של המקלחון בחדר הרחצה שלך:`,
    `${rec.product?.name || 'מקלחון'} – גימור ${FINISH_LABELS[rec.spec.finish]}, זכוכית ${rec.spec.glassMm} מ"מ.`,
  ];
  if (rec.url) lines.push(rec.url);
  if (settings.bizName) lines.push(`\n${settings.bizName}`);
  return lines.join('\n');
}
async function shareImage(rec) {
  const file = fileFor(rec);
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: shareText(rec), title: 'הדמיית מקלחון' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  // Desktop / unsupported: download the image and open the chat so it can be attached.
  download(rec);
  openWhatsApp(rec);
  toast('התמונה ירדה למכשיר – צרפו אותה בצ׳אט', 4500);
}
function openWhatsApp(rec) {
  const phone = normalizePhone(state.customer?.phone);
  const text = encodeURIComponent(shareText(rec));
  window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, '_blank', 'noopener');
}
function normalizePhone(p) {
  if (!p) return '';
  let d = p.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `972${d.slice(1)}`;
  return d.length >= 11 ? d : '';
}
function download(rec) {
  const f = fileFor(rec);
  const a = el('a', { href: objUrl(`a-${rec.id}`, rec.after), download: f.name });
  document.body.append(a); a.click(); a.remove();
}

// ---------------- settings ----------------
function openSettings() {
  $('#accessCode').value = settings.accessCode;
  $('#bizName').value = settings.bizName;
  const sel = $('#providerSelect');
  const opts = server.providers.length ? server.providers : [{ id: 'mock', label: 'הדגמה (אין מפתח API בשרת)' }];
  sel.replaceChildren(...opts.map((p) => el('option', { value: p.id }, [`${p.label}${p.model ? ` – ${p.model}` : ''}`])));
  sel.value = settings.provider && opts.some((o) => o.id === settings.provider) ? settings.provider : server.defaultProvider;
  $('#serverStatus').textContent = [
    server.mock ? '⚠ אין מפתח API בשרת – מצב הדגמה.' : `✓ ${server.providers.length} ספקי הדמיה מוגדרים.`,
    server.catalogConfigured ? '✓ קטלוג מהאתר.' : 'קטלוג הדגמה (CATALOG_URL לא הוגדר).',
    server.cloudLinks ? '✓ קישורי ענן לתמונות.' : '',
  ].join(' ');
  $('#settingsDialog').showModal();
}
$('#settingsBtn').onclick = openSettings;
$('#settingsDialog').onclose = () => {
  settings.accessCode = $('#accessCode').value.trim();
  settings.bizName = $('#bizName').value.trim();
  settings.provider = $('#providerSelect').value;
};
$('#refreshCatalog').onclick = () => loadCatalog(true);

// ---------------- utils ----------------
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined && c !== '') n.append(c);
  return n;
}
function chip(label, pressed, onClick, swatch) {
  const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(pressed) }, swatch ? [el('span', { class: 'sw', style: `background:${swatch}` }), label] : [label]);
  b.onclick = onClick;
  return b;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

// ---------------- boot ----------------
(async function boot() {
  show('customers');
  renderCustomers();
  try {
    server = await api('/api/config', { headers: {} });
    if (server.accessCodeRequired && !settings.accessCode) { toast('הזינו קוד גישה'); openSettings(); }
  } catch { /* offline */ }
  loadCatalog();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
})();

// debug hook for automated tests
window.__app = { state, goStep, openCustomer, drawEditor };
