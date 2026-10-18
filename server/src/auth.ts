import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { AdminUser, User } from '../../shared/types';
import { adoptLegacyData, getSetting, setSetting, tx, type DB } from './db';
import { HttpError } from './util';

/**
 * Comptes : adresse e-mail + mot de passe.
 * - Mots de passe : scrypt (jamais stockés en clair).
 * - Connexion : jeton aléatoire dans un cookie ; seule son empreinte SHA-256 est stockée.
 */

export const COOKIE_NAME = 'mb_session';
const SESSION_MAX_AGE_S = 365 * 24 * 3600;
const SESSION_IDLE_MS = 180 * 24 * 3600_000;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const TEMP_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

type ScryptFn = (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const scrypt = promisify(crypto.scrypt) as unknown as ScryptFn;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 32, { ...SCRYPT, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!(N >= 1024 && N <= 1 << 20) || !(R >= 1 && R <= 32) || !(P >= 1 && P <= 8)) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N,
    r: R,
    p: P,
    maxmem: 128 * N * R + 1024 * 1024,
  });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

let dummyHash: Promise<string> | null = null;

export function normalizeEmail(raw: unknown): string {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new HttpError(400, 'Adresse e-mail invalide.');
  }
  return email;
}

export function checkPassword(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length < 8) throw new HttpError(400, 'Le mot de passe doit faire au moins 8 caractères.');
  if (raw.length > 200) throw new HttpError(400, 'Le mot de passe est trop long.');
  return raw;
}

export function cleanName(raw: unknown, email: string): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  return name || email.split('@')[0]!.slice(0, 60);
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/** Devine un nom lisible d'appareil à partir du User-Agent (« Pixel 7 », « Téléphone Android »…). */
export function deviceNameFromUA(ua: string | undefined): string {
  if (!ua) return 'Appareil';
  const android = /\(Linux; Android [\d.]+; ([^;)]+?)(?: Build[^;)]*)?(?:;[^)]*)?\)/.exec(ua);
  if (android?.[1] && android[1] !== 'K') return android[1].trim().slice(0, 60);
  if (/Android/i.test(ua)) return 'Téléphone Android';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Windows/i.test(ua)) return 'PC Windows';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Appareil Linux';
  return 'Appareil';
}

/** Compte les essais récents par clé (adresse, IP…) pour freiner les devinettes. */
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  private recent(key: string): number[] {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }
  blocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }
  hit(key: string): void {
    const list = this.recent(key);
    list.push(Date.now());
    this.hits.set(key, list);
  }
  clear(key: string): void {
    this.hits.delete(key);
  }
}

export interface AuthUser extends User {
  sessionId: number;
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  pass_hash: string;
  is_admin: number;
  must_change: number;
  disabled: number;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  isAdmin: r.is_admin === 1,
  mustChange: r.must_change === 1,
});

export class Auth {
  private touched = new Map<number, number>();

  constructor(private db: DB) {}

  hasUsers(): boolean {
    return (this.db.prepare('SELECT 1 AS x FROM users LIMIT 1').get() as unknown) !== undefined;
  }

  get signupOpen(): boolean {
    return getSetting<boolean>(this.db, 'signup_open', true);
  }
  set signupOpen(on: boolean) {
    setSetting(this.db, 'signup_open', on);
  }

  adminCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled = 0').get() as { n: number }).n;
  }

  /** Crée un compte. Le tout premier compte est toujours administrateur et reprend les données d'avant les comptes. */
  async createUser(opts: { email: string; name: string; password: string; isAdmin?: boolean; mustChange?: boolean }): Promise<User> {
    const hash = await hashPassword(opts.password);
    return tx(this.db, () => {
      if (this.db.prepare('SELECT 1 AS x FROM users WHERE email = ?').get(opts.email)) {
        throw new HttpError(409, 'Cette adresse e-mail a déjà un compte.');
      }
      const first = !this.hasUsers();
      const isAdmin = first || Boolean(opts.isAdmin);
      const res = this.db
        .prepare('INSERT INTO users (email, name, pass_hash, is_admin, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(opts.email, opts.name, hash, isAdmin ? 1 : 0, opts.mustChange ? 1 : 0, Date.now());
      const id = Number(res.lastInsertRowid);
      if (first) adoptLegacyData(this.db, id);
      return { id, email: opts.email, name: opts.name, isAdmin, mustChange: Boolean(opts.mustChange) };
    });
  }

  /** Vérifie l'e-mail et le mot de passe ; renvoie le compte ou null (même réponse dans tous les cas d'échec). */
  async checkLogin(email: string, password: string): Promise<User | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as unknown as UserRow | undefined;
    if (!row) {
      dummyHash ??= hashPassword('mot de passe factice');
      await verifyPassword(password, await dummyHash); // même durée qu'un vrai essai
      return null;
    }
    const ok = await verifyPassword(password, row.pass_hash);
    return ok && row.disabled === 0 ? toUser(row) : null;
  }

  createSession(userId: number, userAgent: string | undefined): string {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db
      .prepare('INSERT INTO sessions (user_id, token_hash, device, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
      .run(userId, sha256(token), deviceNameFromUA(userAgent), now, now);
    this.db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, userId);
    return token;
  }

  authenticate(cookieHeader: string | undefined): AuthUser | null {
    const token = parseCookie(cookieHeader, COOKIE_NAME);
    if (!token || token.length > 200) return null;
    const row = this.db
      .prepare(
        `SELECT u.*, s.id AS session_id, s.last_seen AS session_seen FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND u.disabled = 0`,
      )
      .get(sha256(token)) as unknown as (UserRow & { session_id: number; session_seen: number }) | undefined;
    if (!row) return null;
    const now = Date.now();
    if (now - row.session_seen > SESSION_IDLE_MS) {
      this.revokeSession(row.session_id);
      return null;
    }
    if (now - (this.touched.get(row.session_id) ?? 0) > 60_000) {
      this.touched.set(row.session_id, now);
      this.db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now, row.session_id);
      this.db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, row.id);
    }
    return { ...toUser(row), sessionId: row.session_id };
  }

  revokeSession(id: number): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    this.touched.delete(id);
  }

  revokeUserSessions(userId: number, exceptSessionId?: number): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?').run(userId, exceptSessionId ?? null);
  }

  async changePassword(userId: number, current: string, next: string, keepSessionId: number): Promise<void> {
    const row = this.db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(userId) as { pass_hash: string } | undefined;
    if (!row || !(await verifyPassword(current, row.pass_hash))) throw new HttpError(400, 'Le mot de passe actuel est incorrect.');
    await this.setPassword(userId, next, false);
    this.revokeUserSessions(userId, keepSessionId);
  }

  async setPassword(userId: number, password: string, mustChange: boolean): Promise<void> {
    const hash = await hashPassword(password);
    this.db.prepare('UPDATE users SET pass_hash = ?, must_change = ? WHERE id = ?').run(hash, mustChange ? 1 : 0, userId);
  }

  /** Mot de passe provisoire lisible (sans caractères ambigus). */
  static tempPassword(): string {
    let s = '';
    for (let i = 0; i < 10; i++) s += TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)];
    return s;
  }

  listUsers(): AdminUser[] {
    const rows = this.db
      .prepare(
        `SELECT u.id, u.email, u.name, u.is_admin, u.disabled, u.must_change, u.created_at, u.last_seen,
           (SELECT COUNT(*) FROM playlists p WHERE p.user_id = u.id) AS playlists,
           (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions
         FROM users u ORDER BY u.is_admin DESC, u.created_at`,
      )
      .all() as unknown as {
      id: number;
      email: string;
      name: string;
      is_admin: number;
      disabled: number;
      must_change: number;
      created_at: number;
      last_seen: number | null;
      playlists: number;
      sessions: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      isAdmin: r.is_admin === 1,
      disabled: r.disabled === 1,
      mustChange: r.must_change === 1,
      createdAt: r.created_at,
      lastSeen: r.last_seen,
      playlistCount: r.playlists,
      sessionCount: r.sessions,
    }));
  }

  findByEmail(email: string): (User & { disabled: boolean }) | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as unknown as UserRow | undefined;
    return row ? { ...toUser(row), disabled: row.disabled === 1 } : undefined;
  }

  getUser(id: number): (User & { disabled: boolean }) | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
    return row ? { ...toUser(row), disabled: row.disabled === 1 } : undefined;
  }

  updateUser(id: number, patch: { name?: string; isAdmin?: boolean; disabled?: boolean }): void {
    const target = this.getUser(id);
    if (!target) throw new HttpError(404, 'Compte introuvable.');
    const losesAdmin = target.isAdmin && !target.disabled && (patch.isAdmin === false || patch.disabled === true);
    if (losesAdmin && this.adminCount() <= 1) throw new HttpError(409, 'Il faut au moins un administrateur actif.');
    if (patch.name !== undefined) this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(patch.name, id);
    if (patch.isAdmin !== undefined) this.db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(patch.isAdmin ? 1 : 0, id);
    if (patch.disabled !== undefined) {
      this.db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(patch.disabled ? 1 : 0, id);
      if (patch.disabled) this.revokeUserSessions(id);
    }
  }

  deleteUser(id: number): void {
    const target = this.getUser(id);
    if (!target) throw new HttpError(404, 'Compte introuvable.');
    if (target.isAdmin && !target.disabled && this.adminCount() <= 1) throw new HttpError(409, 'Il faut au moins un administrateur actif.');
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  listSessions(userId: number, currentId: number) {
    const rows = this.db
      .prepare('SELECT id, device, created_at, last_seen FROM sessions WHERE user_id = ? ORDER BY last_seen DESC')
      .all(userId) as unknown as { id: number; device: string; created_at: number; last_seen: number }[];
    return rows.map((r) => ({ id: r.id, device: r.device, createdAt: r.created_at, lastSeen: r.last_seen, current: r.id === currentId }));
  }

  ownsSession(userId: number, sessionId: number): boolean {
    return Boolean(this.db.prepare('SELECT 1 AS x FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId));
  }

  cookieHeader(token: string, secure: boolean): string {
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure ? '; Secure' : ''}`;
  }

  clearCookieHeader(): string {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
}
