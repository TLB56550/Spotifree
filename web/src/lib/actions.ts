import type { AlbumDetail, PlaylistDetail, Track } from '@shared/types';
import { api, ApiError } from './api';
import { queryClient } from './queryClient';
import { usePlayer } from '../store/player';
import { toast } from '../store/ui';

const fetchAlbum = (id: number) =>
  queryClient.fetchQuery({ queryKey: ['album', String(id)], queryFn: () => api.get<AlbumDetail>(`/api/albums/${id}`) });
const fetchPlaylist = (id: number) =>
  queryClient.fetchQuery({
    queryKey: ['playlist', String(id)],
    queryFn: () => api.get<PlaylistDetail>(`/api/playlists/${id}`),
    staleTime: 0,
  });
const fetchArtistTracks = (id: number) =>
  queryClient.fetchQuery({
    queryKey: ['tracks', { artistId: id }],
    queryFn: () => api.get<Track[]>(`/api/tracks?artistId=${id}`),
  });
const fetchFavorites = () =>
  queryClient.fetchQuery({ queryKey: ['favorites'], queryFn: () => api.get<Track[]>('/api/favorites'), staleTime: 0 });

function fail(e: unknown): void {
  toast(e instanceof ApiError ? e.message : 'Le chargement a échoué.', 'error');
}

export interface Source {
  label: string;
  href: string;
  tracks: () => Promise<Track[]>;
}

export const albumSource = (id: number, title: string): Source => ({
  label: title,
  href: `/album/${id}`,
  tracks: async () => (await fetchAlbum(id)).tracks,
});
export const playlistSource = (id: number, name: string): Source => ({
  label: name,
  href: `/playlist/${id}`,
  tracks: async () => (await fetchPlaylist(id)).tracks,
});
export const artistSource = (id: number, name: string): Source => ({
  label: name,
  href: `/artist/${id}`,
  tracks: () => fetchArtistTracks(id),
});
export const likedSource: Source = { label: 'Titres likés', href: '/liked', tracks: fetchFavorites };

export async function playSource(src: Source, opts: { shuffle?: boolean } = {}): Promise<void> {
  try {
    const tracks = await src.tracks();
    if (!tracks.length) return toast('Rien à lire ici pour le moment.');
    const player = usePlayer.getState();
    if (opts.shuffle) player.playShuffled(tracks, src.label, src.href);
    else player.playContext(tracks, 0, src.label, src.href);
  } catch (e) {
    fail(e);
  }
}

export async function enqueueSource(src: Source, where: 'next' | 'end'): Promise<void> {
  try {
    const tracks = await src.tracks();
    const player = usePlayer.getState();
    if (where === 'next') player.playNext(tracks);
    else player.enqueue(tracks);
    toast(where === 'next' ? 'Sera lu ensuite' : 'Ajouté à la file d’attente');
  } catch (e) {
    fail(e);
  }
}

export async function addToPlaylist(playlistId: number, playlistName: string, tracks: Track[]): Promise<void> {
  try {
    const res = await api.post<{ added: number }>(`/api/playlists/${playlistId}/tracks`, {
      trackIds: tracks.map((t) => t.id),
    });
    void queryClient.invalidateQueries({ queryKey: ['playlists'] });
    void queryClient.invalidateQueries({ queryKey: ['playlist', String(playlistId)] });
    void queryClient.invalidateQueries({ queryKey: ['home'] });
    toast(res.added ? `Ajouté à « ${playlistName} »` : 'Rien n’a été ajouté.');
  } catch (e) {
    fail(e);
  }
}

export function currentContextIs(href: string): boolean {
  return usePlayer.getState().context?.href === href;
}
