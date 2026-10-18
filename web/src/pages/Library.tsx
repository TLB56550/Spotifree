import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Heart, Plus, Search } from 'lucide-react';
import type { Album, Artist, Playlist, Track } from '@shared/types';
import { api } from '../lib/api';
import { albumSource, artistSource, likedSource, playSource } from '../lib/actions';
import { countAlbums, countTracks, formatTotal, normalize } from '../lib/format';
import { sortTracks } from '../lib/sort';
import { openAt, useMenus } from '../hooks/useMenus';
import { ActionBar, Hero, PageMessage, Skeleton } from '../components/Hero';
import { Cover } from '../components/Cover';
import { LibraryChips } from '../components/LibraryChips';
import { LibraryRow, PlaylistRow } from '../components/Sidebar';
import { useUI } from '../store/ui';
import { Grid, MediaCard } from '../components/Cards';
import { TrackList, type SortKey } from '../components/TrackList';

/** Playlists et titres likés : l'onglet « Bibliothèque » du téléphone. */
export function LibraryPage() {
  const navigate = useNavigate();
  const openDialog = useUI((s) => s.openPlaylistDialog);
  const { data: playlists } = useQuery({ queryKey: ['playlists'], queryFn: () => api.get<Playlist[]>('/api/playlists') });
  const { data: likedIds } = useQuery({ queryKey: ['favorites', 'ids'], queryFn: () => api.get<number[]>('/api/favorites/ids') });
  return (
    <div className="page-pad">
      <header className="page-head">
        <h1>Ta bibliothèque</h1>
      </header>
      <LibraryChips />
      <div className="lib-page">
        <button type="button" className="lib-row lib-new" onClick={() => openDialog({ onDone: (p) => navigate(`/playlist/${p.id}`) })}>
          <span className="lib-cover lib-plus">
            <Plus aria-hidden />
          </span>
          <span className="lib-text">
            <span className="lib-title">Nouvelle playlist</span>
          </span>
        </button>
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
      </div>
    </div>
  );
}

export function AlbumsPage() {
  const menus = useMenus();
  const navigate = useNavigate();
  const [sort, setSort] = useState<'title' | 'artist' | 'recent'>('title');
  const { data, isLoading } = useQuery({ queryKey: ['albums', sort], queryFn: () => api.get<Album[]>(`/api/albums?sort=${sort}`) });
  return (
    <div className="page-pad">
      <header className="page-head">
        <h1>Albums</h1>
        <label className="select">
          <span>Trier par</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="title">Titre</option>
            <option value="artist">Artiste</option>
            <option value="recent">Ajout récent</option>
          </select>
        </label>
      </header>
      <LibraryChips />
      {isLoading && <Skeleton />}
      {data && data.length === 0 && <PageMessage title="Aucun album">Ajoute un dossier de musique depuis les paramètres.</PageMessage>}
      <Grid>
        {data?.map((a) => {
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
        })}
      </Grid>
    </div>
  );
}

export function ArtistsPage() {
  const menus = useMenus();
  const { data, isLoading } = useQuery({ queryKey: ['artists'], queryFn: () => api.get<Artist[]>('/api/artists') });
  return (
    <div className="page-pad">
      <header className="page-head">
        <h1>Artistes</h1>
      </header>
      <LibraryChips />
      {isLoading && <Skeleton />}
      {data && data.length === 0 && <PageMessage title="Aucun artiste">Ajoute un dossier de musique depuis les paramètres.</PageMessage>}
      <Grid>
        {data?.map((a) => {
          const src = artistSource(a.id, a.name);
          return (
            <MediaCard
              key={a.id}
              to={src.href}
              round
              title={a.name}
              subtitle={`${countAlbums(a.albumCount)} · ${countTracks(a.trackCount)}`}
              media={<Cover cover={a.cover} seed={a.name} kind="artist" />}
              onPlay={() => void playSource(src)}
              onContextMenu={(e) => openAt(e, menus.source(src))}
            />
          );
        })}
      </Grid>
    </div>
  );
}

