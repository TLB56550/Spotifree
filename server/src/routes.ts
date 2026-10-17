import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Settings } from '../../shared/types';
import { VERSION, defaultMusicDir, isLoopbackHost, isWin } from './config';
import { getMusicDirs, setSetting, type DB } from './db';
import * as q from './queries';
import { PAIR_PAGE } from './pairPage';
import { isLocalRequest, type RemoteAccess } from './remote';
import type { Scanner } from './scanner';
import { HttpError, errMsg, mustInt, pathKey, toInt } from './util';
import { AUDIO_EXT } from './scanner';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface Ctx {
  db: DB;
  scanner: Scanner;
  dataDir: string;
  coversDir: string;
  uploadsDir: string;
  publicDir: string | null;
  host: string;
  port: number;
  remote: RemoteAccess;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Vrai si la requête vient du PC lui-même. */
    mbLocal: boolean;
    /** Appareil associé (téléphone) qui fait la requête, s'il y en a un. */
    mbDevice: { id: number; name: string } | null;
  }
}

const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
};

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

function str(v: unknown, what: string, max = 200): string {
  if (typeof v !== 'string') throw new HttpError(400, `${what} manquant`);
  const s = v.trim();
  if (!s) throw new HttpError(400, `${what} manquant`);
  if (s.length > max) throw new HttpError(400, `${what} trop long`);
  return s;
}

