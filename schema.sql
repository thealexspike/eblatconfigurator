-- e-blat configurator — schema D1 (SQLite)
-- Totul e CREATE ... IF NOT EXISTS: fișierul se poate rula la fiecare deploy
-- fără să atingă datele.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  -- administratorii editează librăria de materiale; steagul se pune manual
  -- în D1 (UPDATE users SET is_admin = 1 WHERE email = ...), nu se deduce
  -- din domeniul emailului
  is_admin INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  -- JSON, în forma în care le ține aplicația
  elements TEXT NOT NULL DEFAULT '[]',
  groups TEXT,
  manual_layout_positions TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Librăria de materiale: un singur rând, id = 'main'
CREATE TABLE IF NOT EXISTS library (
  id TEXT PRIMARY KEY,
  material_types TEXT,
  manufacturers TEXT,
  colors TEXT,
  formats TEXT,
  induction_systems TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
