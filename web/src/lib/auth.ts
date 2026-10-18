import { useQuery } from '@tanstack/react-query';
import type { AuthState, User } from '@shared/types';
import { api } from './api';

export const authQuery = {
  queryKey: ['auth'],
  queryFn: () => api.get<AuthState>('/api/auth/state'),
  staleTime: 30_000,
  retry: false,
} as const;

export function useAuth() {
  return useQuery(authQuery);
}

/** Personne connectée (null avant la fin du chargement ou si personne n'est connecté). */
export function useUser(): User | null {
  return useAuth().data?.user ?? null;
}

const PERSONAL_KEYS = ['mb.player.queue', 'mb.player.time'];

/** Repart de zéro après une connexion ou une déconnexion : file d'attente, likes et cache de l'ancienne personne disparaissent. */
export function restartApp(): void {
  try {
    for (const k of PERSONAL_KEYS) localStorage.removeItem(k);
  } catch {
    // Stockage indisponible : rien à effacer.
  }
  window.location.replace('/');
}

export async function logout(): Promise<void> {
  try {
    await api.post('/api/auth/logout');
  } finally {
    restartApp();
  }
}
