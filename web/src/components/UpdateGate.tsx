import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { UpdateStatus } from '@shared/types';

const BUSY = new Set(['downloading', 'installing', 'restarting']);

/** Écran affiché pendant qu'une mise à jour s'installe, puis rechargement de la page sur la nouvelle version. */
export function UpdateGate({ statusUrl = '/api/update' }: { statusUrl?: string }) {
  const { data } = useQuery({
    queryKey: ['update-gate', statusUrl],
    queryFn: async () => {
      const res = await fetch(statusUrl, { headers: { 'x-mb': '1' } });
      if (!res.ok) throw new Error('update');
      return (await res.json()) as UpdateStatus;
    },
    retry: false,
    refetchInterval: (q) => (q.state.data && BUSY.has(q.state.data.state) ? 700 : 5000),
    refetchIntervalInBackground: true,
  });
  const [from, setFrom] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const last = useRef<UpdateStatus | null>(null);

  if (data && BUSY.has(data.state)) last.current = data;
  const busy = data && BUSY.has(data.state);
  useEffect(() => {
    if (busy && !from) setFrom(data!.current);
  }, [busy, from, data]);

  // Le programme redémarre : on attend qu'il réponde avec la nouvelle version.
  useEffect(() => {
    if (!from) return;
    const started = Date.now();
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const info = (await res.json()) as { version?: string };
        if (info.version && info.version !== from) window.location.reload();
      } catch {
        // Le serveur est en train de redémarrer.
      }
      if (Date.now() - started > 120_000) setFailed(true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [from]);

  // Une mise à jour qui échoue (le serveur répond encore avec l'ancienne version) rend la main.
  useEffect(() => {
    if (from && data && !BUSY.has(data.state) && data.state !== 'checking' && data.current === from) setFrom(null);
  }, [from, data]);

  if (!from) return null;
  const s = last.current ?? data;
  const phase = s?.state ?? 'downloading';
  const pct = Math.round((s?.progress ?? 0) * 100);
  const text =
    phase === 'downloading' ? `Téléchargement… ${pct} %` : phase === 'installing' ? 'Installation…' : 'Redémarrage de l’application…';
  return (
    <div className="update-gate" role="alertdialog" aria-live="polite" aria-label="Mise à jour en cours">
      <div className="update-card">
        <Download aria-hidden />
        <h2>Mise à jour de Ma Bibliothèque</h2>
        <p className="update-versions">
          {from} → {s?.latest ?? '…'}
        </p>
        <div className="progress">
          <div style={{ width: `${phase === 'downloading' ? pct : 100}%` }} />
        </div>
        <p className="update-text">{text}</p>
        {failed && (
          <p className="update-text">
            Le redémarrage prend plus de temps que prévu. Si rien ne se passe, relance Ma Bibliothèque avec son raccourci.
          </p>
        )}
      </div>
    </div>
  );
}
