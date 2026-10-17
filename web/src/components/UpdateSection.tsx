import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { UpdateStatus } from '@shared/types';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';

/** Réglages > Application : état de la mise à jour automatique et recherche manuelle (depuis le PC). */
export function UpdateSection() {
  const { data } = useQuery({
    queryKey: ['update'],
    queryFn: () => api.get<UpdateStatus>('/api/update'),
    refetchInterval: (q) => (q.state.data?.state === 'checking' ? 800 : 5000),
  });
  if (!data) return null;
  const checking = data.state === 'checking';
  let text = 'Les mises à jour sont recherchées et installées automatiquement à chaque démarrage.';
  if (checking) text = 'Recherche d’une mise à jour…';
  else if (data.state === 'error') text = `La recherche a échoué (${data.error ?? 'erreur inconnue'}). Elle sera retentée au prochain démarrage.`;
  else if (data.latest && data.latest !== data.current && !data.canInstall) text = `La version ${data.latest} est disponible, mais cette installation ne se met pas à jour toute seule.`;
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
            queryClient.setQueryData(['update'], await api.post<UpdateStatus>('/api/update/check'));
          }}
        >
          <RefreshCw /> Rechercher une mise à jour
        </button>
      </div>
    </div>
  );
}
