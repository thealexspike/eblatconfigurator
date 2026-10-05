import { json } from '../../_shared/auth.js';

// GET /api/textures/:file — publică; numele fișierelor nu se refolosesc, deci
// răspunsul poate sta în cache.
export async function onRequestGet(context) {
  const { env, params } = context;
  const { value, metadata } = env.FILES
    ? await env.FILES.getWithMetadata(`textures/${params.file}`, 'stream')
    : { value: null };
  if (!value) return json({ error: 'Imagine inexistentă' }, 404);
  return new Response(value, {
    headers: {
      'Content-Type': metadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
