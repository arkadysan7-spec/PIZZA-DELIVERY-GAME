// Fallback catalog used until CATALOG_URL is set (or when scraping finds nothing). Shared by server and client.
export const DEMO_CATALOG = [
  {
    id: 'demo-walkin', name: 'Walk-in מחיצה קבועה – הדגמה', url: null, images: ['demo/walkin.svg'], type: 'walkin',
    dimensions: { widthCm: { min: 60, max: 140 }, heightCm: { min: 200, max: 200 } },
    glassThicknessMm: [8, 10], finishes: ['black_matte', 'chrome', 'nickel'], price: null,
    description: 'מחיצה קבועה עם זוויות קיר ומייצב לקיר. ללא דלת.', defaults: { layout: 'fixed', widthCm: 100 },
  },
  {
    id: 'demo-niche', name: 'חזית לנישה – קבוע + דלת – הדגמה', url: null, images: ['demo/niche.svg'], type: 'niche',
    dimensions: { widthCm: { min: 100, max: 180 }, heightCm: { min: 195, max: 195 } },
    glassThicknessMm: [6, 8], finishes: ['black_matte', 'chrome', 'nickel'], price: null,
    description: 'מחיצה קבועה + דלת על צירים זכוכית-זכוכית, פרופיל U 1x1 ס"מ.', defaults: { layout: 'fixed_door', widthCm: 130, doorWidthCm: 60, fixing: 'u_wall' },
  },
  {
    id: 'demo-door', name: 'דלת בלבד לנישה – הדגמה', url: null, images: ['demo/door.svg'], type: 'door',
    dimensions: { widthCm: { min: 60, max: 100 }, heightCm: { min: 195, max: 195 } },
    glassThicknessMm: [8], finishes: ['black_matte', 'chrome', 'nickel'], price: null,
    description: 'דלת זכוכית על צירי קיר-זכוכית.', defaults: { layout: 'door', widthCm: 80, doorWidthCm: 80 },
  },
];
