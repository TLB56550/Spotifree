import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Fastify from 'fastify';
import { HOST, PORT, REMOTE_PORT, VERSION, isWin, resolveDataDir, resolvePublicDir } from './config';
import { getMusicDirs, openDb } from './db';
import { RemoteAccess } from './remote';
import { registerRoutes } from './routes';
import { Scanner } from './scanner';
import { errMsg } from './util';

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString('fr-FR')}] ${msg}`);

const dataDir = resolveDataDir();
const coversDir = path.join(dataDir, 'covers');
fs.mkdirSync(coversDir, { recursive: true });

const db = openDb(dataDir);
const scanner = new Scanner(db, dataDir, () => getMusicDirs(db), log);
const publicDir = resolvePublicDir();

const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
const remote = new RemoteAccess(db, app, REMOTE_PORT, log);
registerRoutes(app, { db, scanner, dataDir, coversDir, publicDir, host: HOST, port: PORT, remote });

const url = `http://127.0.0.1:${PORT}`;

/** Ouvre l'application dans une fenêtre dédiée (Edge ou Chrome), sinon dans le navigateur par défaut. */
function openApp(): void {
  if (!isWin) return;
  const attempts: string[][] = [
    ['/c', 'start', '', 'msedge', `--app=${url}`],
    ['/c', 'start', '', 'chrome', `--app=${url}`],
    ['/c', 'start', '', url],
  ];
  const tryNext = (i: number) => {
    const args = attempts[i];
    if (!args) return;
    const child = spawn('cmd', args, { stdio: 'ignore', windowsHide: true });
    child.on('error', () => tryNext(i + 1));
    child.on('exit', (code) => {
      if (code !== 0) tryNext(i + 1);
    });
  };
  tryNext(0);
}

try {
  await app.listen({ port: PORT, host: HOST });
} catch (e) {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') {
    // L'application est peut-être déjà ouverte : on la rouvre simplement.
    try {
      const res = await fetch(`${url}/api/health`);
      const info = (await res.json()) as { app?: string };
      if (info.app === 'ma-bibliotheque') {
        log('Ma Bibliothèque est déjà lancée : ouverture de la fenêtre.');
        if (process.env.OPEN_BROWSER === '1') openApp();
        process.exit(0);
      }
    } catch {
      // Le port est pris par autre chose.
    }
    console.error(`Le port ${PORT} est déjà utilisé par un autre programme. Ferme-le puis relance.`);
  } else {
    console.error(`Impossible de démarrer le serveur : ${errMsg(e)}`);
  }
  process.exit(1);
}

log(`Ma Bibliothèque ${VERSION} est prête : ${url}`);
log(`Données : ${dataDir}`);
if (!publicDir) log("Attention : l'interface (dossier « public ») est introuvable.");
if (process.env.OPEN_BROWSER === '1') openApp();
await remote.init();

if (getMusicDirs(db).length) {
  scanner.watch();
  scanner.start();
} else {
  log("Aucun dossier de musique n'est configuré : choisis-le depuis l'application.");
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    scanner.stopWatching();
    void remote.close();
    app.close().finally(() => process.exit(0));
  });
}
