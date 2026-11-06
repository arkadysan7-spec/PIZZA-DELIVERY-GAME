# הדמיית מקלחונים – PWA (אב-טיפוס)

אפליקציית ווב לטלפון (עברית, RTL): מצלמים את חדר הרחצה, בוחרים מקלחון מהקטלוג של העסק, מסמנים מיקום ופרזול,
ומקבלים הדמיה פוטוריאליסטית ששולחים ללקוח בוואטסאפ. אפיון מלא: [SPEC.md](SPEC.md).

## מבנה
```
shower-app/
├─ api/            פונקציות Vercel (המפתחות רק כאן)
│  ├─ config.js    אילו ספקים מוגדרים
│  ├─ catalog.js   גריפת קטלוג מהאתר (cache 6 שעות)
│  └─ render.js    בניית פרומפט + קריאה ל-Nano Banana Pro / GPT Image
├─ lib/            גריפה, חילוץ מידות/עובי/גימור, פרומפט, ספקים
├─ public/         האפליקציה עצמה (HTML/JS בלי build), Service Worker, manifest
└─ scripts/        שרת פיתוח מקומי + בדיקות
```

## הרצה מקומית
```bash
cd shower-app
npm install
cp .env.example .env.local   # למלא מפתח אחד לפחות; בלי מפתח = מצב הדגמה (מחזיר את הסקיצה)
npm run dev                  # http://localhost:3000
npm test
```

## פריסה ל-Vercel
1. Vercel → **Add New Project** → לבחור את הריפו הזה.
2. **Root Directory:** `shower-app` · Framework Preset: **Other** · בלי Build Command.
3. **Environment Variables** (Settings → Environment Variables):

| משתנה | חובה | הסבר |
|---|---|---|
| `GEMINI_API_KEY` | אחד מהשניים | Nano Banana Pro. מ-Google AI Studio |
| `OPENAI_API_KEY` | אחד מהשניים | GPT Image |
| `APP_ACCESS_CODE` | מומלץ מאוד | קוד שמזינים פעם אחת באפליקציה (⚙). בלעדיו כל מי שיש לו את הקישור יכול לבזבז קרדיט |
| `CATALOG_URL` | לקטלוג אמיתי | כתובת האתר של העסק, למשל `https://www.example.co.il` |
| `ALLOWED_IMAGE_HOSTS` | לפעמים | אם תמונות המוצר יושבות על CDN בדומיין אחר |
| `BLOB_READ_WRITE_TOKEN` | אופציונלי | נוצר אוטומטית כשמחברים Vercel Blob (Storage → Blob). נותן קישור לתמונה בהודעת הוואטסאפ |
| `GEMINI_IMAGE_MODEL` / `OPENAI_IMAGE_MODEL` | לא | ברירות מחדל: `gemini-3-pro-image-preview`, `gpt-image-1.5` |
| `OPENAI_IMAGE_SIZE` | לא | `auto` (1024×1536 / 1536×1024). אם המודל תומך ב-2K אפשר לכתוב למשל `2048x1536` |
| `DEFAULT_PROVIDER` | לא | `gemini` או `openai` |

4. Deploy. בטלפון: לפתוח את הקישור → "הוספה למסך הבית".

> משך יצירה: 30–90 שניות. `vercel.json` מגדיר `maxDuration: 300` לפונקציית ההדמיה.

## איך זה עובד
- **מיקום:** גוררים 4 נקודות על התמונה לפינות הזכוכית. האפליקציה מציירת סקיצה (זכוכית, ציר, זוויות קיר, פרופיל U, מייצב, ידית).
- **למודל נשלחות 3 תמונות:** המקור, המקור עם הסקיצה, ותמונת המוצר מהאתר. הפרומפט (`lib/prompt.js`) מחייב אותה פרספקטיבה,
  אסלה/כיור/ברזים במקום, ותיאור פרזול מדויק. אפשר לראות את ההנחיה שנשלחה מתחת לכל הדמיה.
- **Nano Banana Pro** מקבל `imageSize: 2K` ו-aspect ratio הקרוב לתמונה המקורית. **GPT Image** רץ עם `quality=high`, `input_fidelity=high`.
- **היסטוריה:** נשמרת במכשיר (IndexedDB) לפי לקוח. לפני החלפת טלפון/מחיקת נתוני דפדפן – לייצא (שלב הבא: סנכרון ענן).
- **וואטסאפ:** "שליחה בוואטסאפ" פותח את גיליון השיתוף של הטלפון עם הקובץ עצמו; "צ׳אט עם הלקוח" פותח `wa.me` למספר של הלקוח.

## גריפת הקטלוג
סדר: Shopify (`/products.json`) → WooCommerce (`/wp-json/wc/store/v1/products`) → sitemap + JSON-LD בדפי מוצר.
מהטקסט מחולצים מידות, עובי זכוכית וגימורים. אם לא נמצא גימור – מוצעים שחור מט/כרום/ניקל (מסומן כ"משוער").
כפתור **רענון קטלוג מהאתר** בהגדרות מושך מחדש.
