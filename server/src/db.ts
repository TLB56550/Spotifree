import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type DB = DatabaseSync;

const SCHEMA_V1 = `
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE covers (
  key  TEXT PRIMARY KEY,
  mime TEXT NOT NULL
);

CREATE TABLE artists (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  key    TEXT NOT NULL UNIQUE,
  search TEXT NOT NULL
);

CREATE TABLE albums (
  id        INTEGER PRIMARY KEY,
  title     TEXT NOT NULL,
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  key       TEXT NOT NULL UNIQUE,
  year      INTEGER,
  cover_key TEXT,
  search    TEXT NOT NULL,
  added_at  INTEGER NOT NULL
);
CREATE INDEX idx_albums_artist ON albums(artist_id);
CREATE INDEX idx_albums_added  ON albums(added_at);

CREATE TABLE tracks (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  mtime       INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL,
  album_id    INTEGER NOT NULL REFERENCES albums(id),
  artist_id   INTEGER NOT NULL REFERENCES artists(id),
  track_no    INTEGER,
  disc_no     INTEGER,
  year        INTEGER,
  genre       TEXT,
  duration    REAL NOT NULL DEFAULT 0,
  format      TEXT NOT NULL DEFAULT '',
  bitrate     INTEGER,
  cover_key   TEXT,
  search      TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  play_count  INTEGER NOT NULL DEFAULT 0,
  last_played INTEGER
);
CREATE INDEX idx_tracks_album  ON tracks(album_id);
CREATE INDEX idx_tracks_artist ON tracks(artist_id);
CREATE INDEX idx_tracks_added  ON tracks(added_at);
CREATE INDEX idx_tracks_genre  ON tracks(genre);

CREATE TABLE playlists (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE playlist_tracks (
  id          INTEGER PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  added_at    INTEGER NOT NULL
);
CREATE INDEX idx_pt_playlist ON playlist_tracks(playlist_id, position);
CREATE INDEX idx_pt_track    ON playlist_tracks(track_id);

CREATE TABLE favorites (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL
);

CREATE TABLE plays (
  id        INTEGER PRIMARY KEY,
  track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL
);
CREATE INDEX idx_plays_time ON plays(played_at);
`;

const SCHEMA_V2 = `
CREATE TABLE devices (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
`;

const SCHEMA_V3 = `
CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  pass_hash   TEXT NOT NULL,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  must_change INTEGER NOT NULL DEFAULT 0,
  disabled    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER
);

CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

DROP TABLE devices;

-- Écoutes par personne (le compteur global de tracks n'est plus utilisé).
CREATE TABLE user_tracks (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  play_count  INTEGER NOT NULL DEFAULT 0,
  last_played INTEGER,
  PRIMARY KEY (user_id, track_id)
);

-- Les données existantes gardent user_id NULL jusqu'à la création du premier administrateur, qui les reprend.
ALTER TABLE playlists ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX idx_playlists_user ON playlists(user_id);

ALTER TABLE plays ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE favorites_v3 (
  user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  UNIQUE (user_id, track_id)
);
INSERT INTO favorites_v3 (user_id, track_id, added_at) SELECT NULL, track_id, added_at FROM favorites;
DROP TABLE favorites;
ALTER TABLE favorites_v3 RENAME TO favorites;
`;

export function openDb(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'library.db'));
  db.exec(
    'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
  );
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (row.user_version < 1) {
    tx(db, () => {
      db.exec(SCHEMA_V1);
      db.exec('PRAGMA user_version = 1');
    });
  }
  if (row.user_version < 2) {
    tx(db, () => {
      db.exec(SCHEMA_V2);
      db.exec('PRAGMA user_version = 2');
    });
  }
  if (row.user_version < 3) {
    tx(db, () => {
      db.exec(SCHEMA_V3);
      db.exec('PRAGMA user_version = 3');
    });
  }
}

/**
 * Rattache les playlists, favoris et écoutes d'avant les comptes à une personne (à appeler dans une transaction).
 * L'ancien compteur d'écoutes global n'est repris qu'une seule fois.
 */
export function adoptLegacyData(db: DB, userId: number): void {
  db.prepare('UPDATE playlists SET user_id = ? WHERE user_id IS NULL').run(userId);
  db.prepare('UPDATE favorites SET user_id = ? WHERE user_id IS NULL').run(userId);
  db.prepare('UPDATE plays SET user_id = ? WHERE user_id IS NULL').run(userId);
  if (!getSetting<boolean>(db, 'legacy_counts_adopted', false)) {
    db.prepare(
      `INSERT OR IGNORE INTO user_tracks (user_id, track_id, play_count, last_played)
       SELECT ?, id, play_count, last_played FROM tracks WHERE play_count > 0`,
    ).run(userId);
    setSetting(db, 'legacy_counts_adopted', true);
  }
}

/** Exécute `fn` dans une transaction (pas d'`await` à l'intérieur). */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: DB, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

export function getMusicDirs(db: DB): string[] {
  return getSetting<string[]>(db, 'music_dirs', []);
}
