import { useConnection } from '../store/connection';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

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
    // Le PC est éteint, hors de portée, ou Ma Bibliothèque n'est pas lancée.
    useConnection.getState().setOffline(true);
    throw new ApiError('Impossible de joindre le PC.', 0);
  }
  useConnection.getState().setOffline(false);
  if (res.status === 401) {
    // Appareil retiré depuis le PC : on revient à la page d'association.
    window.location.replace('/');
    throw new ApiError('Cet appareil n’est plus associé à ton PC.', 401);
  }
  if (!res.ok) {
    let message = 'Une erreur est survenue.';
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Réponse sans détail.
    }
    throw new ApiError(message, res.status);
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
