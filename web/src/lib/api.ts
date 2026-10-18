import { useConnection } from '../store/connection';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/** Envoyé quand le serveur dit qu'il faut se (re)connecter : l'écran de connexion prend alors le relais. */
export const AUTH_LOST_EVENT = 'mb:auth-lost';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'x-mb': '1',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Le serveur est éteint, hors de portée, ou Ma Bibliothèque n'est pas lancée.
    useConnection.getState().setOffline(true);
    throw new ApiError('Impossible de joindre le serveur.', 0);
  }
  useConnection.getState().setOffline(false);
  if (!res.ok) {
    let message = 'Une erreur est survenue.';
    let code: string | undefined;
    try {
      const data = (await res.json()) as { error?: string; code?: string };
      if (data.error) message = data.error;
      code = data.code;
    } catch {
      // Réponse sans détail.
    }
    // Session expirée ou retirée, ou mot de passe provisoire à remplacer : retour à l'écran de connexion.
    if ((res.status === 401 && code === 'login') || (res.status === 403 && code === 'must_change')) {
      window.dispatchEvent(new Event(AUTH_LOST_EVENT));
    }
    throw new ApiError(message, res.status, code);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export const coverUrl = (key?: string | null): string | null => (key ? `/api/cover/${key}` : null);
export const streamUrl = (id: number): string => `/api/stream/${id}`;
