import type {
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  Genre,
  HomeData,
  Playlist,
  PlaylistDetail,
  PlaylistTrack,
  SearchResults,
  Stats,
  Track,
} from '../../shared/types';
import { tx, type DB } from './db';
import { HttpError, norm } from './util';

type Params = (string | number | null)[];

const TRACK_COLS = `t.id, t.title, t.artist, t.album_id AS albumId, al.title AS album, t.artist_id AS artistId,
  ar.name AS albumArtist, t.track_no AS trackNo, t.disc_no AS discNo, t.year, t.genre, t.duration,
  COALESCE(t.cover_key, al.cover_key) AS cover, t.format, t.added_at AS addedAt, t.play_count AS playCount`;
const TRACK_FROM = `FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists ar ON ar.id = t.artist_id`;
const ALBUM_ORDER = 'ar.key, al.year, al.title, t.disc_no, t.track_no, t.title';

const ALBUM_SELECT = `SELECT al.id, al.title, ar.name AS artist, al.artist_id AS artistId, al.year,
    al.cover_key AS cover, al.added_at AS addedAt, COUNT(t.id) AS trackCount, COALESCE(SUM(t.duration), 0) AS duration
  FROM albums al JOIN artists ar ON ar.id = al.artist_id JOIN tracks t ON t.album_id = al.id`;

const ARTIST_SELECT = `SELECT ar.id, ar.name,
    (SELECT COUNT(*) FROM albums a WHERE a.artist_id = ar.id) AS albumCount,
    (SELECT COUNT(*) FROM tracks t WHERE t.artist_id = ar.id) AS trackCount,
    (SELECT a.cover_key FROM albums a WHERE a.artist_id = ar.id AND a.cover_key IS NOT NULL
       ORDER BY a.year DESC LIMIT 1) AS cover
  FROM artists ar`;

function rows<T>(db: DB, sql: string, params: Params = []): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}
function one<T>(db: DB, sql: string, params: Params = []): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}
const plain = <T extends object>(r: T): T => ({ ...r });

// ---------------------------------------------------------------- titres

export interface TrackFilter {
  genre?: string;
  artistId?: number;
  albumId?: number;
  sort?: 'title' | 'album';
}

