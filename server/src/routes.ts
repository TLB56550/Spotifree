import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppInfo } from '../../shared/types';
import { VERSION, isLoopbackHost } from './config';
import type { DB } from './db';
import * as q from './queries';
import { type Auth, type AuthUser } from './auth';
import { registerAuthRoutes } from './authRoutes';
import { registerConsoleRoutes } from './consoleRoutes';
import { isLocalRequest, type RemoteAccess } from './remote';
import type { Scanner } from './scanner';
import type { Updater } from './update';
import { HttpError, errMsg, mustInt, toInt } from './util';

export interface Ctx {
  db: DB;
  scanner: Scanner;
  dataDir: string;
  coversDir: string;
  uploadsDir: string;
  updater: Updater;
  publicDir: string | null;
  host: string;
  /** Port du lecteur (ce PC) ; le port de la console est à part. */
  port: number;
  consolePort: number;
  /** Adresse du lecteur sur ce PC. */
  playerUrl: string;
  remote: RemoteAccess;
  auth: Auth;
  /** Jeton écrit dans le dossier des données : permet à l'installateur de fermer le serveur sans compte. */
  localToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Vrai si la requête vient du PC lui-même (lecteur ouvert sur le PC du serveur). */
    mbLocal: boolean;
    /** Vrai pour une requête arrivée sur le port de la console (application Serveur). */
    mbConsole: boolean;
    /** Personne connectée qui fait la requête, s'il y en a une. */
    mbUser: AuthUser | null;
    /** Vrai pour une demande venue du PC avec le jeton local (installateur). */
    mbSystem: boolean;
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

export function registerRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, scanner } = ctx;
  const loopback = isLoopbackHost(ctx.host);

  // ---- Protection
  // Deux « surfaces » partagent ce programme :
  //  - le LECTEUR (ports 4242 et 4243) : bibliothèque, lecture, compte personnel. Aucune route d'administration n'y existe ;
  //  - la CONSOLE (port 4244, ce PC uniquement) : l'application Serveur. Pas de compte : c'est le PC qui fait foi.
  // Sur le lecteur : toute requête vers les données vient d'une personne connectée (cookie de session).
  // Sur les deux : aucune requête qui modifie quelque chose ne passe sans l'en-tête x-mb et une origine cohérente.
  app.decorateRequest('mbLocal', false);
  app.decorateRequest('mbConsole', false);
  app.decorateRequest('mbUser', null);
  app.decorateRequest('mbSystem', false);

  const userId = (req: FastifyRequest): number => req.mbUser!.id;

  // Ce qui reste accessible sans être connecté (aucune donnée de musique).
  const OPEN_API = new Set(['/api/health', '/api/auth/state', '/api/auth/login', '/api/auth/register', '/api/auth/logout']);

  app.addHook('onRequest', async (req, reply) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/';
    const sock = req.raw.socket;
    const onConsole = sock.localPort === ctx.consolePort;
    const local = !onConsole && isLocalRequest(req.raw, ctx.port);
    req.mbConsole = onConsole;
    req.mbLocal = local;
    req.mbUser = null;
    req.mbSystem = false;

    // Sur le PC, seule l'adresse « localhost » est admise (protège du « DNS rebinding »).
    if (onConsole ? !isLocalRequest(req.raw, ctx.consolePort) : !local && sock.localPort === ctx.port && loopback) {
      return reply.code(403).send({ error: 'Adresse non autorisée.' });
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

    if (onConsole) {
      // La console n'a que ses propres routes (et l'état de santé).
      if (url.startsWith('/api/') && url !== '/api/health' && !url.startsWith('/api/console/')) {
        return reply.code(404).send({ error: 'Page introuvable' });
      }
      return;
    }
    // Le lecteur ne sait rien de la console, même pour une personne connectée.
    if (url.startsWith('/api/console/')) return reply.code(404).send({ error: 'Page introuvable' });

    req.mbUser = ctx.auth.authenticate(req.headers.cookie);
    // Arrêt par un installateur lancé sur ce PC (jeton lisible seulement dans le dossier des données de l'utilisateur).
    if (local && url === '/api/shutdown' && req.method === 'POST' && req.headers['x-mb-token'] === ctx.localToken) {
      req.mbSystem = true;
      return;
    }
    if (url.startsWith('/api/') && !OPEN_API.has(url)) {
      if (!req.mbUser) return reply.code(401).send({ error: 'Connexion requise.', code: 'login' });
      if (req.mbUser.mustChange && !url.startsWith('/api/auth/')) {
        return reply.code(403).send({ error: 'Choisis d’abord un nouveau mot de passe.', code: 'must_change' });
      }
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

  registerAuthRoutes(app, ctx);
  registerConsoleRoutes(app, ctx);

  // Arrêt demandé par l'installateur (jeton local) : le lecteur n'a aucun autre moyen d'arrêter le serveur.
  app.post('/api/shutdown', async (req, reply) => {
    if (!req.mbSystem) throw new HttpError(403, 'Cette action se fait depuis l’application Serveur.');
    setTimeout(() => process.exit(0), 300);
    return reply.send({ ok: true });
  });

  app.get('/api/about', async (req): Promise<AppInfo> => ({ version: VERSION, local: req.mbLocal }));
  // Avancement de l'analyse et mise à jour : en lecture seule, pour que le lecteur se rafraîchisse tout seul.
  app.get('/api/scan', async () => scanner.status);
  app.get('/api/update', async () => ctx.updater.status());
  app.get('/api/stats', async (req) => q.getStats(db, userId(req)));

  // ---- Bibliothèque
  app.get('/api/home', async (req) => q.getHome(db, userId(req)));

  app.get('/api/tracks', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    return q.listTracks(db, userId(req), {
      genre: query.genre || undefined,
      artistId: query.artistId ? mustInt(query.artistId) : undefined,
      albumId: query.albumId ? mustInt(query.albumId) : undefined,
      sort: query.sort === 'title' ? 'title' : 'album',
    });
  });

  app.post('/api/tracks/batch', async (req) => {
    const body = (req.body ?? {}) as { ids?: unknown };
    return q.tracksByIds(db, userId(req), intList(body.ids, 'Liste de titres'));
  });

  app.get('/api/albums', async (req) => q.listAlbums(db, (req.query as { sort?: string }).sort));
  app.get('/api/albums/:id', async (req) => {
    const album = q.getAlbum(db, userId(req), mustInt((req.params as { id: string }).id));
    if (!album) throw new HttpError(404, 'Album introuvable');
    return album;
  });

  app.get('/api/artists', async () => q.listArtists(db));
  app.get('/api/artists/:id', async (req) => {
    const artist = q.getArtist(db, userId(req), mustInt((req.params as { id: string }).id));
    if (!artist) throw new HttpError(404, 'Artiste introuvable');
    return artist;
  });

  app.get('/api/genres', async () => q.listGenres(db));
  app.get('/api/search', async (req) => q.search(db, userId(req), String((req.query as { q?: string }).q ?? '').slice(0, 100)));

  // ---- Playlists
  app.get('/api/playlists', async (req) => q.listPlaylists(db, userId(req)));
  app.post('/api/playlists', async (req) => {
    const body = (req.body ?? {}) as { name?: unknown; description?: unknown };
    const name = str(body.name, 'Nom');
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
    const id = q.createPlaylist(db, userId(req), name, description);
    return q.getPlaylist(db, userId(req), id);
  });
  app.get('/api/playlists/:id', async (req) => {
    const p = q.getPlaylist(db, userId(req), mustInt((req.params as { id: string }).id));
    if (!p) throw new HttpError(404, 'Playlist introuvable');
    return p;
  });
  app.patch('/api/playlists/:id', async (req) => {
    const id = mustInt((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { name?: unknown; description?: unknown };
    q.updatePlaylist(db, userId(req), id, {
      name: body.name !== undefined ? str(body.name, 'Nom') : undefined,
      description: typeof body.description === 'string' ? body.description.trim().slice(0, 500) : undefined,
    });
    return q.getPlaylist(db, userId(req), id);
  });
  app.delete('/api/playlists/:id', async (req) => {
    q.deletePlaylist(db, userId(req), mustInt((req.params as { id: string }).id));
    return { ok: true };
  });
  app.post('/api/playlists/:id/tracks', async (req) => {
    const id = mustInt((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { trackIds?: unknown };
    const trackIds = intList(body.trackIds, 'Liste de titres');
    if (trackIds.length > 20000) throw new HttpError(400, 'Trop de titres à la fois');
    return { added: q.addToPlaylist(db, userId(req), id, trackIds) };
  });
  app.put('/api/playlists/:id/order', async (req) => {
    const id = mustInt((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { entryIds?: unknown };
    q.reorderPlaylist(db, userId(req), id, intList(body.entryIds, "Liste d'entrées"));
    return { ok: true };
  });
  app.delete('/api/playlists/:id/entries/:entryId', async (req) => {
    const p = req.params as { id: string; entryId: string };
    q.removeFromPlaylist(db, userId(req), mustInt(p.id), mustInt(p.entryId));
    return { ok: true };
  });

  // ---- Favoris et historique
  app.get('/api/favorites', async (req) => q.listFavorites(db, userId(req)));
  app.get('/api/favorites/ids', async (req) => q.favoriteIds(db, userId(req)));
  app.put('/api/favorites/:trackId', async (req) => {
    q.setFavorite(db, userId(req), mustInt((req.params as { trackId: string }).trackId), true);
    return { ok: true };
  });
  app.delete('/api/favorites/:trackId', async (req) => {
    q.setFavorite(db, userId(req), mustInt((req.params as { trackId: string }).trackId), false);
    return { ok: true };
  });
  app.post('/api/plays', async (req) => {
    const body = (req.body ?? {}) as { trackId?: unknown };
    q.recordPlay(db, userId(req), mustInt(body.trackId, 'Titre'));
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
    // Chaque surface a sa propre page d'accueil, et ne voit pas celle de l'autre.
    const page = req.mbConsole ? 'console.html' : 'index.html';
    const other = req.mbConsole ? '/index.html' : '/console.html';
    if (rel === other || (req.mbConsole && (rel === '/sw.js' || rel === '/manifest.webmanifest'))) return reply.code(404).send();
    if (rel === '/' + page) stat = null;
    if (!stat) {
      if (path.extname(rel) && rel !== '/' + page) return reply.code(404).send();
      file = path.join(root, page);
      try {
        stat = await fsp.stat(file);
      } catch {
        return reply.code(503).header('Content-Type', 'text/plain; charset=utf-8').send("L'interface est introuvable (page « " + page + " » manquante).");
      }
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
