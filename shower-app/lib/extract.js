// Pull structured shower-enclosure attributes out of free Hebrew/English product text.

export const FINISHES = {
  black_matte: { he: 'שחור מט', color: '#1b1b1b', en: 'matte black' },
  chrome: { he: 'כרום', color: '#d4d7dc', en: 'polished chrome' },
  nickel: { he: 'ניקל', color: '#b3ab9c', en: 'brushed nickel' },
  gold: { he: 'זהב', color: '#c9a65a', en: 'brushed gold' },
  brushed_steel: { he: 'נירוסטה מוברשת', color: '#a9adb2', en: 'brushed stainless steel' },
  white: { he: 'לבן', color: '#f2f2f2', en: 'matte white' },
};
export const DEFAULT_FINISHES = ['black_matte', 'chrome', 'nickel'];

const FINISH_PATTERNS = [
  ['black_matte', /שחור|black/i],
  ['chrome', /כרום|chrome|chrom/i],
  ['nickel', /ניקל|nickel/i],
  ['gold', /זהב|gold|ברונזה|bronze/i],
  ['brushed_steel', /נירוסט|stainless|inox/i],
  ['white', /\bלבן\b|white/i],
];

export function stripHtml(html = '') {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8221;|&#8220;|&rdquo;|&ldquo;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function extractFinishes(text) {
  const found = [];
  for (const [key, re] of FINISH_PATTERNS) if (re.test(text) && !found.includes(key)) found.push(key);
  return found;
}

const MM = String.raw`(?:מ["״'׳]?מ|מילימטר|mm)`;

export function extractGlassThickness(text) {
  const out = new Set();
  // "עובי זכוכית 8 מ"מ", "זכוכית 6/8 מ"מ", "8mm glass", "זכוכית מחוסמת 10 מ״מ"
  const near = new RegExp(String.raw`(?:עובי|זכוכית|glass|thickness)[^\n\d]{0,25}((?:\d{1,2}(?:\.\d)?\s*(?:[\/,\-]|או)\s*)*\d{1,2}(?:\.\d)?)\s*${MM}`, 'gi');
  const after = new RegExp(String.raw`(\d{1,2}(?:\.\d)?)\s*${MM}[^\n]{0,15}(?:זכוכית|glass)`, 'gi');
  for (const re of [near, after]) {
    for (const m of text.matchAll(re)) {
      for (const n of m[1].split(/[\/,\-]|או/)) {
        const v = parseFloat(n);
        if (v >= 4 && v <= 12) out.add(v);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function extractDimensions(text) {
  const dims = {};
  const range = String.raw`(\d{2,3})(?:\s*[-–עד]+\s*(\d{2,3}))?`;
  const w = text.match(new RegExp(String.raw`(?:רוחב|width|מידה)[^\d\n]{0,12}${range}`, 'i'));
  const h = text.match(new RegExp(String.raw`(?:גובה|height)[^\d\n]{0,12}${range}`, 'i'));
  if (w) dims.widthCm = toRange(w[1], w[2]);
  if (h) dims.heightCm = toRange(h[1], h[2]);
  // "80x190", "90X90X195", "120*200"
  const box = text.match(/\b(\d{2,3})\s*[x×X*]\s*(\d{2,3})(?:\s*[x×X*]\s*(\d{2,3}))?\b/);
  if (box) {
    const nums = [box[1], box[2], box[3]].filter(Boolean).map(Number);
    const tall = nums.filter((n) => n >= 170 && n <= 260);
    const wide = nums.filter((n) => n >= 30 && n < 170);
    if (!dims.heightCm && tall.length) dims.heightCm = { min: tall[0], max: tall[0] };
    if (!dims.widthCm && wide.length) dims.widthCm = { min: Math.min(...wide), max: Math.max(...wide) };
    if (wide.length === 2 && wide[0] !== wide[1]) dims.depthCm = { min: wide[1], max: wide[1] };
  }
  if (dims.widthCm && dims.widthCm.min < 30) delete dims.widthCm;
  return dims;
}

function toRange(a, b) {
  const x = Number(a), y = b ? Number(b) : Number(a);
  return { min: Math.min(x, y), max: Math.max(x, y) };
}

export function guessType(text) {
  const t = text.toLowerCase();
  if (/walk[\s-]?in|ווקאין|וואק אין|מחיצה קבועה|מחיצה בלבד/.test(t)) return 'walkin';
  if (/פינתי|פינה|corner|מרובע|ריבועי/.test(t)) return 'corner';
  if (/מחומש|pentagon/.test(t)) return 'pentagon';
  if (/נישה|niche|חזית/.test(t)) return 'niche';
  if (/דלת|door/.test(t)) return 'door';
  return 'other';
}

export const TYPE_LABELS = {
  walkin: 'Walk-in / מחיצה קבועה',
  niche: 'חזית לנישה',
  corner: 'פינתי',
  pentagon: 'מחומש',
  door: 'דלת',
  other: 'אחר',
};

/** Normalise a raw product {name, url, images, text, attributes} into our catalog shape. */
export function normalizeProduct(raw) {
  const text = [raw.name, raw.text, ...(raw.attributes || []).map((a) => `${a.name}: ${a.values.join(', ')}`)].join('\n');
  const finishes = extractFinishes(text);
  const glass = extractGlassThickness(text);
  return {
    id: String(raw.id || raw.url || raw.name),
    name: raw.name?.trim() || 'מוצר ללא שם',
    url: raw.url || null,
    images: [...new Set((raw.images || []).filter((u) => /^https?:\/\//.test(u)))].slice(0, 8),
    type: guessType(`${raw.name} ${raw.categories || ''} ${text.slice(0, 400)}`),
    dimensions: extractDimensions(text),
    glassThicknessMm: glass.length ? glass : [8],
    glassThicknessGuessed: !glass.length,
    finishes: finishes.length ? finishes : DEFAULT_FINISHES,
    finishesGuessed: !finishes.length,
    price: raw.price || null,
    description: (raw.text || '').slice(0, 600),
  };
}
