// צלילים מסונתזים: צלצול, הרמה, ניתוק, ורוח על המצפור. בלי קבצים.
'use strict';

const SFX = (() => {
  let ctx = null, master = null, ringTimer = null, wind = null;

  function unlock() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function note(freq, at, dur, vol = 0.18, type = 'sine') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(master);
    o.start(at); o.stop(at + dur + 0.05);
  }

  // רינגטון: ארפג׳ מינורי קצר, חוזר. קצת אובססיבי בכוונה.
  function ringOnce() {
    const t = ctx.currentTime + 0.02;
    const seq = [659.25, 783.99, 987.77, 1318.5, 987.77, 783.99];
    seq.forEach((f, i) => { note(f, t + i * 0.11, 0.5, 0.13, 'triangle'); note(f * 2, t + i * 0.11, 0.25, 0.03); });
    const t2 = t + 0.9;
    seq.forEach((f, i) => { note(f, t2 + i * 0.11, 0.5, 0.13, 'triangle'); note(f * 2, t2 + i * 0.11, 0.25, 0.03); });
  }

  function startRing() {
    unlock(); stopRing();
    ringOnce();
    ringTimer = setInterval(ringOnce, 2600);
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 1600, 400, 200, 400, 1600, 400, 200, 400]);
  }
  function stopRing() {
    if (ringTimer) clearInterval(ringTimer);
    ringTimer = null;
    if (navigator.vibrate) navigator.vibrate(0);
  }

  function pickup() {
    unlock();
    const t = ctx.currentTime + 0.01;
    note(1200, t, 0.05, 0.12, 'square');
    note(800, t + 0.06, 0.08, 0.08, 'square');
  }

  // צליל ניתוק ישראלי: ביפים קצרים
  function hangupTone() {
    unlock();
    const t = ctx.currentTime + 0.05;
    for (let i = 0; i < 3; i++) note(425, t + i * 0.4, 0.22, 0.12, 'sine');
  }

  // רוח: רעש לבן דרך מסנן שזז לאט. שקט מאוד בכוונה, כדי שהמיקרופון לא ייקח אותו כדיבור.
  function startWind(level = 0.035) {
    unlock();
    if (wind) return;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.7;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 260;
    lfo.connect(lfoGain); lfoGain.connect(bp.frequency);
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.linearRampToValueAtTime(level, ctx.currentTime + 2.5);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(); lfo.start();
    wind = { src, lfo, g };
  }
  function duckWind(on) {
    if (!wind) return;
    const now = ctx.currentTime;
    wind.g.gain.cancelScheduledValues(now);
    wind.g.gain.setTargetAtTime(on ? 0.006 : 0.035, now, 0.3);
  }
  function stopWind() {
    if (!wind) return;
    const w = wind; wind = null;
    w.g.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    setTimeout(() => { try { w.src.stop(); w.lfo.stop(); } catch {} }, 1500);
  }

  return { unlock, startRing, stopRing, pickup, hangupTone, startWind, duckWind, stopWind, get ctx() { return ctx; } };
})();
