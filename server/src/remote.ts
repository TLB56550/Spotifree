import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { RemoteAddress, RemoteDevice, RemoteStatus } from '../../shared/types';
import { getSetting, setSetting, type DB } from './db';
import { HttpError, errMsg } from './util';

/**
 * Accès depuis un autre appareil (le téléphone).
 *
 * - Le serveur « PC » écoute toujours sur 127.0.0.1 : tout ce qui y arrive directement est de confiance.
 * - Le serveur « distant » (autre port) n'existe que si l'utilisateur l'active. Il écoute sur le réseau,
 *   mais chaque requête doit venir d'un appareil associé (cookie), sauf la page d'association.
 * - L'association se fait avec un code à usage unique (10 min) affiché sur le PC.
 */

export const COOKIE_NAME = 'mb_session';
const SESSION_MAX_AGE_S = 365 * 24 * 3600;
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // sans 0, O, 1, I, L
const CODE_TTL_MS = 10 * 60_000;
const MAX_FAILURES = 6; // essais ratés par minute, tous appareils confondus
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1']);
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded', 'tailscale-user-login'];

function hostName(host: string | undefined): string {
  return (host ?? '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
}

function isLoopbackIp(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Vrai si la requête vient du PC lui-même : arrivée sur le serveur local, par la boucle locale,
 * avec une adresse « localhost » et sans trace de passage par un relais (Tailscale Serve, proxy…).
 */
export function isLocalRequest(req: IncomingMessage, localPort: number): boolean {
  const sock = req.socket;
  if (sock.localPort !== localPort) return false;
  if (!isLoopbackIp(sock.remoteAddress)) return false;
  if (PROXY_HEADERS.some((h) => h in req.headers)) return false;
  return LOOPBACK_NAMES.has(hostName(req.headers.host));
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

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function newCodeValue(): string {
  let s = '';
  while (s.length < 8) {
    const b = crypto.randomBytes(1)[0]!;
    if (b < 248) s += CODE_ALPHABET[b % CODE_ALPHABET.length]; // 248 = 31 × 8 : pas de biais
  }
  return s;
}

export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
export const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function lanAddresses(port: number): RemoteAddress[] {
  const virtual = /vethernet|virtualbox|vmware|vbox|docker|wsl|hyper-v|loopback|bluetooth|pseudo|vpn|npcap/i;
  const out: RemoteAddress[] = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const second = Number(a.address.split('.')[1]);
      const tailscale = (a.address.startsWith('100.') && second >= 64 && second <= 127) || /tailscale/i.test(iface);
      if (!tailscale && virtual.test(iface)) continue;
      out.push({ ip: a.address, iface, kind: tailscale ? 'tailscale' : 'lan', url: `http://${a.address}:${port}` });
    }
  }
  // Réseau de la maison d'abord, Tailscale ensuite.
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'lan' ? -1 : 1));
}

export class RemoteAccess {
  private server: http.Server | null = null;
  private error: string | null = null;
  private code: { value: string; expiresAt: number } | null = null;
  private failures: number[] = [];
  private sessions = new Map<string, number>(); // empreinte du jeton -> id de l'appareil
  private touched = new Map<number, number>();

  constructor(
    private db: DB,
    private app: FastifyInstance,
    readonly port: number,
    private log: (msg: string) => void,
  ) {}

  get enabled(): boolean {
    return getSetting<boolean>(this.db, 'remote_enabled', false);
  }

  get running(): boolean {
    return Boolean(this.server?.listening);
  }

  /** Démarre l'écoute réseau si l'utilisateur l'a activée. */
  async init(): Promise<void> {
    if (this.enabled) await this.start();
  }

  async setEnabled(on: boolean): Promise<void> {
    setSetting(this.db, 'remote_enabled', on);
    if (on) await this.start();
    else {
      this.code = null;
      await this.stop();
    }
  }

