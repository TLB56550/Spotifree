import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PORT, resolveDataDir } from './config';
import { openAppWindow } from './desktop';

const DEFAULT_SERVER = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function configFile(): string {
  return path.join(resolveDataDir(), 'player.json');
}

function readServer(): string {
  try {
    const v = JSON.parse(fs.readFileSync(configFile(), 'utf8')) as { server?: unknown };
    if (typeof v.server === 'string' && /^https?:\/\//i.test(v.server)) return v.server.replace(/\/+$/, '');
  } catch {
    // Pas de réglage : le serveur de ce PC.
  }
  return DEFAULT_SERVER;
}

async function healthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return ((await res.json()) as { app?: string }).app === 'ma-bibliotheque';
  } catch {
    return false;
  }
}

function isThisPc(url: string): boolean {
  try {
    const h = new URL(url);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(h.hostname) && Number(h.port || 80) === PORT;
  } catch {
    return false;
  }
}

/** Lance le serveur en arrière-plan, sans fenêtre, indépendamment du lecteur. */
function startServerInBackground(): void {
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, 'run'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });
  child.unref();
}

/**
 * Le lecteur : ouvre la fenêtre de l'application sur le serveur choisi (ce PC par défaut) et s'arrête.
 * Fermer la fenêtre n'arrête rien ; si le serveur de ce PC n'est pas lancé, il est d'abord démarré en arrière-plan.
 */
export async function runPlayer(args: string[]): Promise<number> {
  if (args[0] === '--set-server') {
    const raw = (args[1] ?? '').trim();
    if (!/^https?:\/\/[^\s/]+/i.test(raw)) {
      console.error('Adresse invalide : elle doit commencer par http:// ou https://');
      return 1;
    }
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify({ server: raw.replace(/\/+$/, '') }, null, 2));
    console.log(`Serveur du lecteur : ${raw}`);
    return 0;
  }

  const url = readServer();
  if (isThisPc(url) && !(await healthy(url))) {
    startServerInBackground();
    for (let i = 0; i < 80 && !(await healthy(url)); i++) await sleep(500);
  }
  await openAppWindow(url);
  // Laisse à Windows le temps de présenter la fenêtre avant que ce processus ne disparaisse.
  await sleep(1500);
  return 0;
}
