import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { AdminUser, ConsoleSession, User } from '../../shared/types';
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
  must_change: number;
  disabled: number;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  mustChange: r.must_change === 1,
});

/** Un appareil est « en ligne » s'il a été actif ces dernières minutes. */
const ONLINE_MS = 5 * 60_000;

export class Auth {
  private touched = new Map<number, number>();
  /** Dernier titre lancé par appareil (en mémoire seulement). */
  private listening = new Map<number, { trackId: number; at: number }>();

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

  /** Playlists et likes d'avant les comptes, qui n'appartiennent encore à personne. */
  legacyCounts(): { playlists: number; favorites: number } {
    const n = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      playlists: n('SELECT COUNT(*) AS n FROM playlists WHERE user_id IS NULL'),
      favorites: n('SELECT COUNT(*) AS n FROM favorites WHERE user_id IS NULL'),
    };
  }

  /**
   * Crée un compte. Avec `adoptLegacy`, il reprend les playlists, likes et écoutes d'avant les comptes
   * (le premier compte créé depuis le PC du serveur, ou celui qu'on désigne dans l'application Serveur).
   */
  async createUser(opts: { email: string; name: string; password: string; mustChange?: boolean; adoptLegacy?: boolean }): Promise<User> {
    const hash = await hashPassword(opts.password);
    return tx(this.db, () => {
      if (this.db.prepare('SELECT 1 AS x FROM users WHERE email = ?').get(opts.email)) {
        throw new HttpError(409, 'Cette adresse e-mail a déjà un compte.');
      }
      const res = this.db
        .prepare('INSERT INTO users (email, name, pass_hash, must_change, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(opts.email, opts.name, hash, opts.mustChange ? 1 : 0, Date.now());
      const id = Number(res.lastInsertRowid);
      if (opts.adoptLegacy) adoptLegacyData(this.db, id);
      return { id, email: opts.email, name: opts.name, mustChange: Boolean(opts.mustChange) };
    });
  }

  /** Rattache les données d'avant les comptes à ce compte. */
  adoptLegacy(userId: number): void {
    if (!this.getUser(userId)) throw new HttpError(404, 'Compte introuvable.');
    tx(this.db, () => adoptLegacyData(this.db, userId));
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

  markListening(sessionId: number, trackId: number): void {
    this.listening.set(sessionId, { trackId, at: Date.now() });
  }

  /** Personnes actives en ce moment (au moins un appareil actif ces dernières minutes). */
  onlineUserCount(): number {
    const since = Date.now() - ONLINE_MS;
    return (this.db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen > ?').get(since) as { n: number }).n;
  }

  revokeSession(id: number): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    this.touched.delete(id);
    this.listening.delete(id);
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
        `SELECT u.id, u.email, u.name, u.disabled, u.must_change, u.created_at, u.last_seen,
           (SELECT COUNT(*) FROM playlists p WHERE p.user_id = u.id) AS playlists,
           (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions
         FROM users u ORDER BY u.created_at`,
      )
      .all() as unknown as {
      id: number;
      email: string;
      name: string;
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

  updateUser(id: number, patch: { name?: string; disabled?: boolean }): void {
    if (!this.getUser(id)) throw new HttpError(404, 'Compte introuvable.');
    if (patch.name !== undefined) this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(patch.name, id);
    if (patch.disabled !== undefined) {
      this.db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(patch.disabled ? 1 : 0, id);
      if (patch.disabled) this.revokeUserSessions(id);
    }
  }

  deleteUser(id: number): void {
    if (!this.getUser(id)) throw new HttpError(404, 'Compte introuvable.');
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  userCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  sessionCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  }

  /** Tous les appareils connectés, quel que soit le compte (application Serveur). */
  listAllSessions(): ConsoleSession[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.user_id, u.name, u.email, s.device, s.created_at, s.last_seen
         FROM sessions s JOIN users u ON u.id = s.user_id ORDER BY s.last_seen DESC`,
      )
      .all() as unknown as { id: number; user_id: number; name: string; email: string; device: string; created_at: number; last_seen: number }[];
    const now = Date.now();
    const track = this.db.prepare('SELECT title, artist FROM tracks WHERE id = ?');
    return rows.map((r) => {
      const l = this.listening.get(r.id);
      const t = l ? (track.get(l.trackId) as { title: string; artist: string } | undefined) : undefined;
      return {
        id: r.id,
        userId: r.user_id,
        userName: r.name,
        email: r.email,
        device: r.device,
        createdAt: r.created_at,
        lastSeen: r.last_seen,
        online: now - r.last_seen < ONLINE_MS,
        listening: l && t && now - l.at < 60 * 60_000 ? { title: t.title, artist: t.artist, at: l.at } : null,
      };
    });
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
