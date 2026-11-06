import test from 'node:test';
import assert from 'node:assert/strict';
import { extractGlassThickness, extractDimensions, extractFinishes, guessType, normalizeProduct } from '../lib/extract.js';
import { buildPrompt, normalizeSpec } from '../lib/prompt.js';
import { nearestRatio } from '../lib/providers.js';

test('glass thickness (Hebrew)', () => {
  assert.deepEqual(extractGlassThickness('זכוכית מחוסמת בעובי 8 מ"מ'), [8]);
  assert.deepEqual(extractGlassThickness('עובי זכוכית: 6/8 מ״מ'), [6, 8]);
  assert.deepEqual(extractGlassThickness('10mm glass panel'), [10]);
  assert.deepEqual(extractGlassThickness('מידות 80 ס"מ'), []);
});

test('dimensions', () => {
  assert.deepEqual(extractDimensions('מקלחון 90x90x195'), { widthCm: { min: 90, max: 90 }, heightCm: { min: 195, max: 195 } });
  assert.deepEqual(extractDimensions('רוחב 80-120 ס"מ, גובה 200 ס"מ').widthCm, { min: 80, max: 120 });
  assert.deepEqual(extractDimensions('רוחב 80-120 ס"מ, גובה 200 ס"מ').heightCm, { min: 200, max: 200 });
});

test('finishes + type', () => {
  assert.deepEqual(extractFinishes('פרזול בגימור שחור מט / כרום / ניקל מוברש'), ['black_matte', 'chrome', 'nickel']);
  assert.equal(guessType('מקלחון Walk-in מחיצה קבועה'), 'walkin');
  assert.equal(guessType('מקלחון פינתי 90X90'), 'corner');
  const p = normalizeProduct({ name: 'חזית לנישה', url: 'https://x.co/p', images: ['https://x.co/a.jpg'], text: 'זכוכית 8 מ"מ שחור' });
  assert.equal(p.type, 'niche');
  assert.deepEqual(p.finishes, ['black_matte']);
  assert.equal(p.glassThicknessGuessed, false);
});

test('prompt contains the hardware spec', () => {
  const spec = normalizeSpec({ layout: 'fixed_door', fixing: 'wall_angles', stabilizer: 'wall', finish: 'nickel', widthCm: 130, doorWidthCm: 60, glassMm: 8 });
  const p = buildPrompt(spec, { hasProductImage: true });
  assert.match(p, /TWO small 90° wall-to-glass angle clamps/);
  assert.match(p, /4x4 cm/);
  assert.match(p, /brushed nickel/);
  assert.match(p, /Fixed glass panel 70 cm/);
  assert.match(p, /Image 3/);
  assert.match(p, /toilet/);
  const u = buildPrompt(normalizeSpec({ layout: 'fixed', fixing: 'u_wall_floor', walls: 'marble' }));
  assert.match(u, /10x10 mm \(1x1 cm\)/);
  assert.match(u, /re-clad all visible walls/);
  assert.doesNotMatch(u, /Image 3/);
});

test('spec sanitising', () => {
  const s = normalizeSpec({ layout: 'evil', widthCm: 99999, finish: 'x', notes: 'a'.repeat(1000) });
  assert.equal(s.layout, 'fixed_door');
  assert.equal(s.widthCm, 300);
  assert.equal(s.finish, 'black_matte');
  assert.equal(s.notes.length, 400);
});

test('aspect ratio mapping', () => {
  assert.equal(nearestRatio(1536, 2048), '3:4');
  assert.equal(nearestRatio(2048, 1152), '16:9');
  assert.equal(nearestRatio(1000, 1000), '1:1');
});
