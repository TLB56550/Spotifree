import { useQuery } from '@tanstack/react-query';
import { Power } from 'lucide-react';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { toast } from '../store/ui';
import { useConsoleInfo } from './Folders';
import { UpdateSection } from './UpdateSection';

interface Autostart {
  available: boolean;
  enabled: boolean;
}

/** Application Serveur > Serveur : démarrage avec Windows, version et mises à jour, emplacement des données, arrêt. */
export function ServerSection({ onShutdown }: { onShutdown: () => void }) {
  const { data } = useQuery({ queryKey: ['console', 'autostart'], queryFn: () => api.get<Autostart>('/api/console/autostart') });
  const { data: info } = useConsoleInfo();

  const toggle = async () => {
    if (!data) return;
    try {
      queryClient.setQueryData(['console', 'autostart'], await api.put<Autostart>('/api/console/autostart', { enabled: !data.enabled }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Impossible de modifier le démarrage automatique.', 'error');
    }
  };

  return (
    <>
      <section className="setting-block">
        <h2>Démarrage</h2>
        <p className="muted">
          Le serveur garde la bibliothèque et envoie la musique aux lecteurs. Il tourne en arrière-plan, sans fenêtre : fermer le lecteur, ou cette fenêtre, ne l’arrête pas.
        </p>
        {data?.available && (
          <label className="check-row">
            <input type="checkbox" checked={data.enabled} onChange={() => void toggle()} />
            <span>Démarrer le serveur avec Windows</span>
          </label>
        )}
      </section>

      <section className="setting-block">
        <h2>Version et mises à jour</h2>
        <p className="muted">
          Version {info?.version ?? '…'}. Le serveur et le lecteur sont mis à jour ensemble.
        </p>
        <UpdateSection />
      </section>

      <section className="setting-block">
        <h2>Où sont les données ?</h2>
        {info && (
          <dl className="c-paths">
            <div>
              <dt>Comptes, playlists, likes, pochettes</dt>
              <dd><code>{info.dataDir}</code></dd>
            </div>
            <div>
              <dt>Fichiers importés</dt>
              <dd><code>{info.uploadsDir}</code></dd>
            </div>
            <div>
              <dt>Journal du serveur</dt>
              <dd><code>{info.dataDir}{info.platform === 'win32' ? '\\' : '/'}server.log</code></dd>
            </div>
          </dl>
        )}
        <p className="muted small">Tes fichiers de musique ne sont jamais modifiés ni déplacés : le serveur ne fait que les lire.</p>
      </section>

      <section className="setting-block">
        <h2>Arrêter le serveur</h2>
        <p className="muted">Plus personne n’a accès à la bibliothèque tant que le serveur est arrêté. Pour le relancer, ouvre « Ma Bibliotheque Serveur » ou « Ma Bibliotheque ».</p>
        <div className="setting-actions">
          <button type="button" className="btn btn-danger" onClick={onShutdown}>
            <Power /> Arrêter le serveur
          </button>
        </div>
      </section>
    </>
  );
}