export function SongsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['tracks', { all: true }], queryFn: () => api.get<Track[]>('/api/tracks?sort=title') });
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'title', dir: 'asc' });

  const tracks = useMemo(() => {
    if (!data) return [];
    const q = normalize(filter).trim();
    const filtered = q ? data.filter((t) => normalize(`${t.title} ${t.artist} ${t.album}`).includes(q)) : data;
    return sortTracks(filtered, sort.key, sort.dir);
  }, [data, filter, sort]);

  return (
    <div className="page-pad">
      <header className="page-head">
        <h1>Titres</h1>
        <label className="filter">
          <Search aria-hidden />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer les titres" aria-label="Filtrer les titres" />
        </label>
      </header>
      <LibraryChips />
      {isLoading && <Skeleton />}
      {data && (
        <p className="muted count">
          {filter ? `${countTracks(tracks.length)} sur ${data.length.toLocaleString('fr-FR')}` : countTracks(data.length)}
        </p>
      )}
      {data && data.length === 0 && <PageMessage title="Aucun titre">Ajoute un dossier de musique depuis les paramètres.</PageMessage>}
      {tracks.length > 0 && (
        <TrackList
          tracks={tracks}
          label={filter ? `Titres · « ${filter} »` : 'Tous les titres'}
          href={filter ? undefined : '/songs'}
          showAdded
          virtual
          sort={{
            key: sort.key,
            dir: sort.dir,
            onSort: (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'addedAt' ? 'desc' : 'asc' })),
          }}
        />
      )}
      {data && data.length > 0 && tracks.length === 0 && <PageMessage title="Aucun résultat">Aucun titre ne correspond à « {filter} ».</PageMessage>}
    </div>
  );
}

export function LikedPage() {
  const { data, isLoading } = useQuery({ queryKey: ['favorites'], queryFn: () => api.get<Track[]>('/api/favorites') });
  const menus = useMenus();
  if (isLoading) return <Skeleton />;
  const tracks = data ?? [];
  const total = tracks.reduce((n, t) => n + t.duration, 0);
  return (
    <div className="hero-page" style={{ '--hero': 'hsl(262 38% 34%)' } as CSSProperties}>
      <Hero
        color="hsl(262 38% 34%)"
        kind="Playlist"
        title="Titres likés"
        cover={
          <div className="cover cover-fallback liked-big">
            <Heart fill="currentColor" />
          </div>
        }
        meta={<span>{tracks.length > 0 ? `${countTracks(tracks.length)}, ${formatTotal(total)}` : 'Aucun titre pour le moment'}</span>}
      />
      <div className="page-body">
        <ActionBar source={likedSource} disabled={tracks.length === 0} menu={() => menus.source(likedSource)} />
        {tracks.length === 0 ? (
          <div className="empty-block">
            <h2>Rien ici pour l’instant</h2>
            <p>Touche le cœur à côté d’un titre pour le retrouver dans cette liste.</p>
          </div>
        ) : (
          <TrackList tracks={tracks} label="Titres likés" href="/liked" showAdded virtual={tracks.length > 400} />
        )}
      </div>
    </div>
  );
}

export function GenrePage() {
  const { name = '' } = useParams();
  const { data, isLoading } = useQuery({ queryKey: ['genre', name], queryFn: () => api.get<Track[]>(`/api/tracks?genre=${encodeURIComponent(name)}`) });
  if (isLoading) return <Skeleton />;
  const tracks = data ?? [];
  const label = `Genre : ${name}`;
  const source = { label, href: `/genre/${encodeURIComponent(name)}`, tracks: async () => tracks };
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return (
    <div className="hero-page" style={{ '--hero': `hsl(${hue} 40% 30%)` } as CSSProperties}>
      <Hero color={`hsl(${hue} 40% 30%)`} kind="Genre" title={name} cover={<Cover seed={name} />} meta={<span>{countTracks(tracks.length)}</span>} />
      <div className="page-body">
        <ActionBar source={source} disabled={tracks.length === 0} />
        {tracks.length === 0 ? <PageMessage title="Aucun titre dans ce genre" /> : <TrackList tracks={tracks} label={label} href={source.href} showAdded={false} virtual={tracks.length > 400} />}
      </div>
    </div>
  );
}
