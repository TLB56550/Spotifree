import type { Track } from '@shared/types';
import type { SortKey } from '../components/TrackList';

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

export function sortTracks(tracks: Track[], key: SortKey, dir: 'asc' | 'desc'): Track[] {
  const sign = dir === 'asc' ? 1 : -1;
  const by: Record<SortKey, (a: Track, b: Track) => number> = {
    title: (a, b) => collator.compare(a.title, b.title),
    artist: (a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.album, b.album) || (a.trackNo ?? 0) - (b.trackNo ?? 0),
    album: (a, b) => collator.compare(a.album, b.album) || (a.discNo ?? 1) - (b.discNo ?? 1) || (a.trackNo ?? 0) - (b.trackNo ?? 0),
    addedAt: (a, b) => a.addedAt - b.addedAt,
    duration: (a, b) => a.duration - b.duration,
  };
  return tracks.slice().sort((a, b) => sign * (by[key](a, b) || a.id - b.id));
}
