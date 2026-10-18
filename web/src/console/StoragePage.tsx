import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FolderOpen, HardDrive, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { ConsoleStorage, StorageDisk, StorageImport } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { formatAgo, formatBytes } from '../lib/format';
import { queryClient } from '../lib/queryClient';
import { toast, useUI } from '../store/ui';

const STORAGE = ['console', 'storage'];
const IMPORTS = ['console', 'storage', 'imports'];
const n = (v: number) => v.toLocaleString('fr-FR');
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, (part / whole) * 100) : 0);

/** Barre d'un disque : la musique de Spotifree, ses données, le reste du disque, puis l'espace libre. */
function DiskCard({ disk, st }: { disk: StorageDisk; st: ConsoleStorage }) {
  const music = st.folders.filter((f) => f.diskId === disk.id).reduce((s, f) => s + f.bytes, 0);
  const data = st.app.diskId === disk.id ? st.app.bytes : 0;
  const used = Math.max(0, disk.total - disk.free);
  const other = Math.max(0, used - music - data);
  const low = disk.free < Math.max(st.minFreeGb * 1024 ** 3, disk.total * 0.05);
  const parts = [
    { key: 'music', label: 'Musique Spotifree', bytes: music },
    { key: 'data', label: 'Données Spotifree', bytes: data },
    { key: 'other', label: 'Autres fichiers', bytes: other },
    { key: 'free', label: 'Libre', bytes: disk.free },
  ];
  return (
    <li className={`c-disk ${low ? 'is-low' : ''}`}>
      <div className="c-disk-head">
        <HardDrive aria-hidden />
        <strong>Disque {disk.label}</strong>
        <span className="c-disk-free">
          <strong>{formatBytes(disk.free)}</strong> libres sur {formatBytes(disk.total)}
        </span>
      </div>
      <div className="c-bar" role="img" aria-label={parts.map((p) => `${p.label} : ${formatBytes(p.bytes)}`).join(', ')}>
        {parts.map((p) => (
          <span key={p.key} className={`c-seg c-seg-${p.key}`} style={{ width: `${pct(p.bytes, disk.total)}%` }} title={`${p.label} : ${formatBytes(p.bytes)}`} />
        ))}
      </div>
      <ul className="c-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <i className={`c-swatch c-seg-${p.key}`} aria-hidden />
            {p.label} <strong>{formatBytes(p.bytes)}</strong>
          </li>
        ))}
      </ul>
    </li>
  );
}

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

function Reserve({ st }: { st: ConsoleStorage }) {
  const [value, setValue] = useState(String(st.minFreeGb));
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const gb = Number(value.replace(',', '.'));
    if (!Number.isFinite(gb) || gb < 0) return toast('Indique un nombre de Go (0 ou plus).', 'error');
    setBusy(true);
    try {
      queryClient.setQueryData(STORAGE, await api.put<ConsoleStorage>('/api/console/storage/settings', { minFreeGb: gb }));
      toast('Réserve enregistrée');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Impossible d’enregistrer.', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="setting-block" aria-labelledby="reserve-title">
      <h2 id="reserve-title">Garder de la place libre</h2>
      <p className="muted">Les importations sont refusées si elles font passer le disque sous cette réserve. Elle évite de remplir complètement le disque du PC.</p>
      <form className="folder-form" onSubmit={(e) => void submit(e)}>
        <label className="sr-only" htmlFor="reserve">
          Réserve d’espace libre en Go
        </label>
        <input id="reserve" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={{ maxWidth: 120 }} />
        <span className="muted">Go à garder libres</span>
        <button type="submit" className="btn" disabled={busy}>
          Enregistrer
        </button>
      </form>
    </section>
  );
}

