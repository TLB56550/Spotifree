import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ServerCog } from 'lucide-react';
import type { Stats } from '@shared/types';
import { api } from '../lib/api';
import { useIsAdmin } from '../lib/auth';
import { formatTotal } from '../lib/format';
import { useIsMobile } from '../hooks/useMobile';
import { useSettings } from '../components/Folders';
import { Account } from '../components/Account';
import { Appearance } from '../components/Appearance';
import { SoundSettings } from '../components/SoundPanel';
import { changeNativeServer, isNativeApp } from '../lib/native';

const SHORTCUTS: [string, string][] = [
  ['Espace', 'Lecture / pause'],
  ['Ctrl + ←  ou  Ctrl + →', 'Titre précédent / suivant'],
  ['←  ou  →', 'Reculer / avancer de 5 secondes'],
  ['↑  ou  ↓', 'Volume plus fort / moins fort'],
  ['M', 'Couper le son'],
  ['S', 'Lecture aléatoire'],
  ['R', 'Répéter'],
  ['L', 'Liker le titre en cours'],
  ['Q', 'Afficher la file d’attente'],
  ['/', 'Aller à la recherche'],
];

/** Réglages personnels : apparence, son, compte. Le serveur se gère dans « Administration ». */
export default function SettingsPage() {
  const { data: settings } = useSettings();
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/api/stats') });
  const admin = useIsAdmin();
  const mobile = useIsMobile();

  return (
    <div className="page-pad settings">
      <header className="page-head">
        <h1>Paramètres</h1>
      </header>

      <Appearance />

      <section className="setting-block">
        <h2>Son</h2>
        <p className="muted">Le choix est gardé sur cet appareil. Il règle l’égaliseur selon ce qui diffuse le son et l’ambiance voulue.</p>
        <SoundSettings />
      </section>

      <Account />

      <section className="setting-block">
        <h2>Ta bibliothèque</h2>
        {stats && (
          <dl className="stats">
            <div><dt>Titres</dt><dd>{stats.tracks.toLocaleString('fr-FR')}</dd></div>
            <div><dt>Albums</dt><dd>{stats.albums.toLocaleString('fr-FR')}</dd></div>
            <div><dt>Artistes</dt><dd>{stats.artists.toLocaleString('fr-FR')}</dd></div>
            <div><dt>Tes playlists</dt><dd>{stats.playlists.toLocaleString('fr-FR')}</dd></div>
            <div><dt>Durée totale</dt><dd>{formatTotal(stats.duration)}</dd></div>
          </dl>
        )}
      </section>

      {admin && (
        <section className="setting-block">
          <h2>Serveur</h2>
          <p className="muted">Comptes, accès depuis les autres appareils, dossiers de musique, importation, mises à jour.</p>
          <div className="setting-actions">
            <Link to="/admin" className="btn btn-primary">
              <ServerCog /> Ouvrir l’administration
            </Link>
          </div>
        </section>
      )}

      {!mobile && (
        <section className="setting-block shortcuts-block">
          <h2>Raccourcis clavier</h2>
          <dl className="shortcuts">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys}>
                <dt><kbd>{keys}</kbd></dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="setting-block">
        <h2>Application</h2>
        <p className="muted">Version {settings?.version ?? '…'}</p>
        {isNativeApp() && (
          <div className="setting-actions">
            <button type="button" className="btn" onClick={changeNativeServer}>
              Changer l’adresse du serveur
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