  private async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((req, res) => this.app.routing(req, res));
    // Les envois de fichiers depuis le téléphone peuvent durer longtemps (réseau mobile).
    server.requestTimeout = 0;
    server.headersTimeout = 60_000;
    this.server = server;
    this.error = null;
    await new Promise<void>((resolve) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        this.error =
          e.code === 'EADDRINUSE'
            ? `Le port ${this.port} est déjà utilisé par un autre programme.`
            : e.code === 'EACCES'
              ? `Windows refuse l'ouverture du port ${this.port}.`
              : `Impossible d'ouvrir l'accès réseau : ${errMsg(e)}`;
        this.server = null;
        this.log(this.error);
        resolve();
      });
      server.listen(this.port, '0.0.0.0', () => {
        server.on('error', (e) => this.log(`Accès réseau : ${errMsg(e)}`));
        this.log(`Accès depuis le téléphone ouvert sur le port ${this.port}.`);
        resolve();
      });
    });
  }

  private async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.log('Accès depuis le téléphone fermé.');
  }

  async close(): Promise<void> {
    await this.stop();
  }

  // ---- Association -------------------------------------------------------------------

  currentCode(): { code: string; expiresAt: number } | null {
    if (!this.code || this.code.expiresAt <= Date.now()) return null;
    return { code: formatCode(this.code.value), expiresAt: this.code.expiresAt };
  }

  newCode(): { code: string; expiresAt: number } {
    this.code = { value: newCodeValue(), expiresAt: Date.now() + CODE_TTL_MS };
    return this.currentCode()!;
  }

  /** Vérifie le code et enregistre l'appareil. Renvoie le jeton à placer dans le cookie. */
  pair(input: unknown, userAgent: string | undefined): { token: string; device: RemoteDevice } {
    const now = Date.now();
    this.failures = this.failures.filter((t) => now - t < 60_000);
    if (this.failures.length >= MAX_FAILURES) {
      throw new HttpError(429, 'Trop d’essais. Patiente une minute puis réessaie.');
    }
    const given = typeof input === 'string' ? normalizeCode(input) : '';
    const live = this.code && this.code.expiresAt > now ? this.code.value : null;
    const a = Buffer.from(given.padEnd(8, '-').slice(0, 8));
    const b = Buffer.from((live ?? '--------').padEnd(8, '-'));
    const same = crypto.timingSafeEqual(a, b) && live !== null && given.length === 8;
    if (!same) {
      this.failures.push(now);
      throw new HttpError(
        400,
        live ? 'Code incorrect. Vérifie-le sur l’écran de ton PC.' : 'Ce code a expiré. Demande-en un nouveau sur ton PC.',
      );
    }
    this.code = null; // usage unique
    return this.createDevice(deviceNameFromUA(userAgent));
  }

  private createDevice(name: string): { token: string; device: RemoteDevice } {
    const token = crypto.randomBytes(32).toString('base64url');
    const hash = sha256(token);
    const now = Date.now();
    const res = this.db
      .prepare('INSERT INTO devices (name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?)')
      .run(name, hash, now, now);
    const id = Number(res.lastInsertRowid);
    this.sessions.set(hash, id);
    return { token, device: { id, name, createdAt: now, lastSeen: now } };
  }

  // ---- Sessions ----------------------------------------------------------------------

  authenticate(cookieHeader: string | undefined): { id: number; name: string } | null {
    const token = parseCookie(cookieHeader, COOKIE_NAME);
    if (!token || token.length > 200) return null;
    const hash = sha256(token);
    const row = this.db.prepare('SELECT id, name FROM devices WHERE token_hash = ?').get(hash) as { id: number; name: string } | undefined;
    if (!row) {
      this.sessions.delete(hash);
      return null;
    }
    this.sessions.set(hash, row.id);
    const now = Date.now();
    if (now - (this.touched.get(row.id) ?? 0) > 60_000) {
      this.touched.set(row.id, now);
      this.db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(now, row.id);
    }
    return row;
  }

  cookieHeader(token: string, secure: boolean): string {
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure ? '; Secure' : ''}`;
  }

  clearCookieHeader(): string {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  listDevices(): RemoteDevice[] {
    const rows = this.db.prepare('SELECT id, name, created_at, last_seen FROM devices ORDER BY last_seen DESC').all() as {
      id: number;
      name: string;
      created_at: number;
      last_seen: number;
    }[];
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastSeen: r.last_seen }));
  }

  revoke(id: number): void {
    this.db.prepare('DELETE FROM devices WHERE id = ?').run(id);
    for (const [hash, deviceId] of this.sessions) if (deviceId === id) this.sessions.delete(hash);
    this.touched.delete(id);
  }

  status(): RemoteStatus {
    const running = this.running;
    if (running && !this.currentCode()) this.newCode();
    return {
      enabled: this.enabled,
      running,
      port: this.port,
      error: this.error,
      addresses: lanAddresses(this.port),
      pairing: running ? this.currentCode() : null,
      devices: this.listDevices(),
    };
  }
}
