import { json, requireAdmin } from '../../_shared/auth.js';

const MAX_TEXTURE_BYTES = 10 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// POST /api/textures?name=<nume culoare> — body: imaginea; doar administratorii.
// Răspunde cu adresa publică a texturii, care se ține în librărie.
export async function onRequestPost(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;

  const { env, request } = context;
  if (!env.FILES) return json({ error: 'Stocarea de fișiere nu este configurată' }, 500);

  const contentType = (request.headers.get('Content-Type') || '').split(';')[0];
  const ext = TYPES[contentType];
  if (!ext) return json({ error: 'Format de imagine neacceptat (JPG, PNG sau WebP)' }, 415);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_TEXTURE_BYTES) {
    return json({ error: 'Imaginea este prea mare (maxim 10 MB)' }, 413);
  }

  const slug = (new URL(request.url).searchParams.get('name') || 'textura')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'textura';
  const file = `${slug}-${Date.now()}.${ext}`;
  await env.FILES.put(`textures/${file}`, bytes, { metadata: { contentType } });

  return json({ url: `/api/textures/${file}` }, 201);
}
