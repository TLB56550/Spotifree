import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { HOST, PORT, REMOTE_PORT, VERSION, resolveDataDir, resolvePublicDir } from './config';
import { Auth, checkPassword, cleanName, normalizeEmail } from './auth';
import { ensureLaunchers, openAppWindow } from './desktop';
import { getMusicDirs, openDb } from './db';
import { RemoteAccess } from './remote';
import { registerRoutes } from './routes';
import { Scanner } from './scanner';
import { EXIT_RESTART, Updater } from './update';
import { errMsg } from './util';

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString('fr-FR')}] ${msg}`);

const dataDir = resolveDataDir();
const coversDir = path.join(dataDir, 'covers');
fs.mkdirSync(coversDir, { recursive: true });

const db = openDb(dataDir);
// Dossier réservé aux fichiers importés (depuis le PC ou le téléphone), distinct de la musique du PC.
const uploadsDir = path.resolve(dataDir, 'Importations');
const oldUploadsDir = path.resolve(dataDir, 'Envois du téléphone');
if (fs.existsSync(oldUploadsDir) && !fs.existsSync(uploadsDir)) {
  try {
    fs.renameSync(oldUploadsDir, uploadsDir); // l'analyse reconnaît les fichiers déplacés : likes et playlists conservés
  } catch {
    // Dossier occupé : on garde l'ancien emplacement pour cette fois.
  }
}
fs.mkdirSync(uploadsDir, { recursive: true });
const scanner = new Scanner(db, dataDir, () => [...getMusicDirs(db), uploadsDir], log);
const publicDir = resolvePublicDir();

const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
const remote = new RemoteAccess(db, app, REMOTE_PORT, log);
const quit = (code: number): Promise<void> => {
  scanner.stopWatching();
  void remote.close();
  return app.close().finally(() => process.exit(code));
};
const updater = new Updater(dataDir, log, () => quit(EXIT_RESTART));
const auth = new Auth(db);
const localToken = crypto.randomBytes(24).toString('hex');
try {
  fs.writeFileSync(path.join(dataDir, 'server.token'), localToken, { mode: 0o600 });
} catch {
  // Sans ce fichier, seul un administrateur connecté peut arrêter le serveur (l'installateur le demandera à la main).
}
registerRoutes(app, { db, scanner, dataDir, coversDir, uploadsDir, updater, publicDir, host: HOST, port: PORT, remote, auth, localToken });

// Serveur sans écran (NAS, Docker) : le premier administrateur peut être créé depuis l'environnement.
if (!auth.hasUsers() && process.env.MB_ADMIN_EMAIL && process.env.MB_ADMIN_PASSWORD) {
  try {
    const email = normalizeEmail(process.env.MB_ADMIN_EMAIL);
    await auth.createUser({
      email,
      name: cleanName(process.env.MB_ADMIN_NAME, email),
      password: checkPassword(process.env.MB_ADMIN_PASSWORD),
      isAdmin: true,
    });
    log(`Compte administrateur créé : ${email}`);
  } catch (e) {
    log(`Compte administrateur non créé : ${errMsg(e)}`);
  }
}

const url = `http://127.0.0.1:${PORT}`;

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
        if (process.env.OPEN_BROWSER === '1') openAppWindow(url);
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
if (!auth.hasUsers()) log("Aucun compte pour l'instant : ouvre l'application sur ce PC pour créer le compte administrateur.");
if (!publicDir) log("Attention : l'interface (dossier « public ») est introuvable.");
if (process.env.OPEN_BROWSER === '1') openAppWindow(url);
await remote.init();
void ensureLaunchers(dataDir, log);

if (!getMusicDirs(db).length) log("Aucun dossier de musique n'est configuré : choisis-le depuis l'application.");
scanner.watch();
scanner.start();
// Mise à jour automatique : recherche au démarrage (sans bloquer l'ouverture de l'application).
if (process.env.UPDATE_DISABLED !== '1' && VERSION !== 'dev') setTimeout(() => void updater.check(), 2000);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void quit(0);
  });
}
