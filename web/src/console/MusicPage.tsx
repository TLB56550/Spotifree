import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { ScanStatus } from '@shared/types';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { toast } from '../store/ui';
import { FolderManager, ScanProgress, useConsoleInfo } from './Folders';
import { UploadList, UploadPicker } from './Uploads';

/** Application Serveur > Musique : dossiers suivis, importation de fichiers, analyse. */
export function MusicPage() {
  const { data: info } = useConsoleInfo();
  const { data: scan } = useQuery({
    queryKey: ['console', 'scan'],
    queryFn: () => api.get<ScanStatus>('/api/console/scan'),
    refetchInterval: (q) => (q.state.data?.running ? 1000 : 5000),
  });

  const rescan = async (full: boolean) => {
    try {
      await api.post('/api/console/scan', { full });
      toast(full ? 'Réanalyse complète lancée' : 'Analyse lancée');
      void queryClient.invalidateQueries({ queryKey: ['console', 'scan'] });
    } catch {
      toast('Impossible de lancer l’analyse.', 'error');
    }
  };

  return (
    <div className="c-page">
      <header className="c-head">
        <div>
          <h1>Musique</h1>
          <p className="muted">Ce que le serveur met à disposition de tous les comptes.</p>
        </div>
      </header>

      <section className="setting-block">
        <h2>Dossiers de musique</h2>
        <p className="muted">Ces dossiers de ce PC sont analysés, sous-dossiers compris. Les nouveaux fichiers sont détectés automatiquement.</p>
        <FolderManager />
      </section>

      <section className="setting-block">
        <h2>Importer de la musique</h2>
        <p className="muted">
          Choisis des fichiers audio, ou glisse-les sur cette fenêtre : ils sont copiés dans un dossier réservé du serveur, séparé de ta musique habituelle, puis ajoutés à la bibliothèque de tout le monde.
        </p>
        <div className="setting-actions">
          <UploadPicker />
        </div>
        <UploadList />
        {info?.uploadsDir && (
          <p className="muted small">
            Dossier des importations : <code>{info.uploadsDir}</code>
          </p>
        )}
      </section>

      <section className="setting-block">
        <h2>Analyse</h2>
        <ScanProgress status={scan} />
        <div className="setting-actions">
          <button type="button" className="btn" disabled={scan?.running} onClick={() => void rescan(false)}>
            <RefreshCw /> Analyser maintenant
          </button>
          <button type="button" className="btn btn-ghost" disabled={scan?.running} onClick={() => void rescan(true)} title="Relit toutes les étiquettes et pochettes, même sans changement">
            Tout réanalyser
          </button>
        </div>
      </section>
    </div>
  );
}
