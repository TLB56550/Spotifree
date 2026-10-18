import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, FolderPlus, Trash2 } from 'lucide-react';
import type { ConsoleInfo, ScanStatus } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { toast } from '../store/ui';

export const infoQuery = { queryKey: ['console', 'info'], queryFn: () => api.get<ConsoleInfo>('/api/console/info') } as const;

export function useConsoleInfo() {
  return useQuery(infoQuery);
}

export function FolderManager() {
  const { data: settings } = useConsoleInfo();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const dirs = settings?.musicDirs ?? [];

  const save = async (next: string[]): Promise<boolean> => {
    setBusy(true);
    try {
      await api.put('/api/console/music', { musicDirs: next });
      await queryClient.invalidateQueries({ queryKey: ['console', 'info'] });
      await queryClient.invalidateQueries({ queryKey: ['console', 'scan'] });
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Impossible d’enregistrer ce dossier.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (p: string) => {
    const value = p.trim();
    if (!value) return;
    if (await save([...dirs, value])) {
      setPath('');
      toast('Dossier ajouté : l’analyse commence');
    }
  };

  const browse = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ path: string | null }>('/api/console/browse');
      setBusy(false);
      if (res.path) await add(res.path);
    } catch (e) {
      setBusy(false);
      toast(e instanceof ApiError ? e.message : 'Impossible d’ouvrir la fenêtre de choix.', 'error');
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void add(path);
  };

  return (
    <div className="folders">
      {dirs.length === 0 && <p className="muted">Aucun dossier pour le moment.</p>}
      <ul className="folder-list">
        {dirs.map((d) => (
          <li key={d}>
            <FolderOpen aria-hidden />
            <span className="folder-path" title={d}>{d}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Ne plus suivre ${d}`}
              title="Ne plus suivre ce dossier"
              disabled={busy}
              onClick={() => void save(dirs.filter((x) => x !== d))}
            >
              <Trash2 />
            </button>
          </li>
        ))}
      </ul>
      <div className="folder-add">
        {settings?.canBrowse && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void browse()}>
            <FolderPlus /> Choisir un dossier…
          </button>
        )}
        <form onSubmit={onSubmit} className="folder-form">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder={settings?.defaultMusicDir ?? 'C:\\Users\\toi\\Music'}
            aria-label="Chemin d’un dossier de musique"
          />
          <button type="submit" className="btn" disabled={busy || !path.trim()}>
            Ajouter
          </button>
        </form>
        {settings && !dirs.length && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void add(settings.defaultMusicDir)}>
            Utiliser {settings.defaultMusicDir}
          </button>
        )}
      </div>
    </div>
  );
}

export function ScanProgress({ status }: { status: ScanStatus | undefined }) {
  if (!status) return null;
  const pct = status.total > 0 ? Math.min(100, Math.round((status.done / status.total) * 100)) : 0;
  const phase = status.phase === 'walking' ? 'Recherche des fichiers…' : status.phase === 'finishing' ? 'Finalisation…' : 'Lecture des titres…';
  return (
    <div className="scan">
      {status.running ? (
        <>
          <p>
            {phase} {status.done.toLocaleString('fr-FR')} / {status.total.toLocaleString('fr-FR')}
          </p>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${pct}%` }} />
          </div>
        </>
      ) : status.finishedAt ? (
        <p>
          Dernière analyse : {status.added} ajouté{status.added > 1 ? 's' : ''}, {status.updated} mis à jour, {status.removed} retiré
          {status.removed > 1 ? 's' : ''}
          {status.errors ? `, ${status.errors} fichier${status.errors > 1 ? 's' : ''} ignoré${status.errors > 1 ? 's' : ''}` : ''}.
        </p>
      ) : (
        <p className="muted">Aucune analyse pour le moment.</p>
      )}
      {status.warnings.map((w) => (
        <p key={w} className="warn">{w}</p>
      ))}
    </div>
  );
}
