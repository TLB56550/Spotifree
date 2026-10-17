import { create } from 'zustand';
import type { ReactNode } from 'react';
import type { Playlist } from '@shared/types';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  children?: MenuItem[];
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export interface PlaylistDialogRequest {
  playlist?: Playlist;
  onDone?: (playlist: Playlist) => void;
}

interface UIState {
  toasts: Toast[];
  menu: { x: number; y: number; items: MenuItem[] } | null;
  queueOpen: boolean;
  confirmRequest: ConfirmRequest | null;
  playlistDialog: PlaylistDialogRequest | null;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  closeMenu: () => void;
  toggleQueue: () => void;
  confirm: (opts: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
  closeConfirm: (ok: boolean) => void;
  openPlaylistDialog: (req: PlaylistDialogRequest) => void;
  closePlaylistDialog: () => void;
}

let toastId = 1;
const QUEUE_KEY = 'mb.queueOpen';

function readQueueOpen(): boolean {
  try {
    return localStorage.getItem(QUEUE_KEY) === '1';
  } catch {
    return false;
  }
}

export const useUI = create<UIState>((set, get) => ({
  toasts: [],
  menu: null,
  queueOpen: readQueueOpen(),
  confirmRequest: null,
  playlistDialog: null,

  toast: (text, kind = 'info') => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),

  toggleQueue: () => {
    const next = !get().queueOpen;
    try {
      localStorage.setItem(QUEUE_KEY, next ? '1' : '0');
    } catch {
      // Stockage indisponible : l'état reste valable pour cette session.
    }
    set({ queueOpen: next });
  },

  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      get().confirmRequest?.resolve(false);
      set({ confirmRequest: { ...opts, resolve } });
    }),
  closeConfirm: (ok) => {
    get().confirmRequest?.resolve(ok);
    set({ confirmRequest: null });
  },

  openPlaylistDialog: (req) => set({ playlistDialog: req }),
  closePlaylistDialog: () => set({ playlistDialog: null }),
}));

export const toast = (text: string, kind: Toast['kind'] = 'info') => useUI.getState().toast(text, kind);
