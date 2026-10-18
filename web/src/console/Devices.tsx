import { useQuery } from '@tanstack/react-query';
import { Monitor, Smartphone, Trash2 } from 'lucide-react';
import type { ConsoleSession } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { formatAgo } from '../lib/format';
import { queryClient } from '../lib/queryClient';
import { toast, useUI } from '../store/ui';

const KEY = ['console', 'sessions'];
const isPhone = (device: string) => !/^(PC|Mac|Appareil Linux)/.test(device);

/** Application Serveur > Appareils : tous les appareils connectés à un compte, avec la possibilité de les déconnecter. */
export function Devices() {
  const confirm = useUI((s) => s.confirm);
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api.get<ConsoleSession[]>('/api/console/sessions'), staleTime: 0, refetchInterval: 8000 });
  if (!data) return null;

  const remove = async (s: ConsoleSession) => {
    const ok = await confirm({
      title: `Déconnecter « ${s.device} » ?`,
      message: `Cet appareil (compte de ${s.userName}) devra se reconnecter avec son adresse e-mail et son mot de passe.`,
      confirmLabel: 'Déconnecter',
      danger: true,
    });
    if (!ok) return;
    try {
      queryClient.setQueryData(KEY, await api.del<ConsoleSession[]>(`/api/console/sessions/${s.id}`));
      void queryClient.invalidateQueries({ queryKey: ['console', 'stats'] });
      void queryClient.invalidateQueries({ queryKey: ['console', 'users'] });
      toast('Appareil déconnecté');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Impossible de déconnecter cet appareil.', 'error');
    }
  };

  return (
    <section className="setting-block" aria-labelledby="devices-title">
      <h2 id="devices-title">Appareils connectés{data.length ? ` (${data.length})` : ''}</h2>
      {data.length === 0 ? (
        <p className="muted">Aucun appareil n’est connecté pour le moment. Dès qu’une personne se connecte depuis le lecteur, son appareil apparaît ici.</p>
      ) : (
        <>
          <p className="muted">Un appareil, c’est une connexion d’un compte : le lecteur du PC, un téléphone, un navigateur. Déconnecter un appareil ne supprime rien.</p>
          <ul className="device-list c-devices">
            {data.map((s) => (
              <li key={s.id}>
                {isPhone(s.device) ? <Smartphone aria-hidden /> : <Monitor aria-hidden />}
                <span className="device-text">
                  <span className="device-name">{s.device}</span>
                  <span className="muted small">
                    {s.userName} · {s.email} · dernière activité {formatAgo(s.lastSeen)}
                  </span>
                </span>
                <button type="button" className="icon-btn" aria-label={`Déconnecter ${s.device} (${s.userName})`} title="Déconnecter cet appareil" onClick={() => void remove(s)}>
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