function intList(v: unknown, what: string): number[] {
  if (!Array.isArray(v)) throw new HttpError(400, `${what} invalide`);
  const out = v.map(toInt);
  if (out.some((n) => n === null)) throw new HttpError(400, `${what} invalide`);
  return out as number[];
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

export function registerRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, scanner } = ctx;
  const loopback = isLoopbackHost(ctx.host);

  // ---- Protection
  // 1. Le PC (127.0.0.1) est de confiance. 2. Tout le reste doit venir d'un appareil associé.
  // 3. Aucune requête qui modifie quelque chose ne passe sans l'en-tête x-mb et une origine cohérente.
  app.decorateRequest('mbLocal', false);
  app.decorateRequest('mbDevice', null);

  const requireLocal = (req: FastifyRequest) => {
    if (!req.mbLocal) throw new HttpError(403, 'Cette action est réservée au PC.');
  };

  // Ce que peut charger un appareil qui n'est pas encore associé (sans aucune donnée de musique).
  const openToVisitors = (method: string, url: string) => {
    if (url === '/api/health') return method === 'GET' || method === 'HEAD';
    if (url === '/api/pair') return method === 'POST';
    if (url.startsWith('/api/')) return false;
    return (method === 'GET' || method === 'HEAD') && /\.[a-z0-9]{1,12}$/i.test(url); // fichiers de l'interface
  };

  app.addHook('onRequest', async (req, reply) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/';
    const local = isLocalRequest(req.raw, ctx.port);
    req.mbLocal = local;
    req.mbDevice = null;

    if (!local) {
      // Sur le serveur du PC, seule l'adresse « localhost » est admise (protège du « DNS rebinding »).
      if (req.raw.socket.localPort === ctx.port && loopback) {
        return reply.code(403).send({ error: 'Adresse non autorisée.' });
      }
      if (!ctx.remote.enabled) {
        return reply.code(403).send({ error: 'L’accès depuis un autre appareil est désactivé.' });
      }
      req.mbDevice = ctx.remote.authenticate(req.headers.cookie);
      if (!req.mbDevice && !openToVisitors(req.method, url)) {
        if (url.startsWith('/api/')) return reply.code(401).send({ error: 'Appareil non associé.' });
        return reply.code(200).header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-store').send(PAIR_PAGE);
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const host = (req.headers.host ?? '').toLowerCase();
      const origin = req.headers.origin;
      if (origin) {
        let originHost = '';
        try {
          originHost = new URL(origin).host.toLowerCase();
        } catch {
          // Origine illisible : refusée plus bas.
        }
        if (originHost !== host) return reply.code(403).send({ error: 'Origine refusée.' });
      }
      if (req.headers['x-mb'] !== '1') return reply.code(403).send({ error: 'Requête refusée.' });
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'Requête invalide.' });
    console.error(err);
    return reply.code(500).send({ error: 'Erreur interne du serveur.' });
  });

  // ---- Général
  app.get('/api/health', async () => ({ ok: true, app: 'ma-bibliotheque', version: VERSION }));

  app.get('/api/settings', async (req): Promise<Settings> => ({
    // Un téléphone n'a pas à connaître l'organisation des dossiers du PC.
    musicDirs: req.mbLocal ? getMusicDirs(db) : [],
    defaultMusicDir: req.mbLocal ? defaultMusicDir() : '',
    platform: process.platform,
    dataDir: req.mbLocal ? ctx.dataDir : '',
    uploadsDir: req.mbLocal ? ctx.uploadsDir : '',
    version: VERSION,
    canBrowse: isWin && req.mbLocal,
    local: req.mbLocal,
    deviceName: req.mbDevice?.name ?? null,
  }));

  // ---- Envoi d'un fichier audio depuis le téléphone vers le dossier réservé du PC
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  app.post('/api/upload', async (req, reply) => {
    const query = (req.query ?? {}) as { name?: unknown };
    const parsed = safeUploadName(typeof query.name === 'string' ? query.name : '');
    if (!parsed) throw new HttpError(415, 'Format non pris en charge (MP3, FLAC, M4A, AAC, OGG, OPUS ou WAV).');
    const stream = req.body as NodeJS.ReadableStream | undefined;
    if (!stream || typeof (stream as { pipe?: unknown }).pipe !== 'function') throw new HttpError(400, 'Fichier manquant.');
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_UPLOAD) throw new HttpError(413, 'Fichier trop volumineux (1 Go au maximum).');

    await fsp.mkdir(ctx.uploadsDir, { recursive: true });
    const trackAt = (file: string) =>
      db.prepare('SELECT id FROM tracks WHERE path = ?').get(file) as { id: number } | undefined;

    // Déjà envoyé (même nom, même taille) : on ne le copie pas une seconde fois.
    const sameFile = path.join(ctx.uploadsDir, parsed.base + parsed.ext);
    if (declared > 0 && (await sizeOf(sameFile)) === declared) {
      const known = trackAt(sameFile);
      const track = known ? q.tracksByIds(db, [known.id])[0] : undefined;
      if (track) {
        (stream as NodeJS.ReadableStream & { resume(): void }).resume();
        return { track, duplicate: true };
      }
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
    const track = row ? q.tracksByIds(db, [row.id])[0] : undefined;
    if (!track) {
      await fsp.rm(target, { force: true }).catch(() => {});
      scanner.start();
      throw new HttpError(415, "Ce fichier n'a pas pu être lu : il est peut-être corrompu.");
    }
    reply.code(201);
    return { track, duplicate: false };
  });

  app.put('/api/settings', async (req) => {
    requireLocal(req);
    const body = (req.body ?? {}) as { musicDirs?: unknown };
    if (!Array.isArray(body.musicDirs)) throw new HttpError(400, 'Liste de dossiers manquante');
    const dirs: string[] = [];
    for (const raw of body.musicDirs) {
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

  app.post('/api/settings/browse', async (req) => {
    requireLocal(req);
    if (!isWin) throw new HttpError(501, "Le choix d'un dossier n'est pas disponible ici.");
    return { path: await pickFolder() };
  });

  app.post('/api/scan', async (req) => {
    requireLocal(req);
    const body = (req.body ?? {}) as { full?: boolean };
    return { started: scanner.start({ full: Boolean(body.full) }) };
  });
  app.get('/api/scan', async () => scanner.status);
  app.get('/api/stats', async () => q.getStats(db));

  app.post('/api/shutdown', async (req, reply) => {
    requireLocal(req);
    setTimeout(() => process.exit(0), 300);
    return reply.send({ ok: true });
  });

  // ---- Accès depuis le téléphone
  app.get('/api/remote', async (req) => {
    requireLocal(req);
    return ctx.remote.status();
  });
  app.put('/api/remote', async (req) => {
    requireLocal(req);
    const body = (req.body ?? {}) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'Valeur manquante');
    await ctx.remote.setEnabled(body.enabled);
    return ctx.remote.status();
  });
  app.post('/api/remote/code', async (req) => {
    requireLocal(req);
    if (!ctx.remote.running) throw new HttpError(409, "L'accès depuis le téléphone n'est pas activé.");
    ctx.remote.newCode();
    return ctx.remote.status();
  });
  app.delete('/api/remote/devices/:id', async (req) => {
    requireLocal(req);
    ctx.remote.revoke(mustInt((req.params as { id: string }).id));
    return ctx.remote.status();
  });
  app.post('/api/pair', async (req, reply) => {
    if (req.mbLocal) throw new HttpError(400, 'Cet appareil est le PC : il n’a pas besoin d’être associé.');
    const body = (req.body ?? {}) as { code?: unknown };
    const { token, device } = ctx.remote.pair(body.code, req.headers['user-agent']);
    const secure = req.headers['x-forwarded-proto'] === 'https';
    reply.header('Set-Cookie', ctx.remote.cookieHeader(token, secure));
    return { ok: true, device: device.name };
  });
  app.post('/api/session/logout', async (req, reply) => {
    if (req.mbDevice) ctx.remote.revoke(req.mbDevice.id);
    reply.header('Set-Cookie', ctx.remote.clearCookieHeader());
    return { ok: true };
  });
  // Un appareil déjà associé (ou le PC) qui ouvre /pair est simplement renvoyé vers l'application.
  app.get('/pair', async (_req, reply) => reply.redirect('/'));

  // ---- Bibliothèque
  app.get('/api/home', async () => q.getHome(db));

  app.get('/api/tracks', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    return q.listTracks(db, {
      genre: query.genre || undefined,
      artistId: query.artistId ? mustInt(query.artistId) : undefined,
      albumId: query.albumId ? mustInt(query.albumId) : undefined,
      sort: query.sort === 'title' ? 'title' : 'album',
    });
  });

  app.post('/api/tracks/batch', async (req) => {
    const body = (req.body ?? {}) as { ids?: unknown };
    return q.tracksByIds(db, intList(body.ids, 'Liste de titres'));
  });

  app.get('/api/albums', async (req) => q.listAlbums(db, (req.query as { sort?: string }).sort));
  app.get('/api/albums/:id', async (req) => {
    const album = q.getAlbum(db, mustInt((req.params as { id: string }).id));
    if (!album) throw new HttpError(404, 'Album introuvable');
    return album;
  });

  app.get('/api/artists', async () => q.listArtists(db));
  app.get('/api/artists/:id', async (req) => {
    const artist = q.getArtist(db, mustInt((req.params as { id: string }).id));
    if (!artist) throw new HttpError(404, 'Artiste introuvable');
    return artist;
  });

  app.get('/api/genres', async () => q.listGenres(db));
  app.get('/api/search', async (req) => q.search(db, String((req.query as { q?: string }).q ?? '').slice(0, 100)));

  // ---- Playlists
  app.get('/api/playlists', async () => q.listPlaylists(db));
  app.post('/api/playlists', async (req) => {
    const body = (req.body ?? {}) as { name?: unknown; description?: unknown };
    const name = str(body.name, 'Nom');
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
    const id = q.createPlaylist(db, name, description);
    return q.getPlaylist(db, id);
  });
  app.get('/api/playlists/:id', async (req) => {
    const p = q.getPlaylist(db, mustInt((req.params as { id: string }).id));
    if (!p) throw new HttpError(404, 'Playlist introuvable');
    return p;
  });
  app.patch('/api/playlists/:id', async (req) => {
    const id = mustInt((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { name?: unknown; description?: unknown };
    q.updatePlaylist(db, id, {
      name: body.name !== undefined ? str(body.name, 'Nom') : undefined,
      description: typeof body.description === 'string' ? body.description.trim().slice(0, 500) : undefined,
    });
    return q.getPlaylist(db, id);
  });
  app.delete('/api/playlists/:id', async (req) => {
    q.deletePlaylist(db, mustInt((req.params as { id: string }).id));
    return { ok: true };
  });
  app.post('/api/playlists/:id/tracks', async (req) => {
    const id = mustInt((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { trackIds?: unknown };
    const trackIds = intList(body.trackIds, 'Liste de titres');
    if (trackIds.length > 20000) throw new HttpError(400, 'Trop de titres à la fois');
    return { added: q.addToPlaylist(db, id, trackIds) };
  });
  app.put('/api/playlists/:id/order', async (req) => {
    const id = mustInt((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { entryIds?: unknown };
    q.reorderPlaylist(db, id, intList(body.entryIds, "Liste d'entrées"));
    return { ok: true };
  });
  app.delete('/api/playlists/:id/entries/:entryId', async (req) => {
    const p = req.params as { id: string; entryId: string };
    q.removeFromPlaylist(db, mustInt(p.id), mustInt(p.entryId));
    return { ok: true };
  });

  // ---- Favoris et historique
  app.get('/api/favorites', async () => q.listFavorites(db));
  app.get('/api/favorites/ids', async () => q.favoriteIds(db));
  app.put('/api/favorites/:trackId', async (req) => {
    q.setFavorite(db, mustInt((req.params as { trackId: string }).trackId), true);
    return { ok: true };
  });
  app.delete('/api/favorites/:trackId', async (req) => {
    q.setFavorite(db, mustInt((req.params as { trackId: string }).trackId), false);
    return { ok: true };
  });
  app.post('/api/plays', async (req) => {
    const body = (req.body ?? {}) as { trackId?: unknown };
    q.recordPlay(db, mustInt(body.trackId, 'Titre'));
    return { ok: true };
  });

  // ---- Lecture et pochettes
  app.get('/api/stream/:id', async (req, reply) => streamTrack(req, reply));

  async function streamTrack(req: FastifyRequest, reply: FastifyReply) {
    const id = mustInt((req.params as { id: string }).id);
    const file = q.trackFile(db, id);
    if (!file) throw new HttpError(404, 'Titre introuvable');
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(file);
    } catch {
      throw new HttpError(404, 'Le fichier est introuvable sur le disque.');
    }
    const type = AUDIO_MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const size = stat.size;
    reply.header('Accept-Ranges', 'bytes').header('Content-Type', type).header('Cache-Control', 'no-cache');

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (m[1] === '' && m[2] === '')) {
        return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      }
      let start: number;
      let end: number;
      if (m[1] === '') {
        const suffix = Number(m[2]);
        start = Math.max(0, size - suffix);
        end = size - 1;
      } else {
        start = Number(m[1]);
        end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
      }
      if (start >= size || start > end) {
        return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      }
      reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${size}`)
        .header('Content-Length', end - start + 1);
      return reply.send(fs.createReadStream(file, { start, end }));
    }
    reply.header('Content-Length', size);
    return reply.send(fs.createReadStream(file));
  }

  app.get('/api/cover/:key', async (req, reply) => {
    const key = (req.params as { key: string }).key;
    if (!/^[a-f0-9]{40}$/.test(key)) throw new HttpError(404, 'Pochette introuvable');
    const mime = q.coverMime(db, key);
    const file = path.join(ctx.coversDir, key);
    if (!mime || !fs.existsSync(file)) throw new HttpError(404, 'Pochette introuvable');
    return reply
      .header('Content-Type', mime)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(fs.createReadStream(file));
  });

  app.all('/api/*', async () => {
    throw new HttpError(404, 'Page introuvable');
  });

  // ---- Interface (fichiers statiques + navigation côté navigateur)
  const root = ctx.publicDir ? path.resolve(ctx.publicDir) : null;
  const sendStatic = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!root) {
      return reply
        .code(503)
        .header('Content-Type', 'text/plain; charset=utf-8')
        .send("L'interface est introuvable (dossier « public » manquant).");
    }
    let rel = '/';
    try {
      rel = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    } catch {
      return reply.code(400).send();
    }
    let file = path.resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + path.sep)) return reply.code(403).send();
    let stat: fs.Stats | null = null;
    try {
      stat = await fsp.stat(file);
      if (stat.isDirectory()) stat = null;
    } catch {
      stat = null;
    }
    if (!stat) {
      if (path.extname(rel)) return reply.code(404).send();
      file = path.join(root, 'index.html');
      stat = await fsp.stat(file);
    }
    const ext = path.extname(file).toLowerCase();
    const immutable = rel.startsWith('/assets/');
    return reply
      .header('Content-Type', STATIC_MIME[ext] ?? 'application/octet-stream')
      .header('Content-Length', stat.size)
      .header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(fs.createReadStream(file));
  };
  app.get('/', sendStatic);
  app.get('/*', sendStatic);

  void errMsg;
}
