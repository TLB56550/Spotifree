import { useQuery } from '@tanstack/react-query';
import { Power } from 'lucide-react';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { toast } from '../store/ui';

interface Autostart {
  available: boolean;
  enabled: boolean;
}

/** Administration > Serveur : le serveur tourne à part du lecteur, il reste allumé quand on ferme la fenêtre. */
export function ServerSection({ onShutdown }: { onShutdown: () => void }) {
  const { data } = useQuery({ queryKey: ['autostart'], queryFn: () => api.get<Autostart>('/api/autostart') });

  const toggle = async () => {
    if (!data) return;
    try {
      queryClient.setQueryData(['autostart'], await api.put<Autostart>('/api/autostart', { enabled: !data.enabled }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Impossible de modifier le démarrage automatique.', 'error');
    }
  };

  return (
    <section className="setting-block">
      <h2>Serveur</h2>
      <p className="muted">
        Le serveur garde la bibliothèque et envoie la musique à tous les appareils connectés. Il tourne en arrière-plan, séparé du lecteur :
        tu peux fermer la fenêtre du lecteur, le serveur reste allumé. Pour rouvrir le lecteur, utilise le raccourci « Ma Bibliothèque ».
      </p>
      {data?.available && (
        <label className="check-row">
          <input type="checkbox" checked={data.enabled} onChange={() => void toggle()} />
          <span>Démarrer le serveur avec Windows</span>
        </label>
      )}
      <div className="setting-actions">
        <button type="button" className="btn btn-danger" onClick={onShutdown}>
          <Power /> Arrêter le serveur
        </button>
      </div>
    </section>
  );
}
