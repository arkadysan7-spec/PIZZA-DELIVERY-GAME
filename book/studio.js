// בוק — מנוע הסטודיו. הכל רץ על המכשיר: שום תמונה לא עולה לשרת.
// שלבים: איתור האדם והפנים → מסגור → הפרדת רקע → איזון אור → תאורת סטודיו →
// רטוש עור (הפרדת תדרים) → עיניים → רקע סטודיו → גימור.

const MP_VER = '0.10.14';
export const CONFIG = {
  mpBase: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`,
  faceModel: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  segModel: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
};

export const BACKDROPS = {
  white:  { name: 'לבן',         c0: [0.985, 0.985, 0.98], c1: [0.90, 0.90, 0.895], mottle: 0.0, shadow: 0.10, rim: 0.0 },
  gray:   { name: 'אפור סטודיו', c0: [0.60, 0.60, 0.61], c1: [0.22, 0.22, 0.23], mottle: 0.012, shadow: 0.20, rim: 0.10 },
  dark:   { name: 'כהה',         c0: [0.24, 0.24, 0.25], c1: [0.035, 0.035, 0.04], mottle: 0.008, shadow: 0.0, rim: 0.16 },
  light:  { name: 'בהיר',        c0: [0.965, 0.96, 0.955], c1: [0.80, 0.795, 0.79], mottle: 0.006, shadow: 0.16, rim: 0.0 },
  canvas: { name: 'קנבס',        c0: [0.53, 0.48, 0.39], c1: [0.15, 0.13, 0.10], mottle: 0.07, shadow: 0.22, rim: 0.10 },
  slate:  { name: 'כחול-אפור',   c0: [0.41, 0.47, 0.54], c1: [0.09, 0.12, 0.16], mottle: 0.02, shadow: 0.20, rim: 0.12 },
};

// ---------- small utils ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function ctxOf(c) { return c.getContext('2d', { willReadFrequently: true }); }

// ---------- blur toolbox (Float32 planes) ----------
function boxH(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[o + clamp(i, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[o + x] = acc * inv;
      const a = x + r + 1, b = x - r;
      acc += src[o + (a < w ? a : w - 1)] - src[o + (b > 0 ? b : 0)];
    }
  }
}
function boxV(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1); const acc = new Float64Array(w);
  for (let i = -r; i <= r; i++) { const o = clamp(i, 0, h - 1) * w; for (let x = 0; x < w; x++) acc[x] += src[o + x]; }
  for (let y = 0; y < h; y++) {
    const o = y * w, oa = Math.min(y + r + 1, h - 1) * w, ob = Math.max(y - r, 0) * w;
    for (let x = 0; x < w; x++) { dst[o + x] = acc[x] * inv; acc[x] += src[oa + x] - src[ob + x]; }
  }
}
function gaussXY(src, w, h, sx, sy) {
  const plan = (s) => {
    if (s < 0.3) return { r: 0, n: 0 };
    let r = Math.round((-1 + Math.sqrt(1 + 4 * s * s)) / 2), n = 3;
    if (r < 1) { r = 1; n = clamp(Math.round(1.5 * s * s), 1, 3); }
    return { r, n };
  };
  const px = plan(sx), py = plan(sy);
  let a = new Float32Array(src), b = new Float32Array(src.length);
  for (let i = 0; i < px.n; i++) { boxH(a, b, w, h, Math.min(px.r, w - 1)); const t = a; a = b; b = t; }
  for (let i = 0; i < py.n; i++) { boxV(a, b, w, h, Math.min(py.r, h - 1)); const t = a; a = b; b = t; }
  return a;
}
function downsample(src, w, h, f) {
  const dw = Math.ceil(w / f), dh = Math.ceil(h / f);
  const out = new Float32Array(dw * dh), cnt = new Float32Array(dw * dh);
  for (let y = 0; y < h; y++) {
    const dy = ((y / f) | 0) * dw, o = y * w;
    for (let x = 0; x < w; x++) { const d = dy + ((x / f) | 0); out[d] += src[o + x]; cnt[d]++; }
  }
  for (let i = 0; i < out.length; i++) out[i] /= cnt[i];
  return { data: out, w: dw, h: dh };
}
// bilinear resample of a plane to a new size
function resample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  const kx = sw / dw, ky = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = clamp((y + 0.5) * ky - 0.5, 0, sh - 1); const y0 = fy | 0, y1 = Math.min(y0 + 1, sh - 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = clamp((x + 0.5) * kx - 0.5, 0, sw - 1); const x0 = fx | 0, x1 = Math.min(x0 + 1, sw - 1), tx = fx - x0;
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      out[y * dw + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}
// gaussian blur; large radii go through a downsampled copy
function blur(src, w, h, sigma) {
  const f = Math.min(8, Math.floor(sigma / 3));
  if (f < 2) return gaussXY(src, w, h, sigma, sigma);
  const d = downsample(src, w, h, f);
  const b = gaussXY(d.data, d.w, d.h, sigma / f, sigma / f);
  return resample(b, d.w, d.h, w, h);
}
function guidedFilter(I, p, w, h, r, eps) {
  const n = w * h; const t = new Float32Array(n);
  const box = (s) => { const o = new Float32Array(n); boxH(s, t, w, h, r); boxV(t, o, w, h, r); return o; };
  const II = new Float32Array(n), Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; Ip[i] = I[i] * p[i]; }
  const mI = box(I), mp_ = box(p), cII = box(II), cIp = box(Ip);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = cII[i] - mI[i] * mI[i], c = cIp[i] - mI[i] * mp_[i];
    a[i] = c / (v + eps); b[i] = mp_[i] - a[i] * mI[i];
  }
  const ma = box(a), mb = box(b), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}
// rasterize polygons (arrays of [x,y]) into a 0..1 plane, optional feather
function polyMask(w, h, polys, feather = 0, ox = 0, oy = 0) {
  const c = canvasOf(w, h), g = ctxOf(c);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff';
  for (const p of polys) {
    if (p.circle) { g.beginPath(); g.arc(p.circle[0] - ox, p.circle[1] - oy, p.circle[2], 0, Math.PI * 2); g.fill(); continue; }
    g.beginPath(); p.forEach((pt, i) => (i ? g.lineTo(pt[0] - ox, pt[1] - oy) : g.moveTo(pt[0] - ox, pt[1] - oy))); g.closePath(); g.fill();
  }
  const d = g.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return feather > 0.3 ? blur(out, w, h, feather) : out;
}

// ---------- matting model (RMBG-1.4 via onnxruntime-web, served from ./vendor) ----------
const VENDOR = new URL('./vendor/', import.meta.url).href;
let ortMod = null, rmbg = null, rmbgPromise = null;
export function initMatting(onProgress = () => {}) {
  if (rmbgPromise) return rmbgPromise;
  rmbgPromise = (async () => {
    ortMod = await import(/* @vite-ignore */ VENDOR + 'ort.wasm.min.mjs');
    const ort = ortMod.default || ortMod;
    ort.env.wasm.wasmPaths = VENDOR; ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    const parts = [1, 2, 3, 4, 5].map((k) => `${VENDOR}rmbg-${k}.onnx`), total = 44403226, bufs = new Array(parts.length), got = new Array(parts.length).fill(0);
    await Promise.all(parts.map(async (u, k) => {
      const res = await fetch(u); if (!res.ok) throw new Error('model ' + res.status);
      const rd = res.body.getReader(), chunks = [];
      for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); got[k] += value.length; onProgress(got.reduce((a, b) => a + b, 0) / total); }
      const b = new Uint8Array(got[k]); let o = 0; for (const c of chunks) { b.set(c, o); o += c.length; } bufs[k] = b;
    }));
    const all = new Uint8Array(bufs.reduce((a, b) => a + b.length, 0)); let o = 0; for (const b of bufs) { all.set(b, o); o += b.length; }
    rmbg = { ort, session: await ort.InferenceSession.create(all, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }) };
  })().catch((e) => { rmbgPromise = null; throw e; });
  return rmbgPromise;
}
async function runMatting(canvas, N) {
  await initMatting();
  const c = canvasOf(N, N), g = ctxOf(c); g.imageSmoothingQuality = 'high'; g.drawImage(canvas, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data, x = new Float32Array(3 * N * N), nn = N * N;
  for (let i = 0; i < nn; i++) { x[i] = d[i * 4] / 255 - 0.5; x[nn + i] = d[i * 4 + 1] / 255 - 0.5; x[2 * nn + i] = d[i * 4 + 2] / 255 - 0.5; }
  const { ort, session } = rmbg;
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, N, N]) });
  const y = out[session.outputNames[0]].data; let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < nn; i++) { if (y[i] < mn) mn = y[i]; if (y[i] > mx) mx = y[i]; }
  const r = new Float32Array(nn), k = 1 / Math.max(1e-6, mx - mn); for (let i = 0; i < nn; i++) r[i] = (y[i] - mn) * k;
  return r;
}

// ---------- models ----------
let mp = null, segmenter = null, landmarker = null, initPromise = null, TRIS = null;
export function init(onStage = () => {}) {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    onStage('טוען את מנוע הסטודיו…');
    mp = await import(/* @vite-ignore */ `${CONFIG.mpBase}/vision_bundle.mjs`);
    const fileset = await mp.FilesetResolver.forVisionTasks(`${CONFIG.mpBase}/wasm`);
    onStage('טוען מודל הפרדת רקע…');
    segmenter = await mp.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: CONFIG.segModel, delegate: 'CPU' },
      runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true,
    });
    onStage('טוען מודל פנים…');
    landmarker = await mp.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: CONFIG.faceModel, delegate: 'CPU' },
      runningMode: 'IMAGE', numFaces: 1,
      minFaceDetectionConfidence: 0.3, minFacePresenceConfidence: 0.3,
    });
  })().catch((e) => { initPromise = null; throw e; });
  return initPromise;
}

// landmark index sets
const LM = {
  oval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
  eyeR: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], // image-left eye
  eyeL: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
  lidR: [33, 7, 163, 144, 145, 153, 154, 155, 133],
  lidL: [362, 382, 381, 380, 374, 373, 390, 249, 263],
  browR: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  browL: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  lipsOuter: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
  lipsInner: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191],
  irisR: 468, irisL: 473, top: 10, chin: 152,
  cheeks: [50, 280, 205, 425, 151, 9],
};
function meshTris() {
  if (TRIS) return TRIS;
  const adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const c of mp.FaceLandmarker.FACE_LANDMARKS_TESSELATION) { add(c.start, c.end); add(c.end, c.start); }
  const tris = [];
  for (const [a, na] of adj) for (const b of na) if (b > a) for (const c of adj.get(b)) if (c > b && na.has(c)) tris.push(a, b, c);
  TRIS = { tris: new Uint16Array(tris), adj };
  return TRIS;
}

// ---------- segmentation ----------
function fitCanvas(src, sw, sh, maxSide, sx = 0, sy = 0, cw = sw, ch = sh) {
  const s = Math.min(1, maxSide / Math.max(cw, ch));
  const c = canvasOf(cw * s, ch * s), g = ctxOf(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, sx, sy, cw, ch, 0, 0, c.width, c.height);
  return c;
}
function runSeg(canvas) {
  const res = segmenter.segment(canvas);
  const m = res.confidenceMasks;
  const out = { w: m[0].width, h: m[0].height };
  ['bg', 'hair', 'body', 'face', 'clothes', 'other'].forEach((k, i) => { out[k] = new Float32Array(m[i].getAsFloat32Array()); });
  m.forEach((x) => x.close());
  return out;
}
function components(mask, w, h, thr) {
  const lab = new Int32Array(w * h), stack = new Int32Array(w * h), comps = [];
  for (let s = 0; s < w * h; s++) {
    if (lab[s] || mask[s] <= thr) continue;
    const id = comps.length + 1; let sp = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[sp++] = s; lab[s] = id;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0; area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !lab[p - 1] && mask[p - 1] > thr) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && !lab[p + 1] && mask[p + 1] > thr) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && !lab[p - w] && mask[p - w] > thr) { lab[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && !lab[p + w] && mask[p + w] > thr) { lab[p + w] = id; stack[sp++] = p + w; }
    }
    comps.push({ id, area, x0, y0, x1, y1 });
  }
  return { lab, comps };
}
// Two-pass segmentation: find the person, then re-run on a tight crop for a sharper mask.
// Returns planes on a grid (long side <= 512) covering the whole canvas.
function segmentFrame(canvas) {
  const W = canvas.width, H = canvas.height;
  const p1 = runSeg(fitCanvas(canvas, W, H, 384));
  const person1 = p1.bg.map((v) => 1 - v);
  let x0 = p1.w, y0 = p1.h, x1 = -1, y1 = -1, area = 0;
  for (let y = 0; y < p1.h; y++) for (let x = 0; x < p1.w; x++) if (person1[y * p1.w + x] > 0.5) { area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (area < p1.w * p1.h * 0.004) return null;
  const padX = (x1 - x0 + 1) * 0.08 + 2, padY = (y1 - y0 + 1) * 0.08 + 2;
  const cx0 = clamp((x0 - padX) / p1.w, 0, 1) * W, cy0 = clamp((y0 - padY) / p1.h, 0, 1) * H;
  const cx1 = clamp((x1 + 1 + padX) / p1.w, 0, 1) * W, cy1 = clamp((y1 + 1 + padY) / p1.h, 0, 1) * H;
  const p2 = runSeg(fitCanvas(canvas, W, H, 640, cx0, cy0, cx1 - cx0, cy1 - cy0));

  const gs = Math.min(1, 512 / Math.max(W, H));
  const gw = Math.max(8, Math.round(W * gs)), gh = Math.max(8, Math.round(H * gs));
  const grid = { w: gw, h: gh };
  const keys = ['hair', 'body', 'face', 'clothes', 'other', 'person'];
  p2.person = p2.bg.map((v) => 1 - v);
  for (const k of keys) grid[k] = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    const fy = ((y + 0.5) / gh * H - cy0) / (cy1 - cy0) * p2.h - 0.5;
    if (fy < -0.5 || fy > p2.h - 0.5) continue;
    const yy = clamp(fy, 0, p2.h - 1), ya = yy | 0, yb = Math.min(ya + 1, p2.h - 1), ty = yy - ya;
    for (let x = 0; x < gw; x++) {
      const fx = ((x + 0.5) / gw * W - cx0) / (cx1 - cx0) * p2.w - 0.5;
      if (fx < -0.5 || fx > p2.w - 0.5) continue;
      const xx = clamp(fx, 0, p2.w - 1), xa = xx | 0, xb = Math.min(xa + 1, p2.w - 1), tx = xx - xa;
      const i = y * gw + x;
      for (const k of keys) {
        const s = p2[k];
        const a = s[ya * p2.w + xa], b = s[ya * p2.w + xb], c = s[yb * p2.w + xa], d = s[yb * p2.w + xb];
        grid[k][i] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      }
    }
  }
  // main face blob + keep only the person connected to it (drops passers-by)
  const fc = components(grid.face, gw, gh, 0.5);
  let faceBlob = null;
  for (const c of fc.comps) if (!faceBlob || c.area > faceBlob.area) faceBlob = c;
  if (faceBlob && faceBlob.area < 12) faceBlob = null;
  const pc = components(grid.person, gw, gh, 0.5);
  if (pc.comps.length > 1) {
    let best = null;
    if (faceBlob) {
      const hits = new Map();
      for (let i = 0; i < gw * gh; i++) if (fc.lab[i] === faceBlob.id && pc.lab[i]) hits.set(pc.lab[i], (hits.get(pc.lab[i]) || 0) + 1);
      let bh = 0; for (const [id, n] of hits) if (n > bh) { bh = n; best = id; }
    }
    if (!best) best = pc.comps.reduce((a, b) => (b.area > a.area ? b : a)).id;
    const keepIds = new Set([best]);
    const main = pc.comps[best - 1];
    // also keep sizeable pieces overlapping the main person's column (e.g. a hand split off by an object)
    for (const c of pc.comps) if (c.area > main.area * 0.02 && c.x1 >= main.x0 && c.x0 <= main.x1 && c.y1 >= main.y0 && c.y0 <= main.y1) keepIds.add(c.id);
    const keep = new Float32Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) keep[i] = keepIds.has(pc.lab[i]) ? 1 : 0;
    const soft = blur(keep, gw, gh, 2.5);
    for (let i = 0; i < gw * gh; i++) { const k = smooth(0.02, 0.4, soft[i]); for (const key of keys) grid[key][i] *= k; }
  }
  grid.faceBlob = faceBlob;
  // person bbox on the grid
  let bx0 = gw, by0 = gh, bx1 = -1, by1 = -1;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (grid.person[y * gw + x] > 0.5) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  if (bx1 < 0) return null;
  grid.bbox = { x0: bx0 / gw, y0: by0 / gh, x1: (bx1 + 1) / gw, y1: (by1 + 1) / gh };
  const edge = (sel) => { let n = 0, t = 0; for (let i = 0; i < gw * gh; i++) { const x = i % gw, y = (i / gw) | 0; if (sel(x, y)) { t++; if (grid.person[i] > 0.5) n++; } } return n / Math.max(1, t) > 0.02; };
  grid.touch = { l: edge((x) => x < 2), r: edge((x) => x >= gw - 2), t: edge((x, y) => y < 2), b: edge((x, y) => y >= gh - 2) };
  return grid;
}

// ---------- face landmarks ----------
// drawable: image/canvas of size dw×dh. box: face blob {cx,cy,size} in drawable px (or null → whole image).
function detectFace(drawable, dw, dh, box) {
  const attempt = (x, y, s) => {
    const N = 640, c = canvasOf(N, N), g = ctxOf(c);
    g.fillStyle = '#777'; g.fillRect(0, 0, N, N); g.imageSmoothingQuality = 'high';
    const k = N / s;
    const sx0 = Math.max(0, x), sy0 = Math.max(0, y), sx1 = Math.min(dw, x + s), sy1 = Math.min(dh, y + s);
    if (sx1 <= sx0 || sy1 <= sy0) return null;
    g.drawImage(drawable, sx0, sy0, sx1 - sx0, sy1 - sy0, (sx0 - x) * k, (sy0 - y) * k, (sx1 - sx0) * k, (sy1 - sy0) * k);
    const res = landmarker.detect(c);
    if (!res.faceLandmarks || !res.faceLandmarks.length) return null;
    const src = res.faceLandmarks[0], pts = new Float32Array(src.length * 3);
    for (let i = 0; i < src.length; i++) { pts[i * 3] = x + src[i].x * s; pts[i * 3 + 1] = y + src[i].y * s; pts[i * 3 + 2] = src[i].z * s; }
    return pts;
  };
  if (box) {
    for (const m of [2.6, 3.6, 1.9]) {
      const s = box.size * m; const pts = attempt(box.cx - s / 2, box.cy - s / 2, s);
      if (pts) return pts;
    }
  }
  const s = Math.max(dw, dh);
  return attempt((dw - s) / 2, (dh - s) / 2, s) || (dh > dw ? attempt(0, 0, dw) : null);
}
function faceMetrics(pts) {
  const P = (i) => [pts[i * 3], pts[i * 3 + 1]];
  const eR = P(LM.irisR), eL = P(LM.irisL), top = P(LM.top), chin = P(LM.chin);
  const iod = Math.hypot(eL[0] - eR[0], eL[1] - eR[1]);
  const faceH = Math.hypot(chin[0] - top[0], chin[1] - top[1]);
  const up = [(top[0] - chin[0]) / faceH, (top[1] - chin[1]) / faceH];
  const right = [-up[1], up[0]]; // image-right when the head is upright
  return { eR, eL, top, chin, iod, faceH, up, right, mid: [(eR[0] + eL[0]) / 2, (eR[1] + eL[1]) / 2] };
}

// ---------- public: source + locate + framing ----------
export async function loadSource(file) {
  const url = URL.createObjectURL(file);
  const img = new Image(); img.src = url;
  try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw new Error('לא הצלחתי לפתוח את התמונה'); }
  return { img, w: img.naturalWidth, h: img.naturalHeight, url };
}

export async function locate(source) {
  await init();
  const small = fitCanvas(source.img, source.w, source.h, 640);
  const grid = segmentFrame(small);
  if (!grid) return { person: null, face: null };
  const b = grid.bbox;
  const person = { x0: b.x0 * source.w, y0: b.y0 * source.h, x1: b.x1 * source.w, y1: b.y1 * source.h };
  let box = null;
  if (grid.faceBlob) {
    const f = grid.faceBlob, kx = source.w / grid.w, ky = source.h / grid.h;
    box = { cx: (f.x0 + f.x1 + 1) / 2 * kx, cy: (f.y0 + f.y1 + 1) / 2 * ky, size: Math.max((f.x1 - f.x0 + 1) * kx, (f.y1 - f.y0 + 1) * ky) };
  }
  const pts = detectFace(source.img, source.w, source.h, box);
  return { person, touch: grid.touch, face: pts ? faceMetrics(pts) : null };
}

const HEAD_ASPECT = 0.8; // 4:5 — the classic 8×10 headshot
export function frameHeadshot(source, loc) {
  const f = loc.face; if (!f) return null;
  const eyeAt = 0.33;
  let H = f.faceH * 2.55;
  const t = loc.touch || {};
  H = Math.min(H, (source.h - f.mid[1]) / (1 - eyeAt)); // never invent pixels below
  if (t.t) H = Math.min(H, f.mid[1] / eyeAt);
  if (t.l) H = Math.min(H, 2 * f.mid[0] / HEAD_ASPECT);
  if (t.r) H = Math.min(H, 2 * (source.w - f.mid[0]) / HEAD_ASPECT);
  const W = H * HEAD_ASPECT;
  return { x: f.mid[0] - W / 2, y: f.mid[1] - eyeAt * H, w: W, h: H };
}
export function frameFull(source, loc) {
  const p = loc.person; if (!p) return null;
  const t = loc.touch || {}, ph = p.y1 - p.y0, pw = p.x1 - p.x0;
  let y0 = p.y0 - ph * 0.10, y1 = p.y1 + ph * 0.07;
  const cx = (p.x0 + p.x1) / 2, W = Math.max(pw * 1.22, (y1 - y0) * 0.667);
  let x0 = cx - W / 2, x1 = cx + W / 2;
  if (t.t) y0 = Math.max(0, y0); if (t.b) y1 = Math.min(source.h, y1);
  if (t.l) x0 = Math.max(0, x0); if (t.r) x1 = Math.min(source.w, x1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------- prepare: everything that doesn't depend on the look ----------
export async function prepareFrame(source, rect, maxSide, onStage = () => {}) {
  await init();
  const scale = clamp(maxSide / Math.max(rect.w, rect.h), 0, Math.max(1, 900 / Math.max(rect.w, rect.h)));
  const w = Math.round(rect.w * scale), h = Math.round(rect.h * scale);
  const canvas = canvasOf(w, h), g = ctxOf(canvas);
  g.imageSmoothingQuality = 'high';
  const dx = -rect.x * scale, dy = -rect.y * scale, dw = source.w * scale, dh = source.h * scale;
  g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
  g.drawImage(source.img, dx, dy, dw, dh);
  // valid (real-pixel) area; smear edges into any padding so the segmenter sees plain background there
  const vx0 = clamp(Math.ceil(dx), 0, w), vy0 = clamp(Math.ceil(dy), 0, h), vx1 = clamp(Math.floor(dx + dw), 0, w), vy1 = clamp(Math.floor(dy + dh), 0, h);
  if (vy0 > 0) g.drawImage(canvas, 0, vy0 + 1, w, 1, 0, 0, w, vy0 + 1);
  if (vy1 < h) g.drawImage(canvas, 0, vy1 - 2, w, 1, 0, vy1 - 1, w, h - vy1 + 1);
  if (vx0 > 0) g.drawImage(canvas, vx0 + 1, 0, 1, h, 0, 0, vx0 + 1, h);
  if (vx1 < w) g.drawImage(canvas, vx1 - 2, 0, 1, h, vx1 - 1, 0, w - vx1 + 1, h);

  onStage('מפריד את הדמות מהרקע…'); await nextFrame();
  const grid = segmentFrame(canvas);
  if (!grid) throw new Error('לא מצאתי אדם בתמונה');

  onStage('ממפה את הפנים…'); await nextFrame();
  let pts = null;
  if (grid.faceBlob) {
    const f = grid.faceBlob, kx = w / grid.w, ky = h / grid.h;
    pts = detectFace(canvas, w, h, { cx: (f.x0 + f.x1 + 1) / 2 * kx, cy: (f.y0 + f.y1 + 1) / 2 * ky, size: Math.max((f.x1 - f.x0 + 1) * kx, (f.y1 - f.y0 + 1) * ky) });
  } else pts = detectFace(canvas, w, h, null);
  const fm = pts ? faceMetrics(pts) : null;

  onStage('מעדן את קווי המתאר…'); await nextFrame();
  const n = w * h;
  const img = g.getImageData(0, 0, w, h); const px = img.data;
  // --- alpha matte: RMBG (high-res matting model), cleaned to the main subject, edge-refined against the image
  onStage('גוזר את הדמות…'); await nextFrame();
  const RM = 1024, rm = await runMatting(canvas, RM);
  const ms = Math.min(1, 1600 / Math.max(w, h)), mw = Math.round(w * ms), mh = Math.round(h * ms);
  let p = resample(rm, RM, RM, mw, mh);
  {
    // keep the subject the face belongs to (drops passers-by and stray objects)
    const cc = components(p, mw, mh, 0.5);
    if (cc.comps.length > 1) {
      let best = null;
      if (grid.faceBlob) {
        const f = grid.faceBlob, fx = Math.round((f.x0 + f.x1 + 1) / 2 / grid.w * mw), fy = Math.round((f.y0 + f.y1 + 1) / 2 / grid.h * mh);
        best = cc.lab[clamp(fy, 0, mh - 1) * mw + clamp(fx, 0, mw - 1)] || null;
      }
      if (!best) best = cc.comps.reduce((x, y) => (y.area > x.area ? y : x)).id;
      const main = cc.comps[best - 1], keepIds = new Set([best]);
      for (const c of cc.comps) if (c.area > main.area * 0.03 && c.x1 >= main.x0 && c.x0 <= main.x1 && c.y1 >= main.y0 && c.y0 <= main.y1) keepIds.add(c.id);
      const keep = new Float32Array(mw * mh); for (let i = 0; i < keep.length; i++) keep[i] = keepIds.has(cc.lab[i]) ? 1 : 0;
      const soft = blur(keep, mw, mh, Math.max(2, mw * 0.004));
      for (let i = 0; i < p.length; i++) p[i] *= smooth(0.05, 0.45, soft[i]);
    }
  }
  {
    // sharpen the upsampled matte against the real edges, but only inside the soft edge band
    const mc = canvasOf(mw, mh), mg = ctxOf(mc); mg.imageSmoothingQuality = 'high'; mg.drawImage(canvas, 0, 0, mw, mh);
    const md = mg.getImageData(0, 0, mw, mh).data, I = new Float32Array(mw * mh);
    for (let i = 0; i < mw * mh; i++) I[i] = lum(md[i * 4], md[i * 4 + 1], md[i * 4 + 2]) / 255;
    const r = Math.max(2, Math.round(Math.max(mw, mh) / RM * 2.5));
    const q = guidedFilter(I, p, mw, mh, r, 1e-3);
    for (let i = 0; i < p.length; i++) {
      const band = 4 * p[i] * (1 - p[i]); // 0 in solid areas, 1 at the 50% edge
      const v = p[i] + (clamp(q[i], 0, 1) - p[i]) * clamp(band * 1.6, 0, 0.85);
      p[i] = v < 0.015 ? 0 : v > 0.985 ? 1 : v;
    }
  }
  { // fill pinholes inside the body (a white collar against a white wall must not turn see-through)
    const big = blur(p, mw, mh, Math.max(2, Math.max(mw, mh) * 0.008));
    for (let i = 0; i < p.length; i++) p[i] = Math.max(p[i], smooth(0.9, 0.985, big[i]));
  }
  const alpha = resample(p, mw, mh, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < vx0 || x >= vx1 || y < vy0 || y >= vy1) alpha[y * w + x] = 0;

  // --- white balance (conservative gray-world on near-neutral pixels) + exposure from subject highlights
  let sr = 0, sg = 0, sb = 0, sn = 0; const hist = new Uint32Array(256); let hn = 0;
  for (let i = 0; i < n; i += 3) {
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), L = lum(r, gg, b);
    if (mx - mn < 0.13 * mx + 5 && L > 40 && L < 235) { sr += r; sg += gg; sb += b; sn++; }
    if (alpha[i] > 0.6) { hist[L | 0]++; hn++; }
  }
  const wb = [1, 1, 1];
  if (sn > n / 3 * 0.03) { const m = (sr + sg + sb) / 3; [sr, sg, sb].forEach((s, k) => { wb[k] = 1 + (clamp(m / s, 0.9, 1.1) - 1) * 0.6; }); }
  let acc = 0, p97 = 255; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= hn * 0.03) { p97 = v; break; } }
  const expo = clamp(0.92 * 255 / Math.max(p97, 1), 0.92, 1.35);
  const lut = [0, 1, 2].map((k) => { const t = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) { let c = v / 255 * expo * wb[k]; if (c > 0.85) c = 0.85 + 0.15 * Math.tanh((c - 0.85) / 0.15); t[v] = Math.round(c * 255); } return t; });
  const before = canvasOf(w, h); ctxOf(before).drawImage(canvas, 0, 0);
  for (let i = 0; i < n; i++) { px[i * 4] = lut[0][px[i * 4]]; px[i * 4 + 1] = lut[1][px[i * 4 + 1]]; px[i * 4 + 2] = lut[2][px[i * 4 + 2]]; }

  // --- edge decontamination: un-mix the old background out of hair and edge pixels, so nothing of the shop bleeds onto the new backdrop
  {
    const f = 3, sig = Math.max(2, Math.max(w, h) * 0.012) / f;
    const wb = new Float32Array(n), wf = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = alpha[i], b = 1 - a; wb[i] = b * b * b * b; wf[i] = a * a * a * a; }
    const dwb = downsample(wb, w, h, f), dwf = downsample(wf, w, h, f), bwb = gaussXY(dwb.data, dwb.w, dwb.h, sig, sig), bwf = gaussXY(dwf.data, dwf.w, dwf.h, sig * 0.4, sig * 0.4);
    const Bk = [], Fk = [], ch = new Float32Array(n);
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < n; i++) ch[i] = px[i * 4 + k] * wb[i];
      const db = downsample(ch, w, h, f); Bk.push(gaussXY(db.data, db.w, db.h, sig, sig));
      for (let i = 0; i < n; i++) ch[i] = px[i * 4 + k] * wf[i];
      const df = downsample(ch, w, h, f); Fk.push(gaussXY(df.data, df.w, df.h, sig * 0.4, sig * 0.4));
    }
    const dw = dwb.w, dh = dwb.h;
    // colour-line refinement: near the edge, a pixel's alpha is where its colour sits between the old background and the subject
    const near = blur(alpha, w, h, Math.max(1.2, Math.max(w, h) * 0.0025));
    for (let y = 0; y < h; y++) {
      const dy = Math.min(dh - 1, (y / f) | 0);
      for (let x = 0; x < w; x++) {
        const i = y * w + x, a = alpha[i], edge = 1 - smooth(0.82, 0.995, near[i]); if (a < 0.004 || edge < 0.01) continue;
        const di = dy * dw + Math.min(dw - 1, (x / f) | 0), sb = bwb[di], sf = bwf[di]; if (sb < 1e-4 || sf < 1e-4) continue;
        let dd = 0, dot = 0;
        for (let k = 0; k < 3; k++) { const B = Bk[k][di] / sb, d = Fk[k][di] / sf - B; dd += d * d; dot += (px[i * 4 + k] - B) * d; }
        const conf = smooth(30, 90, Math.sqrt(dd)); if (conf < 0.01) continue;
        const ac = clamp(dot / dd, 0, 1);
        if (ac < a) alpha[i] = a + (ac - a) * conf * edge; // only ever thins: removes leftover background, never adds it
      }
    }
    for (let y = 0; y < h; y++) {
      const dy = Math.min(dh - 1, (y / f) | 0);
      for (let x = 0; x < w; x++) {
        const i = y * w + x, a = alpha[i]; if (a < 0.004 || a > 0.995) continue;
        const di = dy * dw + Math.min(dw - 1, (x / f) | 0), sb = bwb[di], sf = bwf[di];
        for (let k = 0; k < 3; k++) {
          const I = px[i * 4 + k];
          const B = sb > 1e-4 ? Bk[k][di] / sb : I, Fin = sf > 1e-4 ? Fk[k][di] / sf : I;
          const Fun = clamp((I - (1 - a) * B) / Math.max(a, 0.05), 0, 255); // compositing equation solved for the foreground
          const t = smooth(0.08, 0.45, a); // thin wisps: unreliable to un-mix, take the nearby subject colour
          let F = Fin + (Fun - Fin) * t;
          F = Math.min(F, Math.max(Fin * 1.25, I)); // never invent a halo brighter than the subject next to it
          px[i * 4 + k] = F;
        }
        // edge pixels keep their own brightness but take the subject's colour: no tinted fringe from the old background
        const e = (1 - smooth(0.82, 0.995, near[i])) * 0.8; if (e < 0.01 || sf < 1e-4) continue;
        const L = lum(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]), fr = Fk[0][di] / sf, fg = Fk[1][di] / sf, fb = Fk[2][di] / sf, Lf = Math.max(1, lum(fr, fg, fb));
        const tr = fr * L / Lf, tg = fg * L / Lf, tb = fb * L / Lf;
        px[i * 4] += (tr - px[i * 4]) * e; px[i * 4 + 1] += (tg - px[i * 4 + 1]) * e; px[i * 4 + 2] += (tb - px[i * 4 + 2]) * e;
      }
    }
  }

  // --- skin mask: segmentation skin × colour similarity to the cheeks, minus eyes / brows / lips
  const segSkin = new Float32Array(grid.w * grid.h); for (let i = 0; i < segSkin.length; i++) segSkin[i] = Math.min(1, grid.face[i] + grid.body[i]);
  const skin = resample(segSkin, grid.w, grid.h, w, h);
  let skinRef = null;
  if (fm) {
    let cb = 0, cr = 0, ly = 0, c = 0; const rad = Math.max(1, Math.round(fm.iod * 0.05));
    for (const idx of LM.cheeks) {
      const X = Math.round(pts[idx * 3]), Y = Math.round(pts[idx * 3 + 1]);
      for (let yy = Y - rad; yy <= Y + rad; yy++) for (let xx = X - rad; xx <= X + rad; xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const i = (yy * w + xx) * 4;
        const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255, L = lum(r, gg, b);
        cb += (b - L) * 0.564; cr += (r - L) * 0.713; ly += L; c++;
      }
    }
    if (c) skinRef = { cb: cb / c, cr: cr / c, L: ly / c };
  }
  for (let i = 0; i < n; i++) {
    let s = smooth(0.3, 0.7, skin[i]) * alpha[i];
    if (s > 0 && skinRef) {
      const r = px[i * 4] / 255, gg = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255, L = lum(r, gg, b);
      const d = Math.hypot((b - L) * 0.564 - skinRef.cb, (r - L) * 0.713 - skinRef.cr);
      s *= (1 - smooth(0.045, 0.11, d)) * smooth(0.28, 0.5, L / skinRef.L);
    }
    skin[i] = s;
  }
  const poly = (idx) => idx.map((i) => [pts[i * 3], pts[i * 3 + 1]]);
  let features = null, roi = null;
  if (fm) {
    const pad = fm.iod * 0.9; let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const i of LM.oval) { x0 = Math.min(x0, pts[i * 3]); x1 = Math.max(x1, pts[i * 3]); y0 = Math.min(y0, pts[i * 3 + 1]); y1 = Math.max(y1, pts[i * 3 + 1]); }
    roi = { x: clamp(Math.floor(x0 - pad), 0, w - 1), y: clamp(Math.floor(y0 - pad), 0, h - 1) };
    roi.w = clamp(Math.ceil(x1 + pad), 1, w) - roi.x; roi.h = clamp(Math.ceil(y1 + pad), 1, h) - roi.y;
    // exclusion mask (ROI space): eyes (grown), brows, lips
    const grow = (pl, k) => { const cx = pl.reduce((s, q2) => s + q2[0], 0) / pl.length, cy = pl.reduce((s, q2) => s + q2[1], 0) / pl.length; return pl.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]); };
    features = polyMask(roi.w, roi.h, [grow(poly(LM.eyeR), 1.35), grow(poly(LM.eyeL), 1.35), grow(poly(LM.browR), 1.15), grow(poly(LM.browL), 1.15), grow(poly(LM.lipsOuter), 1.08)], Math.max(0.8, fm.iod * 0.02), roi.x, roi.y);
    for (let y = 0; y < roi.h; y++) for (let x = 0; x < roi.w; x++) { const i = (roi.y + y) * w + roi.x + x; skin[i] *= 1 - clamp(features[y * roi.w + x] * 1.6, 0, 1); }
  }
  return { w, h, pixels: px, before, alpha, skin, pts, fm, roi, grid, sourceScale: scale };
}

// ---------- render: the look ----------
export function renderFrame(fr, o = {}) {
  const opt = { backdrop: 'white', retouch: 0.55, light: 0.6, eyes: 0.65, bw: false, ...o };
  const { w, h, pixels: px, alpha, skin, pts, fm } = fr, n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { R[i] = px[i * 4] / 255; G[i] = px[i * 4 + 1] / 255; B[i] = px[i * 4 + 2] / 255; }
  const P = (i) => [pts[i * 3], pts[i * 3 + 1]];
  const poly = (idx) => idx.map(P);
  let keyX = -1; // key light from image-left by default

  // ===== 1. face relight: even out the existing light, then add a soft sculpting key =====
  if (fm && opt.light > 0.01) {
    const { roi } = fr, ls = Math.min(1, 56 / fm.iod), lw = Math.max(4, Math.round(roi.w * ls)), lh = Math.max(4, Math.round(roi.h * ls)), ln = lw * lh;
    const L = new Float32Array(ln), M = new Float32Array(ln), C = new Float32Array(ln);
    for (let y = 0; y < roi.h; y++) {
      const ly = Math.min(lh - 1, (y * ls) | 0) * lw, o2 = (roi.y + y) * w + roi.x;
      for (let x = 0; x < roi.w; x++) { const d = ly + Math.min(lw - 1, (x * ls) | 0), i = o2 + x; L[d] += lum(R[i], G[i], B[i]); M[d] += skin[i]; C[d]++; }
    }
    for (let i = 0; i < ln; i++) { L[i] /= C[i]; M[i] /= C[i]; }
    const iodL = fm.iod * ls, toL = (pl) => pl.map(([x, y]) => [(x - roi.x) * ls, (y - roi.y) * ls]);
    const ovalHard = polyMask(lw, lh, [toL(poly(LM.oval))]);
    const ovalSoft = blur(ovalHard, lw, lh, iodL * 0.16);
    // which side is already brighter? put the key there so we work with the real light, not against it
    let sl = 0, nl = 0, sR = 0, nr = 0; const midx = (fm.mid[0] - roi.x) * ls;
    for (let i = 0; i < ln; i++) { const wgt = M[i] * ovalHard[i]; if (i % lw < midx) { sl += L[i] * wgt; nl += wgt; } else { sR += L[i] * wgt; nr += wgt; } }
    if (nl > 1 && nr > 1 && (sR / nr) > (sl / nl) * 1.04) keyX = 1;
    // flatten: local skin brightness pulled toward the face average
    const LM_ = new Float32Array(ln); for (let i = 0; i < ln; i++) LM_[i] = L[i] * M[i];
    const bl = blur(LM_, lw, lh, iodL * 0.30), bm = blur(M, lw, lh, iodL * 0.30);
    let sm = 0, sw = 0; for (let i = 0; i < ln; i++) { const wgt = M[i] * ovalHard[i]; sm += L[i] * wgt; sw += wgt; }
    const meanL = sw > 0 ? sm / sw : 0.5, kf = 0.48 * opt.light;
    const gain = new Float32Array(ln).fill(1);
    for (let i = 0; i < ln; i++) {
      if (bm[i] < 0.02) continue;
      const gf = clamp(Math.pow(meanL / Math.max(bl[i] / bm[i], 0.03), kf), 0.7, 1.7);
      gain[i] = 1 + (gf - 1) * smooth(0.05, 0.4, bm[i]) * ovalSoft[i];
    }
    // sculpt: lambert shading from the 3D face mesh
    const { tris, adj } = meshTris(), nv = pts.length / 3, nrm = new Float32Array(nv * 3);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const ux = pts[b] - pts[a], uy = pts[b + 1] - pts[a + 1], uz = pts[b + 2] - pts[a + 2], vx = pts[c] - pts[a], vy = pts[c + 1] - pts[a + 1], vz = pts[c + 2] - pts[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nz > 0) { nx = -nx; ny = -ny; nz = -nz; }
      for (const v of [a, b, c]) { nrm[v] += nx; nrm[v + 1] += ny; nrm[v + 2] += nz; }
    }
    for (let it = 0; it < 2; it++) { // smooth normals
      const s2 = new Float32Array(nrm);
      for (const [v, nb] of adj) for (const u of nb) { s2[v * 3] += nrm[u * 3] * 0.5; s2[v * 3 + 1] += nrm[u * 3 + 1] * 0.5; s2[v * 3 + 2] += nrm[u * 3 + 2] * 0.5; }
      nrm.set(s2);
    }
    const lv = [keyX * 0.50, -0.42, -0.76], ll = Math.hypot(...lv), shadeV = new Float32Array(nv);
    for (let v = 0; v < nv; v++) { const x = nrm[v * 3], y = nrm[v * 3 + 1], z = nrm[v * 3 + 2], l2 = Math.hypot(x, y, z) || 1; shadeV[v] = Math.max(0, (x * lv[0] + y * lv[1] + z * lv[2]) / (l2 * ll)); }
    const S = new Float32Array(ln), In = new Float32Array(ln);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const ax = (pts[a * 3] - roi.x) * ls, ay = (pts[a * 3 + 1] - roi.y) * ls, bx = (pts[b * 3] - roi.x) * ls, by = (pts[b * 3 + 1] - roi.y) * ls, cx = (pts[c * 3] - roi.x) * ls, cy = (pts[c * 3 + 1] - roi.y) * ls;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-6) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(lw - 1, Math.ceil(Math.max(ax, bx, cx))), y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(lh - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const pxx = x + 0.5, pyy = y + 0.5;
        const wa = ((by - cy) * (pxx - cx) + (cx - bx) * (pyy - cy)) / den, wb = ((cy - ay) * (pxx - cx) + (ax - cx) * (pyy - cy)) / den, wc = 1 - wa - wb;
        if (wa < -0.02 || wb < -0.02 || wc < -0.02) continue;
        S[y * lw + x] = wa * shadeV[a] + wb * shadeV[b] + wc * shadeV[c]; In[y * lw + x] = 1;
      }
    }
    // extend the shading smoothly past the mesh edge (ears, hairline, neck) so there's no seam
    const bs = blur(S, lw, lh, iodL * 0.22), bi = blur(In, lw, lh, iodL * 0.22), ss = blur(S, lw, lh, iodL * 0.07), si = blur(In, lw, lh, iodL * 0.07);
    let ms = 0, mw2 = 0; for (let i = 0; i < ln; i++) { ms += S[i] * In[i]; mw2 += In[i]; }
    const meanS = mw2 ? ms / mw2 : 1, amp = 0.42 * opt.light;
    const reach = blur(In, lw, lh, iodL * 0.45);
    for (let i = 0; i < ln; i++) {
      const inner = si[i] > 0.5 ? ss[i] / si[i] : null, outer = bi[i] > 0.01 ? bs[i] / bi[i] : meanS;
      const t = smooth(0.5, 0.95, si[i]), s = inner !== null ? outer + (inner - outer) * t : outer;
      gain[i] *= 1 + clamp(amp * (s / meanS - 1), -0.30, 0.20) * smooth(0.0, 0.5, reach[i]);
    }
    const gUp = resample(gain, lw, lh, roi.w, roi.h);
    for (let y = 0; y < roi.h; y++) for (let x = 0; x < roi.w; x++) { const i = (roi.y + y) * w + roi.x + x; let gv = gUp[y * roi.w + x];
      if (gv > 1) gv = 1 + (gv - 1) * (1 - smooth(0.62, 0.98, Math.max(R[i], G[i], B[i]))); // never push highlights into clipping
      R[i] *= gv; G[i] *= gv; B[i] *= gv; }
  }

  // ===== 2. skin retouch: frequency separation, texture kept =====
  if (opt.retouch > 0.01) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (skin[y * w + x] > 0.05) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 > x0 && y1 > y0) {
      const unit = fm ? fm.iod : Math.max(w, h) * 0.03;
      const s1 = Math.max(0.7, unit * 0.014), s2 = Math.max(2.5, unit * 0.085), padR = Math.ceil(s2 * 2);
      x0 = Math.max(0, x0 - padR); y0 = Math.max(0, y0 - padR); x1 = Math.min(w - 1, x1 + padR); y1 = Math.min(h - 1, y1 + padR);
      const rw = x1 - x0 + 1, rh = y1 - y0 + 1, rn = rw * rh;
      const m = new Float32Array(rn); for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) m[y * rw + x] = skin[(y0 + y) * w + x0 + x];
      const m1 = blur(m, rw, rh, s1), m2 = blur(m, rw, rh, s2), t = new Float32Array(rn);
      const s = opt.retouch, kMid = 1 - 0.78 * s, kHigh = 1 - 0.12 * s;
      for (const Pn of [R, G, B]) {
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) t[y * rw + x] = Pn[(y0 + y) * w + x0 + x] * m[y * rw + x];
        const b1 = blur(t, rw, rh, s1), b2 = blur(t, rw, rh, s2);
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
          const j = y * rw + x, mk = m[j]; if (mk < 0.02 || m1[j] < 0.05 || m2[j] < 0.05) continue;
          const i = (y0 + y) * w + x0 + x, c = Pn[i], lo1 = b1[j] / m1[j], lo2 = b2[j] / m2[j];
          let out = lo2 + (lo1 - lo2) * kMid + (c - lo1) * kHigh;
          const hot = smooth(0.78, 0.97, c); out += (lo2 - out) * hot * 0.45 * s; // tame shine
          Pn[i] = c + (out - c) * mk;
        }
      }
    }
  }

  // ===== 3. eyes — where the soul comes through =====
  if (fm && opt.eyes > 0.01 && fm.iod > 14) {
    const s = opt.eyes, { roi } = fr, up = fm.up, right = fm.right;
    // under-eye: lift toward the cheek tone
    for (const lid of [LM.lidR, LM.lidL]) {
      const lp = poly(lid), dn = [-up[0], -up[1]], off = (pl, k) => pl.map(([x, y]) => [x + dn[0] * fm.iod * k, y + dn[1] * fm.iod * k]);
      const under = [...off(lp, 0.05), ...off(lp, 0.30).reverse()], cheek = [...off(lp, 0.34), ...off(lp, 0.55).reverse()];
      const um = polyMask(roi.w, roi.h, [under], fm.iod * 0.06, roi.x, roi.y), cm = polyMask(roi.w, roi.h, [cheek], 0, roi.x, roi.y);
      let su = 0, nu = 0, sc = 0, nc = 0;
      for (let y = 0; y < roi.h; y++) for (let x = 0; x < roi.w; x++) { const j = y * roi.w + x, i = (roi.y + y) * w + roi.x + x, L = lum(R[i], G[i], B[i]), sk = skin[i]; su += L * um[j] * sk; nu += um[j] * sk; sc += L * cm[j] * sk; nc += cm[j] * sk; }
      if (nu > 4 && nc > 4 && sc / nc > su / nu) {
        const gmax = clamp(Math.pow((sc / nc) / (su / nu), 0.75 * s), 1, 1.28) - 1;
        for (let y = 0; y < roi.h; y++) for (let x = 0; x < roi.w; x++) { const j = y * roi.w + x; if (um[j] < 0.01) continue; const i = (roi.y + y) * w + roi.x + x, gv = 1 + gmax * um[j]; R[i] *= gv; G[i] *= gv; B[i] *= gv; }
      }
    }
    // crisp eyes, lashes and brows
    {
      const grow = (pl, k) => { const cx = pl.reduce((a, q) => a + q[0], 0) / pl.length, cy = pl.reduce((a, q) => a + q[1], 0) / pl.length; return pl.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]); };
      const sm = polyMask(roi.w, roi.h, [grow(poly(LM.eyeR), 1.45), grow(poly(LM.eyeL), 1.45), poly(LM.browR), poly(LM.browL)], fm.iod * 0.035, roi.x, roi.y);
      const Lr = new Float32Array(roi.w * roi.h);
      for (let y = 0; y < roi.h; y++) for (let x = 0; x < roi.w; x++) { const i = (roi.y + y) * w + roi.x + x; Lr[y * roi.w + x] = lum(R[i], G[i], B[i]); }
      const Lb = blur(Lr, roi.w, roi.h, Math.max(0.8, fm.iod * 0.012)), amt = 0.6 * s;
      for (let j = 0; j < Lr.length; j++) { if (sm[j] < 0.01) continue; const i = (roi.y + ((j / roi.w) | 0)) * w + roi.x + (j % roi.w), d = clamp((Lr[j] - Lb[j]) * amt, -0.09, 0.09) * sm[j]; R[i] += d; G[i] += d; B[i] += d; }
    }
    for (const [contour, ic] of [[LM.eyeR, LM.irisR], [LM.eyeL, LM.irisL]]) {
      const ep = poly(contour), c = P(ic);
      let r = 0; for (let k = 1; k <= 4; k++) { const q = P(ic + k); r += Math.hypot(q[0] - c[0], q[1] - c[1]) / 4; }
      if (r < 2.2) continue;
      let x0 = w, y0 = h, x1 = 0, y1 = 0; for (const [x, y] of ep) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const pad = Math.max(3, r * 0.8); x0 = clamp(Math.floor(x0 - pad), 0, w - 1); y0 = clamp(Math.floor(y0 - pad), 0, h - 1); x1 = clamp(Math.ceil(x1 + pad), 0, w - 1); y1 = clamp(Math.ceil(y1 + pad), 0, h - 1);
      const ew = x1 - x0 + 1, eh = y1 - y0 + 1;
      const eye = polyMask(ew, eh, [ep], Math.max(0.5, r * 0.07), x0, y0);
      const iris = polyMask(ew, eh, [{ circle: [c[0], c[1], r * 0.97] }], Math.max(0.5, r * 0.09), x0, y0);
      const irisWide = polyMask(ew, eh, [{ circle: [c[0], c[1], r * 1.12] }], Math.max(0.5, r * 0.08), x0, y0);
      const Le = new Float32Array(ew * eh); let hi = 0;
      for (let y = 0; y < eh; y++) for (let x = 0; x < ew; x++) { const i = (y0 + y) * w + x0 + x, j = y * ew + x; Le[j] = lum(R[i], G[i], B[i]); if (iris[j] * eye[j] > 0.6 && Le[j] > hi) hi = Le[j]; }
      const Lb = blur(Le, ew, eh, Math.max(0.8, r * 0.28));
      const cdx = keyX * 0.8 * right[0] + 0.6 * up[0], cdy = keyX * 0.8 * right[1] + 0.6 * up[1], cl = Math.hypot(cdx, cdy), ux = cdx / cl, uy = cdy / cl; // toward the key
      const kx = c[0] + ux * r * 0.40, ky = c[1] + uy * r * 0.40, ksig = Math.max(0.6, r * 0.13), kAmp = (r >= 4.5 ? 0.62 : 0.3) * s * (hi > 0.72 ? 0.3 : 1);
      for (let y = 0; y < eh; y++) for (let x = 0; x < ew; x++) {
        const j = y * ew + x, e = eye[j]; if (e < 0.01) continue;
        const i = (y0 + y) * w + x0 + x, ir = iris[j] * e, sc = e * (1 - irisWide[j]);
        let rr = R[i], gg = G[i], bb = B[i], L = Le[j];
        if (sc > 0.01) { // whites: cleaner and a touch brighter, never paper-white
          const k = sc * s, gv = 1 + 0.13 * k * (1 - smooth(0.7, 0.95, L));
          rr = (rr + (L - rr) * 0.38 * k) * gv; gg = (gg + (L - gg) * 0.38 * k) * gv; bb = (bb + (L - bb) * 0.38 * k) * gv;
        }
        if (ir > 0.01) { // iris: depth, colour and light opposite the catchlight
          const dxn = (x0 + x - c[0]) / r, dyn = (y0 + y - c[1]) / r, dd = Math.hypot(dxn, dyn);
          const opp = clamp(0.55 - 0.45 * (dxn * ux + dyn * uy), 0, 1), lit = smooth(0.03, 0.22, L);
          const gv = 1 + 0.24 * ir * s * opp * lit, det = (L - Lb[j]) * 0.6 * ir * s, sat = 1 + 0.08 * ir * s;
          const L2 = L * gv + det;
          rr = L2 + (rr - L) * sat; gg = L2 + (gg - L) * sat; bb = L2 + (bb - L) * sat;
          const ring = Math.exp(-(((dd - 0.96) / 0.09) ** 2)) * e * 0.08 * s; rr *= 1 - ring; gg *= 1 - ring; bb *= 1 - ring;
        }
        // catchlight: a small soft-box reflection toward the key light
        const dk = ((x0 + x - kx) ** 2 + (y0 + y - ky) ** 2) / (2 * ksig * ksig);
        if (dk < 6) { const a = Math.exp(-dk) * kAmp * e * irisWide[j]; rr += (1 - rr) * a; gg += (1 - gg) * a; bb += (1 - bb) * a; }
        R[i] = rr; G[i] = gg; B[i] = bb;
      }
    }
    // teeth: a little cleaner, only if the mouth is open
    {
      const ip = poly(LM.lipsInner); let x0 = w, y0 = h, x1 = 0, y1 = 0; for (const [x, y] of ip) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      x0 = clamp(Math.floor(x0), 0, w - 1); y0 = clamp(Math.floor(y0), 0, h - 1); x1 = clamp(Math.ceil(x1), 0, w - 1); y1 = clamp(Math.ceil(y1), 0, h - 1);
      if (y1 - y0 > fm.iod * 0.06) {
        const tw = x1 - x0 + 1, th = y1 - y0 + 1, tm = polyMask(tw, th, [ip], Math.max(0.6, fm.iod * 0.012), x0, y0);
        for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
          const j = y * tw + x; if (tm[j] < 0.02) continue; const i = (y0 + y) * w + x0 + x, L = lum(R[i], G[i], B[i]);
          const mx = Math.max(R[i], G[i], B[i]), mn = Math.min(R[i], G[i], B[i]), k = tm[j] * smooth(0.38, 0.6, L) * (1 - smooth(0.25, 0.45, (mx - mn) / (mx + 1e-3))) * s;
          if (k < 0.01) continue; const gv = 1 + 0.06 * k;
          R[i] = (R[i] + (L - R[i]) * 0.35 * k) * gv; G[i] = (G[i] + (L - G[i]) * 0.35 * k) * gv; B[i] = (B[i] + (L - B[i]) * 0.35 * k) * gv;
        }
      }
    }
  }

  // ===== 4. backdrop, body light, composite =====
  const bd = BACKDROPS[opt.backdrop] || BACKDROPS.gray, big = Math.max(w, h);
  let px0 = w, py0 = h, px1 = 0, py1 = 0;
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) if (alpha[y * w + x] > 0.5) { if (x < px0) px0 = x; if (x > px1) px1 = x; if (y < py0) py0 = y; if (y > py1) py1 = y; }
  const ph = Math.max(1, py1 - py0), pcx = (px0 + px1) / 2;
  const hx = fm ? fm.mid[0] : pcx, hy = fm ? fm.mid[1] + fm.faceH * 0.35 : py0 + ph * 0.3;
  const fullBody = fm ? ph > fm.faceH * 4.2 : ph > h * 0.7;
  // backdrop mottle (paper / painted canvas)
  const nz = (cell) => { const nw = Math.ceil(w / cell) + 2, nh = Math.ceil(h / cell) + 2, a = new Float32Array(nw * nh); for (let i = 0; i < a.length; i++) a[i] = Math.random() - 0.5; return resample(gaussXY(a, nw, nh, 1, 1), nw, nh, w, h); };
  const n1 = nz(big / 7), n2 = nz(big / 28);
  // soft shadow of the subject on the backdrop, away from the key
  let shadow = null;
  if (bd.shadow > 0) {
    const f = 6, d = downsample(alpha, w, h, f), sh = new Float32Array(d.w * d.h), ox = Math.round(-keyX * big * 0.035 / f), oy = Math.round(big * 0.012 / f);
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) { const sx = x - ox, sy = y - oy; sh[y * d.w + x] = sx >= 0 && sy >= 0 && sx < d.w && sy < d.h ? d.data[sy * d.w + sx] : 0; }
    shadow = resample(gaussXY(sh, d.w, d.h, big * 0.035 / f, big * 0.035 / f), d.w, d.h, w, h);
  }
  // floor contact shadow under visible feet
  let contact = null;
  if (fullBody && py1 < h - h * 0.015) {
    // per column: the lowest subject pixel, if it sits near the floor line, drops a thin shadow just below it
    const f = 4, d = downsample(alpha, w, h, f), cs = new Float32Array(d.w * d.h);
    const floorY = (py1 - ph * 0.14) / f, dy = Math.max(1, Math.round(ph * 0.004 / f)), thick = Math.max(1, Math.round(ph * 0.012 / f));
    for (let x = 0; x < d.w; x++) {
      let y = d.h - 1; while (y >= 0 && d.data[y * d.w + x] <= 0.5) y--;
      if (y < floorY) continue;
      for (let k = 0; k < thick; k++) { const ty = y + dy + k; if (ty < d.h) cs[ty * d.w + x] = 1; }
    }
    contact = resample(gaussXY(cs, d.w, d.h, ph * 0.022 / f, ph * 0.007 / f), d.w, d.h, w, h);
  }
  // rim / kicker light on the side away from the key
  let rim = null;
  if (bd.rim > 0 && opt.light > 0.01) {
    const sig = big * 0.006, ba = blur(alpha, w, h, sig); rim = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, gx = (ba[i + 1] - ba[i - 1]) * sig; rim[i] = clamp(keyX * gx * 2.2, 0, 1) * alpha[i]; }
  }
  const out = new ImageData(w, h), od = out.data;
  const curve = new Float32Array(1025); for (let i = 0; i <= 1024; i++) { const c = i / 1024; curve[i] = c - 0.16 * Math.sin(2 * Math.PI * c) / (2 * Math.PI); }
  const tone = (c) => curve[(clamp(c, 0, 1) * 1024) | 0];
  const rad = big * 0.78, rimAmt = bd.rim * (0.5 + opt.light);
  for (let y = 0; y < h; y++) {
    const fall = fullBody ? 1 - 0.14 * smooth(0, 1, (y - hy) / (ph * 0.9)) : 1; // light falls off toward the feet
    for (let x = 0; x < w; x++) {
      const i = y * w + x, a = alpha[i];
      const dn = Math.hypot(x - hx, y - hy) / rad, t = smooth(0, 1, dn), mott = 1 + bd.mottle * (n1[i] * 3.2 + n2[i] * 1.6);
      let br = (bd.c0[0] + (bd.c1[0] - bd.c0[0]) * t) * mott, bg = (bd.c0[1] + (bd.c1[1] - bd.c0[1]) * t) * mott, bb = (bd.c0[2] + (bd.c1[2] - bd.c0[2]) * t) * mott;
      if (shadow) { const sh = 1 - bd.shadow * shadow[i]; br *= sh; bg *= sh; bb *= sh; }
      if (contact) { const sh = 1 - 0.55 * contact[i]; br *= sh; bg *= sh; bb *= sh; }
      let r = R[i] * fall, g = G[i] * fall, b = B[i] * fall;
      if (rim) { const k = rim[i] * rimAmt; r += (1 - r) * k; g += (1 - g) * k; b += (1 - b) * k; }
      r = r * a + br * (1 - a); g = g * a + bg * (1 - a); b = b * a + bb * (1 - a);
      const vig = 1 - 0.16 * smooth(0.55, 1.25, dn), gr = (Math.random() + Math.random() - 1) * 0.014;
      r = tone(r * vig) + gr; g = tone(g * vig) + gr; b = tone(b * vig) + gr;
      if (opt.bw) { const L = clamp(0.30 * r + 0.59 * g + 0.11 * b, 0, 1), L2 = L - 0.10 * Math.sin(2 * Math.PI * L) / (2 * Math.PI); r = L2 * 1.005; g = L2; b = L2 * 0.99; }
      od[i * 4] = r * 255; od[i * 4 + 1] = g * 255; od[i * 4 + 2] = b * 255; od[i * 4 + 3] = 255;
    }
  }
  const c = canvasOf(w, h); c.getContext('2d').putImageData(out, 0, 0);
  return c;
}

// debug: draw landmarks / masks over the frame
export function debugOverlay(fr) {
  const c = canvasOf(fr.w, fr.h), g = ctxOf(c); g.drawImage(fr.before, 0, 0);
  const id = g.getImageData(0, 0, fr.w, fr.h), d = id.data;
  for (let i = 0; i < fr.w * fr.h; i++) { const a = fr.alpha[i], s = fr.skin[i]; d[i * 4] = d[i * 4] * a + 255 * (1 - a) * 0.0 + 0; d[i * 4 + 1] = d[i * 4 + 1] * a * (1 - s * 0.6) + 255 * s * 0.6 * a; d[i * 4 + 2] = d[i * 4 + 2] * a + 200 * (1 - a); }
  g.putImageData(id, 0, 0);
  if (fr.pts) {
    const draw = (idx, col) => { g.strokeStyle = col; g.lineWidth = Math.max(1, fr.w / 600); g.beginPath(); idx.forEach((i, k) => (k ? g.lineTo(fr.pts[i * 3], fr.pts[i * 3 + 1]) : g.moveTo(fr.pts[i * 3], fr.pts[i * 3 + 1]))); g.closePath(); g.stroke(); };
    draw(LM.oval, '#ff0'); draw(LM.eyeR, '#0ff'); draw(LM.eyeL, '#0ff'); draw(LM.browR, '#f0f'); draw(LM.browL, '#f0f'); draw(LM.lipsOuter, '#f00'); draw(LM.lipsInner, '#f80');
    g.fillStyle = '#fff'; for (const i of [LM.irisR, LM.irisL]) g.fillRect(fr.pts[i * 3] - 1, fr.pts[i * 3 + 1] - 1, 3, 3);
  }
  return c;
}
