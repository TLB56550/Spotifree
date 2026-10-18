import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

declare const __APP_VERSION__: string | undefined;

export const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const isWin = process.platform === 'win32';

export const PORT = Number(process.env.PORT) || 4242;
/** Port d'écoute pour les appareils associés (téléphone), ouvert seulement si l'utilisateur l'active. */
export const REMOTE_PORT = Number(process.env.REMOTE_PORT) || PORT + 1;
/** Port de l'application « Serveur » : toujours limité à ce PC, jamais ouvert au réseau. */
export const CONSOLE_PORT = Number(process.env.CONSOLE_PORT) || PORT + 2;
/** Par défaut l'application n'est joignable que depuis ce PC. */
export const HOST = process.env.HOST || '127.0.0.1';

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function resolveDataDir(): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (isWin) {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'MaBibliotheque');
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'ma-bibliotheque');
}

export function defaultMusicDir(): string {
  return path.join(os.homedir(), 'Music');
}

/** Dossier contenant l'interface compilée. */
export function resolvePublicDir(): string | null {
  if (process.env.PUBLIC_DIR) return path.resolve(process.env.PUBLIC_DIR);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'public'), // version empaquetée
    path.join(here, '..', 'public'),
    path.join(here, '..', '..', 'web', 'dist'), // développement
    path.join(here, '..', '..', '..', 'web', 'dist'),
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, 'index.html'))) ?? null;
}
