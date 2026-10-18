import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION, isWin } from './config';
import { errMsg } from './util';

/** Ouvre l'application dans une fenêtre dédiée (Edge ou Chrome), sinon dans le navigateur par défaut. */
export function openAppWindow(url: string): void {
  if (process.env.MB_PLAYER_DRY === '1') {
    console.log(`OPEN ${url}`);
    return;
  }
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

/** Dossiers de l'installation Windows (« …/app » et « …/runtime »), ou null quand on tourne depuis les sources. */
export function installedDirs(): { root: string; appDir: string } | null {
  if (process.env.UPDATE_TARGET_DIR) {
    const appDir = path.resolve(process.env.UPDATE_TARGET_DIR);
    return { root: path.dirname(appDir), appDir };
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (path.basename(here) === 'app' && fs.existsSync(path.join(here, '..', 'runtime'))) return { root: path.dirname(here), appDir: here };
  return null;
}

// ---------------------------------------------------------------- démarrage avec Windows

const AUTOSTART_NAME = 'Ma Bibliotheque (serveur).vbs';

function startupDir(): string | null {
  if (process.env.MB_STARTUP_DIR) return process.env.MB_STARTUP_DIR;
  if (!isWin) return null;
  const base = process.env.APPDATA;
  return base ? path.join(base, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') : null;
}

export function autostartStatus(): { available: boolean; enabled: boolean } {
  const dir = startupDir();
  const available = Boolean(dir && installedDirs());
  return { available, enabled: available && fs.existsSync(path.join(dir!, AUTOSTART_NAME)) };
}

/** Active ou coupe le démarrage du serveur (en arrière-plan) à l'ouverture de session Windows. */
export async function setAutostart(on: boolean): Promise<void> {
  const dir = startupDir();
  const inst = installedDirs();
  if (!dir || !inst) throw new Error('indisponible dans cette installation');
  const file = path.join(dir, AUTOSTART_NAME);
  if (!on) return void (await fsp.rm(file, { force: true }));
  const node = path.join(inst.root, 'runtime', 'node.exe');
  const script = path.join(inst.appDir, 'server.mjs');
  const q = (s: string) => s.replace(/"/g, '""');
  const text =
    "' Demarre le serveur Ma Bibliotheque en arriere-plan a l'ouverture de session.\r\n" +
    'Set sh = CreateObject("WScript.Shell")\r\n' +
    `sh.Run """${q(node)}"" --no-warnings ""${q(script)}"" run", 0, False\r\n`;
  await fsp.mkdir(dir, { recursive: true });
  // UTF-16 avec BOM : le chemin peut contenir des accents (nom d'utilisateur Windows).
  await fsp.writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
}

// ---------------------------------------------------------------- lanceurs installés

/**
 * Après une mise à jour automatique, les petits lanceurs (« Ma Bibliotheque.vbs »…) livrés dans « app/launchers »
 * sont copiés à la racine de l'installation, et les raccourcis existants « Ma Bibliotheque » sont pointés dessus (une seule fois).
 */
export async function ensureLaunchers(dataDir: string, log: (m: string) => void): Promise<void> {
  const inst = installedDirs();
  if (!inst) return;
  const src = path.join(inst.appDir, 'launchers');
  if (!fs.existsSync(src)) return;
  try {
    for (const name of await fsp.readdir(src)) {
      const from = await fsp.readFile(path.join(src, name));
      const to = path.join(inst.root, name);
      const same = fs.existsSync(to) && (await fsp.readFile(to)).equals(from);
      if (!same) await fsp.writeFile(to, from);
    }
    const marker = path.join(dataDir, 'launchers.done');
    if (!isWin || fs.existsSync(marker)) return;
    const ps = [
      '$ws = New-Object -ComObject WScript.Shell',
      "$vbs = Join-Path $env:MB_ROOT 'Ma Bibliotheque.vbs'",
      "if (Test-Path $vbs) { foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {",
      "$p = Join-Path $d 'Ma Bibliotheque.lnk'",
      "if (Test-Path $p) { $l = $ws.CreateShortcut($p); $l.TargetPath = Join-Path $env:SystemRoot 'System32\\wscript.exe'; $l.Arguments = ([char]34 + $vbs + [char]34); $l.WorkingDirectory = $env:MB_ROOT; $l.WindowStyle = 1; $l.Save() } } }",
    ].join('; ');
    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        { env: { ...process.env, MB_ROOT: inst.root }, timeout: 30_000, windowsHide: true },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    await fsp.writeFile(marker, VERSION);
    log('Raccourcis « Ma Bibliotheque » mis à jour : ils ouvrent maintenant le lecteur (le serveur tourne en arrière-plan).');
  } catch (e) {
    log(`Lanceurs non mis à jour : ${errMsg(e)}`);
  }
}
