import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Disc3, Heart, ListEnd, ListPlus, ListStart, Pencil, Play, Plus, Trash2, User } from 'lucide-react';
import type { Playlist, Track } from '@shared/types';
import { api } from '../lib/api';
import { addToPlaylist, enqueueSource, playSource, type Source } from '../lib/actions';
import { queryClient } from '../lib/queryClient';
import { usePlayer } from '../store/player';
import { useLikes } from '../store/likes';
import { toast, useUI, type MenuItem } from '../store/ui';

type TrackSource = () => Promise<Track[]> | Track[];

function playlistItems(getTracks: TrackSource): MenuItem[] {
  const playlists = queryClient.getQueryData<Playlist[]>(['playlists']) ?? [];
  const items: MenuItem[] = [
    {
      label: 'Nouvelle playlist',
      icon: <Plus />,
      onClick: () =>
        useUI.getState().openPlaylistDialog({
          onDone: async (p) => addToPlaylist(p.id, p.name, await getTracks()),
        }),
    },
  ];
  if (playlists.length) items.push({ separator: true });
  for (const p of playlists) {
    items.push({ label: p.name, onClick: async () => addToPlaylist(p.id, p.name, await getTracks()) });
  }
  return items;
}

export interface TrackMenuExtras {
  /** Si le titre est affiché dans une playlist : permet de l'en retirer. */
  onRemove?: () => void;
  /** Dans une playlist : déplace le titre d'un cran (sans glisser-déposer, utile au doigt). */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function useMenus() {
  const navigate = useNavigate();

  return useMemo(
    () => ({
      track(track: Track, extras: TrackMenuExtras = {}): MenuItem[] {
        const liked = useLikes.getState().ids.has(track.id);
        const items: MenuItem[] = [
          { label: 'Lire ensuite', icon: <ListStart />, onClick: () => { usePlayer.getState().playNext([track]); toast('Sera lu ensuite'); } },
          { label: 'Ajouter à la file d’attente', icon: <ListEnd />, onClick: () => { usePlayer.getState().enqueue([track]); toast('Ajouté à la file d’attente'); } },
          { separator: true },
          { label: 'Ajouter à une playlist', icon: <ListPlus />, children: playlistItems(() => [track]) },
          {
            label: liked ? 'Retirer des titres likés' : 'Ajouter aux titres likés',
            icon: <Heart />,
            onClick: () => void useLikes.getState().toggle(track.id),
          },
        ];
        if (extras.onMoveUp) items.push({ label: 'Monter dans la playlist', icon: <ArrowUp />, onClick: extras.onMoveUp });
        if (extras.onMoveDown) items.push({ label: 'Descendre dans la playlist', icon: <ArrowDown />, onClick: extras.onMoveDown });
        if (extras.onRemove) items.push({ label: 'Retirer de cette playlist', icon: <Trash2 />, onClick: extras.onRemove });
        items.push(
          { separator: true },
          { label: 'Aller à l’album', icon: <Disc3 />, onClick: () => navigate(`/album/${track.albumId}`) },
          { label: 'Aller à l’artiste', icon: <User />, onClick: () => navigate(`/artist/${track.artistId}`) },
        );
        return items;
      },

      /** Menu d'un album, d'une playlist, d'un artiste… */
      source(src: Source, extra: MenuItem[] = []): MenuItem[] {
        return [
          { label: 'Lire', icon: <Play />, onClick: () => void playSource(src) },
          { label: 'Lire ensuite', icon: <ListStart />, onClick: () => void enqueueSource(src, 'next') },
          { label: 'Ajouter à la file d’attente', icon: <ListEnd />, onClick: () => void enqueueSource(src, 'end') },
          { separator: true },
          { label: 'Ajouter à une playlist', icon: <ListPlus />, children: playlistItems(src.tracks) },
          ...(extra.length ? [{ separator: true } as MenuItem, ...extra] : []),
        ];
      },

      playlist(playlist: Playlist, src: Source, onDeleted?: () => void): MenuItem[] {
        return [
          { label: 'Lire', icon: <Play />, onClick: () => void playSource(src) },
          { label: 'Lire ensuite', icon: <ListStart />, onClick: () => void enqueueSource(src, 'next') },
          { label: 'Ajouter à la file d’attente', icon: <ListEnd />, onClick: () => void enqueueSource(src, 'end') },
          { separator: true },
          {
            label: 'Modifier les détails',
            icon: <Pencil />,
            onClick: () => useUI.getState().openPlaylistDialog({ playlist }),
          },
          {
            label: 'Supprimer la playlist',
            icon: <Trash2 />,
            danger: true,
            onClick: async () => {
              const ok = await useUI.getState().confirm({
                title: 'Supprimer cette playlist ?',
                message: `« ${playlist.name} » sera supprimée. Tes titres restent dans la bibliothèque.`,
                confirmLabel: 'Supprimer',
                danger: true,
              });
              if (!ok) return;
              try {
                await api.del(`/api/playlists/${playlist.id}`);
                void queryClient.invalidateQueries({ queryKey: ['playlists'] });
                void queryClient.invalidateQueries({ queryKey: ['home'] });
                queryClient.removeQueries({ queryKey: ['playlist', String(playlist.id)] });
                toast('Playlist supprimée');
                onDeleted?.();
              } catch {
                toast('La suppression a échoué.', 'error');
              }
            },
          },
        ];
      },
    }),
    [navigate],
  );
}

/** Ouvre un menu à l'endroit du clic droit. */
export function openAt(e: React.MouseEvent, items: MenuItem[]): void {
  e.preventDefault();
  e.stopPropagation();
  useUI.getState().openMenu(e.clientX, e.clientY, items);
}

/** Ouvre un menu sous un bouton. */
export function openBelow(e: React.MouseEvent<HTMLElement>, items: MenuItem[]): void {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  useUI.getState().openMenu(r.right - 8, r.bottom + 4, items);
}
