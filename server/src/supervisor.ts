import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveDataDir } from './config';
import { EXIT_RESTART } from './update';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fait tourner le serveur en arrière-plan (sans fenêtre) et le relance après une mise à jour (code 75)
 * ou un plantage imprévu. Son journal est « server.log » dans le dossier des données.
 */
export async function runSupervisor(): Promise<number> {
  const dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const logFile = path.join(dataDir, 'server.log');
  try {
    if (fs.statSync(logFile).size > 1024 * 1024) fs.renameSync(logFile, `${logFile}.1`);
  } catch {
    // Pas encore de journal.
  }

  const crashes: number[] = [];
  for (;;) {
    const fd = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, 'serve'], {
      stdio: ['ignore', fd, fd],
      windowsHide: true,
      env: { ...process.env, OPEN_BROWSER: '0' },
    });
    const code = await new Promise<number>((resolve) => {
      child.on('exit', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });
    fs.closeSync(fd);
    if (code === EXIT_RESTART) {
      await sleep(300);
      continue;
    }
    if (code === 0) return 0; // arrêt demandé (« Arrêter le serveur »)
    // Plantage : on relance, mais pas en boucle (3 fois par minute au plus).
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0]! > 60_000) crashes.shift();
    if (crashes.length > 3) return code;
    await sleep(2000);
  }
}
