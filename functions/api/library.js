import { json, readJson, requireUser, requireAdmin, nowIso } from '../_shared/auth.js';

const FIELDS = ['material_types', 'manufacturers', 'colors', 'formats', 'induction_systems'];

// GET /api/library — librăria de materiale (null până o salvează prima dată un administrator)
export async function onRequestGet(context) {
  const denied = requireUser(context);
  if (denied) return denied;

  const row = await context.env.DB.prepare("SELECT * FROM library WHERE id = 'main'").first();
  if (!row) return json({ library: null });

  const library = { updated_at: row.updated_at };
  for (const f of FIELDS) {
    try {
      library[f] = row[f] == null ? null : JSON.parse(row[f]);
    } catch {
      library[f] = null;
    }
  }
  return json({ library });
}

// PUT /api/library — doar administratorii
export async function onRequestPut(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;

  const body = await readJson(context.request);
  // un câmp lipsă se ține NULL, iar aplicația îl completează cu valorile implicite
  if (!body || FIELDS.some(f => body[f] != null && !Array.isArray(body[f]))) {
    return json({ error: 'Date de librărie invalide' }, 400);
  }

  const now = nowIso();
  await context.env.DB.prepare(
    `INSERT INTO library (id, material_types, manufacturers, colors, formats, induction_systems, updated_at)
     VALUES ('main', ?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(id) DO UPDATE SET
       material_types = excluded.material_types, manufacturers = excluded.manufacturers,
       colors = excluded.colors, formats = excluded.formats,
       induction_systems = excluded.induction_systems, updated_at = excluded.updated_at`
  ).bind(...FIELDS.map(f => (body[f] == null ? null : JSON.stringify(body[f]))), now).run();

  return json({ ok: true, updated_at: now });
}