/** Application Serveur > Stockage : espace utilisé et libre, répartition de la musique, fichiers importés. */
export function StoragePage() {
  const { data: st, isFetching } = useQuery({ queryKey: STORAGE, queryFn: () => api.get<ConsoleStorage>('/api/console/storage'), refetchInterval: 10_000 });
  const refresh = async () => {
    try {
      queryClient.setQueryData(STORAGE, await api.get<ConsoleStorage>('/api/console/storage?refresh=1'));
    } catch {
      toast('Impossible de mesurer le stockage.', 'error');
    }
  };

  const lowDisks = st ? st.disks.filter((d) => d.free < Math.max(st.minFreeGb * 1024 ** 3, d.total * 0.05)) : [];
  const diskLabel = (id: string | null) => st?.disks.find((d) => d.id === id)?.label;

  return (
    <div className="c-page">
      <header className="c-head">
        <div>
          <h1>Stockage</h1>
          <p className="muted">L’espace pris par ta musique et ce qu’il reste sur les disques de ce PC.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void refresh()} disabled={isFetching}>
          <RefreshCw /> Mesurer à nouveau
        </button>
      </header>

      {!st ? null : (
        <>
          {lowDisks.length > 0 && (
            <div className="callout is-warn" role="status">
              <strong>
                <AlertTriangle aria-hidden /> Il reste peu de place
              </strong>
              <p>
                Disque {lowDisks.map((d) => d.label).join(', ')} : {lowDisks.map((d) => formatBytes(d.free)).join(', ')} libres. Libère de la place avant d’importer d’autres fichiers.
              </p>
            </div>
          )}

          <section className="c-block" aria-labelledby="disks-title">
            <h2 id="disks-title">Disques</h2>
            {st.disks.length === 0 ? (
              <p className="muted">L’espace des disques n’a pas pu être mesuré sur ce PC.</p>
            ) : (
              <ul className="c-disks">
                {st.disks.map((d) => (
                  <DiskCard key={d.id} disk={d} st={st} />
                ))}
              </ul>
            )}
            <dl className="stats">
              <div><dt>Titres</dt><dd>{n(st.library.tracks)}</dd></div>
              <div><dt>Musique</dt><dd>{formatBytes(st.library.bytes)}</dd></div>
              <div><dt>Données de Spotifree</dt><dd>{formatBytes(st.app.bytes)}</dd></div>
            </dl>
          </section>

          <section className="setting-block" aria-labelledby="folders-title">
            <h2 id="folders-title">Dossiers</h2>
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
                      {diskLabel(f.diskId) ? ` · disque ${diskLabel(f.diskId)}` : ''}
                    </span>
                    {f.exists && st.library.bytes > 0 && (
                      <span className="c-meter" aria-hidden>
                        <span style={{ width: `${pct(f.bytes, st.library.bytes)}%` }} />
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

          <section className="setting-block" aria-labelledby="formats-title">
            <h2 id="formats-title">Par format</h2>
            {st.formats.length === 0 ? (
              <p className="muted">Aucune musique pour le moment.</p>
            ) : (
              <ul className="c-rows">
                {st.formats.map((f) => (
                  <li key={f.format}>
                    <span className="c-format">{f.format}</span>
                    <span className="c-row-text">
                      <span className="c-row-name">
                        {formatBytes(f.bytes)} <span className="muted small">· {n(f.tracks)} titre{f.tracks > 1 ? 's' : ''} · {Math.round(pct(f.bytes, st.library.bytes))} %</span>
                      </span>
                      <span className="c-meter" aria-hidden>
                        <span style={{ width: `${pct(f.bytes, st.library.bytes)}%` }} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {st.biggest.length > 0 && (
            <section className="setting-block" aria-labelledby="big-title">
              <h2 id="big-title">Albums les plus volumineux</h2>
              <ul className="c-rows">
                {st.biggest.map((a) => (
                  <li key={a.id}>
                    <span className="c-row-text">
                      <span className="c-row-name">{a.title}</span>
                      <span className="muted small">
                        {a.artist} · {n(a.tracks)} titre{a.tracks > 1 ? 's' : ''}
                      </span>
                    </span>
                    <strong className="c-size">{formatBytes(a.bytes)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Imports st={st} />

          <section className="setting-block" aria-labelledby="app-title">
            <h2 id="app-title">Données de Spotifree</h2>
            <p className="muted">Base de données, pochettes et journaux. Ils restent petits, même avec une grande bibliothèque.</p>
            <dl className="c-paths">
              <div>
                <dt>Dossier</dt>
                <dd><code>{st.app.dataDir}</code></dd>
              </div>
              <div>
                <dt>Base de données</dt>
                <dd>{formatBytes(st.app.database)}</dd>
              </div>
              <div>
                <dt>Pochettes</dt>
                <dd>{formatBytes(st.app.covers)}</dd>
              </div>
            </dl>
          </section>

          <Reserve key={st.minFreeGb} st={st} />
        </>
      )}
    </div>
  );
}
