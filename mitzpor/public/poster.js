// הפוסטר האישי: 1080x1920 (גודל סטורי). שם, אובססיה, ציטוט של נוגה, מילה סודית ופרטי האירוע.
'use strict';

const Poster = (() => {
  const W = 1080, H = 1920;

  function rng(seedStr) {
    let h = 2166136261;
    for (const ch of seedStr) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  }

  function fit(ctx, text, maxW, size, weight, family, min = 20) {
    let s = size;
    do { ctx.font = `${weight} ${s}px ${family}`; if (ctx.measureText(text).width <= maxW) break; s -= 4; } while (s > min);
    return s;
  }

  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function loadImage(src) {
    return new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  }

  function sky(ctx, r) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#04050d'); g.addColorStop(0.45, '#0e0b26'); g.addColorStop(0.78, '#2a0f3a'); g.addColorStop(0.9, '#6b1d4a'); g.addColorStop(1, '#ff7a45');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 420; i++) {
      const x = r() * W, y = r() * H * 0.82, s = r() < 0.06 ? 2.6 : r() * 1.6 + 0.4;
      ctx.globalAlpha = 0.25 + r() * 0.75 * (1 - y / H);
      ctx.fillStyle = r() < 0.15 ? '#ffd9a8' : '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function city(ctx, r) {
    // קו רקיע
    ctx.fillStyle = '#07050f';
    ctx.beginPath(); ctx.moveTo(0, H);
    let x = 0;
    while (x < W) { const bw = 20 + r() * 60, bh = 40 + r() * 150; ctx.lineTo(x, H - 110 - bh); ctx.lineTo(x + bw, H - 110 - bh); x += bw; }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    // אורות
    for (let i = 0; i < 700; i++) {
      const lx = r() * W, ly = H - 20 - r() * 250;
      ctx.globalAlpha = 0.3 + r() * 0.7;
      ctx.fillStyle = r() < 0.7 ? '#ffc56b' : (r() < 0.5 ? '#ffffff' : '#ff4f8b');
      ctx.fillRect(lx, ly, r() < 0.1 ? 3 : 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function tower(ctx, cx) {
    const top = H - 290, base = H;
    ctx.save();
    ctx.strokeStyle = '#05040b'; ctx.fillStyle = '#05040b'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    const L0 = cx - 85, R0 = cx + 85, L1 = cx - 34, R1 = cx + 34;
    ctx.beginPath(); ctx.moveTo(L0, base); ctx.lineTo(L1, top); ctx.moveTo(R0, base); ctx.lineTo(R1, top); ctx.stroke();
    ctx.lineWidth = 4;
    for (let i = 0; i < 5; i++) {
      const y0 = base - i * (base - top) / 5, y1 = base - (i + 1) * (base - top) / 5;
      const lx = (y) => L0 + (L1 - L0) * (base - y) / (base - top), rx = (y) => R0 + (R1 - R0) * (base - y) / (base - top);
      ctx.beginPath(); ctx.moveTo(lx(y0), y0); ctx.lineTo(rx(y1), y1); ctx.moveTo(rx(y0), y0); ctx.lineTo(lx(y1), y1);
      ctx.moveTo(lx(y1), y1); ctx.lineTo(rx(y1), y1); ctx.stroke();
    }
    ctx.fillRect(cx - 78, top - 16, 156, 18);
    ctx.lineWidth = 4;
    ctx.beginPath(); for (let i = 0; i <= 6; i++) { ctx.moveTo(cx - 74 + i * 24.6, top - 16); ctx.lineTo(cx - 74 + i * 24.6, top - 56); } ctx.moveTo(cx - 76, top - 56); ctx.lineTo(cx + 76, top - 56); ctx.stroke();
    // נוגה עם משקפת
    ctx.beginPath(); ctx.arc(cx + 20, top - 92, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(cx + 10, top - 78, 22, 62);
    ctx.fillRect(cx + 26, top - 100, 22, 10);
    // נורות על המעקה
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const bx = cx - 74 + i * 24.6, by = top - 58 + Math.sin(i * 1.3) * 4;
      const gl = ctx.createRadialGradient(bx, by, 0, bx, by, 14); gl.addColorStop(0, 'rgba(255,214,140,.9)'); gl.addColorStop(.35, 'rgba(255,170,80,.35)'); gl.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(bx, by, 14, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  function binoculars(ctx, cy) {
    const r = 255, dx = 205;
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2 - dx, cy, r, 0, Math.PI * 2); ctx.arc(W / 2 + dx, cy, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(W / 2, cy, 40, W / 2, cy, r + dx);
    g.addColorStop(0, 'rgba(60,20,80,.55)'); g.addColorStop(1, 'rgba(5,4,15,.85)');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.shadowColor = 'rgba(255,61,127,.9)'; ctx.shadowBlur = 30;
    ctx.strokeStyle = 'rgba(255,230,240,.9)'; ctx.lineWidth = 5;
    // מתאר החיצוני בלבד של שני העיגולים
    const a = Math.acos(dx / r);
    ctx.beginPath();
    ctx.arc(W / 2 - dx, cy, r, a, Math.PI * 2 - a);
    ctx.arc(W / 2 + dx, cy, r, Math.PI + a, Math.PI - a);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }

  function stamp(ctx, x, y, word) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(-0.21);
    ctx.strokeStyle = '#ff3d7f'; ctx.fillStyle = '#ff3d7f'; ctx.globalAlpha = 0.92;
    ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 112, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 98, 0, Math.PI * 2); ctx.stroke();
    ctx.textAlign = 'center'; ctx.direction = 'rtl';
    ctx.font = '500 25px Rubik'; ctx.fillText('המילה הסודית', 0, -42);
    fit(ctx, word, 168, 64, 700, 'Karantina'); ctx.fillText(word, 0, 26);
    ctx.font = '500 20px Rubik'; ctx.fillText('★ ליל המצפור ★', 0, 66);
    ctx.restore();
  }

  async function draw(canvas, data, ev) {
    try { await Promise.all(['700 200px Karantina', '400 40px Karantina', '300 40px Rubik', '500 40px Rubik', '700 40px Rubik', '900 40px Rubik'].map(f => document.fonts.load(f))); } catch {}
    const ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    const r = rng((data.name || '') + (data.obsession || '') + (data.callNo || ''));
    ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

    const img = ev.officialPosterImage ? await loadImage(ev.officialPosterImage) : null;
    if (img) {
      const s = Math.max(W / img.width, H / img.height);
      ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
      const shade = ctx.createLinearGradient(0, 0, 0, H); shade.addColorStop(0, 'rgba(0,0,0,.25)'); shade.addColorStop(.4, 'rgba(0,0,0,.6)'); shade.addColorStop(1, 'rgba(0,0,0,.75)');
      ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
    } else {
      sky(ctx, r);
      city(ctx, r);
      tower(ctx, 170);
    }

    // כותרת
    ctx.fillStyle = '#f4efe6';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '18px';
    ctx.font = '700 34px Rubik'; ctx.fillText(ev.presenter || 'OBSESSION', W / 2 + 9, 120);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.font = '300 30px Rubik'; ctx.globalAlpha = 0.7; ctx.fillText('מציגים', W / 2, 170); ctx.globalAlpha = 1;

    ctx.save();
    ctx.shadowColor = 'rgba(255,61,127,.8)'; ctx.shadowBlur = 50;
    fit(ctx, ev.title || 'ליל המצפור', W - 120, 300, 700, 'Karantina');
    ctx.fillText(ev.title || 'ליל המצפור', W / 2, 430);
    ctx.restore();
    if (ev.subtitle) { ctx.font = '300 32px Rubik'; ctx.globalAlpha = 0.85; fit(ctx, ev.subtitle, W - 160, 32, 300, 'Rubik'); ctx.fillText(ev.subtitle, W / 2, 500); ctx.globalAlpha = 1; }

    // המשקפת והשם
    const cy = 860;
    binoculars(ctx, cy);
    ctx.fillStyle = '#f4efe6';
    ctx.font = '400 34px Rubik'; ctx.globalAlpha = 0.8; ctx.fillText('האובססיה של', W / 2, cy - 96); ctx.globalAlpha = 1;
    ctx.save(); ctx.shadowColor = 'rgba(255,255,255,.5)'; ctx.shadowBlur = 24;
    fit(ctx, data.name, 700, 200, 700, 'Karantina', 80); ctx.fillText(data.name, W / 2, cy + 62);
    ctx.restore();
    ctx.fillStyle = '#ffb547';
    let os = fit(ctx, data.obsession, 700, 66, 700, 'Rubik', 40);
    let olines = wrap(ctx, data.obsession, 700);
    if (olines.length > 1) { os = 50; ctx.font = `700 ${os}px Rubik`; olines = wrap(ctx, data.obsession, 720).slice(0, 2); }
    olines.forEach((ln, i) => ctx.fillText(ln, W / 2, cy + 140 + i * (os + 8)));

    // ציטוט של נוגה
    ctx.fillStyle = '#f4efe6';
    ctx.font = '300 44px Rubik';
    const ql = wrap(ctx, `"${data.line}"`, 820).slice(0, 3);
    const qy = 1215;
    ql.forEach((ln, i) => ctx.fillText(ln, W / 2, qy + i * 58));
    ctx.font = '400 28px Rubik'; ctx.globalAlpha = 0.65;
    ctx.fillText('נוגה, השומרת של המצפור', W / 2, qy + ql.length * 58 + 12); ctx.globalAlpha = 1;

    stamp(ctx, 150, 650, data.word);

    // פרטי האירוע
    const details = [ev.date, ev.doors, ev.location].filter(Boolean).join('  ·  ');
    let dy = 1432;
    ctx.fillStyle = '#f4efe6';
    if (details) { fit(ctx, details, W - 140, 46, 700, 'Rubik'); ctx.fillText(details, W / 2, dy); dy += 58; }
    else { ctx.font = '700 44px Rubik'; ctx.fillText('תאריך ומיקום · בקרוב', W / 2, dy); dy += 58; }
    if (ev.lineup && ev.lineup.length) {
      ctx.font = '400 32px Rubik'; ctx.globalAlpha = 0.85;
      // שבירת שורה רק בין שמות, לא באמצע שם
      const lines = []; let cur = '';
      for (const name of ev.lineup) {
        const t = cur ? cur + '  ·  ' + name : name;
        if (cur && ctx.measureText(t).width > 680) { lines.push(cur); cur = name; } else cur = t;
      }
      if (cur) lines.push(cur);
      lines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, W / 2, dy + i * 44));
      ctx.globalAlpha = 1;
    }

    // שורת שיחה
    ctx.font = '400 24px Rubik'; ctx.globalAlpha = 0.6; ctx.fillStyle = '#ffffff';
    ctx.fillText(`שיחה מס׳ ${data.callNo}  ·  ${data.duration}`, W / 2 + 160, H - 46);
    ctx.globalAlpha = 1;
  }

  function toBlob(canvas) { return new Promise(res => canvas.toBlob(res, 'image/png')); }

  return { draw, toBlob };
})();
