import { create } from 'zustand';
import { api } from '../lib/api';
import { toast, useUI } from '../store/ui';

/** Vrai une fois que le serveur a été arrêté depuis cette fenêtre. */
export const useServerState = create<{ stopped: boolean }>(() => ({ stopped: false }));

/** Demande confirmation, puis arrête le serveur. */
export async function shutdownServer(): Promise<void> {
  const ok = await useUI.getState().confirm({
    title: 'Arrêter le serveur ?',
    message: 'La musique s’arrêtera pour tout le monde, sur tous les appareils. Tu pourras le relancer avec « Spotifree Serveur » ou « Spotifree ».',
    confirmLabel: 'Arrêter le serveur',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.post('/api/console/shutdown');
    useServerState.setState({ stopped: true });
  } catch {
    toast('Impossible d’arrêter le serveur depuis ici.', 'error');
  }
}
