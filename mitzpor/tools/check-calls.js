#!/usr/bin/env node
// בודק את השיחות שנשמרו (LOG_CALLS=1) ומחפש בעיות: שאלה שחוזרת, מונולוגים, חריגה מדקה, שתיקות, שיחות שלא נסגרו כמו שצריך.
// שימוש: node tools/check-calls.js [data/calls.jsonl]
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'data', 'calls.jsonl');
if (!fs.existsSync(file)) { console.log('אין קובץ שיחות:', file, '\nצריך להריץ את השרת עם LOG_CALLS=1'); process.exit(0); }

const calls = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const norm = (s) => s.replace(/[֑-ׇ]/g, '').replace(/[^א-תa-z0-9\s]/gi, ' ').toLowerCase().split(/\s+/).filter(w => w.length > 1);

const totals = {};
const bump = (k) => { totals[k] = (totals[k] || 0) + 1; };

for (const c of calls) {
  const problems = [];
  const noga = (c.transcript || []).filter(x => x.who === 'noga');
  const player = (c.transcript || []).filter(x => x.who === 'player');

  // שאלות שחוזרות (גם אם הלקוח לא תפס בזמן אמת)
  const qs = [];
  for (const line of noga) {
    for (const q of line.text.split(/(?<=\?)/).filter(x => x.includes('?'))) {
      const w = new Set(norm(q));
      if (w.size < 2) continue;
      const dup = qs.find(p => { const i = [...w].filter(x => p.w.has(x)).length; return i / (w.size + p.w.size - i) >= 0.5; });
      if (dup) problems.push(`שאלה חוזרת: "${q.trim()}" (קודם: "${dup.q.trim()}")`);
      qs.push({ q, w });
    }
  }
  for (const line of noga) {
    const n = line.text.split(/\s+/).length;
    if (n > 40) problems.push(`מונולוג של ${n} מילים ב-${line.t}s`);
  }
  if (c.duration > 66) problems.push(`חריגה: ${c.duration}s`);
  if (!['end_call', 'end_call_timeout'].includes(c.reason)) problems.push(`נסגרה בגלל: ${c.reason}`);
  if (!c.state || !c.state.name) problems.push('לא נקלט שם (remember לא נקרא)');
  if (!c.endData) problems.push('end_call לא נקרא, הפוסטר נבנה מברירות מחדל');
  if (c.firstAudioAt > 1.8) problems.push(`פתיחה איטית: הקול שלה התחיל רק ב-${c.firstAudioAt}s אחרי המענה`);
  if (player.length === 0) problems.push('השחקן לא אמר כלום (או שהתמלול כבוי)');
  for (const f of c.flags || []) if (f.type !== 'player_hung_up') bump(f.type);
  problems.forEach(p => bump(p.split(':')[0].replace(/ של \d+.*/, '').replace(/ ב-.*/, '')));

  console.log(`\n── ${c.at || ''}  ${c.callId ? c.callId.slice(-8) : ''}  ${c.duration}s  ${c.reason}  ${c.state && c.state.name ? c.state.name : ''}`);
  if (problems.length) problems.forEach(p => console.log('  ✗', p));
  else console.log('  ✓ נקי');
}

console.log(`\n══ ${calls.length} שיחות`);
Object.entries(totals).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}× ${k}`));
