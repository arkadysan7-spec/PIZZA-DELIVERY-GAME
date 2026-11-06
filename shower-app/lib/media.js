// Image post-processing + optional cloud upload. Both dependencies are optional at runtime.

let sharpMod;
async function getSharp() {
  if (sharpMod === undefined) {
    try { sharpMod = (await import('sharp')).default; } catch { sharpMod = null; }
  }
  return sharpMod;
}

/** Re-encode to JPEG (keeps the response under Vercel's 4.5MB limit). */
export async function toJpeg(buf, { quality = 90, maxSide = 0 } = {}) {
  const sharp = await getSharp();
  if (!sharp) return null;
  let img = sharp(buf, { failOn: 'none' }).rotate();
  if (maxSide) img = img.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  return img.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
}

export function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Upload to Vercel Blob (public, random suffix). Returns URL or null. */
export async function uploadPublic(pathname, buf, contentType) {
  if (!blobEnabled()) return null;
  try {
    const { put } = await import('@vercel/blob');
    const r = await put(pathname, buf, { access: 'public', contentType, addRandomSuffix: true });
    return r.url;
  } catch (e) {
    console.error('blob upload failed', e);
    return null;
  }
}
