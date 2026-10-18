import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthState } from '../../shared/types';
import { Limiter, checkPassword, cleanName, normalizeEmail } from './auth';
import type { Ctx } from './routes';
import { HttpError, mustInt } from './util';

const BAD_LOGIN = 'Adresse e-mail ou mot de passe incorrect.';

/** Connexion, inscription et compte personnel (le lecteur). La gestion des comptes est dans l'application Serveur. */
export function registerAuthRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { auth } = ctx;
  const failuresByEmail = new Limiter(8, 10 * 60_000);
  const failuresByIp = new Limiter(40, 10 * 60_000);
  const signupsByIp = new Limiter(10, 60 * 60_000);
  const ipOf = (req: FastifyRequest) => req.socket.remoteAddress ?? '?';
  const isHttps = (req: FastifyRequest) => req.headers['x-forwarded-proto'] === 'https';
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;

  const state = (req: FastifyRequest): AuthState => {
    const hasUsers = auth.hasUsers();
    const u = req.mbUser;
    return {
      hasUsers,
      signupOpen: auth.signupOpen,
      user: u ? { id: u.id, email: u.email, name: u.name, mustChange: u.mustChange } : null,
    };
  };

  app.get('/api/auth/state', async (req) => state(req));

  app.post('/api/auth/register', async (req, reply) => {
    const b = body(req);
    const email = normalizeEmail(b.email);
    const password = checkPassword(b.password);
    const name = cleanName(b.name, email);
    // Le tout premier compte est toujours possible ; s'il est créé depuis le PC du serveur,
    // il reprend les playlists et likes d'avant les comptes.
    const first = !auth.hasUsers();
    if (!first) {
      if (!auth.signupOpen) throw new HttpError(403, 'Les inscriptions sont fermées. Demande un compte à la personne qui gère le serveur.');
      if (signupsByIp.blocked(ipOf(req))) throw new HttpError(429, 'Trop de comptes créés depuis cet appareil. Réessaie plus tard.');
      signupsByIp.hit(ipOf(req));
    }
    const user = await auth.createUser({ email, name, password, adoptLegacy: first && req.mbLocal });
    const token = auth.createSession(user.id, req.headers['user-agent']);
    reply.header('Set-Cookie', auth.cookieHeader(token, isHttps(req)));
    reply.code(201);
    return { user };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const b = body(req);
    let email: string;
    try {
      email = normalizeEmail(b.email);
    } catch {
      throw new HttpError(401, BAD_LOGIN);
    }
    const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
    const ip = ipOf(req);
    if (failuresByEmail.blocked(email) || failuresByIp.blocked(ip)) {
      throw new HttpError(429, 'Trop d’essais. Patiente quelques minutes puis réessaie.');
    }
    const user = await auth.checkLogin(email, password);
    if (!user) {
      failuresByEmail.hit(email);
      failuresByIp.hit(ip);
      throw new HttpError(401, BAD_LOGIN);
    }
    failuresByEmail.clear(email);
    const token = auth.createSession(user.id, req.headers['user-agent']);
    reply.header('Set-Cookie', auth.cookieHeader(token, isHttps(req)));
    return { user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.mbUser) auth.revokeSession(req.mbUser.sessionId);
    reply.header('Set-Cookie', auth.clearCookieHeader());
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    const b = body(req);
    const next = checkPassword(b.next);
    const current = typeof b.current === 'string' ? b.current.slice(0, 200) : '';
    const u = req.mbUser!;
    if (failuresByEmail.blocked(u.email)) throw new HttpError(429, 'Trop d’essais. Patiente quelques minutes puis réessaie.');
    try {
      await auth.changePassword(u.id, current, next, u.sessionId);
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) failuresByEmail.hit(u.email);
      throw e;
    }
    return { ok: true };
  });

  app.patch('/api/auth/me', async (req) => {
    const u = req.mbUser!;
    const name = cleanName(body(req).name, u.email);
    auth.updateUser(u.id, { name });
    return { ...state(req).user!, name };
  });

  app.get('/api/auth/sessions', async (req) => auth.listSessions(req.mbUser!.id, req.mbUser!.sessionId));
  app.delete('/api/auth/sessions/:id', async (req) => {
    const id = mustInt((req.params as { id: string }).id);
    if (!auth.ownsSession(req.mbUser!.id, id)) throw new HttpError(404, 'Appareil introuvable.');
    auth.revokeSession(id);
    return { ok: true };
  });
}
