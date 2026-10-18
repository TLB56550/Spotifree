import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AdminUsers, ConsoleInfo, ConsoleStats } from '../../shared/types';
import { Auth, checkPassword, cleanName, normalizeEmail } from './auth';
import { defaultMusicDir, isWin } from './config';
import { getMusicDirs, setSetting } from './db';
import { autostartStatus, openAppWindow, setAutostart } from './desktop';
import { AUDIO_EXT } from './scanner';
import type { Ctx } from './routes';
import { GB, computeStorage, deleteImport, freeSpaceAt, invalidateStorage, listImports, minFreeGb } from './storage';
import { HttpError, errMsg, mustInt, pathKey } from './util';
import { VERSION } from './config';

/**
 * L'application « Serveur » : tout ce qui gère le serveur (comptes, appareils, musique, accès réseau,
 * mises à jour, arrêt). Ces routes n'existent que sur le port de la console, qui n'écoute que sur ce PC :
 * ni le lecteur, ni un téléphone, ni un compte (même ancien administrateur) ne peut les atteindre.
 */

function str(v: unknown, what: string, max = 200): string {
  if (typeof v !== 'string') throw new HttpError(400, `${what} manquant`);
  const s = v.trim();
  if (!s) throw new HttpError(400, `${what} manquant`);
  if (s.length > max) throw new HttpError(400, `${what} trop long`);
  return s;
}

const MAX_UPLOAD = 1024 * 1024 * 1024; // 1 Go par fichier
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Nom de fichier sûr (sans chemin, sans caractères interdits sous Windows) ; null si l'extension n'est pas de l'audio. */
function safeUploadName(raw: string): { base: string; ext: string } | null {
  const leaf = raw.split(/[\\/]/).pop() ?? '';
  const ext = path.extname(leaf).toLowerCase();
  if (!AUDIO_EXT.has(ext)) return null;
  let base = leaf
    .slice(0, leaf.length - ext.length)
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120)
    .trim();
  if (!base) base = 'audio';
  if (RESERVED_NAMES.test(base)) base = `_${base}`;
  return { base, ext };
}

/** Taille d'un fichier ou null s'il n'existe pas. */
async function sizeOf(file: string): Promise<number | null> {
  try {
    return (await fsp.stat(file)).size;
  } catch {
    return null;
  }
}

function pickFolder(): Promise<string | null> {
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = 'Choisis le dossier qui contient ta musique'",
    '$d.ShowNewFolderButton = $false',
    "if ($d.ShowDialog($owner) -eq 'OK') { Write-Output $d.SelectedPath }",
  ].join('; ');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 5 * 60_000, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return reject(new HttpError(500, "Impossible d'ouvrir la fenêtre de choix du dossier."));
        const p = stdout.trim();
        resolve(p || null);
      },
    );
  });
}

