import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import type { RemoteStatus } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { toast } from '../store/ui';

const KEY = ['console', 'remote'];

function QrCode({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('qrcode')
      .then((mod) => {
        const QR = (mod as unknown as { default?: typeof mod }).default ?? mod;
        return QR.toDataURL(value, { margin: 2, width: 232, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } });
      })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return src ? <img className="qr" src={src} width={232} height={232} alt="QR code de l’adresse du serveur" /> : <div className="qr qr-loading" aria-hidden />;
}

const KIND_LABEL = { lan: 'Wi-Fi de la maison', tailscale: 'Tailscale (de partout)' } as const;

/** Application Serveur > Appareils : ouvre ou ferme l'écoute réseau du serveur, et montre comment y connecter un téléphone. */
export function RemoteAccess() {
  const { data: status } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<RemoteStatus>('/api/console/remote'),
    refetchInterval: 5000,
    staleTime: 0,
  });
  const [busy, setBusy] = useState(false);
  const [chosenIp, setChosenIp] = useState<string | null>(null);

  const setEnabled = async (enabled: boolean) => {
    setBusy(true);
    try {
      queryClient.setQueryData(KEY, await api.put<RemoteStatus>('/api/console/remote', { enabled }));
      toast(enabled ? 'Accès depuis les autres appareils activé' : 'Accès depuis les autres appareils désactivé');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Impossible de changer ce réglage.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  const address = status.addresses.find((a) => a.ip === chosenIp) ?? status.addresses[0];

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Adresse copiée');
    } catch {
      toast('Copie impossible : recopie l’adresse à la main.', 'error');
    }
  };

  return (
    <section className="setting-block phone" aria-labelledby="remote-title">
      <h2 id="remote-title">Ajouter un téléphone ou un autre appareil</h2>
      <p className="muted">
        Ouvre l’accès réseau, puis donne l’adresse ci-dessous à la personne. Elle ouvre le lecteur sur son appareil et se connecte avec son propre compte : il n’y a pas de code à saisir.
      </p>

      <div className="switch-row">
        <div>
          <strong>Autoriser l’accès depuis le réseau</strong>
          <span className="muted small">Le serveur doit rester allumé. Désactivé par défaut.</span>
        </div>
        <button type="button" role="switch" aria-checked={status.enabled} aria-label="Autoriser l’accès depuis le réseau" className={`switch ${status.enabled ? 'is-on' : ''}`} disabled={busy} onClick={() => void setEnabled(!status.enabled)}>
          <span />
        </button>
      </div>

      {status.enabled && status.error && (
        <p className="form-error" role="alert">
          {status.error}{' '}
          <button type="button" className="link-btn" onClick={() => void setEnabled(true)}>
            Réessayer
          </button>
        </p>
      )}

      {status.running && (
        <>
          {!address ? (
            <p className="form-error" role="alert">
              Aucune connexion réseau n’a été trouvée sur ce serveur. Branche-le à ta box (Wi-Fi ou câble) puis reviens ici.
            </p>
          ) : (
            <div className="pair-card">
              <div className="pair-qr">
                <QrCode value={address.url} />
              </div>
              <div className="pair-steps">
                <ol>
                  <li>
                    Sur le téléphone (même Wi-Fi que le serveur, ou connecté à Tailscale), scanne le QR code ou ouvre <code>{address.url}</code> dans Chrome.
                  </li>
                  <li>La personne se connecte avec son adresse e-mail et son mot de passe, ou crée son compte si les inscriptions sont ouvertes (page « Comptes »).</li>
                  <li>Dans Chrome, menu ⋮ puis « Ajouter à l’écran d’accueil » : le lecteur s’installe. (Ou installe l’application Android Spotifree et saisis cette adresse.)</li>
                </ol>
                <div className="setting-actions">
                  <button type="button" className="btn" onClick={() => void copy(address.url)}>
                    <Copy /> Copier l’adresse
                  </button>
                </div>
              </div>
            </div>
          )}

          {status.addresses.length > 1 && (
            <div className="addr-choice" role="radiogroup" aria-label="Adresse à utiliser">
              {status.addresses.map((a) => (
                <button key={a.ip} type="button" role="radio" aria-checked={a.ip === address?.ip} className={`chip ${a.ip === address?.ip ? 'is-active' : ''}`} onClick={() => setChosenIp(a.ip)}>
                  {KIND_LABEL[a.kind]} · {a.ip}
                </button>
              ))}
            </div>
          )}

          <details className="phone-help">
            <summary>Windows, Tailscale : aide</summary>
            <div>
              <p>
                <strong>Pare-feu Windows.</strong> Quand tu actives l’accès, Windows peut afficher « Le Pare-feu Windows Defender a bloqué certaines fonctionnalités de node.exe ». Coche <em>Réseaux privés</em> puis clique sur <em>Autoriser l’accès</em>.
              </p>
              <p>
                <strong>Écouter hors de chez toi.</strong> Installe Tailscale (gratuit, tailscale.com) sur le serveur et sur chaque appareil, avec le même compte. Une adresse « Tailscale » apparaît alors ici : choisis-la.
              </p>
              <p>
                <strong>Adresse https:// (recommandée si le serveur est joignable depuis internet).</strong> Avec Tailscale, dans PowerShell sur le serveur, tape <code>tailscale serve --bg {status.port}</code> et utilise l’adresse https:// qu’il affiche : les mots de passe circulent alors chiffrés.
              </p>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
