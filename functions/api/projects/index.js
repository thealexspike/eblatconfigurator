import { json, readJson, requireUser, uuid, nowIso } from '../../_shared/auth.js';
import { MAX_PROJECTS, projectFromRow, toJsonText } from '../../_shared/projects.js';

// GET /api/projects — proiectele contului, cele mai recente primele
export async function onRequestGet(context) {
  const denied = requireUser(context);
  if (denied) return denied;

  const { results } = await context.env.DB.prepare(
    'SELECT * FROM projects WHERE user_id = ?1 ORDER BY updated_at DESC'
  ).bind(context.data.user.id).all();
  return json({ projects: results.map(projectFromRow) });
}

// POST /api/projects — body: { name, description, elements, groups, manual_layout_positions }
export async function onRequestPost(context) {
  const denied = requireUser(context);
  if (denied) return denied;

  const { env } = context;
  const userId = context.data.user.id;
  const body = await readJson(context.request);
  const name = String(body?.name || '').trim().slice(0, 200);
  if (!name) return json({ error: 'Numele proiectului lipsește' }, 400);

  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?1')
    .bind(userId).first();
  if (n >= MAX_PROJECTS) return json({ error: `Limită atinsă: maxim ${MAX_PROJECTS} de proiecte.` }, 409);

  const now = nowIso();
  const row = {
    id: uuid(),
    user_id: userId,
    name,
    description: body.description ? String(body.description).slice(0, 2000) : null,
    elements: JSON.stringify(Array.isArray(body.elements) ? body.elements : []),
    groups: toJsonText(body.groups),
    manual_layout_positions: toJsonText(body.manual_layout_positions),
    created_at: now,
    updated_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO projects (id, user_id, name, description, elements, groups, manual_layout_positions, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`
  ).bind(row.id, row.user_id, row.name, row.description, row.elements, row.groups, row.manual_layout_positions, now).run();

  return json({ project: projectFromRow(row) }, 201);
}
