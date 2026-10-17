import { create } from 'zustand';
import { invalidateLibrary } from '../lib/queryClient';
import { useConnection } from './connection';
import { toast } from './ui';

export interface UploadItem {
  id: number;
  name: string;
  size: number;
  loaded: number;
  status: 'waiting' | 'sending' | 'done' | 'duplicate' | 'error';
  error?: string;
}

interface UploadState {
  items: UploadItem[];
  add: (files: File[]) => void;
  clearFinished: () => void;
}

const files = new Map<number, File>();
let nextId = 1;
let working = false;

function patch(id: number, change: Partial<UploadItem>): void {
  useUploads.setState((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...change } : it)) }));
}

/** Envoie un fichier vers le PC ; la progression vient de XMLHttpRequest (fetch ne la fournit pas). */
function send(item: UploadItem, file: File): Promise<void> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?name=${encodeURIComponent(item.name)}`);
    xhr.setRequestHeader('x-mb', '1');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) patch(item.id, { loaded: e.loaded });
    };
    xhr.onload = () => {
      useConnection.getState().setOffline(false);
      if (xhr.status === 401) {
        window.location.replace('/');
        return resolve();
      }
      let body: { duplicate?: boolean; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        // Réponse sans détail.
      }
      if (xhr.status >= 200 && xhr.status < 300) patch(item.id, { status: body.duplicate ? 'duplicate' : 'done', loaded: item.size });
      else patch(item.id, { status: 'error', error: body.error ?? 'Le PC a refusé ce fichier.' });
      resolve();
    };
    xhr.onerror = () => {
      useConnection.getState().setOffline(true);
      patch(item.id, { status: 'error', error: 'Impossible de joindre le PC.' });
      resolve();
    };
    xhr.ontimeout = xhr.onerror;
    xhr.send(file);
  });
}

async function work(): Promise<void> {
  if (working) return;
  working = true;
  let sent = 0;
  let failed = 0;
  try {
    for (;;) {
      const item = useUploads.getState().items.find((it) => it.status === 'waiting');
      if (!item) break;
      const file = files.get(item.id);
      files.delete(item.id);
      if (!file) {
        patch(item.id, { status: 'error', error: 'Fichier introuvable.' });
        continue;
      }
      patch(item.id, { status: 'sending', loaded: 0 });
      await send(item, file);
      const done = useUploads.getState().items.find((it) => it.id === item.id);
      if (done?.status === 'error') failed++;
      else sent++;
      if (done?.status === 'done') void invalidateLibrary();
    }
  } finally {
    working = false;
  }
  if (sent) toast(sent === 1 ? 'Titre envoyé vers ton PC.' : `${sent} titres envoyés vers ton PC.`);
  if (failed) toast(failed === 1 ? 'Un fichier n’a pas pu être envoyé.' : `${failed} fichiers n’ont pas pu être envoyés.`, 'error');
}

export const useUploads = create<UploadState>((set) => ({
  items: [],
  add: (list) => {
    if (!list.length) return;
    const added: UploadItem[] = list.map((f) => {
      const id = nextId++;
      files.set(id, f);
      return { id, name: f.name, size: f.size, loaded: 0, status: 'waiting' };
    });
    set((s) => ({ items: [...s.items, ...added] }));
    void work();
  },
  clearFinished: () => set((s) => ({ items: s.items.filter((it) => it.status === 'waiting' || it.status === 'sending') })),
}));
