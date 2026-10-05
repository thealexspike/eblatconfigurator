import { json, readJson, requireUser } from '../../_shared/auth.js';

// GET /api/auth/me — contul sesiunii curente (null dacă nu e autentificat)
export async function onRequestGet(context) {
  return json({ user: context.data.user });
}

// PATCH /api/auth/me — body: { phone }
export async function onRequestPatch(context) {
  const denied = requireUser(context);
  if (denied) return denied;

  const body = await readJson(context.request);
  const phone = String(body?.phone || '').trim().slice(0, 40) || null;
  await context.env.DB.prepare('UPDATE users SET phone = ?1 WHERE id = ?2')
    .bind(phone, context.data.user.id).run();
  return json({ user: { ...context.data.user, phone } });
}
