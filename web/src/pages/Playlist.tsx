import type { CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PlaylistDetail } from '@shared/types';
import { api, coverUrl } from '../lib/api';
import { playlistSource } from '../lib/actions';
import { useDominantColor } from '../lib/color';
import { countTracks, formatTotal } from '../lib/format';
import { moveItem } from '../lib/queue';
import { queryClient } from '../lib/queryClient';
import { useMenus } from '../hooks/useMenus';
import { toast, useUI } from '../store/ui';
import { ActionBar, Hero, PageMessage, Skeleton } from '../components/Hero';
import { PlaylistCover } from '../components/Cover';
import { TrackList } from '../components/TrackList';

export default function PlaylistPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const menus = useMenus();
  const openDialog = useUI((s) => s.openPlaylistDialog);
  const key = ['playlist', id];
  const { data: playlist, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => api.get<PlaylistDetail>(`/api/playlists/${id}`),
  });
  const color = useDominantColor(coverUrl(playlist?.covers[0]));

  if (isLoading) return <Skeleton />;
  if (isError || !playlist) return <PageMessage title="Playlist introuvable">Elle a peut-être été supprimée.</PageMessage>;

  const source = playlistSource(playlist.id, playlist.name);

  const reorder = async (from: number, to: number) => {
    const tracks = moveItem(playlist.tracks, from, to);
    queryClient.setQueryData<PlaylistDetail>(key, { ...playlist, tracks });
    try {
      await api.put(`/api/playlists/${playlist.id}/order`, { entryIds: tracks.map((t) => t.entryId) });
    } catch {
      toast('L’ordre n’a pas pu être enregistré.', 'error');
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const remove = async (index: number) => {
    const entry = playlist.tracks[index];
    if (!entry) return;
    queryClient.setQueryData<PlaylistDetail>(key, {
      ...playlist,
      trackCount: playlist.trackCount - 1,
      tracks: playlist.tracks.filter((_, i) => i !== index),
    });
    try {
      await api.del(`/api/playlists/${playlist.id}/entries/${entry.entryId}`);
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast('Retiré de la playlist');
    } catch {
      toast('Le titre n’a pas pu être retiré.', 'error');
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  return (
    <div className="hero-page" style={{ '--hero': color ?? 'var(--raised)' } as CSSProperties}>
      <Hero
        color={color}
        kind="Playlist"
        title={playlist.name}
        cover={<PlaylistCover covers={playlist.covers} name={playlist.name} />}
        description={playlist.description}
        onTitleClick={() => openDialog({ playlist })}
        meta={
          <span>
            {countTracks(playlist.trackCount)}
            {playlist.trackCount > 0 ? `, ${formatTotal(playlist.duration)}` : ''}
          </span>
        }
      />
      <div className="page-body">
        <ActionBar source={source} disabled={playlist.tracks.length === 0} menu={() => menus.playlist(playlist, source, () => navigate('/'))} />
        {playlist.tracks.length === 0 ? (
          <div className="empty-block">
            <h2>Cette playlist est vide</h2>
            <p>
              Ajoute des titres avec le menu « ⋯ » d’un titre ou d’un album, puis « Ajouter à une playlist ». Tu peux commencer par parcourir
              tes <Link to="/albums">albums</Link> ou tes <Link to="/songs">titres</Link>.
            </p>
          </div>
        ) : (
          <TrackList
            tracks={playlist.tracks}
            label={playlist.name}
            href={source.href}
            showAdded
            reorderable
            onReorder={(from, to) => void reorder(from, to)}
            onRemove={(i) => void remove(i)}
            virtual={playlist.tracks.length > 400}
          />
        )}
      </div>
    </div>
  );
}
