export const MAX_PROJECTS = 30;

const parse = (text, fallback) => {
  if (text == null) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

// Rândul din D1 → forma pe care o așteaptă aplicația
export function projectFromRow(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    elements: parse(row.elements, []),
    groups: parse(row.groups, null),
    manual_layout_positions: parse(row.manual_layout_positions, null),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const toJsonText = (value) => (value == null ? null : JSON.stringify(value));
