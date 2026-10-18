import http from 'node:http';
import os from 'node:os';
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { RemoteAddress, RemoteStatus } from '../../shared/types';
import { getSetting, setSetting, type DB } from './db';
import { errMsg } from './util';

/**
 * Accès depuis un autre appareil (le téléphone).
 *
 * - Le serveur principal écoute par défaut sur 127.0.0.1 (ce PC uniquement).
 * - Le serveur « distant » (autre port) n'existe que si l'administrateur l'active. Il écoute sur le réseau ;
 *   chaque requête doit de toute façon venir d'une personne connectée (voir auth.ts).
 */

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

  /** Démarre l'écoute réseau si l'administrateur l'a activée. */
  async init(): Promise<void> {
    if (this.enabled) await this.start();
  }

  async setEnabled(on: boolean): Promise<void> {
    setSetting(this.db, 'remote_enabled', on);
    if (on) await this.start();
    else await this.stop();
  }

  private async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((req, res) => this.app.routing(req, res));
    // Les envois de fichiers peuvent durer longtemps (réseau mobile).
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
        this.log(`Accès depuis les autres appareils ouvert sur le port ${this.port}.`);
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
    this.log('Accès depuis les autres appareils fermé.');
  }

  async close(): Promise<void> {
    await this.stop();
  }

  status(): RemoteStatus {
    return {
      enabled: this.enabled,
      running: this.running,
      port: this.port,
      error: this.error,
      addresses: lanAddresses(this.port),
    };
  }
}
