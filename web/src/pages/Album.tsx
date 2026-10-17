import type { CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AlbumDetail } from '@shared/types';
import { api, coverUrl } from '../lib/api';
import { albumSource } from '../lib/actions';
import { useDominantColor } from '../lib/color';
import { countTracks, formatTotal } from '../lib/format';
import { useMenus } from '../hooks/useMenus';
import { ActionBar, Hero, PageMessage, Skeleton } from '../components/Hero';
import { Cover } from '../components/Cover';
import { TrackList } from '../components/TrackList';

export default function AlbumPage() {
  const { id = '' } = useParams();
  const menus = useMenus();
  const navigate = useNavigate();
  const { data: album, isLoading, isError } = useQuery({
    queryKey: ['album', id],
    queryFn: () => api.get<AlbumDetail>(`/api/albums/${id}`),
  });
  const color = useDominantColor(coverUrl(album?.cover));

  if (isLoading) return <Skeleton />;
  if (isError || !album) return <PageMessage title="Album introuvable">Il a peut-être été retiré de ta bibliothèque.</PageMessage>;

  const source = albumSource(album.id, album.title);
  const multiDisc = new Set(album.tracks.map((t) => t.discNo ?? 1)).size > 1;

  return (
    <div className="hero-page" style={{ '--hero': color ?? 'var(--raised)' } as CSSProperties}>
      <Hero
        color={color}
        kind="Album"
        title={album.title}
        cover={<Cover cover={album.cover} seed={album.title} />}
        meta={
          <>
            <Link to={`/artist/${album.artistId}`} className="hero-link">
              {album.artist}
            </Link>
            {album.year ? <span>{album.year}</span> : null}
            <span>
              {countTracks(album.trackCount)}, {formatTotal(album.duration)}
            </span>
          </>
        }
      />
      <div className="page-body">
        <ActionBar
          source={source}
          menu={() =>
            menus.source(source, [{ label: 'Aller à l’artiste', onClick: () => navigate(`/artist/${album.artistId}`) }])
          }
        />
        <TrackList tracks={album.tracks} label={album.title} href={source.href} showAlbum={false} showCover={false} numbering={multiDisc ? 'position' : 'trackNo'} />
      </div>
    </div>
  );
}
