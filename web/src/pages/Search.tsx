import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Genre, SearchResults } from '@shared/types';
import { api } from '../lib/api';
import { albumSource, artistSource, playlistSource, playSource } from '../lib/actions';
import { countAlbums, countTracks, hueOf } from '../lib/format';
import { openAt, useMenus } from '../hooks/useMenus';
import { Cover, PlaylistCover } from '../components/Cover';
import { Grid, MediaCard } from '../components/Cards';
import { PageMessage } from '../components/Hero';
import { TrackList } from '../components/TrackList';

function Browse() {
  const { data } = useQuery({ queryKey: ['genres'], queryFn: () => api.get<Genre[]>('/api/genres') });
  return (
    <div className="page-pad">
      <header className="page-head">
        <h1>Parcourir</h1>
      </header>
      {data && data.length === 0 && (
        <PageMessage title="Cherche dans ta musique">Tape le nom d’un titre, d’un album, d’un artiste ou d’une playlist dans la barre ci-dessus.</PageMessage>
      )}
      {data && data.length > 0 && (
        <>
          <p className="muted count">Tape dans la barre ci-dessus, ou explore par genre.</p>
          <div className="genre-grid">
            {data.map((g) => {
              const hue = hueOf(g.name);
              return (
                <Link
                  key={g.name}
                  to={`/genre/${encodeURIComponent(g.name)}`}
                  className="genre-card"
                  style={{ background: `linear-gradient(140deg, hsl(${hue} 46% 34%), hsl(${(hue + 40) % 360} 50% 20%))` }}
                >
                  <span className="genre-name">{g.name}</span>
                  <span className="genre-count">{countTracks(g.trackCount)}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const menus = useMenus();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
    placeholderData: (prev) => prev,
  });

  if (!q) return <Browse />;
  if (isLoading || !data) return <div className="page-pad"><p className="muted">Recherche…</p></div>;

  const empty = !data.tracks.length && !data.albums.length && !data.artists.length && !data.playlists.length;
  if (empty) {
    return (
      <div className="page-pad">
        <PageMessage title={`Aucun résultat pour « ${q} »`}>Vérifie l’orthographe : la recherche ignore les accents et les majuscules.</PageMessage>
      </div>
    );
  }

  return (
    <div className="page-pad search-results">
      {data.tracks.length > 0 && (
        <section className="block">
          <h2>Titres</h2>
          <TrackList tracks={data.tracks.slice(0, 8)} label={`Résultats pour « ${q} »`} />
        </section>
      )}
      {data.artists.length > 0 && (
        <section className="block">
          <h2>Artistes</h2>
          <Grid>
            {data.artists.map((a) => {
              const src = artistSource(a.id, a.name);
              return (
                <MediaCard
                  key={a.id}
                  to={src.href}
                  round
                  title={a.name}
                  subtitle={countAlbums(a.albumCount)}
                  media={<Cover cover={a.cover} seed={a.name} kind="artist" />}
                  onPlay={() => void playSource(src)}
                  onContextMenu={(e) => openAt(e, menus.source(src))}
                />
              );
            })}
          </Grid>
        </section>
      )}
      {data.albums.length > 0 && (
        <section className="block">
          <h2>Albums</h2>
          <Grid>
            {data.albums.map((a) => {
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
        </section>
      )}
      {data.playlists.length > 0 && (
        <section className="block">
          <h2>Playlists</h2>
          <Grid>
            {data.playlists.map((p) => {
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
            })}
          </Grid>
        </section>
      )}
    </div>
  );
}
