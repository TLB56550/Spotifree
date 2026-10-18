import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { UpdateStatus } from '@shared/types';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';

/** Application Serveur > Serveur : état de la mise à jour automatique et recherche manuelle. */
export function UpdateSection() {
  const { data } = useQuery({
    queryKey: ['console', 'update'],
    queryFn: () => api.get<UpdateStatus>('/api/console/update'),
    refetchInterval: (q) => (q.state.data?.state === 'checking' ? 800 : 5000),
  });
  if (!data) return null;
  const checking = data.state === 'checking';
  const available = Boolean(data.latest && data.latest !== data.current && data.canInstall);
  let text = 'Les mises à jour sont recherchées et installées automatiquement à chaque démarrage.';
  if (checking) text = 'Recherche d’une mise à jour…';
  else if (data.state === 'error') text = `La recherche a échoué (${data.error ?? 'erreur inconnue'}). Elle sera retentée au prochain démarrage.`;
  else if (data.latest && data.latest !== data.current && !data.canInstall) text = `La version ${data.latest} est disponible, mais cette installation ne se met pas à jour toute seule.`;
  else if (available) text = `La version ${data.latest} est prête : elle s’installe toute seule.`;
  else if (data.checkedAt) text = 'Tu as la dernière version.';
  return (
    <div className="update-section">
      <p className="muted small">{text}</p>
      <div className="setting-actions">
        <button
          type="button"
          className="btn"
          disabled={checking}
          onClick={async () => {
            queryClient.setQueryData(['console', 'update'], await api.post<UpdateStatus>('/api/console/update/check'));
          }}
        >
          <RefreshCw /> Rechercher une mise à jour
        </button>
      </div>
    </div>
  );
}
