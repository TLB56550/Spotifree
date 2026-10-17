import { useQuery } from '@tanstack/react-query';
import { Power, RefreshCw } from 'lucide-react';
import type { ScanStatus, Stats } from '@shared/types';
import { api } from '../lib/api';
import { formatTotal, plural } from '../lib/format';
import { invalidateLibrary } from '../lib/queryClient';
import { toast, useUI } from '../store/ui';
import { FolderManager, ScanProgress, useSettings } from '../components/Folders';
import { Appearance } from '../components/Appearance';
import { SoundSettings } from '../components/SoundPanel';
import { UpdateSection } from '../components/UpdateSection';
import { UploadList, UploadPicker } from '../components/Uploads';
import { PhoneAccess } from '../components/PhoneAccess';
import { changeNativeServer, isNativeApp } from '../lib/native';
import { useState } from 'react';

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

export default function SettingsPage() {
  const { data: settings } = useSettings();
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/api/stats') });
  const { data: scan } = useQuery({
    queryKey: ['scan'],
    queryFn: () => api.get<ScanStatus>('/api/scan'),
    refetchInterval: (q) => (q.state.data?.running ? 1000 : 5000),
  });
  const confirm = useUI((s) => s.confirm);
  const [stopped, setStopped] = useState(false);

  const rescan = async (full: boolean) => {
    try {
      await api.post('/api/scan', { full });
      toast(full ? 'Réanalyse complète lancée' : 'Analyse lancée');
      void invalidateLibrary();
    } catch {
      toast('Impossible de lancer l’analyse.', 'error');
    }
  };

  const shutdown = async () => {
    const ok = await confirm({
      title: 'Arrêter Ma Bibliothèque ?',
      message: 'La musique s’arrêtera et l’application se fermera. Tu pourras la relancer avec « Lancer Ma Bibliothèque ».',
      confirmLabel: 'Arrêter',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post('/api/shutdown');
      setStopped(true);
    } catch {
      toast('Impossible d’arrêter le serveur depuis ici.', 'error');
    }
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: 'Déconnecter ce téléphone ?',
      message: 'Pour réécouter ta musique, il faudra l’associer de nouveau avec un code affiché sur ton PC.',
      confirmLabel: 'Déconnecter',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post('/api/session/logout');
    } finally {
      window.location.replace('/');
    }
  };

  // Vu depuis un téléphone associé : ni dossiers du PC, ni arrêt du programme.
  if (settings && !settings.local) {
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
        <section className="setting-block">
          <h2>Ta bibliothèque</h2>
          {stats && (
            <dl className="stats">
              <div><dt>Titres</dt><dd>{stats.tracks.toLocaleString('fr-FR')}</dd></div>
              <div><dt>Albums</dt><dd>{stats.albums.toLocaleString('fr-FR')}</dd></div>
              <div><dt>Artistes</dt><dd>{stats.artists.toLocaleString('fr-FR')}</dd></div>
              <div><dt>Playlists</dt><dd>{stats.playlists.toLocaleString('fr-FR')}</dd></div>
              <div><dt>Durée totale</dt><dd>{formatTotal(stats.duration)}</dd></div>
            </dl>
          )}
        </section>
        <section className="setting-block">
          <h2>Envoyer de la musique vers le PC</h2>
          <p className="muted">
            Les fichiers audio choisis sur ce téléphone sont copiés dans un dossier réservé de ton PC (« Importations »), séparé de ta musique habituelle, puis ajoutés à la bibliothèque.
          </p>
          <div className="setting-actions">
            <UploadPicker variant="button" />
          </div>
          <UploadList />
        </section>
        <section className="setting-block">
          <h2>Ce téléphone</h2>
          <p className="muted">
            Associé à ton PC sous le nom « {settings.deviceName ?? 'Téléphone'} ». Les dossiers de musique, l’analyse et l’arrêt du programme se gèrent depuis le PC.
          </p>
          <div className="setting-actions">
            <button type="button" className="btn btn-danger" onClick={() => void disconnect()}>
              Déconnecter ce téléphone
            </button>
            {isNativeApp() && (
              <button type="button" className="btn" onClick={changeNativeServer}>
                Changer l’adresse du PC
              </button>
            )}
          </div>
        </section>
        <section className="setting-block">
          <h2>Application</h2>
          <p className="muted">Version {settings.version}</p>
        </section>
      </div>
    );
  }

  if (stopped) {
    return (
      <div className="page-pad">
        <div className="empty-block">
          <h2>Ma Bibliothèque est arrêtée</h2>
          <p>Tu peux fermer cette fenêtre.</p>
        </div>
      </div>
    );
  }

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

      <section className="setting-block">
        <h2>Dossiers de musique</h2>
        <p className="muted">Ces dossiers sont analysés, sous-dossiers compris. Les nouveaux fichiers sont détectés automatiquement.</p>
        <FolderManager />
      </section>

      <section className="setting-block">
        <h2>Importer de la musique</h2>
        <p className="muted">
          Choisis des fichiers audio (ou glisse-les sur la fenêtre) : ils sont copiés dans un dossier réservé de l’application, séparé de ta musique habituelle, puis ajoutés à la bibliothèque. Tes téléphones peuvent aussi y envoyer leurs fichiers.
        </p>
        <div className="setting-actions">
          <UploadPicker variant="button" />
        </div>
        {settings?.uploadsDir && (
          <p className="muted small">
            Dossier des importations : <code>{settings.uploadsDir}</code>
          </p>
        )}
      </section>

      <section className="setting-block">
        <h2>Analyse</h2>
        <ScanProgress status={scan} />
        <div className="setting-actions">
          <button type="button" className="btn" disabled={scan?.running} onClick={() => void rescan(false)}>
            <RefreshCw /> Analyser maintenant
          </button>
          <button type="button" className="btn btn-ghost" disabled={scan?.running} onClick={() => void rescan(true)} title="Relit toutes les étiquettes et pochettes, même sans changement">
            Tout réanalyser
          </button>
        </div>
      </section>

      <section className="setting-block">
        <h2>Ta bibliothèque</h2>
        {stats && (
          <dl className="stats">
            <div><dt>Titres</dt><dd>{stats.tracks.toLocaleString('fr-FR')}</dd></div>
            <div><dt>Albums</dt><dd>{stats.albums.toLocaleString('fr-FR')}</dd></div>
            <div><dt>Artistes</dt><dd>{stats.artists.toLocaleString('fr-FR')}</dd></div>
            <div><dt>Playlists</dt><dd>{stats.playlists.toLocaleString('fr-FR')}</dd></div>
            <div><dt>Durée totale</dt><dd>{formatTotal(stats.duration)}</dd></div>
          </dl>
        )}
      </section>

      {settings?.local && <PhoneAccess />}

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

      <section className="setting-block">
        <h2>Application</h2>
        <p className="muted">
          Version {settings?.version ?? '…'} · Les données (playlists, likes, pochettes) sont dans <code>{settings?.dataDir}</code>.
          Tes fichiers de musique ne sont jamais modifiés.
        </p>
        <div className="setting-actions">
          <button type="button" className="btn btn-danger" onClick={() => void shutdown()}>
            <Power /> Arrêter Ma Bibliothèque
          </button>
        </div>
        {stats && <p className="muted small">{plural(stats.tracks, 'titre', 'titres')} dans la bibliothèque.</p>}
        <UpdateSection />
      </section>
    </div>
  );
}
