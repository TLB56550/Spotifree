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
  COALESCE(t.cover_key, al.cover_key) AS cover, t.format, t.bitrate, t.added_at AS addedAt, COALESCE(ut.play_count, 0) AS playCount`;
/** Les écoutes sont propres à chaque personne : `uid` est un entier issu de la base (jamais une saisie). */
const trackFrom = (uid: number) =>
  `FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists ar ON ar.id = t.artist_id
   LEFT JOIN user_tracks ut ON ut.track_id = t.id AND ut.user_id = ${Math.trunc(uid)}`;
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

export function listTracks(db: DB, uid: number, f: TrackFilter = {}): Track[] {
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
  const sql = `SELECT ${TRACK_COLS} ${trackFrom(uid)} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  return rows<Track>(db, sql, params).map(plain);
}

export function tracksByIds(db: DB, uid: number, ids: number[]): Track[] {
  if (!ids.length) return [];
  const found = rows<Track>(
    db,
    `SELECT ${TRACK_COLS} ${trackFrom(uid)} WHERE t.id IN (SELECT value FROM json_each(?))`,
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

export function recordPlay(db: DB, uid: number, trackId: number): void {
  const now = Date.now();
  if (!one(db, 'SELECT 1 AS x FROM tracks WHERE id = ?', [trackId])) throw new HttpError(404, 'Titre introuvable');
  db.prepare(
    `INSERT INTO user_tracks (user_id, track_id, play_count, last_played) VALUES (?, ?, 1, ?)
     ON CONFLICT(user_id, track_id) DO UPDATE SET play_count = play_count + 1, last_played = excluded.last_played`,
  ).run(uid, trackId, now);
  db.prepare('INSERT INTO plays (track_id, played_at, user_id) VALUES (?, ?, ?)').run(trackId, now, uid);
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

export function getAlbum(db: DB, uid: number, id: number): AlbumDetail | undefined {
  const album = one<Album>(db, `${ALBUM_SELECT} WHERE al.id = ? GROUP BY al.id`, [id]);
  if (!album) return undefined;
  const tracks = rows<Track>(
    db,
    `SELECT ${TRACK_COLS} ${trackFrom(uid)} WHERE t.album_id = ? ORDER BY t.disc_no, t.track_no, t.title`,
    [id],
  ).map(plain);
  return { ...album, tracks };
}

// -------------------------------------------------------------- artistes

export function listArtists(db: DB): Artist[] {
  return rows<Artist>(db, `${ARTIST_SELECT} WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = ar.id)
    ORDER BY ar.name COLLATE NOCASE`).map(plain);
}

export function getArtist(db: DB, uid: number, id: number): ArtistDetail | undefined {
  const artist = one<Artist>(db, `${ARTIST_SELECT} WHERE ar.id = ?`, [id]);
  if (!artist) return undefined;
  const albums = rows<Album>(db, `${ALBUM_SELECT} WHERE al.artist_id = ? GROUP BY al.id ORDER BY al.year DESC, al.title`, [
    id,
  ]).map(plain);
  const topTracks = rows<Track>(
    db,
    `SELECT ${TRACK_COLS} ${trackFrom(uid)} WHERE t.artist_id = ?
     ORDER BY COALESCE(ut.play_count, 0) DESC, al.year DESC, al.title, t.disc_no, t.track_no LIMIT 10`,
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

export function listPlaylists(db: DB, uid: number, limit?: number): Playlist[] {
  const sql = `${PLAYLIST_SELECT} WHERE p.user_id = ? ORDER BY p.updated_at DESC, p.id DESC ${limit ? 'LIMIT ' + Math.floor(limit) : ''}`;
  return rows<Omit<Playlist, 'covers'>>(db, sql, [uid]).map((p) => withCovers(db, plain(p)));
}

export function getPlaylist(db: DB, uid: number, id: number): PlaylistDetail | undefined {
  const p = one<Omit<Playlist, 'covers'>>(db, `${PLAYLIST_SELECT} WHERE p.id = ? AND p.user_id = ?`, [id, uid]);
  if (!p) return undefined;
  const tracks = rows<PlaylistTrack>(
    db,
    `SELECT ${TRACK_COLS}, pt.id AS entryId ${trackFrom(uid).replace('FROM tracks t', 'FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id')}
     WHERE pt.playlist_id = ? ORDER BY pt.position, pt.id`,
    [id],
  ).map(plain);
  return { ...withCovers(db, plain(p)), tracks };
}

function touchPlaylist(db: DB, id: number): void {
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), id);
}

/** Une playlist n'est visible que par la personne qui l'a créée. */
function mustExist(db: DB, uid: number, id: number): void {
  if (!one(db, 'SELECT 1 AS x FROM playlists WHERE id = ? AND user_id = ?', [id, uid])) throw new HttpError(404, 'Playlist introuvable');
}

export function createPlaylist(db: DB, uid: number, name: string, description = ''): number {
  const now = Date.now();
  const res = db
    .prepare('INSERT INTO playlists (name, description, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(name, description, now, now, uid);
  return Number(res.lastInsertRowid);
}

export function updatePlaylist(db: DB, uid: number, id: number, patch: { name?: string; description?: string }): void {
  mustExist(db, uid, id);
  if (patch.name !== undefined) db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(patch.name, id);
  if (patch.description !== undefined)
    db.prepare('UPDATE playlists SET description = ? WHERE id = ?').run(patch.description, id);
  touchPlaylist(db, id);
}

export function deletePlaylist(db: DB, uid: number, id: number): void {
  mustExist(db, uid, id);
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
}

export function addToPlaylist(db: DB, uid: number, id: number, trackIds: number[]): number {
  mustExist(db, uid, id);
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

export function removeFromPlaylist(db: DB, uid: number, id: number, entryId: number): void {
  mustExist(db, uid, id);
  db.prepare('DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?').run(entryId, id);
  touchPlaylist(db, id);
}

export function reorderPlaylist(db: DB, uid: number, id: number, entryIds: number[]): void {
  mustExist(db, uid, id);
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

export function favoriteIds(db: DB, uid: number): number[] {
  return rows<{ track_id: number }>(db, 'SELECT track_id FROM favorites WHERE user_id = ? ORDER BY added_at DESC', [uid]).map(
    (r) => r.track_id,
  );
}

export function listFavorites(db: DB, uid: number): Track[] {
  return rows<Track>(
    db,
    `SELECT ${TRACK_COLS} ${trackFrom(uid).replace('FROM tracks t', 'FROM favorites f JOIN tracks t ON t.id = f.track_id')}
     WHERE f.user_id = ? ORDER BY f.added_at DESC`,
    [uid],
  ).map(plain);
}

export function setFavorite(db: DB, uid: number, trackId: number, on: boolean): void {
  if (on) {
    const res = db
      .prepare('INSERT OR IGNORE INTO favorites (user_id, track_id, added_at) SELECT ?, id, ? FROM tracks WHERE id = ?')
      .run(uid, Date.now(), trackId);
    if (Number(res.changes) === 0 && !one(db, 'SELECT 1 AS x FROM tracks WHERE id = ?', [trackId]))
      throw new HttpError(404, 'Titre introuvable');
  } else {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND track_id = ?').run(uid, trackId);
  }
}

// -------------------------------------------------------------- accueil

export function getHome(db: DB, uid: number): HomeData {
  const u = Math.trunc(uid);
  const recentAlbums = rows<Album>(
    db,
    `${ALBUM_SELECT} WHERE al.id IN (SELECT x.album_id FROM user_tracks y JOIN tracks x ON x.id = y.track_id
       WHERE y.user_id = ${u} AND y.last_played IS NOT NULL GROUP BY x.album_id ORDER BY MAX(y.last_played) DESC LIMIT 12)
     GROUP BY al.id ORDER BY (SELECT MAX(y.last_played) FROM user_tracks y JOIN tracks x ON x.id = y.track_id
       WHERE y.user_id = ${u} AND x.album_id = al.id) DESC`,
  ).map(plain);
  const recentlyAdded = rows<Album>(db, `${ALBUM_SELECT} GROUP BY al.id ORDER BY al.added_at DESC, al.id DESC LIMIT 12`).map(plain);
  const discover = rows<Album>(db, `${ALBUM_SELECT} GROUP BY al.id ORDER BY RANDOM() LIMIT 12`).map(plain);
  const mostPlayed = rows<Track>(
    db,
    `SELECT ${TRACK_COLS} ${trackFrom(uid)} WHERE ut.play_count > 0 ORDER BY ut.play_count DESC, ut.last_played DESC LIMIT 10`,
  ).map(plain);
  const fav = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?', [uid]);
  return {
    recentAlbums,
    recentlyAdded,
    discover,
    mostPlayed,
    playlists: listPlaylists(db, uid, 12),
    favoriteCount: fav?.n ?? 0,
  };
}

export function getStats(db: DB, uid: number): Stats {
  const r = one<Stats>(
    db,
    `SELECT (SELECT COUNT(*) FROM tracks) AS tracks, (SELECT COUNT(*) FROM albums) AS albums,
       (SELECT COUNT(*) FROM artists) AS artists, (SELECT COUNT(*) FROM playlists WHERE user_id = ${Math.trunc(uid)}) AS playlists,
       (SELECT COALESCE(SUM(duration), 0) FROM tracks) AS duration`,
  );
  return plain(r!);
}

// ------------------------------------------------------------ recherche

export function search(db: DB, uid: number, query: string): SearchResults {
  const tokens = norm(query).split(' ').filter(Boolean);
  if (!tokens.length) return { tracks: [], albums: [], artists: [], playlists: [] };
  const like = (col: string) => tokens.map(() => `${col} LIKE ?`).join(' AND ');
  const params = tokens.map((t) => `%${t}%`);
  const first = tokens[0]!;
  const phrase = tokens.join(' ');

  const tracks = rows<Track>(
    db,
    `SELECT ${TRACK_COLS} ${trackFrom(uid)} WHERE ${like('t.search')} LIMIT 300`,
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

  const playlists = listPlaylists(db, uid).filter((p) => {
    const n = norm(p.name);
    return tokens.every((t) => n.includes(t));
  });
  return { tracks, albums, artists, playlists };
}
