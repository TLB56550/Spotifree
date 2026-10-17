import { create } from 'zustand';

/** Vrai quand la dernière requête n'a pas pu joindre le PC. */
export const useConnection = create<{ offline: boolean; setOffline: (v: boolean) => void }>((set, get) => ({
  offline: false,
  setOffline: (v) => {
    if (get().offline !== v) set({ offline: v });
  },
}));
