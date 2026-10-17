import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Smartphone, Trash2 } from 'lucide-react';
import type { RemoteStatus } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { formatAgo } from '../lib/format';
import { queryClient } from '../lib/queryClient';
import { toast, useUI } from '../store/ui';

const KEY = ['remote'];

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

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
  return src ? <img className="qr" src={src} width={232} height={232} alt="QR code pour associer ton téléphone" /> : <div className="qr qr-loading" aria-hidden />;
}

const KIND_LABEL = { lan: 'Wi-Fi de la maison', tailscale: 'Tailscale (de partout)' } as const;

export function PhoneAccess() {
  const confirm = useUI((s) => s.confirm);
  const { data: status } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<RemoteStatus>('/api/remote'),
    refetchInterval: 4000,
    staleTime: 0,
  });
  const [busy, setBusy] = useState(false);
  const [chosenIp, setChosenIp] = useState<string | null>(null);
  const now = useNow(1000);

  // Le code a expiré : le serveur en prépare un nouveau, on le récupère tout de suite.
  const expired = status?.running && status.pairing !== null && status.pairing.expiresAt <= now;
  useEffect(() => {
    if (expired) void queryClient.invalidateQueries({ queryKey: KEY });
  }, [expired]);

  const update = (next: RemoteStatus) => queryClient.setQueryData(KEY, next);
  const fail = (e: unknown, fallback: string) => toast(e instanceof ApiError ? e.message : fallback, 'error');

  const setEnabled = async (enabled: boolean) => {
    setBusy(true);
    try {
      update(await api.put<RemoteStatus>('/api/remote', { enabled }));
      toast(enabled ? 'Accès depuis le téléphone activé' : 'Accès depuis le téléphone désactivé');
    } catch (e) {
      fail(e, 'Impossible de changer ce réglage.');
    } finally {
      setBusy(false);
    }
  };

  const newCode = async () => {
    try {
      update(await api.post<RemoteStatus>('/api/remote/code'));
    } catch (e) {
      fail(e, 'Impossible de créer un nouveau code.');
    }
  };

  const removeDevice = async (id: number, name: string) => {
    const ok = await confirm({
      title: `Retirer « ${name} » ?`,
      message: 'Cet appareil n’aura plus accès à ta musique. Tu pourras l’associer de nouveau avec un nouveau code.',
      confirmLabel: 'Retirer',
      danger: true,
    });
    if (!ok) return;
    try {
      update(await api.del<RemoteStatus>(`/api/remote/devices/${id}`));
      toast('Appareil retiré');
    } catch (e) {
      fail(e, 'Impossible de retirer cet appareil.');
    }
  };

  if (!status) return null;

  const address = status.addresses.find((a) => a.ip === chosenIp) ?? status.addresses[0];
  const code = status.pairing;
  const left = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0;
  const countdown = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <section className="setting-block phone" aria-labelledby="phone-title">
      <h2 id="phone-title">Téléphone</h2>
      <p className="muted">
        Écoute ta bibliothèque depuis ton téléphone. C’est désactivé tant que tu ne l’actives pas, et chaque téléphone doit être associé avec un code.
      </p>

      <div className="switch-row">
        <div>
          <strong>Autoriser l’accès depuis mon téléphone</strong>
          <span className="muted small">Ma Bibliothèque doit rester lancée sur ce PC.</span>
        </div>
        <button type="button" role="switch" aria-checked={status.enabled} aria-label="Autoriser l’accès depuis mon téléphone" className={`switch ${status.enabled ? 'is-on' : ''}`} disabled={busy} onClick={() => void setEnabled(!status.enabled)}>
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
              Aucune connexion réseau n’a été trouvée sur ce PC. Branche-le à ta box (Wi-Fi ou câble) puis reviens ici.
            </p>
          ) : (
            <div className="pair-card">
              <div className="pair-qr">{code ? <QrCode value={`${address.url}/pair?code=${encodeURIComponent(code.code)}`} /> : <div className="qr qr-loading" aria-hidden />}</div>
              <div className="pair-steps">
                <ol>
                  <li>
                    Sur ton téléphone, ouvre l’appareil photo et <strong>scanne le QR code</strong>. Le téléphone doit être sur le même Wi-Fi que ce PC (ou connecté à Tailscale).
                  </li>
                  <li>
                    Pas de QR code ? Ouvre <code>{address.url}</code> dans Chrome et saisis le code : <strong className="pair-code">{code?.code ?? '…'}</strong>
                  </li>
                  <li>Dans Chrome, menu ⋮ puis « Ajouter à l’écran d’accueil » : l’application s’installe.</li>
                </ol>
                <p className="muted small">
                  {code ? `Code valable encore ${countdown}. ` : ''}
                  <button type="button" className="link-btn inline" onClick={() => void newCode()}>
                    Nouveau code
                  </button>
                </p>
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
                <strong>Écouter hors de chez toi.</strong> Installe Tailscale (gratuit, tailscale.com) sur ce PC et sur ton téléphone, avec le même compte. Une adresse « Tailscale » apparaît alors ici : choisis-la, puis scanne le QR code.
              </p>
              <p>
                <strong>Application plein écran (facultatif).</strong> Avec Tailscale, tu peux obtenir une adresse https:// : dans PowerShell sur ce PC, tape <code>tailscale serve --bg {status.port}</code> et ouvre l’adresse https:// qu’il affiche. Tailscale te demandera peut-être d’activer HTTPS dans sa console d’administration.
              </p>
            </div>
          </details>
        </>
      )}

      {status.devices.length > 0 && (
        <div className="devices">
          <h3>Téléphones associés</h3>
          <ul className="device-list">
            {status.devices.map((d) => (
              <li key={d.id}>
                <Smartphone aria-hidden />
                <span className="device-text">
                  <span className="device-name">{d.name}</span>
                  <span className="muted small">Dernière activité {formatAgo(d.lastSeen, now)}</span>
                </span>
                <button type="button" className="icon-btn" aria-label={`Retirer ${d.name}`} title="Retirer cet appareil" onClick={() => void removeDevice(d.id, d.name)}>
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
