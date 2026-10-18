import { describe, expect, it } from 'vitest';
import type { Track } from '@shared/types';
import { formatTime, formatTotal, greeting, normalize } from './format';
import { identityOrder, moveItem, shuffledOrder } from './queue';
import { audioQuality } from './quality';
import { sortTracks } from './sort';

describe('queue', () => {
  it('shuffledOrder est une permutation et respecte le premier élément', () => {
    for (let n = 1; n < 30; n++) {
      const first = Math.floor(n / 2);
      const order = shuffledOrder(n, first);
      expect(order[0]).toBe(first);
      expect([...order].sort((a, b) => a - b)).toEqual(identityOrder(n));
    }
  });
  it('shuffledOrder mélange vraiment', () => {
    const orders = new Set(Array.from({ length: 20 }, () => shuffledOrder(10).join(',')));
    expect(orders.size).toBeGreaterThan(10);
  });
  it('moveItem déplace sans modifier l’original', () => {
    const a = ['a', 'b', 'c', 'd'];
    expect(moveItem(a, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(a, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(a, 1, 1)).toEqual(a);
    expect(moveItem(a, 9, 0)).toEqual(a);
    expect(a).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('format', () => {
  it('formatTime', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(NaN)).toBe('0:00');
  });
  it('formatTotal', () => {
    expect(formatTotal(0)).toBe('0 min');
    expect(formatTotal(20)).toBe('moins d’une minute');
    expect(formatTotal(42 * 60)).toBe('42 min');
    expect(formatTotal(3600)).toBe('1 h');
    expect(formatTotal(4320)).toBe('1 h 12 min');
  });
  it('greeting', () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('Bonjour');
    expect(greeting(new Date(2026, 0, 1, 15))).toBe('Bon après-midi');
    expect(greeting(new Date(2026, 0, 1, 21))).toBe('Bonsoir');
  });
  it('normalize ignore accents et casse', () => {
    expect(normalize('Étienne Daho')).toBe('etienne daho');
  });
});

describe('sortTracks', () => {
  const t = (id: number, title: string, duration: number, addedAt: number): Track => ({
    id, title, artist: 'A', album: 'B', albumId: 1, artistId: 1, albumArtist: 'A', trackNo: id, discNo: 1,
    year: null, genre: null, duration, cover: null, format: 'MP3', bitrate: 320, addedAt, playCount: 0,
  });
  const list = [t(1, 'Zèbre', 100, 3), t(2, 'abeille', 300, 1), t(3, 'Éléphant', 200, 2), t(4, 'piste 10', 50, 4), t(5, 'piste 2', 60, 5)];
  it('trie les titres en ignorant accents et casse, chiffres dans l’ordre naturel', () => {
    expect(sortTracks(list, 'title', 'asc').map((x) => x.title)).toEqual(['abeille', 'Éléphant', 'piste 2', 'piste 10', 'Zèbre']);
    expect(sortTracks(list, 'title', 'desc')[0]!.title).toBe('Zèbre');
  });
  it('trie par durée et par date d’ajout', () => {
    expect(sortTracks(list, 'duration', 'desc').map((x) => x.id)).toEqual([2, 3, 1, 5, 4]);
    expect(sortTracks(list, 'addedAt', 'asc').map((x) => x.id)).toEqual([2, 3, 1, 4, 5]);
  });
  it('ne modifie pas la liste d’origine', () => {
    const copy = list.slice();
    sortTracks(list, 'duration', 'asc');
    expect(list).toEqual(copy);
  });
});

describe('audioQuality', () => {
  it('classe les fichiers selon leur débit', () => {
    expect(audioQuality('FLAC', 900).level).toBe('lossless');
    expect(audioQuality('WAV', 1411).level).toBe('lossless');
    expect(audioQuality('MP3', 320).level).toBe('high');
    expect(audioQuality('MP3', 256).level).toBe('high');
    expect(audioQuality('MP3', 192).level).toBe('good');
    expect(audioQuality('MP3', 160).level).toBe('low');
    expect(audioQuality('MP3', 128).level).toBe('low');
    expect(audioQuality('MP3', 96).level).toBe('poor');
  });
  it('est plus indulgent avec les codecs récents et reconnaît l\'ALAC', () => {
    expect(audioQuality('M4A', 192).level).toBe('high');
    expect(audioQuality('OPUS', 96).level).toBe('low');
    expect(audioQuality('M4A', 900).level).toBe('lossless');
  });
  it('gère un débit inconnu et écrit le texte affiché', () => {
    expect(audioQuality('MP3', null).level).toBe('unknown');
    expect(audioQuality('MP3', null).text).toBe('MP3');
    expect(audioQuality('mp3', 319.6).text).toBe('MP3 · 320 kbit/s');
  });
});
