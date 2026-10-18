import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import type { Album, HomeData, Playlist, ScanStatus, Stats } from '@shared/types';
import { api } from '../lib/api';
import { albumSource, likedSource, playlistSource, playSource, type Source } from '../lib/actions';
import { countTracks, greeting } from '../lib/format';
import { openAt, useMenus } from '../hooks/useMenus';
import { usePlayer } from '../store/player';
import { Cover, PlaylistCover } from '../components/Cover';
import { MediaCard, Shelf } from '../components/Cards';
import { PlayButton } from '../components/Controls';
import { TrackList } from '../components/TrackList';
import { Skeleton } from '../components/Hero';
import { useAbout } from '../lib/about';
import { InstallHint } from '../components/InstallHint';

function QuickTile({ to, cover, title, source }: { to: string; cover: React.ReactNode; title: string; source: Source }) {
  const active = usePlayer((s) => s.context?.href === to);
  const playing = usePlayer((s) => s.context?.href === to && s.playing);
  return (
    <div className={`quick ${active ? 'is-active' : ''}`}>
      <div className="quick-cover">{cover}</div>
      <Link to={to} className="quick-title">
        {title}
      </Link>
      <div className="quick-play">
        <PlayButton playing={playing} label={`${playing ? 'Mettre en pause' : 'Lire'} ${title}`} onClick={() => (active ? usePlayer.getState().toggle() : void playSource(source))} />
      </div>
    </div>
  );
}

function Onboarding() {
  const { data: about } = useAbout();
  const { data: scan } = useQuery({
    queryKey: ['scan'],
    queryFn: () => api.get<ScanStatus>('/api/scan'),
    refetchInterval: (q) => (q.state.data?.running ? 1000 : 4000),
  });
  return (
    <div className="onboarding">
      <h1>La bibliothèque est vide</h1>
      {scan?.running ? (
        <p>La musique est en cours d’analyse sur le serveur. Les premiers titres apparaissent dans quelques instants.</p>
      ) : about?.local ? (
        <p>
          Aucun titre n’a encore été ajouté. Ouvre l’application <strong>Spotifree Serveur</strong> (raccourci du bureau) : choisis le dossier qui contient ta musique, elle apparaîtra ici.
        </p>
      ) : (
        <p>Aucun titre n’a encore été ajouté. La personne qui gère le serveur doit d’abord choisir le dossier de musique : reviens un peu plus tard.</p>
      )}
    </div>
  );
}

export default function HomePage() {
  const menus = useMenus();
  const navigate = useNavigate();
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/api/stats') });
  const home = useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeData>('/api/home') });

  if (stats.data && stats.data.tracks === 0) return <Onboarding />;
  if (!home.data) return <Skeleton />;
  const d = home.data;

  const albumCard = (a: Album) => {
    const src = albumSource(a.id, a.title);
    return (
      <MediaCard
        key={a.id}
        to={src.href}
        title={a.title}
        subtitle={[a.year, a.artist].filter(Boolean).join(' · ')}
        media={<Cover cover={a.cover} seed={a.title} />}
        onPlay={() => void playSource(src)}
        onContextMenu={(e) => openAt(e, menus.source(src, [{ label: 'Aller à l’artiste', onClick: () => navigate(`/artist/${a.artistId}`) }]))}
      />
    );
  };
  const playlistCard = (p: Playlist) => {
    const src = playlistSource(p.id, p.name);
    return (
      <MediaCard
        key={p.id}
        to={src.href}
        title={p.name}
        subtitle={`Playlist · ${countTracks(p.trackCount)}`}
        media={<PlaylistCover covers={p.covers} name={p.name} />}
        onPlay={() => void playSource(src)}
        onContextMenu={(e) => openAt(e, menus.playlist(p, src))}
      />
    );
  };

  const tiles: React.ReactNode[] = [
    <QuickTile
      key="liked"
      to="/liked"
      source={likedSource}
      title="Titres likés"
      cover={
        <span className="liked-cover">
          <Heart fill="currentColor" />
        </span>
      }
    />,
  ];
  for (const p of d.playlists.slice(0, 3)) {
    tiles.push(<QuickTile key={`p${p.id}`} to={`/playlist/${p.id}`} source={playlistSource(p.id, p.name)} title={p.name} cover={<PlaylistCover covers={p.covers} name={p.name} />} />);
  }
  for (const a of [...d.recentAlbums, ...d.recentlyAdded]) {
    if (tiles.length >= 8) break;
    if (tiles.some((t) => (t as { key: string }).key === `a${a.id}`)) continue;
    tiles.push(<QuickTile key={`a${a.id}`} to={`/album/${a.id}`} source={albumSource(a.id, a.title)} title={a.title} cover={<Cover cover={a.cover} seed={a.title} />} />);
  }

  return (
    <div className="home">
      <h1 className="home-greeting">{greeting()}</h1>
      <InstallHint />
      <div className="quick-grid">{tiles}</div>

      {d.recentAlbums.length > 0 && <Shelf title="Écoutés récemment">{d.recentAlbums.map(albumCard)}</Shelf>}
      {d.recentlyAdded.length > 0 && (
        <Shelf title="Ajoutés récemment" to="/albums">
          {d.recentlyAdded.map(albumCard)}
        </Shelf>
      )}
      {d.playlists.length > 0 && <Shelf title="Tes playlists">{d.playlists.map(playlistCard)}</Shelf>}
      {d.mostPlayed.length > 0 && (
        <section className="shelf">
          <header className="shelf-head">
            <h2>Tes titres les plus écoutés</h2>
          </header>
          <TrackList tracks={d.mostPlayed} label="Tes titres les plus écoutés" showAdded={false} />
        </section>
      )}
      {d.discover.length > 0 && <Shelf title="À redécouvrir">{d.discover.map(albumCard)}</Shelf>}
    </div>
  );
}

