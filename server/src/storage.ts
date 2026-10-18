import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { ConsoleStorage, StorageFolder, StorageImport } from '../../shared/types';
import { isWin } from './config';
import { getMusicDirs, getSetting, type DB } from './db';
import { HttpError, pathKey } from './util';

const GB = 1024 ** 3;
/** Place maximale de la musique, en Go (modifiable dans l'application Serveur > Stockage). */
export const DEFAULT_LIMIT_GB = 20;
/** Espace à toujours laisser libre sur le disque, quelle que soit la limite. */
const DISK_SAFETY = GB;

export function limitGb(db: DB): number {
  const v = getSetting<number>(db, 'music_limit_gb', DEFAULT_LIMIT_GB);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_LIMIT_GB;
}

/** Octets pris par toute la musique de la bibliothèque. */
export function usedBytes(db: DB): number {
  return (db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM tracks').get() as { n: number }).n;
}

/** Espace libre (octets) du disque qui contient `p`, ou null si on ne peut pas le savoir. */
async function freeSpace(p: string): Promise<number | null> {
  try {
    const s = await fsp.statfs(p);
    if (Number(s.blocks) > 0) return Number(s.bavail) * Number(s.bsize);
  } catch {
    // Pas pris en charge ici : on essaie autrement sous Windows.
  }
  if (!isWin) return null;
  const root = path.parse(path.resolve(p)).root;
  const script = `$d = New-Object System.IO.DriveInfo '${root.replace(/'/g, "''")}'; Write-Output $d.AvailableFreeSpace.ToString()`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: 15_000, windowsHide: true, encoding: 'utf8' }, (err, out) => {
      const v = Number(String(out ?? '').trim());
      resolve(err || !Number.isFinite(v) ? null : v);
    });
  });
}

/** Le plus proche dossier existant au-dessus de `p`. */
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

/**
 * Vérifie qu'un fichier de `incoming` octets peut être importé : la musique ne doit pas dépasser la limite,
 * et le disque doit garder un peu de place. Lève une erreur 507 sinon.
 */
export async function assertRoomFor(db: DB, uploadsDir: string, incoming: number): Promise<void> {
  const limit = limitGb(db) * GB;
  const used = usedBytes(db);
  if (used + incoming > limit) {
    const left = Math.max(0, limit - used);
    throw new HttpError(507, `Limite de ${fmtGb(limitGb(db))} atteinte : il reste ${fmtGb(left / GB)} pour la musique. Supprime des fichiers importés ou augmente la limite dans Stockage.`);
  }
  const free = await freeSpace(await existingAncestor(uploadsDir));
  if (free !== null && free - incoming < DISK_SAFETY) throw new HttpError(507, 'Le disque du PC est presque plein : libère de la place avant d’importer.');
}

function fmtGb(v: number): string {
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: v < 1 ? 2 : 1 })} Go`;
}

export function computeStorage(db: DB, uploadsDir: string): ConsoleStorage {
  const rows = db.prepare('SELECT path, size FROM tracks').all() as unknown as { path: string; size: number }[];
  // Chaque titre est rangé dans le dossier le plus précis qui le contient (les importations d'abord).
  const roots: { path: string; kind: StorageFolder['kind'] }[] = [
    { path: uploadsDir, kind: 'imports' },
    ...getMusicDirs(db).map((d) => ({ path: d, kind: 'music' as const })),
  ];
  const keyed = roots.map((r) => ({ ...r, key: pathKey(path.resolve(r.path)) })).sort((a, b) => b.key.length - a.key.length);
  const sums = new Map(keyed.map((r) => [r.key, { tracks: 0, bytes: 0 }]));
  let tracks = 0;
  let bytes = 0;
  for (const r of rows) {
    tracks++;
    bytes += r.size;
    const key = pathKey(path.resolve(r.path));
    const root = keyed.find((k) => key.startsWith(k.key.endsWith(path.sep) ? k.key : k.key + path.sep));
    if (root) {
      const s = sums.get(root.key)!;
      s.tracks++;
      s.bytes += r.size;
    }
  }
  const folders: StorageFolder[] = roots.map((r) => {
    const s = sums.get(pathKey(path.resolve(r.path)))!;
    return { path: r.path, kind: r.kind, exists: fs.existsSync(r.path), tracks: s.tracks, bytes: s.bytes };
  });
  const limitBytes = Math.round(limitGb(db) * GB);
  return { limitBytes, usedBytes: bytes, tracks, folders, at: Date.now() };
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
}

export { GB };
