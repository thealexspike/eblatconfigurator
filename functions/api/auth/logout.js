import { json, getSessionToken, sha256Hex, clearSessionCookie } from '../../_shared/auth.js';

// POST /api/auth/logout
export async function onRequestPost(context) {
  const token = getSessionToken(context.request);
  if (token) {
    await context.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1')
      .bind(await sha256Hex(token)).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}
