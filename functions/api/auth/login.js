import {
  json, readJson, verifyPassword, createSession, sessionCookie, normalizeEmail, publicUser, nowIso,
} from '../../_shared/auth.js';

// POST /api/auth/login
export async function onRequestPost(context) {
  const { env } = context;
  const body = await readJson(context.request);
  const email = normalizeEmail(body?.email);
  const password = body?.password || '';

  const user = await env.DB.prepare(
    'SELECT id, email, name, phone, is_admin, password_hash FROM users WHERE email = ?1'
  ).bind(email).first();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: 'Email sau parolă greșită' }, 401);
  }

  await env.DB.prepare('UPDATE users SET last_login = ?1 WHERE id = ?2')
    .bind(nowIso(), user.id).run();

  const { token } = await createSession(env.DB, user.id);
  return json({ user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(token) });
}
