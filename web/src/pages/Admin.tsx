import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { ScanStatus } from '@shared/types';
import { api } from '../lib/api';
import { useIsAdmin } from '../lib/auth';
import { invalidateLibrary } from '../lib/queryClient';
import { toast, useUI } from '../store/ui';
import { FolderManager, ScanProgress, useSettings } from '../components/Folders';
import { AdminUsers } from '../components/AdminUsers';
import { PageMessage } from '../components/Hero';
import { RemoteAccess } from '../components/RemoteAccess';
import { UpdateSection } from '../components/UpdateSection';
import { UploadList, UploadPicker } from '../components/Uploads';
import { ServerSection } from '../components/ServerSection';

/** La partie « serveur » : comptes, accès depuis les autres appareils, musique, mises à jour. Réservée aux administrateurs. */
export default function AdminPage() {
  const admin = useIsAdmin();
  const { data: settings } = useSettings();
  const { data: scan } = useQuery({
    queryKey: ['scan'],
    queryFn: () => api.get<ScanStatus>('/api/scan'),
    refetchInterval: (q) => (q.state.data?.running ? 1000 : 5000),
    enabled: admin,
  });
  const confirm = useUI((s) => s.confirm);
  const [stopped, setStopped] = useState(false);

  if (!admin) return <PageMessage title="Réservé à l’administrateur">Cette page sert à gérer le serveur.</PageMessage>;

  const rescan = async (full: boolean) => {
    try {
      await api.post('/api/scan', { full });
      toast(full ? 'Réanalyse complète lancée' : 'Analyse lancée');
      void invalidateLibrary();
    } catch {
      toast('Impossible de lancer l’analyse.', 'error');
    }
  };

  const shutdown = async () => {
    const ok = await confirm({
      title: 'Arrêter le serveur ?',
      message: 'La musique s’arrêtera pour tout le monde, sur tous les appareils. Tu pourras le relancer avec le raccourci « Ma Bibliothèque (serveur) ».',
      confirmLabel: 'Arrêter le serveur',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post('/api/shutdown');
      setStopped(true);
    } catch {
      toast('Impossible d’arrêter le serveur depuis ici.', 'error');
    }
  };

  if (stopped) {
    return (
      <div className="page-pad">
        <div className="empty-block">
          <h2>Le serveur est arrêté</h2>
          <p>Tu peux fermer cette fenêtre. Pour le relancer, ouvre le raccourci « Ma Bibliothèque (serveur) ».</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-pad settings">
      <header className="page-head">
        <h1>Administration</h1>
      </header>
      <p className="muted">Ici, tout ce qui concerne le serveur et les personnes qui s’en servent.</p>

      <AdminUsers />
      <RemoteAccess />

      <section className="setting-block">
        <h2>Dossiers de musique</h2>
        <p className="muted">Ces dossiers du serveur sont analysés, sous-dossiers compris. Les nouveaux fichiers sont détectés automatiquement.</p>
        <FolderManager />
      </section>

      <section className="setting-block">
        <h2>Importer de la musique</h2>
        <p className="muted">
          Choisis des fichiers audio (ou glisse-les sur la fenêtre) : ils sont copiés dans un dossier réservé du serveur, séparé de ta musique habituelle, puis ajoutés à la bibliothèque de tout le monde.
        </p>
        <div className="setting-actions">
          <UploadPicker variant="button" />
        </div>
        <UploadList />
        {settings?.uploadsDir && (
          <p className="muted small">
            Dossier des importations : <code>{settings.uploadsDir}</code>
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

      <ServerSection onShutdown={() => void shutdown()} />

      <section className="setting-block">
        <h2>Version et mises à jour</h2>
        <p className="muted">
          Version {settings?.version ?? '…'} · Les données (comptes, playlists, likes, pochettes) sont dans <code>{settings?.dataDir}</code>. Tes fichiers de musique ne sont jamais modifiés.
        </p>
        <UpdateSection />
      </section>
    </div>
  );
}

