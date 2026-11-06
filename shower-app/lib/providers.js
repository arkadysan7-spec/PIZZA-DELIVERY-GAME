// Image-model providers. Each takes { prompt, images: [{mime, data(base64)}], aspect } and
// returns { mime, data(base64), model }.

const GEMINI_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

export function availableProviders() {
  const list = [];
  if (process.env.GEMINI_API_KEY) list.push({ id: 'gemini', label: 'Nano Banana Pro (Gemini)', model: geminiModel() });
  if (process.env.OPENAI_API_KEY) list.push({ id: 'openai', label: 'GPT Image (OpenAI)', model: openaiModel() });
  return list;
}

const geminiModel = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';
const openaiModel = () => process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5';

export function nearestRatio(w, h, ratios = GEMINI_RATIOS) {
  const r = w / h;
  let best = ratios[0], bestErr = Infinity;
  for (const s of ratios) {
    const [a, b] = s.split(':').map(Number);
    const err = Math.abs(Math.log(r / (a / b)));
    if (err < bestErr) { bestErr = err; best = s; }
  }
  return best;
}

export async function renderWith(providerId, args) {
  if (providerId === 'gemini') return gemini(args);
  if (providerId === 'openai') return openai(args);
  throw new Error(`unknown provider ${providerId}`);
}

async function gemini({ prompt, images, width, height }) {
  const model = geminiModel();
  const body = {
    contents: [{
      role: 'user',
      parts: [
        ...images.map((img, i) => [
          { text: `Image ${i + 1}:` },
          { inline_data: { mime_type: img.mime, data: img.data } },
        ]).flat(),
        { text: prompt },
      ],
    }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: nearestRatio(width, height), imageSize: process.env.GEMINI_IMAGE_SIZE || '2K' },
    },
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw providerError('Gemini', res.status, data?.error?.message);
  const cand = data.candidates?.[0];
  const part = cand?.content?.parts?.find((p) => p.inlineData || p.inline_data);
  const inline = part?.inlineData || part?.inline_data;
  if (!inline) {
    const reason = cand?.finishReason || data.promptFeedback?.blockReason || 'no image returned';
    throw providerError('Gemini', 502, `המודל לא החזיר תמונה (${reason})`);
  }
  return { mime: inline.mimeType || inline.mime_type || 'image/png', data: inline.data, model };
}

async function openai({ prompt, images, width, height }) {
  const model = openaiModel();
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('quality', process.env.OPENAI_IMAGE_QUALITY || 'high');
  let size = process.env.OPENAI_IMAGE_SIZE || 'auto';
  if (size === 'auto') size = width >= height * 1.15 ? '1536x1024' : height >= width * 1.15 ? '1024x1536' : '1024x1024';
  form.append('size', size);
  if (!/^gpt-image-1-mini/.test(model)) form.append('input_fidelity', 'high');
  images.forEach((img, i) => {
    const ext = img.mime.split('/')[1] || 'jpg';
    form.append('image[]', new Blob([Buffer.from(img.data, 'base64')], { type: img.mime }), `image-${i + 1}.${ext}`);
  });
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw providerError('OpenAI', res.status, data?.error?.message);
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw providerError('OpenAI', 502, 'המודל לא החזיר תמונה');
  return { mime: `image/${data.output_format || 'png'}`, data: b64, model };
}

function providerError(name, status, message) {
  const e = new Error(`${name}: ${message || `HTTP ${status}`}`);
  e.status = status === 429 ? 429 : 502;
  return e;
}
