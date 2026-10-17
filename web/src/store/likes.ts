import { create } from 'zustand';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { toast } from './ui';

interface LikesState {
  ids: Set<number>;
  loaded: boolean;
  load: () => Promise<void>;
  toggle: (trackId: number) => Promise<void>;
}

export const useLikes = create<LikesState>((set, get) => ({
  ids: new Set(),
  loaded: false,

  load: async () => {
    try {
      const ids = await api.get<number[]>('/api/favorites/ids');
      set({ ids: new Set(ids), loaded: true });
    } catch {
      // Le serveur n'est pas joignable : les cœurs resteront vides.
    }
  },

  toggle: async (trackId) => {
    const was = get().ids.has(trackId);
    const apply = (on: boolean) =>
      set((s) => {
        const ids = new Set(s.ids);
        if (on) ids.add(trackId);
        else ids.delete(trackId);
        return { ids };
      });
    apply(!was); // affichage immédiat
    try {
      if (was) await api.del(`/api/favorites/${trackId}`);
      else await api.put(`/api/favorites/${trackId}`);
      void queryClient.invalidateQueries({ queryKey: ['favorites'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      if (!was) toast('Ajouté à tes titres likés');
    } catch {
      apply(was);
      toast('Impossible de modifier tes titres likés.', 'error');
    }
  },
}));
