import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FolderOpen, HardDrive, Trash2, Upload } from 'lucide-react';
import type { ConsoleStorage, StorageImport } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { formatAgo, formatBytes } from '../lib/format';
import { queryClient } from '../lib/queryClient';
import { toast, useUI } from '../store/ui';

const STORAGE = ['console', 'storage'];
const IMPORTS = ['console', 'storage', 'imports'];
const n = (v: number) => v.toLocaleString('fr-FR');
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, (part / whole) * 100) : 0);

function Imports({ st }: { st: ConsoleStorage }) {
  const confirm = useUI((s) => s.confirm);
  const { data } = useQuery({ queryKey: IMPORTS, queryFn: () => api.get<StorageImport[]>('/api/console/storage/imports'), refetchInterval: 10_000 });
  const folder = st.folders.find((f) => f.kind === 'imports');
  const total = (data ?? []).reduce((s, f) => s + f.bytes, 0);

  const remove = async (f: StorageImport) => {
    const ok = await confirm({
      title: `Supprimer « ${f.name} » ?`,
      message: 'Le fichier est supprimé du disque (il ne passe pas par la corbeille) et le titre disparaît de la bibliothèque de tout le monde. Les likes et playlists qui le contiennent le perdent aussi.',
      confirmLabel: 'Supprimer le fichier',
      danger: true,
    });
    if (!ok) return;
    try {
      queryClient.setQueryData(IMPORTS, await api.del<StorageImport[]>(`/api/console/storage/imports/${encodeURIComponent(f.name)}`));
      void queryClient.invalidateQueries({ queryKey: STORAGE });
      void queryClient.invalidateQueries({ queryKey: ['console', 'stats'] });
      toast('Fichier supprimé');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Impossible de supprimer ce fichier.', 'error');
    }
  };

  return (
    <section className="setting-block" aria-labelledby="imports-title">
      <h2 id="imports-title">Fichiers importés{data?.length ? ` (${data.length})` : ''}</h2>
      <p className="muted">
        Les fichiers envoyés vers Spotifree (bouton « Importer » ou glisser-déposer) sont rangés ici, à part de ta musique habituelle
        {folder ? (
          <>
            {' '}
            : <code>{folder.path}</code>
          </>
        ) : null}
        . Tu peux en supprimer pour récupérer de la place. Tes dossiers de musique, eux, ne sont jamais modifiés par Spotifree.
      </p>
      {!data ? null : data.length === 0 ? (
        <p className="muted">
          Aucun fichier importé. <Link to="/musique">Importer de la musique</Link>
        </p>
      ) : (
        <>
          <ul className="c-rows">
            {data.map((f) => (
              <li key={f.name}>
                <span className="c-row-text">
                  <span className="c-row-name">{f.name}</span>
                  <span className="muted small">
                    {formatBytes(f.bytes)} · ajouté {formatAgo(f.modifiedAt)}
                    {f.inLibrary ? '' : ' · pas encore analysé'}
                  </span>
                </span>
                <button type="button" className="icon-btn" aria-label={`Supprimer ${f.name}`} title="Supprimer ce fichier" onClick={() => void remove(f)}>
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">Total des importations : {formatBytes(total)}</p>
        </>
      )}
    </section>
  );
}

function Limit({ st }: { st: ConsoleStorage }) {
  const current = Math.round((st.limitBytes / 1024 ** 3) * 100) / 100;
  const [value, setValue] = useState(String(current).replace('.', ','));
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const gb = Number(value.replace(',', '.'));
    if (!Number.isFinite(gb) || gb <= 0) return toast('Indique un nombre de Go (plus que 0).', 'error');
    setBusy(true);
    try {
      queryClient.setQueryData(STORAGE, await api.put<ConsoleStorage>('/api/console/storage/settings', { limitGb: gb }));
      toast('Limite enregistrée');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Impossible d’enregistrer.', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="setting-block" aria-labelledby="limit-title">
      <h2 id="limit-title">Limite de la musique</h2>
      <p className="muted">Une fois la limite atteinte, les nouvelles importations sont refusées. Tes dossiers de musique ne sont jamais modifiés ni supprimés.</p>
      <form className="folder-form" onSubmit={(e) => void submit(e)}>
        <label className="sr-only" htmlFor="limit">
          Limite de la musique en Go
        </label>
        <input id="limit" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={{ maxWidth: 120 }} />
        <span className="muted">Go au maximum</span>
        <button type="submit" className="btn" disabled={busy}>
          Enregistrer
        </button>
      </form>
    </section>
  );
}

/** Application Serveur > Stockage : la place prise par la musique, limitée, et les fichiers importés. */
export function StoragePage() {
  const { data: st } = useQuery({ queryKey: STORAGE, queryFn: () => api.get<ConsoleStorage>('/api/console/storage'), refetchInterval: 10_000 });

  const share = st ? pct(st.usedBytes, st.limitBytes) : 0;
  const over = !!st && st.usedBytes > st.limitBytes;
  const low = !!st && share >= 90;
  const left = st ? Math.max(0, st.limitBytes - st.usedBytes) : 0;

  return (
    <div className="c-page">
      <header className="c-head">
        <div>
          <h1>Stockage</h1>
          <p className="muted">La place prise par ta musique, limitée à {st ? formatBytes(st.limitBytes) : '20 Go'}.</p>
        </div>
      </header>

      {!st ? null : (
        <>
          {low && (
            <div className="callout is-warn" role="status">
              <strong>
                <AlertTriangle aria-hidden /> {over ? 'La limite est dépassée' : 'La limite est presque atteinte'}
              </strong>
              <p>
                {over
                  ? 'Les nouvelles importations sont refusées. Supprime des fichiers importés ou augmente la limite.'
                  : `Il reste ${formatBytes(left)} avant que les importations soient refusées.`}
              </p>
            </div>
          )}

          <section className={`c-disk ${low ? 'is-low' : ''}`} aria-labelledby="usage-title">
            <div className="c-disk-head">
              <HardDrive aria-hidden />
              <strong id="usage-title">Musique</strong>
              <span className="c-disk-free">
                <strong>{formatBytes(st.usedBytes)}</strong> utilisés sur {formatBytes(st.limitBytes)}
              </span>
            </div>
            <div className="c-bar" role="img" aria-label={`${formatBytes(st.usedBytes)} utilisés sur ${formatBytes(st.limitBytes)}`}>
              <span className="c-seg c-seg-music" style={{ width: `${share}%` }} />
              <span className="c-seg c-seg-free" style={{ width: `${100 - share}%` }} />
            </div>
            <ul className="c-legend">
              <li>
                <i className="c-swatch c-seg-music" aria-hidden />
                Utilisé <strong>{formatBytes(st.usedBytes)}</strong>
              </li>
              <li>
                <i className="c-swatch c-seg-free" aria-hidden />
                Disponible <strong>{formatBytes(left)}</strong>
              </li>
              <li>
                {n(st.tracks)} titre{st.tracks > 1 ? 's' : ''}
              </li>
            </ul>
          </section>

          <section className="setting-block" aria-labelledby="folders-title">
            <h2 id="folders-title">Dossiers de musique</h2>
            <ul className="c-rows">
              {st.folders.map((f) => (
                <li key={f.path} className={f.exists ? '' : 'is-missing'}>
                  {f.kind === 'imports' ? <Upload aria-hidden /> : <FolderOpen aria-hidden />}
                  <span className="c-row-text">
                    <span className="c-row-name">
                      <code>{f.path}</code>
                    </span>
                    <span className="muted small">
                      {f.kind === 'imports' ? 'Fichiers importés' : 'Dossier de musique'} · {f.exists ? `${n(f.tracks)} titre${f.tracks > 1 ? 's' : ''} · ${formatBytes(f.bytes)}` : 'introuvable (disque débranché ?)'}
                    </span>
                    {f.exists && st.usedBytes > 0 && (
                      <span className="c-meter" aria-hidden>
                        <span style={{ width: `${pct(f.bytes, st.usedBytes)}%` }} />
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted small">
              Pour ajouter ou retirer un dossier : <Link to="/musique">Musique</Link>.
            </p>
          </section>

          <Imports st={st} />

          <Limit key={st.limitBytes} st={st} />
        </>
      )}
    </div>
  );
}
