import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Playlist } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { toast, useUI } from '../store/ui';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function PlaylistDialog() {
  const req = useUI((s) => s.playlistDialog)!;
  const close = useUI((s) => s.closePlaylistDialog);
  const editing = req.playlist;
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Donne un nom à ta playlist.');
    setBusy(true);
    setError(null);
    try {
      const saved = editing
        ? await api.patch<Playlist>(`/api/playlists/${editing.id}`, { name, description })
        : await api.post<Playlist>('/api/playlists', { name, description });
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      void queryClient.invalidateQueries({ queryKey: ['playlist', String(saved.id)] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      close();
      toast(editing ? 'Playlist modifiée' : `Playlist « ${saved.name} » créée`);
      req.onDone?.(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'L’enregistrement a échoué.');
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? 'Modifier les détails' : 'Nouvelle playlist'} onClose={close}>
      <form onSubmit={submit} className="modal-form">
        <label className="field">
          <span>Nom</span>
          <input ref={nameRef} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Ma playlist" />
        </label>
        <label className="field">
          <span>Description (facultatif)</span>
          <textarea value={description} maxLength={300} rows={3} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {editing ? 'Enregistrer' : 'Créer'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function ConfirmDialog() {
  const req = useUI((s) => s.confirmRequest)!;
  const close = useUI((s) => s.closeConfirm);
  return (
    <Modal title={req.title} onClose={() => close(false)}>
      <p className="modal-text">{req.message}</p>
      <footer className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
          Annuler
        </button>
        <button type="button" className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => close(true)}>
          {req.confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}

export function ModalHost() {
  const playlistDialog = useUI((s) => s.playlistDialog);
  const confirmRequest = useUI((s) => s.confirmRequest);
  return (
    <>
      {playlistDialog && <PlaylistDialog key={playlistDialog.playlist?.id ?? 'new'} />}
      {confirmRequest && <ConfirmDialog />}
    </>
  );
}

export function ToastHost() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'is-error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
