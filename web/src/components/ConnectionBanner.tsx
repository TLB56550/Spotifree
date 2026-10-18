import { WifiOff } from 'lucide-react';
import { queryClient } from '../lib/queryClient';
import { useConnection } from '../store/connection';

/** S'affiche quand le serveur ne répond plus (éteint, hors de portée, application fermée). */
export function ConnectionBanner() {
  const offline = useConnection((s) => s.offline);
  if (!offline) return null;
  return (
    <div className="conn-banner" role="alert">
      <WifiOff aria-hidden />
      <span>Le serveur est injoignable. Vérifie qu’il est allumé et que tu es bien connecté au réseau.</span>
      <button type="button" className="btn" onClick={() => void queryClient.invalidateQueries()}>
        Réessayer
      </button>
    </div>
  );
}
