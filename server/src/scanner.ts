import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { parseFile, selectCover } from 'music-metadata';
import type { ScanStatus } from '../../shared/types';
import { tx, type DB } from './db';
import { errMsg, isUnder, norm, pathKey } from './util';

export const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav']);
const FOLDER_COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart'];
const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const SKIPPED_DIRS = new Set(['$recycle.bin', 'system volume information', '@eadir']);
const MAX_COVER_BYTES = 12 * 1024 * 1024;

interface FileInfo {
  path: string;
  mtime: number;
  size: number;
}

interface ExistingRow {
  id: number;
  path: string;
  mtime: number;
  size: number;
  title: string;
  artist: string;
}

interface Parsed {
  path: string;
  mtime: number;
  size: number;
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  duration: number;
  format: string;
  bitrate: number | null;
  coverKey: string | null;
  coverMime: string | null;
}

function idleStatus(): ScanStatus {
  return {
    running: false,
    phase: 'idle',
    total: 0,
    done: 0,
    added: 0,
    updated: 0,
    removed: 0,
    errors: 0,
    startedAt: null,
    finishedAt: null,
    warnings: [],
  };
}

function clean(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function filenameTitle(file: string): string {
  const base = path.basename(file, path.extname(file));
  return clean(base.replace(/^\d{1,3}\s*[-._)]\s*/, '').replace(/_/g, ' ')) || base;
}

/** « A feat. B » → « A » : évite de couper un album en plusieurs quand il n'a pas d'artiste d'album. */
function primaryArtist(name: string): string {
  const first = name.split(/\s+(?:feat\.?|ft\.?|featuring|avec)\s+/i)[0] ?? name;
  return clean(first) || name;
}

function yearOf(year: number | undefined, date: string | undefined): number | null {
  if (year && year > 0) return year;
  const m = /^(\d{4})/.exec(date ?? '');
  return m ? Number(m[1]) : null;
}

async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

export class Scanner {
  status: ScanStatus = idleStatus();
  private running = false;
  private rerun: { full: boolean } | null = null;
  private watchers: fs.FSWatcher[] = [];
  private debounce: NodeJS.Timeout | null = null;
  private coversDir: string;

  constructor(
    private db: DB,
    dataDir: string,
    private getDirs: () => string[],
    private log: (msg: string) => void = () => {},
  ) {
    this.coversDir = path.join(dataDir, 'covers');
    fs.mkdirSync(this.coversDir, { recursive: true });
  }

  /** Lance une analyse en arrière-plan. Si une analyse est déjà en cours, une nouvelle suivra. */
  start(opts: { full?: boolean } = {}): boolean {
    if (this.running) {
      this.rerun = { full: Boolean(opts.full) || Boolean(this.rerun?.full) };
      return false;
    }
    void this.run(Boolean(opts.full)).catch((e) => this.log(`Analyse interrompue : ${errMsg(e)}`));
    return true;
  }

  /** Attend la fin des analyses en cours ou en attente (60 s au plus). */
  async whenIdle(): Promise<void> {
    const end = Date.now() + 60_000;
    while ((this.running || this.rerun) && Date.now() < end) await new Promise((r) => setTimeout(r, 80));
  }

  /** Surveille les dossiers : une analyse se relance quand des fichiers changent. */
  watch(): void {
    this.stopWatching();
    for (const dir of this.getDirs()) {
      try {
        const w = fs.watch(dir, { recursive: true, persistent: false }, () => this.schedule());
        w.on('error', () => {});
        this.watchers.push(w);
      } catch {
        // Surveillance indisponible pour ce dossier : l'analyse manuelle reste possible.
      }
    }
  }

  stopWatching(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
  }