export function listTracks(db: DB, f: TrackFilter = {}): Track[] {
  const where: string[] = [];
  const params: Params = [];
  if (f.genre) {
    where.push('t.genre = ? COLLATE NOCASE');
    params.push(f.genre);
  }
  if (f.artistId != null) {
    where.push('t.artist_id = ?');
    params.push(f.artistId);
  }
  if (f.albumId != null) {
    where.push('t.album_id = ?');
    params.push(f.albumId);
  }
  const order = f.sort === 'title' ? 't.title COLLATE NOCASE, ar.key' : ALBUM_ORDER;
  const sql = `SELECT ${TRACK_COLS} ${TRACK_FROM} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  return rows<Track>(db, sql, params).map(plain);
}

export function tracksByIds(db: DB, ids: number[]): Track[] {
  if (!ids.length) return [];
  const found = rows<Track>(
    db,
    `SELECT ${TRACK_COLS} ${TRACK_FROM} WHERE t.id IN (SELECT value FROM json_each(?))`,
    [JSON.stringify(ids)],
  );
  const byId = new Map(found.map((t) => [t.id, plain(t)]));
  return ids.map((id) => byId.get(id)).filter((t): t is Track => Boolean(t));
}

export function trackFile(db: DB, id: number): string | undefined {
  return one<{ path: string }>(db, 'SELECT path FROM tracks WHERE id = ?', [id])?.path;
}

export function coverMime(db: DB, key: string): string | undefined {
  return one<{ mime: string }>(db, 'SELECT mime FROM covers WHERE key = ?', [key])?.mime;
}

export function recordPlay(db: DB, trackId: number): void {
  const now = Date.now();
  const res = db.prepare('UPDATE tracks SET play_count = play_count + 1, last_played = ? WHERE id = ?').run(now, trackId);
  if (Number(res.changes) === 0) throw new HttpError(404, 'Titre introuvable');
  db.prepare('INSERT INTO plays (track_id, played_at) VALUES (?, ?)').run(trackId, now);
}

// ---------------------------------------------------------------- albums

export function listAlbums(db: DB, sort: string = 'title'): Album[] {
  const order =
    sort === 'recent'
      ? 'al.added_at DESC'
      : sort === 'artist'
        ? 'ar.key, al.year, al.title COLLATE NOCASE'
        : 'al.title COLLATE NOCASE';
  return rows<Album>(db, `${ALBUM_SELECT} GROUP BY al.id ORDER BY ${order}`).map(plain);
}

export function getAlbum(db: DB, id: number): AlbumDetail | undefined {
  const album = one<Album>(db, `${ALBUM_SELECT} WHERE al.id = ? GROUP BY al.id`, [id]);
  if (!album) return undefined;
  const tracks = rows<Track>(
    db,
    `SELECT ${TRACK_COLS} ${TRACK_FROM} WHERE t.album_id = ? ORDER BY t.disc_no, t.track_no, t.title`,
    [id],
  ).map(plain);
  return { ...album, tracks };
}

// -------------------------------------------------------------- artistes

export function listArtists(db: DB): Artist[] {
  return rows<Artist>(db, `${ARTIST_SELECT} WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = ar.id)
    ORDER BY ar.name COLLATE NOCASE`).map(plain);
}

export function getArtist(db: DB, id: number): ArtistDetail | undefined {
  const artist = one<Artist>(db, `${ARTIST_SELECT} WHERE ar.id = ?`, [id]);
  if (!artist) return undefined;
  const albums = rows<Album>(db, `${ALBUM_SELECT} WHERE al.artist_id = ? GROUP BY al.id ORDER BY al.year DESC, al.title`, [
    id,
  ]).map(plain);
  const topTracks = rows<Track>(
    db,
    `SELECT ${TRACK_COLS} ${TRACK_FROM} WHERE t.artist_id = ?
     ORDER BY t.play_count DESC, al.year DESC, al.title, t.disc_no, t.track_no LIMIT 10`,
    [id],
  ).map(plain);
  return { ...artist, albums, topTracks };
}

// ---------------------------------------------------------------- genres

export function listGenres(db: DB): Genre[] {
  return rows<Genre>(
    db,
    `SELECT genre AS name, COUNT(*) AS trackCount FROM tracks WHERE genre IS NOT NULL AND genre <> ''
     GROUP BY genre COLLATE NOCASE ORDER BY trackCount DESC, genre COLLATE NOCASE`,
  ).map(plain);
}

// -------------------------------------------------------------- playlists

const PLAYLIST_SELECT = `SELECT p.id, p.name, p.description, p.updated_at AS updatedAt,
    (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS trackCount,
    (SELECT COALESCE(SUM(t.duration), 0) FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = p.id) AS duration
  FROM playlists p`;

function withCovers(db: DB, p: Omit<Playlist, 'covers'>): Playlist {
  const found = rows<{ cover: string }>(
    db,
    `SELECT COALESCE(t.cover_key, al.cover_key) AS cover FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id JOIN albums al ON al.id = t.album_id
     WHERE pt.playlist_id = ? AND COALESCE(t.cover_key, al.cover_key) IS NOT NULL
     ORDER BY pt.position, pt.id`,
    [p.id],
  );
  const covers: string[] = [];
  for (const r of found) {
    if (!covers.includes(r.cover)) covers.push(r.cover);
    if (covers.length === 4) break;
  }
  return { ...p, covers };
}

export function listPlaylists(db: DB, limit?: number): Playlist[] {
  const sql = `${PLAYLIST_SELECT} ORDER BY p.updated_at DESC, p.id DESC ${limit ? 'LIMIT ' + Math.floor(limit) : ''}`;
  return rows<Omit<Playlist, 'covers'>>(db, sql).map((p) => withCovers(db, plain(p)));
}

export function getPlaylist(db: DB, id: number): PlaylistDetail | undefined {
  const p = one<Omit<Playlist, 'covers'>>(db, `${PLAYLIST_SELECT} WHERE p.id = ?`, [id]);
  if (!p) return undefined;
  const tracks = rows<PlaylistTrack>(
    db,
    `SELECT ${TRACK_COLS}, pt.id AS entryId ${TRACK_FROM.replace('FROM tracks t', 'FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id')}
     WHERE pt.playlist_id = ? ORDER BY pt.position, pt.id`,
    [id],
  ).map(plain);
  return { ...withCovers(db, plain(p)), tracks };
}

function touchPlaylist(db: DB, id: number): void {
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), id);
}

function mustExist(db: DB, id: number): void {
  if (!one(db, 'SELECT 1 AS x FROM playlists WHERE id = ?', [id])) throw new HttpError(404, 'Playlist introuvable');
}

export function createPlaylist(db: DB, name: string, description = ''): number {
  const now = Date.now();
  const res = db
    .prepare('INSERT INTO playlists (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(name, description, now, now);
  return Number(res.lastInsertRowid);
}

export function updatePlaylist(db: DB, id: number, patch: { name?: string; description?: string }): void {
  mustExist(db, id);
  if (patch.name !== undefined) db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(patch.name, id);
  if (patch.description !== undefined)
    db.prepare('UPDATE playlists SET description = ? WHERE id = ?').run(patch.description, id);
  touchPlaylist(db, id);
}

export function deletePlaylist(db: DB, id: number): void {
  mustExist(db, id);
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
}

export function addToPlaylist(db: DB, id: number, trackIds: number[]): number {
  mustExist(db, id);
  return tx(db, () => {
    const last = one<{ m: number | null }>(db, 'SELECT MAX(position) AS m FROM playlist_tracks WHERE playlist_id = ?', [id]);
    let position = (last?.m ?? -1) + 1;
    const insert = db.prepare(
      'INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) SELECT ?, id, ?, ? FROM tracks WHERE id = ?',
    );
    let added = 0;
    const now = Date.now();
    for (const trackId of trackIds) {
      const res = insert.run(id, position, now, trackId);
      if (Number(res.changes) > 0) {
        added++;
        position++;
      }
    }
    touchPlaylist(db, id);
    return added;
  });
}

export function removeFromPlaylist(db: DB, id: number, entryId: number): void {
  mustExist(db, id);
  db.prepare('DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?').run(entryId, id);
  touchPlaylist(db, id);
}

export function reorderPlaylist(db: DB, id: number, entryIds: number[]): void {
  mustExist(db, id);
  const current = rows<{ id: number }>(db, 'SELECT id FROM playlist_tracks WHERE playlist_id = ?', [id]).map((r) => r.id);
  const same =
    current.length === entryIds.length &&
    new Set(entryIds).size === entryIds.length &&
    entryIds.every((e) => current.includes(e));
  if (!same) throw new HttpError(409, 'La playlist a changé, recharge la page.');
  tx(db, () => {
    const update = db.prepare('UPDATE playlist_tracks SET position = ? WHERE id = ? AND playlist_id = ?');
    entryIds.forEach((entryId, i) => update.run(i, entryId, id));
    touchPlaylist(db, id);
  });
}

// ------------------------------------------------------------- favoris

export function favoriteIds(db: DB): number[] {
  return rows<{ track_id: number }>(db, 'SELECT track_id FROM favorites ORDER BY added_at DESC').map((r) => r.track_id);
}

export function listFavorites(db: DB): Track[] {
  return rows<Track>(
    db,
    `SELECT ${TRACK_COLS} ${TRACK_FROM.replace('FROM tracks t', 'FROM favorites f JOIN tracks t ON t.id = f.track_id')}
     ORDER BY f.added_at DESC`,
  ).map(plain);
}

export function setFavorite(db: DB, trackId: number, on: boolean): void {
  if (on) {
    const res = db
      .prepare('INSERT OR IGNORE INTO favorites (track_id, added_at) SELECT id, ? FROM tracks WHERE id = ?')
      .run(Date.now(), trackId);
    if (Number(res.changes) === 0 && !one(db, 'SELECT 1 AS x FROM tracks WHERE id = ?', [trackId]))
      throw new HttpError(404, 'Titre introuvable');
  } else {
    db.prepare('DELETE FROM favorites WHERE track_id = ?').run(trackId);
  }
}

// -------------------------------------------------------------- accueil

export function getHome(db: DB): HomeData {
  const recentAlbums = rows<Album>(
    db,
    `${ALBUM_SELECT} WHERE al.id IN (SELECT album_id FROM tracks WHERE last_played IS NOT NULL
       GROUP BY album_id ORDER BY MAX(last_played) DESC LIMIT 12)
     GROUP BY al.id ORDER BY (SELECT MAX(last_played) FROM tracks x WHERE x.album_id = al.id) DESC`,
  ).map(plain);
  const recentlyAdded = rows<Album>(db, `${ALBUM_SELECT} GROUP BY al.id ORDER BY al.added_at DESC, al.id DESC LIMIT 12`).map(plain);
  const discover = rows<Album>(db, `${ALBUM_SELECT} GROUP BY al.id ORDER BY RANDOM() LIMIT 12`).map(plain);
  const mostPlayed = rows<Track>(
    db,
    `SELECT ${TRACK_COLS} ${TRACK_FROM} WHERE t.play_count > 0 ORDER BY t.play_count DESC, t.last_played DESC LIMIT 10`,
  ).map(plain);
  const fav = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM favorites');
  return {
    recentAlbums,
    recentlyAdded,
    discover,
    mostPlayed,
    playlists: listPlaylists(db, 12),
    favoriteCount: fav?.n ?? 0,
  };
}

export function getStats(db: DB): Stats {
  const r = one<Stats>(
    db,
    `SELECT (SELECT COUNT(*) FROM tracks) AS tracks, (SELECT COUNT(*) FROM albums) AS albums,
       (SELECT COUNT(*) FROM artists) AS artists, (SELECT COUNT(*) FROM playlists) AS playlists,
       (SELECT COALESCE(SUM(duration), 0) FROM tracks) AS duration`,
  );
  return plain(r!);
}

// ------------------------------------------------------------ recherche

export function search(db: DB, query: string): SearchResults {
  const tokens = norm(query).split(' ').filter(Boolean);
  if (!tokens.length) return { tracks: [], albums: [], artists: [], playlists: [] };
  const like = (col: string) => tokens.map(() => `${col} LIKE ?`).join(' AND ');
  const params = tokens.map((t) => `%${t}%`);
  const first = tokens[0]!;
  const phrase = tokens.join(' ');

  const tracks = rows<Track>(
    db,
    `SELECT ${TRACK_COLS} ${TRACK_FROM} WHERE ${like('t.search')} LIMIT 300`,
    params,
  )
    .map(plain)
    .map((t) => {
      const title = norm(t.title);
      const score = title === phrase ? 0 : title.startsWith(phrase) ? 1 : title.includes(first) ? 2 : 3;
      return { t, score };
    })
    .sort((a, b) => a.score - b.score || b.t.playCount - a.t.playCount)
    .slice(0, 20)
    .map((x) => x.t);

  const albums = rows<Album>(db, `${ALBUM_SELECT} WHERE ${like('al.search')} GROUP BY al.id ORDER BY al.title COLLATE NOCASE LIMIT 12`, params).map(plain);
  const artists = rows<Artist>(
    db,
    `${ARTIST_SELECT} WHERE ${like('ar.search')} ORDER BY (ar.search LIKE ?) DESC, ar.name COLLATE NOCASE LIMIT 12`,
    [...params, `${first}%`],
  ).map(plain);

  const playlists = listPlaylists(db).filter((p) => {
    const n = norm(p.name);
    return tokens.every((t) => n.includes(t));
  });
  return { tracks, albums, artists, playlists };
}
