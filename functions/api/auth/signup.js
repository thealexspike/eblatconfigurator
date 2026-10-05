import {
  json, readJson, uuid, hashPassword, createSession, sessionCookie,
  normalizeEmail, validCredentials, nowIso, publicUser,
} from '../../_shared/auth.js';

// POST /api/auth/signup — înregistrare publică; contul nou nu este niciodată
// administrator (emailul nu se verifică, deci domeniul lui nu dovedește nimic).
export async function onRequestPost(context) {
  const { env } = context;
  const body = await readJson(context.request);
  const email = normalizeEmail(body?.email);
  const password = body?.password || '';
  const name = String(body?.name || '').trim().slice(0, 200) || null;

  const invalid = validCredentials(email, password);
  if (invalid) return json({ error: invalid }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first();
  if (existing) return json({ error: 'Există deja un cont cu acest email' }, 409);

  const id = uuid();
  const now = nowIso();
  const passwordHash = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, created_at, last_login)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)`
  ).bind(id, email, name, passwordHash, now).run();

  const { token } = await createSession(env.DB, id);
  return json(
    { user: publicUser({ id, email, name, phone: null, is_admin: 0 }) },
    200,
    { 'Set-Cookie': sessionCookie(token) }
  );
}
