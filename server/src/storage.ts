import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { ConsoleStorage, StorageAlbum, StorageDisk, StorageFolder, StorageFormat, StorageImport } from '../../shared/types';
import { isWin } from './config';
import { getMusicDirs, getSetting, type DB } from './db';
import { HttpError, pathKey } from './util';

/** Espace à laisser libre par défaut : les importations sont refusées en dessous. */
export const DEFAULT_MIN_FREE_GB = 1;
const GB = 1024 ** 3;

export function minFreeGb(db: DB): number {
  const v = getSetting<number>(db, 'import_min_free_gb', DEFAULT_MIN_FREE_GB);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MIN_FREE_GB;
}

/** Taille totale d'un dossier (sous-dossiers compris) ; 0 s'il n'existe pas. */
async function dirSize(dir: string): Promise<number> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await Promise.all(
    entries.map(async (e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return dirSize(p);
      if (e.isFile()) return fsp.stat(p).then((s) => s.size, () => 0);
      return 0;
    }),
  );
  return sizes.reduce((a, b) => a + b, 0);
}

/** Espace total et libre du disque qui contient `p` (null si on ne peut pas le savoir). */
async function diskSpace(p: string): Promise<{ total: number; free: number } | null> {
  try {
    const s = await fsp.statfs(p);
    const total = Number(s.blocks) * Number(s.bsize);
    if (total > 0) return { total, free: Number(s.bavail) * Number(s.bsize) };
  } catch {
    // Pas pris en charge ici : on essaie autrement sous Windows.
  }
  if (!isWin) return null;
  const root = path.parse(path.resolve(p)).root;
  const script = `$d = New-Object System.IO.DriveInfo '${root.replace(/'/g, "''")}'; Write-Output ($d.TotalSize.ToString() + ' ' + $d.AvailableFreeSpace.ToString())`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: 15_000, windowsHide: true, encoding: 'utf8' }, (err, out) => {
      const [t, f] = String(out ?? '').trim().split(/\s+/).map(Number);
      resolve(err || !t ? null : { total: t, free: f ?? 0 });
    });
  });
}

/** Le plus proche dossier existant au-dessus de `p` (le disque se mesure sur un dossier qui existe). */
async function existingAncestor(p: string): Promise<string> {
  let cur = path.resolve(p);
  for (;;) {
    try {
      await fsp.access(cur);
      return cur;
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return cur;
      cur = up;
    }
  }
}

async function diskKey(p: string): Promise<string> {
  const dir = await existingAncestor(p);
  const st = await fsp.stat(dir).catch(() => null);
  return st ? `${st.dev}` : path.parse(dir).root;
}

/** Espace libre (octets) sur le disque qui contient `p`, ou null. */
export async function freeSpaceAt(p: string): Promise<number | null> {
  return (await diskSpace(await existingAncestor(p)))?.free ?? null;
}

interface Row {
  path: string;
  size: number;
  format: string;
}

let cache: { at: number; value: ConsoleStorage } | null = null;