export function registerConsoleRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, scanner, auth } = ctx;
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;
  const boolOf = (v: unknown): boolean => {
    if (typeof v !== 'boolean') throw new HttpError(400, 'Valeur manquante');
    return v;
  };

  // ---- Aperçu
  app.get('/api/console/info', async (): Promise<ConsoleInfo> => ({
    version: VERSION,
    platform: process.platform,
    dataDir: ctx.dataDir,
    uploadsDir: ctx.uploadsDir,
    musicDirs: getMusicDirs(db),
    defaultMusicDir: defaultMusicDir(),
    canBrowse: isWin,
    playerUrl: ctx.playerUrl,
  }));

  app.get('/api/console/stats', async (): Promise<ConsoleStats> => {
    const r = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM tracks) AS tracks, (SELECT COUNT(*) FROM albums) AS albums,
           (SELECT COUNT(*) FROM artists) AS artists, (SELECT COALESCE(SUM(duration), 0) FROM tracks) AS duration`,
      )
      .get() as unknown as Omit<ConsoleStats, 'users' | 'devices'>;
    return { tracks: r.tracks, albums: r.albums, artists: r.artists, duration: r.duration, users: auth.userCount(), online: auth.onlineUserCount(), devices: auth.sessionCount() };
  });

  app.post('/api/console/open-player', async () => {
    await openAppWindow(ctx.playerUrl);
    return { ok: true };
  });

  // ---- Musique : dossiers, analyse, importation
  app.put('/api/console/music', async (req) => {
    const b = body(req);
    if (!Array.isArray(b.musicDirs)) throw new HttpError(400, 'Liste de dossiers manquante');
    const dirs: string[] = [];
    for (const raw of b.musicDirs) {
      const dir = path.resolve(str(raw, 'Dossier', 1000));
      let stat: fs.Stats;
      try {
        stat = await fsp.stat(dir);
      } catch {
        throw new HttpError(400, `Dossier introuvable : ${dir}`);
      }
      if (!stat.isDirectory()) throw new HttpError(400, `Ce n'est pas un dossier : ${dir}`);
      if (!dirs.some((d) => d.toLowerCase() === dir.toLowerCase())) dirs.push(dir);
    }
    setSetting(db, 'music_dirs', dirs);
    scanner.watch();
    scanner.start();
    return { musicDirs: dirs };
  });

  app.post('/api/console/browse', async () => {
    if (!isWin) throw new HttpError(501, "Le choix d'un dossier n'est pas disponible ici.");
    return { path: await pickFolder() };
  });

  app.get('/api/console/scan', async () => scanner.status);
  app.post('/api/console/scan', async (req) => ({ started: scanner.start({ full: Boolean(body(req).full) }) }));

  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  app.post('/api/console/upload', async (req, reply) => {
    const query = (req.query ?? {}) as { name?: unknown };
    const parsed = safeUploadName(typeof query.name === 'string' ? query.name : '');
    if (!parsed) throw new HttpError(415, 'Format non pris en charge (MP3, FLAC, M4A, AAC, OGG, OPUS ou WAV).');
    const stream = req.body as NodeJS.ReadableStream | undefined;
    if (!stream || typeof (stream as { pipe?: unknown }).pipe !== 'function') throw new HttpError(400, 'Fichier manquant.');
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_UPLOAD) throw new HttpError(413, 'Fichier trop volumineux (1 Go au maximum).');

    await fsp.mkdir(ctx.uploadsDir, { recursive: true });
    // On garde de la place libre sur le disque : l'importation est refusée si elle la fait passer sous la réserve.
    const free = await freeSpaceAt(ctx.uploadsDir);
    if (free !== null && free - declared < minFreeGb(db) * GB) {
      throw new HttpError(507, `Pas assez d'espace libre sur le disque (réserve de ${minFreeGb(db)} Go). Libère de la place ou change la réserve dans Stockage.`);
    }
    const trackAt = (file: string) => db.prepare('SELECT id FROM tracks WHERE path = ?').get(file) as { id: number } | undefined;

    // Déjà envoyé (même nom, même taille) : on ne le copie pas une seconde fois.
    const sameFile = path.join(ctx.uploadsDir, parsed.base + parsed.ext);
    if (declared > 0 && (await sizeOf(sameFile)) === declared && trackAt(sameFile)) {
      (stream as NodeJS.ReadableStream & { resume(): void }).resume();
      return { duplicate: true };
    }

    let target = sameFile;
    for (let n = 2; (await sizeOf(target)) !== null; n++) {
      target = path.join(ctx.uploadsDir, `${parsed.base} (${n})${parsed.ext}`);
      if (n > 999) throw new HttpError(500, 'Trop de fichiers portent déjà ce nom.');
    }

    const part = `${target}.part`;
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > MAX_UPLOAD) cb(new HttpError(413, 'Fichier trop volumineux (1 Go au maximum).'));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(stream, limiter, fs.createWriteStream(part, { flags: 'wx' }));
      if (received === 0) throw new HttpError(400, 'Le fichier est vide.');
      if (declared > 0 && received !== declared) throw new HttpError(400, 'Envoi incomplet.');
      await fsp.rename(part, target);
    } catch (e) {
      await fsp.rm(part, { force: true }).catch(() => {});
      if (e instanceof HttpError) throw e;
      throw new HttpError(500, "L'envoi a échoué : " + errMsg(e));
    }

    scanner.start();
    await scanner.whenIdle();
    let row = trackAt(target);
    if (!row) {
      // Windows ne distingue pas les majuscules : on retrouve le titre sans tenir compte de la casse.
      const all = db.prepare('SELECT id, path FROM tracks WHERE path LIKE ?').all(`%${path.basename(target)}`) as unknown as { id: number; path: string }[];
      row = all.find((r) => pathKey(r.path) === pathKey(target));
    }
    if (!row) {
      await fsp.rm(target, { force: true }).catch(() => {});
      scanner.start();
      throw new HttpError(415, "Ce fichier n'a pas pu être lu : il est peut-être corrompu.");
    }
    invalidateStorage();
    reply.code(201);
    return { duplicate: false };
  });

  // ---- Stockage : espace utilisé et libre, fichiers importés
  app.get('/api/console/storage', async (req) => {
    const force = (req.query as { refresh?: string }).refresh === '1';
    const st = scanner.status;
    return computeStorage(db, ctx.dataDir, ctx.uploadsDir, ctx.coversDir, force || st.running, st.finishedAt ?? 0);
  });

  app.put('/api/console/storage/settings', async (req) => {
    const v = body(req).minFreeGb;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100_000) throw new HttpError(400, 'Indique un nombre de Go entre 0 et 100 000.');
    setSetting(db, 'import_min_free_gb', Math.round(v * 10) / 10);
    return computeStorage(db, ctx.dataDir, ctx.uploadsDir, ctx.coversDir, true);
  });

  app.get('/api/console/storage/imports', async () => listImports(db, ctx.uploadsDir));

  app.delete('/api/console/storage/imports/:name', async (req) => {
    await deleteImport(ctx.uploadsDir, (req.params as { name: string }).name);
    scanner.start(); // le titre disparaît de la bibliothèque
    invalidateStorage();
    return listImports(db, ctx.uploadsDir);
  });

  // ---- Serveur : démarrage avec Windows, mises à jour, arrêt
  app.get('/api/console/update', async () => ctx.updater.status());
  app.post('/api/console/update/check', async () => {
    void ctx.updater.check();
    return ctx.updater.status();
  });

  app.get('/api/console/autostart', async () => autostartStatus());
  app.put('/api/console/autostart', async (req) => {
    const enabled = boolOf(body(req).enabled);
    try {
      await setAutostart(enabled);
    } catch (e) {
      throw new HttpError(400, `Impossible de modifier le démarrage automatique : ${errMsg(e)}`);
    }
    return autostartStatus();
  });

  app.post('/api/console/shutdown', async (_req, reply) => {
    setTimeout(() => process.exit(0), 300);
    return reply.send({ ok: true });
  });

  // ---- Accès depuis les autres appareils
  app.get('/api/console/remote', async () => ctx.remote.status());
  app.put('/api/console/remote', async (req) => {
    await ctx.remote.setEnabled(boolOf(body(req).enabled));
    return ctx.remote.status();
  });

  // ---- Comptes
  const usersView = (): AdminUsers => ({ users: auth.listUsers(), signupOpen: auth.signupOpen, legacy: auth.legacyCounts() });
  const targetOf = (req: FastifyRequest) => mustInt((req.params as { id: string }).id);

  app.get('/api/console/users', async () => usersView());

  app.put('/api/console/signup', async (req) => {
    auth.signupOpen = boolOf(body(req).open);
    return usersView();
  });

  app.post('/api/console/users', async (req, reply) => {
    const b = body(req);
    const email = normalizeEmail(b.email);
    const password = checkPassword(b.password);
    await auth.createUser({ email, name: cleanName(b.name, email), password, mustChange: true });
    reply.code(201);
    return usersView();
  });

  app.patch('/api/console/users/:id', async (req) => {
    const id = targetOf(req);
    const b = body(req);
    const patch: { name?: string; disabled?: boolean } = {};
    if (b.name !== undefined) patch.name = cleanName(b.name, auth.getUser(id)?.email ?? 'compte');
    if (b.disabled !== undefined) {
      if (typeof b.disabled !== 'boolean') throw new HttpError(400, 'Valeur invalide');
      patch.disabled = b.disabled;
    }
    auth.updateUser(id, patch);
    return usersView();
  });

  app.post('/api/console/users/:id/reset', async (req) => {
    const id = targetOf(req);
    if (!auth.getUser(id)) throw new HttpError(404, 'Compte introuvable.');
    const password = Auth.tempPassword();
    await auth.setPassword(id, password, true);
    auth.revokeUserSessions(id);
    return { password, ...usersView() };
  });

  app.post('/api/console/users/:id/adopt', async (req) => {
    auth.adoptLegacy(targetOf(req));
    return usersView();
  });

  app.delete('/api/console/users/:id', async (req) => {
    auth.deleteUser(targetOf(req));
    return usersView();
  });

  // ---- Appareils connectés (tous comptes confondus)
  app.get('/api/console/sessions', async () => auth.listAllSessions());
  app.delete('/api/console/sessions/:id', async (req) => {
    auth.revokeSession(targetOf(req));
    return auth.listAllSessions();
  });
}
