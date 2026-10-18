import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Power } from 'lucide-react';
import type { ConsoleStats, RemoteStatus, ScanStatus, UpdateStatus } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { formatTotal } from '../lib/format';
import { toast } from '../store/ui';
import { ScanProgress, useConsoleInfo } from './Folders';
import { shutdownServer } from './state';

const n = (v: number) => v.toLocaleString('fr-FR');

/** Application Serveur > Vue d'ensemble : l'état du serveur d'un coup d'œil. */
export function Overview() {
  const { data: info } = useConsoleInfo();
  const { data: stats } = useQuery({ queryKey: ['console', 'stats'], queryFn: () => api.get<ConsoleStats>('/api/console/stats'), refetchInterval: 6000 });
  const { data: remote } = useQuery({ queryKey: ['console', 'remote'], queryFn: () => api.get<RemoteStatus>('/api/console/remote'), refetchInterval: 6000 });
  const { data: scan } = useQuery({
    queryKey: ['console', 'scan'],
    queryFn: () => api.get<ScanStatus>('/api/console/scan'),
    refetchInterval: (q) => (q.state.data?.running ? 1000 : 6000),
  });
  const { data: update } = useQuery({ queryKey: ['console', 'update'], queryFn: () => api.get<UpdateStatus>('/api/console/update'), refetchInterval: 10_000 });

  const openPlayer = async () => {
    try {
      await api.post('/api/console/open-player');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Impossible d’ouvrir le lecteur.', 'error');
    }
  };

  const noMusic = info && info.musicDirs.length === 0 && stats?.tracks === 0;
  const noAccount = stats && stats.users === 0;
  const address = remote?.running ? remote.addresses[0]?.url : null;

  return (
    <div className="c-page">
      <header className="c-head">
        <div>
          <h1>Vue d’ensemble</h1>
          <p className="c-status">
            <span className="c-dot" aria-hidden /> Le serveur est en marche{info ? ` · version ${info.version}` : ''}
          </p>
        </div>
        <div className="setting-actions">
          <button type="button" className="btn btn-primary" onClick={() => void openPlayer()}>
            <ExternalLink /> Ouvrir le lecteur
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void shutdownServer()}>
            <Power /> Arrêter
          </button>
        </div>
      </header>

      {update && update.latest && update.latest !== update.current && update.canInstall && (
        <div className="callout" role="status">
          <strong>Mise à jour {update.latest}</strong>
          <p>Elle s’installe toute seule ; le lecteur et le serveur redémarrent en quelques secondes.</p>
        </div>
      )}
      {noMusic && (
        <div className="callout" role="status">
          <strong>Aucune musique pour le moment</strong>
          <p>
            Choisis le dossier qui contient tes fichiers dans <Link to="/musique">Musique</Link>.
          </p>
        </div>
      )}
      {noAccount && (
        <div className="callout" role="status">
          <strong>Aucun compte pour le moment</strong>
          <p>Ouvre le lecteur : la première personne qui s’y inscrit crée le premier compte. Tu peux aussi en créer un dans <Link to="/comptes">Comptes</Link>.</p>
        </div>
      )}

      <section className="c-block">
        <h2>Bibliothèque</h2>
        <dl className="stats">
          <div><dt>Titres</dt><dd>{stats ? n(stats.tracks) : '…'}</dd></div>
          <div><dt>Albums</dt><dd>{stats ? n(stats.albums) : '…'}</dd></div>
          <div><dt>Artistes</dt><dd>{stats ? n(stats.artists) : '…'}</dd></div>
          <div><dt>Durée totale</dt><dd>{stats ? formatTotal(stats.duration) : '…'}</dd></div>
        </dl>
        <ScanProgress status={scan} />
      </section>

      <section className="c-block">
        <h2>Personnes et appareils</h2>
        <dl className="stats">
          <Link to="/comptes" className="c-stat-link">
            <dt>Comptes</dt>
            <dd>{stats ? n(stats.users) : '…'}</dd>
          </Link>
          <Link to="/appareils" className="c-stat-link">
            <dt>Appareils connectés</dt>
            <dd>{stats ? n(stats.devices) : '…'}</dd>
          </Link>
        </dl>
        <div className="c-line">
          <span className={`c-dot ${remote?.running ? '' : 'is-off'}`} aria-hidden />
          <span>
            {remote?.running ? (
              <>
                Accès depuis d’autres appareils : <strong>activé</strong>
                {address ? (
                  <>
                    {' '}
                    — <code>{address}</code>
                  </>
                ) : null}
              </>
            ) : (
              <>
                Accès depuis d’autres appareils : <strong>désactivé</strong> — ce PC seulement
              </>
            )}
          </span>
          <Link to="/appareils" className="link-btn">
            Gérer
          </Link>
        </div>
      </section>

      {info && (
        <p className="muted small c-foot">
          Lecteur sur ce PC : <code>{info.playerUrl}</code>
        </p>
      )}
    </div>
  );
}