  private schedule(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.start(), 10_000);
    this.debounce.unref?.();
  }

  private async run(full: boolean): Promise<void> {
    this.running = true;
    const st: ScanStatus = (this.status = { ...idleStatus(), running: true, phase: 'walking', startedAt: Date.now() });
    try {
      const dirs = this.getDirs().map((d) => path.resolve(d));
      const files = new Map<string, FileInfo>();
      const folderCovers = new Map<string, string>();
      const reachable: string[] = [];

      for (const root of dirs) {
        try {
          await fsp.access(root);
        } catch {
          st.warnings.push(`Dossier introuvable (ignoré) : ${root}`);
          continue;
        }
        reachable.push(root);
        await this.walk(root, files, folderCovers, st);
      }

      st.total = files.size;
      st.phase = 'reading';

      const rows = this.db
        .prepare('SELECT id, path, mtime, size, title, artist FROM tracks')
        .all() as unknown as ExistingRow[];
      const existing = new Map<string, ExistingRow>();
      for (const r of rows) existing.set(pathKey(r.path), r);

      // Titres à retirer : fichiers disparus dans un dossier joignable, ou dossier qui n'est plus suivi.
      const removeIds = new Set<number>();
      const missingBySig = new Map<string, ExistingRow[]>();
      for (const r of rows) {
        const stillConfigured = dirs.some((d) => isUnder(r.path, d));
        if (!stillConfigured) {
          removeIds.add(r.id);
        } else if (reachable.some((d) => isUnder(r.path, d)) && !files.has(pathKey(r.path))) {
          removeIds.add(r.id);
          const sig = `${r.size}|${norm(r.title)}|${norm(r.artist)}`;
          const list = missingBySig.get(sig) ?? [];
          list.push(r);
          missingBySig.set(sig, list);
        }
      }

      const todo: FileInfo[] = [];
      for (const f of files.values()) {
        const ex = existing.get(pathKey(f.path));
        if (ex && !full && ex.mtime === f.mtime && ex.size === f.size) st.done++;
        else todo.push(f);
      }

      const ids = new Ids(this.db);
      const batch: Parsed[] = [];
      const flush = () => {
        if (!batch.length) return;
        const items = batch.splice(0);
        tx(this.db, () => {
          for (const p of items) this.store(p, existing, missingBySig, removeIds, ids, st);
        });
      };

      await pool(todo, 6, async (f) => {
        try {
          batch.push(await this.parse(f, folderCovers));
        } catch (e) {
          st.errors++;
          this.log(`Fichier illisible : ${f.path} (${errMsg(e)})`);
        } finally {
          st.done++;
        }
        if (batch.length >= 100) flush();
      });
      flush();

      st.phase = 'finishing';
      this.finish(removeIds, st);
    } finally {
      st.running = false;
      st.phase = 'idle';
      st.finishedAt = Date.now();
      this.running = false;
      const again = this.rerun;
      this.rerun = null;
      if (again) this.start(again);
    }
  }

  private async walk(
    dir: string,
    files: Map<string, FileInfo>,
    folderCovers: Map<string, string>,
    st: ScanStatus,
  ): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      st.errors++;
      return;
    }
    let bestCover: { rank: number; file: string } | null = null;
    const subdirs: string[] = [];
    const audio: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SKIPPED_DIRS.has(e.name.toLowerCase())) subdirs.push(full);
      } else if (e.isFile() || e.isSymbolicLink()) {
        const ext = path.extname(e.name).toLowerCase();
        if (AUDIO_EXT.has(ext)) audio.push(full);
        else if (IMAGE_MIME[ext]) {
          const rank = FOLDER_COVER_NAMES.indexOf(path.basename(e.name, ext).toLowerCase());
          if (rank >= 0 && (!bestCover || rank < bestCover.rank)) bestCover = { rank, file: full };
        }
      }
    }
    if (bestCover) folderCovers.set(pathKey(dir), bestCover.file);
    for (const f of audio) {
      try {
        const s = await fsp.stat(f);
        if (s.isFile()) files.set(pathKey(f), { path: f, mtime: Math.floor(s.mtimeMs), size: s.size });
      } catch {
        st.errors++;
      }
    }
    st.total = files.size;
    for (const d of subdirs) await this.walk(d, files, folderCovers, st);
  }

  private async parse(f: FileInfo, folderCovers: Map<string, string>): Promise<Parsed> {
    const ext = path.extname(f.path).slice(1).toUpperCase();
    // Pour l'Ogg et l'Opus, la durée n'est connue qu'en lisant la fin du fichier.
    const meta = await parseFile(f.path, { duration: ['OGG', 'OGA', 'OPUS'].includes(ext) });
    const c = meta.common;
    if (!meta.format.sampleRate) throw new Error('aucun son audio lisible dans ce fichier');

    const title = clean(c.title) || filenameTitle(f.path);
    const artist = clean(c.artist) || clean(c.albumartist) || 'Artiste inconnu';
    const albumArtist =
      clean(c.albumartist) || primaryArtist(clean(c.artists?.[0]) || artist) || 'Artiste inconnu';
    const album = clean(c.album) || 'Album inconnu';

    let coverKey: string | null = null;
    let coverMime: string | null = null;
    const pic = selectCover(c.picture);
    if (pic && pic.data.length > 0) {
      coverMime = pic.format || 'image/jpeg';
      coverKey = await this.saveCover(pic.data);
    } else {
      const folderImage = folderCovers.get(pathKey(path.dirname(f.path)));
      if (folderImage) {
        try {
          const st = await fsp.stat(folderImage);
          if (st.size > 0 && st.size <= MAX_COVER_BYTES) {
            const data = await fsp.readFile(folderImage);
            coverMime = IMAGE_MIME[path.extname(folderImage).toLowerCase()] ?? 'image/jpeg';
            coverKey = await this.saveCover(data);
          }
        } catch {
          // Pochette illisible : on continue sans.
        }
      }
    }

    return {
      path: f.path,
      mtime: f.mtime,
      size: f.size,
      title,
      artist,
      albumArtist,
      album,
      trackNo: c.track?.no ?? null,
      discNo: c.disk?.no ?? null,
      year: yearOf(c.year, c.date),
      genre: clean(c.genre?.[0]) || null,
      duration: meta.format.duration ?? 0,
      format: ext,
      bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null,
      coverKey,
      coverMime,
    };
  }

  private async saveCover(data: Uint8Array): Promise<string> {
    const key = createHash('sha1').update(data).digest('hex');
    const file = path.join(this.coversDir, key);
    if (!fs.existsSync(file)) {
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, file);
    }
    return key;
  }

  private store(
    p: Parsed,
    existing: Map<string, ExistingRow>,
    missingBySig: Map<string, ExistingRow[]>,
    removeIds: Set<number>,
    ids: Ids,
    st: ScanStatus,
  ): void {
    if (p.coverKey && p.coverMime) {
      this.db.prepare('INSERT OR IGNORE INTO covers (key, mime) VALUES (?, ?)').run(p.coverKey, p.coverMime);
    }
    const artistId = ids.artist(p.albumArtist);
    const albumId = ids.album(artistId, p.albumArtist, p.album);
    const search = norm(`${p.title} ${p.artist} ${p.album}`);
    const fields = [
      p.title,
      p.artist,
      albumId,
      artistId,
      p.trackNo,
      p.discNo,
      p.year,
      p.genre,
      p.duration,
      p.format,
      p.bitrate,
      p.coverKey,
      search,
      p.mtime,
      p.size,
    ];

    const known = existing.get(pathKey(p.path));
    if (known) {
      this.db
        .prepare(
          `UPDATE tracks SET title=?, artist=?, album_id=?, artist_id=?, track_no=?, disc_no=?, year=?, genre=?,
             duration=?, format=?, bitrate=?, cover_key=?, search=?, mtime=?, size=? WHERE id=?`,
        )
        .run(...fields, known.id);
      st.updated++;
      return;
    }

    // Fichier déplacé ou renommé : on garde le même titre (et donc ses playlists et ses likes).
    const sig = `${p.size}|${norm(p.title)}|${norm(p.artist)}`;
    const moved = missingBySig.get(sig)?.pop();
    if (moved) {
      removeIds.delete(moved.id);
      this.db
        .prepare(
          `UPDATE tracks SET title=?, artist=?, album_id=?, artist_id=?, track_no=?, disc_no=?, year=?, genre=?,
             duration=?, format=?, bitrate=?, cover_key=?, search=?, mtime=?, size=?, path=? WHERE id=?`,
        )
        .run(...fields, p.path, moved.id);
      st.updated++;
      return;
    }

    this.db
      .prepare(
        `INSERT INTO tracks (title, artist, album_id, artist_id, track_no, disc_no, year, genre, duration, format,
           bitrate, cover_key, search, mtime, size, path, added_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(...fields, p.path, Date.now());
    st.added++;
  }

  private finish(removeIds: Set<number>, st: ScanStatus): void {
    const db = this.db;
    tx(db, () => {
      if (removeIds.size) {
        db.prepare('DELETE FROM tracks WHERE id IN (SELECT value FROM json_each(?))').run(
          JSON.stringify([...removeIds]),
        );
        st.removed = removeIds.size;
      }
      db.exec('DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks)');
      db.exec('DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM tracks)');
      db.exec(`UPDATE albums SET
        year = (SELECT MIN(t.year) FROM tracks t WHERE t.album_id = albums.id AND t.year > 0),
        cover_key = (SELECT t.cover_key FROM tracks t WHERE t.album_id = albums.id AND t.cover_key IS NOT NULL
                     ORDER BY t.disc_no, t.track_no LIMIT 1)`);
    });

    // Nettoyage des pochettes qui ne servent plus.
    const unused = db
      .prepare('SELECT key FROM covers WHERE key NOT IN (SELECT cover_key FROM tracks WHERE cover_key IS NOT NULL)')
      .all() as unknown as { key: string }[];
    for (const { key } of unused) {
      try {
        fs.unlinkSync(path.join(this.coversDir, key));
      } catch {
        // Déjà supprimée.
      }
      db.prepare('DELETE FROM covers WHERE key = ?').run(key);
    }
    this.log(
      `Analyse terminée : ${st.added} ajoutés, ${st.updated} mis à jour, ${st.removed} retirés, ${st.errors} erreurs.`,
    );
  }
}

/** Retrouve ou crée les artistes et albums, avec un cache pour éviter des requêtes répétées. */
class Ids {
  private artists = new Map<string, number>();
  private albums = new Map<string, number>();
  constructor(private db: DB) {}

  artist(name: string): number {
    const key = norm(name) || name.toLowerCase();
    const hit = this.artists.get(key);
    if (hit) return hit;
    const row = this.db.prepare('SELECT id FROM artists WHERE key = ?').get(key) as { id: number } | undefined;
    let id = row?.id;
    if (!id) {
      id = Number(
        this.db.prepare('INSERT INTO artists (name, key, search) VALUES (?, ?, ?)').run(name, key, key).lastInsertRowid,
      );
    }
    this.artists.set(key, id);
    return id;
  }

  album(artistId: number, artistName: string, title: string): number {
    const key = `${norm(artistName) || artistName.toLowerCase()}::${norm(title) || title.toLowerCase()}`;
    const hit = this.albums.get(key);
    if (hit) return hit;
    const row = this.db.prepare('SELECT id FROM albums WHERE key = ?').get(key) as { id: number } | undefined;
    let id = row?.id;
    if (!id) {
      id = Number(
        this.db
          .prepare('INSERT INTO albums (title, artist_id, key, search, added_at) VALUES (?, ?, ?, ?, ?)')
          .run(title, artistId, key, norm(`${title} ${artistName}`), Date.now()).lastInsertRowid,
      );
    }
    this.albums.set(key, id);
    return id;
  }
}
