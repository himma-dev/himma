CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  child_name TEXT DEFAULT 'الطفل',
  prefs TEXT DEFAULT '{}',
  nextdns_profile TEXT,
  nextdns_key_enc TEXT,
  last_log_ts INTEGER DEFAULT 0,
  tg_link_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_chats (
  family_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  PRIMARY KEY (family_id, chat_id)
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  paused INTEGER DEFAULT 0,
  msg_text TEXT,
  msg_until INTEGER DEFAULT 0,
  last_seen INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_family ON devices (family_id);
CREATE TABLE IF NOT EXISTS pairings (
  code TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  type TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed INTEGER DEFAULT 0,
  device_token TEXT,
  device_name TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  device_name TEXT,
  domain TEXT,
  kind TEXT,
  reason TEXT,
  dkey TEXT,
  acked INTEGER DEFAULT 0,
  reminded INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_family_ts ON events (family_id, ts);