export async function computeStorage(db: DB, dataDir: string, uploadsDir: string, coversDir: string, force = false, scanDoneAt = 0): Promise<ConsoleStorage> {
  if (!force && cache && cache.at >= scanDoneAt && Date.now() - cache.at < 15_000) return { ...cache.value, minFreeGb: minFreeGb(db) };

  const musicDirs = getMusicDirs(db);
  const rows = db.prepare('SELECT path, size, upper(format) AS format FROM tracks').all() as unknown as Row[];

  // Chaque titre est rangé dans le dossier le plus précis qui le contient (les importations d'abord).
  const roots: { path: string; kind: StorageFolder['kind'] }[] = [
    { path: uploadsDir, kind: 'imports' },
    ...musicDirs.map((d) => ({ path: d, kind: 'music' as const })),
  ];
  const ordered = [...roots].sort((a, b) => b.path.length - a.path.length);
  const sums = new Map<string, { tracks: number; bytes: number }>(roots.map((r) => [pathKey(path.resolve(r.path)), { tracks: 0, bytes: 0 }]));
  const formats = new Map<string, StorageFormat>();
  let tracks = 0;
  let bytes = 0;
  for (const r of rows) {
    tracks++;
    bytes += r.size;
    const f = formats.get(r.format) ?? { format: r.format || '?', tracks: 0, bytes: 0 };
    f.tracks++;
    f.bytes += r.size;
    formats.set(r.format, f);
    const key = pathKey(path.resolve(r.path));
    for (const root of ordered) {
      const rk = pathKey(path.resolve(root.path));
      if (key.startsWith(rk.endsWith(path.sep) ? rk : rk + path.sep)) {
        const s = sums.get(rk)!;
        s.tracks++;
        s.bytes += r.size;
        break;
      }
    }
  }

  const disks = new Map<string, StorageDisk>();
  const folderRows: StorageFolder[] = [];
  const diskOf = async (p: string): Promise<string | null> => {
    const key = await diskKey(p);
    if (!disks.has(key)) {
      const space = await diskSpace(await existingAncestor(p));
      if (!space) return null;
      const root = path.parse(path.resolve(await existingAncestor(p))).root;
      disks.set(key, { id: key, label: isWin ? root : root || '/', ...space });
    }
    return key;
  };
  for (const r of roots) {
    const s = sums.get(pathKey(path.resolve(r.path)))!;
    folderRows.push({
      path: r.path,
      kind: r.kind,
      exists: fs.existsSync(r.path),
      tracks: s.tracks,
      bytes: s.bytes,
      diskId: await diskOf(r.path),
    });
  }

  const [covers, dataTotal] = await Promise.all([dirSize(coversDir), dirSize(dataDir)]);
  const uploadsInData = pathKey(path.resolve(uploadsDir)).startsWith(pathKey(path.resolve(dataDir)) + path.sep);
  const uploadsBytes = uploadsInData ? await dirSize(uploadsDir) : 0;
  const database = (await Promise.all(['library.db', 'library.db-wal', 'library.db-shm'].map((n) => fsp.stat(path.join(dataDir, n)).then((s) => s.size, () => 0)))).reduce((a, b) => a + b, 0);
  const appDiskId = await diskOf(dataDir);

  const biggest = db
    .prepare(
      `SELECT al.id, al.title, ar.name AS artist, COUNT(t.id) AS tracks, SUM(t.size) AS bytes
       FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists ar ON ar.id = al.artist_id
       GROUP BY al.id ORDER BY bytes DESC LIMIT 8`,
    )
    .all() as unknown as StorageAlbum[];

  const value: ConsoleStorage = {
    disks: [...disks.values()],
    folders: folderRows,
    formats: [...formats.values()].sort((a, b) => b.bytes - a.bytes),
    biggest,
    library: { tracks, bytes },
    // Les fichiers importés vivent dans le dossier des données : on ne les compte pas deux fois comme « données ».
    app: { dataDir, bytes: Math.max(0, dataTotal - uploadsBytes), covers, database, diskId: appDiskId },
    minFreeGb: minFreeGb(db),
    at: Date.now(),
  };
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateStorage(): void {
  cache = null;
}

/** Fichiers du dossier des importations. */
export async function listImports(db: DB, uploadsDir: string): Promise<StorageImport[]> {
  let names: string[];
  try {
    names = await fsp.readdir(uploadsDir);
  } catch {
    return [];
  }
  const indexed = new Set((db.prepare('SELECT path FROM tracks').all() as unknown as { path: string }[]).map((r) => pathKey(path.resolve(r.path))));
  const out: StorageImport[] = [];
  for (const name of names) {
    if (name.endsWith('.part')) continue;
    const full = path.join(uploadsDir, name);
    const st = await fsp.stat(full).catch(() => null);
    if (!st?.isFile()) continue;
    out.push({ name, bytes: st.size, modifiedAt: st.mtimeMs, inLibrary: indexed.has(pathKey(path.resolve(full))) });
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** Supprime un fichier importé (et seulement lui : jamais en dehors du dossier des importations). */
export async function deleteImport(uploadsDir: string, name: string): Promise<void> {
  const leaf = path.basename(name);
  if (!leaf || leaf !== name || leaf === '.' || leaf === '..') throw new HttpError(400, 'Nom de fichier invalide.');
  const full = path.join(uploadsDir, leaf);
  if (path.dirname(full) !== path.resolve(uploadsDir)) throw new HttpError(400, 'Nom de fichier invalide.');
  try {
    await fsp.unlink(full);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Ce fichier n’existe plus.');
    throw new HttpError(500, 'Impossible de supprimer ce fichier.');
  }
  invalidateStorage();
}

export { GB };
