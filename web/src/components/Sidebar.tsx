import { NavLink, useMatch, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Disc3, Heart, Home, ListMusic, Mic2, Music2, Plus, Search, Settings, Volume2 } from 'lucide-react';
import type { Playlist } from '@shared/types';
import { api } from '../lib/api';
import { countTracks } from '../lib/format';
import { playlistSource } from '../lib/actions';
import { usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { openAt, useMenus } from '../hooks/useMenus';
import { PlaylistCover } from './Cover';

import { UploadPicker } from './Uploads';

export function LibraryRow({
  to,
  cover,
  title,
  subtitle,
  onContextMenu,
}: {
  to: string;
  cover: React.ReactNode;
  title: string;
  subtitle: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const playing = usePlayer((s) => s.context?.href === to && s.playing);
  return (
    <NavLink to={to} className={({ isActive }) => `lib-row ${isActive ? 'is-active' : ''}`} onContextMenu={onContextMenu}>
      <span className="lib-cover">{cover}</span>
      <span className="lib-text">
        <span className="lib-title">{title}</span>
        <span className="lib-sub">{subtitle}</span>
      </span>
      {playing && <Volume2 className="lib-playing" aria-label="En lecture" />}
    </NavLink>
  );
}

export function PlaylistRow({ playlist }: { playlist: Playlist }) {
  const menus = useMenus();
  const navigate = useNavigate();
  const to = `/playlist/${playlist.id}`;
  const onPage = useMatch(to);
  return (
    <LibraryRow
      to={to}
      cover={<PlaylistCover covers={playlist.covers} name={playlist.name} />}
      title={playlist.name}
      subtitle={`Playlist · ${countTracks(playlist.trackCount)}`}
      onContextMenu={(e) =>
        openAt(
          e,
          menus.playlist(playlist, playlistSource(playlist.id, playlist.name), () => {
            if (onPage) navigate('/');
          }),
        )
      }
    />
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const { data: playlists } = useQuery({ queryKey: ['playlists'], queryFn: () => api.get<Playlist[]>('/api/playlists') });
  const { data: likedIds } = useQuery({ queryKey: ['favorites', 'ids'], queryFn: () => api.get<number[]>('/api/favorites/ids') });
  const openDialog = useUI((s) => s.openPlaylistDialog);

  const navItem = (to: string, icon: React.ReactNode, label: string, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
      {icon}
      <span>{label}</span>
    </NavLink>
  );

  return (
    <aside className="sidebar">
      <section className="panel sidebar-top">
        <NavLink to="/" className="brand" aria-label="Ma Bibliothèque, accueil">
          <svg viewBox="0 0 64 64" className="brand-mark" aria-hidden>
            <circle cx="32" cy="32" r="29" fill="#0c0e12" stroke="currentColor" strokeWidth="3" />
            <circle cx="32" cy="32" r="19" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".4" />
            <circle cx="32" cy="32" r="10" fill="var(--accent)" />
            <circle cx="32" cy="32" r="2.6" fill="#0c0e12" />
          </svg>
          <span className="brand-name">Ma Bibliothèque</span>
        </NavLink>
        <nav className="nav" aria-label="Navigation principale">
          {navItem('/', <Home />, 'Accueil', true)}
          {navItem('/search', <Search />, 'Rechercher')}
          {navItem('/songs', <Music2 />, 'Titres')}
          {navItem('/albums', <Disc3 />, 'Albums')}
          {navItem('/artists', <Mic2 />, 'Artistes')}
        </nav>
      </section>

      <section className="panel sidebar-library">
        <header className="lib-head">
          <h2>
            <ListMusic /> Playlists
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Créer une playlist"
            title="Créer une playlist"
            onClick={() => openDialog({ onDone: (p) => navigate(`/playlist/${p.id}`) })}
          >
            <Plus />
          </button>
        </header>
        <div className="lib-list">
          <LibraryRow
            to="/liked"
            cover={
              <span className="liked-cover">
                <Heart fill="currentColor" />
              </span>
            }
            title="Titres likés"
            subtitle={`Playlist · ${countTracks(likedIds?.length ?? 0)}`}
          />
          {playlists?.map((p) => <PlaylistRow key={p.id} playlist={p} />)}
          {playlists && playlists.length === 0 && (
            <p className="lib-empty">
              Crée ta première playlist avec le bouton +, puis ajoute des titres depuis le menu « ⋯ ».
            </p>
          )}
        </div>
        <footer className="lib-foot">
          <UploadPicker variant="nav" />
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
            <Settings />
            <span>Paramètres</span>
          </NavLink>
        </footer>
      </section>
    </aside>
  );
}
