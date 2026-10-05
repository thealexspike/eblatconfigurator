import { json, readJson, requireUser, nowIso } from '../../_shared/auth.js';
import { toJsonText } from '../../_shared/projects.js';

// PATCH /api/projects/:id — body: { elements, groups, manual_layout_positions } (salvarea automată)
export async function onRequestPatch(context) {
  const denied = requireUser(context);
  if (denied) return denied;

  const body = await readJson(context.request);
  if (!body || !Array.isArray(body.elements)) return json({ error: 'Date de proiect invalide' }, 400);

  const now = nowIso();
  const result = await context.env.DB.prepare(
    `UPDATE projects SET elements = ?1, groups = ?2, manual_layout_positions = ?3, updated_at = ?4
     WHERE id = ?5 AND user_id = ?6`
  ).bind(
    JSON.stringify(body.elements), toJsonText(body.groups), toJsonText(body.manual_layout_positions),
    now, context.params.id, context.data.user.id
  ).run();

  if (!result.meta.changes) return json({ error: 'Proiect inexistent' }, 404);
  return json({ ok: true, updated_at: now });
}

// DELETE /api/projects/:id
export async function onRequestDelete(context) {
  const denied = requireUser(context);
  if (denied) return denied;

  await context.env.DB.prepare('DELETE FROM projects WHERE id = ?1 AND user_id = ?2')
    .bind(context.params.id, context.data.user.id).run();
  return json({ ok: true });
}
