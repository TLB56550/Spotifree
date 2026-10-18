import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isWin } from './config';
import { errMsg } from './util';

/** Navigateurs installés capables d'ouvrir une fenêtre d'application (Edge d'abord, puis Chrome). */
function appBrowsers(): string[] {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA;
  const list = [
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ...(local ? [path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')] : []),
  ];
  return list.filter((f) => fs.existsSync(f));
}

/** Lance un programme détaché de celui-ci ; vrai s'il a démarré. */
function launchDetached(command: string, args: string[], hide: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', windowsHide: hide, detached: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Ouvre l'application dans une fenêtre dédiée (Edge ou Chrome en mode « application »), sinon dans le navigateur par défaut.
 * Le navigateur est lancé directement et détaché de ce processus : sous Windows, Node arrête sinon ses enfants
 * (et la fenêtre qu'ils viennent d'ouvrir) dès qu'il se termine, ce qui est le cas du lecteur juste après l'appel.
 */
export async function openAppWindow(url: string): Promise<void> {
  if (process.env.MB_PLAYER_DRY === '1') {
    console.log(`OPEN ${url}`);
    return;
  }
  if (!isWin) return;
  for (const exe of appBrowsers()) {
    // La fenêtre du navigateur ne doit pas être masquée (contrairement au programme qui la lance).
    if (await launchDetached(exe, [`--app=${url}`], false)) return;
  }
  await launchDetached('cmd', ['/c', 'start', '', url], true);
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

const AUTOSTART_NAME = 'Spotifree (serveur).vbs';
/** Ancien nom du script (l'application s'appelait « Ma Bibliotheque ») : retiré et remplacé au premier démarrage. */
const OLD_AUTOSTART_NAME = 'Ma Bibliotheque (serveur).vbs';

function startupDir(): string | null {
  if (process.env.MB_STARTUP_DIR) return process.env.MB_STARTUP_DIR;
  if (!isWin) return null;
  const base = process.env.APPDATA;
  return base ? path.join(base, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') : null;
}

export function autostartStatus(): { available: boolean; enabled: boolean } {
  const dir = startupDir();
  const available = Boolean(dir && installedDirs());
  return { available, enabled: available && (fs.existsSync(path.join(dir!, AUTOSTART_NAME)) || fs.existsSync(path.join(dir!, OLD_AUTOSTART_NAME))) };
}

/** Active ou coupe le démarrage du serveur (en arrière-plan) à l'ouverture de session Windows. */
export async function setAutostart(on: boolean): Promise<void> {
  const dir = startupDir();
  const inst = installedDirs();
  if (!dir || !inst) throw new Error('indisponible dans cette installation');
  const file = path.join(dir, AUTOSTART_NAME);
  await fsp.rm(path.join(dir, OLD_AUTOSTART_NAME), { force: true });
  if (!on) return void (await fsp.rm(file, { force: true }));
  const node = path.join(inst.root, 'runtime', 'node.exe');
  const script = path.join(inst.appDir, 'server.mjs');
  const q = (s: string) => s.replace(/"/g, '""');
  const text =
    "' Demarre le serveur Spotifree en arriere-plan a l'ouverture de session.\r\n" +
    'Set sh = CreateObject("WScript.Shell")\r\n' +
    `sh.Run """${q(node)}"" --no-warnings ""${q(script)}"" run", 0, False\r\n`;
  await fsp.mkdir(dir, { recursive: true });
  // UTF-16 avec BOM : le chemin peut contenir des accents (nom d'utilisateur Windows).
  await fsp.writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
}

// ---------------------------------------------------------------- lanceurs installés

/**
 * Après une mise à jour automatique, les petits lanceurs (« Spotifree.vbs », « Spotifree Serveur.vbs »…)
 * livrés dans « app/launchers » sont copiés à la racine de l'installation. Une seule fois, les raccourcis existants
 * (bureau, menu Démarrer), y compris ceux de l'ancien nom « Ma Bibliotheque », deviennent « Spotifree » (le lecteur)
 * et « Spotifree Serveur » (l'application Serveur).
 */
const SHORTCUTS_REV = '3';

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
    // Démarrage avec Windows activé sous l'ancien nom : on le refait sous le nouveau.
    const startup = startupDir();
    if (startup && fs.existsSync(path.join(startup, OLD_AUTOSTART_NAME))) await setAutostart(true).catch(() => {});
    const marker = path.join(dataDir, 'shortcuts.done');
    if (!isWin) return;
    if (fs.existsSync(marker) && (await fsp.readFile(marker, 'utf8')).trim() === SHORTCUTS_REV) return;
    const ps = [
      '$ws = New-Object -ComObject WScript.Shell',
      "$wsh = Join-Path $env:SystemRoot 'System32\\wscript.exe'",
      "$vbsPlayer = Join-Path $env:MB_ROOT 'Spotifree.vbs'",
      "$vbsServer = Join-Path $env:MB_ROOT 'Spotifree Serveur.vbs'",
      "$iconPlayer = Join-Path $env:MB_ROOT 'app\\icone.ico'",
      "$iconServer = Join-Path $env:MB_ROOT 'app\\icone-serveur.ico'",
      "foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {",
      "$old = Join-Path $d 'Ma Bibliotheque.lnk'; $oldS = Join-Path $d 'Ma Bibliotheque Serveur.lnk'; $p = Join-Path $d 'Spotifree.lnk'",
      'if (((Test-Path $old) -or (Test-Path $p)) -and (Test-Path $vbsPlayer)) {',
      'Remove-Item $old, $oldS -ErrorAction SilentlyContinue',
      "$l = $ws.CreateShortcut($p); $l.TargetPath = $wsh; $l.Arguments = ([char]34 + $vbsPlayer + [char]34); $l.WorkingDirectory = $env:MB_ROOT; $l.WindowStyle = 1; $l.Description = 'Spotifree - lecteur'; if (Test-Path $iconPlayer) { $l.IconLocation = $iconPlayer }; $l.Save()",
      "if (Test-Path $vbsServer) { $s = $ws.CreateShortcut((Join-Path $d 'Spotifree Serveur.lnk')); $s.TargetPath = $wsh; $s.Arguments = ([char]34 + $vbsServer + [char]34); $s.WorkingDirectory = $env:MB_ROOT; $s.WindowStyle = 1; $s.Description = 'Spotifree - serveur'; if (Test-Path $iconServer) { $s.IconLocation = $iconServer }; $s.Save() }",
      '} }',
    ].join('; ');
    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        { env: { ...process.env, MB_ROOT: inst.root }, timeout: 30_000, windowsHide: true },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    await fsp.writeFile(marker, SHORTCUTS_REV);
    log("Raccourcis mis à jour : « Spotifree » ouvre le lecteur, « Spotifree Serveur » ouvre l'application Serveur.");
  } catch (e) {
    log(`Lanceurs non mis à jour : ${errMsg(e)}`);
  }
}
