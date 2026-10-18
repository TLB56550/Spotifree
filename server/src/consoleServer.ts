import http from 'node:http';
import type { FastifyInstance } from 'fastify';
import { errMsg } from './util';

/**
 * Écoute de l'application « Serveur » : un port à part, uniquement sur ce PC (127.0.0.1).
 * Il n'est jamais ouvert au réseau, quoi que choisisse l'utilisateur pour l'accès des autres appareils.
 */
export class ConsoleServer {
  private server: http.Server | null = null;

  constructor(
    private app: FastifyInstance,
    readonly port: number,
    private log: (msg: string) => void,
  ) {}

  async start(): Promise<void> {
    const server = http.createServer((req, res) => this.app.routing(req, res));
    // Les importations de fichiers peuvent durer longtemps.
    server.requestTimeout = 0;
    server.headersTimeout = 60_000;
    await new Promise<void>((resolve) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        this.log(
          e.code === 'EADDRINUSE'
            ? `Le port ${this.port} (application Serveur) est déjà utilisé par un autre programme : l'application Serveur est indisponible.`
            : `Application Serveur indisponible : ${errMsg(e)}`,
        );
        resolve();
      });
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server;
        server.on('error', (e) => this.log(`Application Serveur : ${errMsg(e)}`));
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
