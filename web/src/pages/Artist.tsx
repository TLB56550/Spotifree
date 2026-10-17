import { useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ArtistDetail } from '@shared/types';
import { api, coverUrl } from '../lib/api';
import { albumSource, artistSource, playSource } from '../lib/actions';
import { useDominantColor } from '../lib/color';
import { countAlbums, countTracks } from '../lib/format';
import { openAt, useMenus } from '../hooks/useMenus';
import { ActionBar, Hero, PageMessage, Skeleton } from '../components/Hero';
import { Cover } from '../components/Cover';
import { Grid, MediaCard } from '../components/Cards';
import { TrackList } from '../components/TrackList';

export default function ArtistPage() {
  const { id = '' } = useParams();
  const menus = useMenus();
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  const { data: artist, isLoading, isError } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => api.get<ArtistDetail>(`/api/artists/${id}`),
  });
  const color = useDominantColor(coverUrl(artist?.cover));

  if (isLoading) return <Skeleton />;
  if (isError || !artist) return <PageMessage title="Artiste introuvable">Il a peut-être été retiré de ta bibliothèque.</PageMessage>;

  const source = artistSource(artist.id, artist.name);
  const shown = more ? artist.topTracks : artist.topTracks.slice(0, 5);

  return (
    <div className="hero-page" style={{ '--hero': color ?? 'var(--raised)' } as CSSProperties}>
      <Hero
        color={color}
        kind="Artiste"
        title={artist.name}
        round
        cover={<Cover cover={artist.cover} seed={artist.name} kind="artist" />}
        meta={
          <span>
            {countAlbums(artist.albumCount)}, {countTracks(artist.trackCount)}
          </span>
        }
      />
      <div className="page-body">
        <ActionBar source={source} menu={() => menus.source(source)} />

        <section className="block">
          <h2>{artist.topTracks.some((t) => t.playCount > 0) ? 'Tes titres préférés' : 'Titres'}</h2>
          <TrackList tracks={shown} label={`${artist.name} · titres`} />
          {artist.topTracks.length > 5 && (
            <button type="button" className="link-btn" onClick={() => setMore((m) => !m)}>
              {more ? 'Afficher moins' : 'Afficher plus'}
            </button>
          )}
        </section>

        <section className="block">
          <h2>Albums</h2>
          <Grid>
            {artist.albums.map((a) => {
              const src = albumSource(a.id, a.title);
              return (
                <MediaCard
                  key={a.id}
                  to={src.href}
                  title={a.title}
                  subtitle={[a.year, countTracks(a.trackCount)].filter(Boolean).join(' · ')}
                  media={<Cover cover={a.cover} seed={a.title} />}
                  onPlay={() => void playSource(src)}
                  onContextMenu={(e) => openAt(e, menus.source(src, [{ label: 'Aller à l’artiste', onClick: () => navigate(`/artist/${a.artistId}`) }]))}
                />
              );
            })}
          </Grid>
        </section>
      </div>
    </div>
  );
}
