import path from 'node:path';

const isWin = process.platform === 'win32';

/** Normalise un texte pour la recherche : sans accents, minuscules, sans ponctuation. */
export function norm(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Clé de comparaison d'un chemin (insensible à la casse sous Windows). */
export function pathKey(p: string): string {
  return isWin ? p.toLowerCase() : p;
}

/** Vrai si `p` se trouve dans le dossier `root`. */
export function isUnder(p: string, root: string): boolean {
  const a = pathKey(path.resolve(p));
  const r = pathKey(path.resolve(root));
  return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function toInt(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

export function mustInt(v: unknown, what = 'identifiant'): number {
  const n = toInt(v);
  if (n === null) throw new HttpError(400, `${what} invalide`);
  return n;
}

export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}
