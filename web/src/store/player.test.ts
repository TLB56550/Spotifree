import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@shared/types';

// jsdom ne sait pas lire de l'audio : on simule un élément audio minimal.
type FakeEl = HTMLAudioElement & { _paused?: boolean; _t?: number };
const proto = window.HTMLMediaElement.prototype as unknown as Record<string, unknown>;
proto.play = function (this: FakeEl) {
  this._paused = false;
  this.dispatchEvent(new Event('play'));
  return Promise.resolve();
};
proto.pause = function (this: FakeEl) {
  this._paused = true;
  this.dispatchEvent(new Event('pause'));
};
Object.defineProperty(proto, 'paused', { get(this: FakeEl) { return this._paused ?? true; }, configurable: true });
Object.defineProperty(proto, 'currentTime', {
  get(this: FakeEl) { return this._t ?? 0; },
  set(this: FakeEl, v: number) { this._t = v; },
  configurable: true,
});
Object.defineProperty(proto, 'ended', { get: () => false, configurable: true });

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
vi.stubGlobal('fetch', fetchMock);

let usePlayer: typeof import('./player').usePlayer;
let audio: HTMLAudioElement;

const track = (id: number): Track => ({
  id,
  title: `Titre ${id}`,
  artist: 'Artiste',
  album: 'Album',
  albumId: 1,
  artistId: 1,
  albumArtist: 'Artiste',
  trackNo: id,
  discNo: 1,
  year: 2020,
  genre: null,
  duration: 200,
  cover: null,
  format: 'MP3',
  addedAt: 0,
  playCount: 0,
});
const tracks = (n: number) => Array.from({ length: n }, (_, i) => track(i + 1));
const ended = () => audio.dispatchEvent(new Event('ended'));
const currentId = () => usePlayer.getState().current?.id;

beforeAll(async () => {
  const mod = await import('./player');
  usePlayer = mod.usePlayer;
  audio = mod.audio;
});

beforeEach(() => {
  audio.pause();
  (audio as FakeEl)._t = 0;
  usePlayer.setState({ current: null, context: null, manual: [], source: 'context', shuffle: false, repeat: 'off', playing: false, time: 0 });
  fetchMock.mockClear();
});

describe('lecture dans l’ordre', () => {
  it('lance le titre choisi et enchaîne les suivants', () => {
    const p = usePlayer.getState();
    p.playContext(tracks(4), 1, 'Album', '/album/1');
    expect(currentId()).toBe(2);
    expect(usePlayer.getState().playing).toBe(true);
    ended();
    expect(currentId()).toBe(3);
    ended();
    expect(currentId()).toBe(4);
  });

  it('s’arrête à la fin de la liste sans répétition', () => {
    usePlayer.getState().playContext(tracks(2), 1, 'Album');
    ended();
    expect(currentId()).toBe(2);
    expect(usePlayer.getState().playing).toBe(false);
    expect(usePlayer.getState().time).toBe(0);
  });

  it('« suivant » à la dernière position ne fait rien', () => {
    usePlayer.getState().playContext(tracks(2), 1, 'Album');
    usePlayer.getState().next();
    expect(currentId()).toBe(2);
    expect(usePlayer.getState().playing).toBe(true);
  });

  it('« précédent » recommence le titre après 3 secondes, sinon revient au titre d’avant', () => {
    usePlayer.getState().playContext(tracks(3), 1, 'Album');
    (audio as FakeEl)._t = 10;
    usePlayer.getState().prev();
    expect(currentId()).toBe(2);
    expect(audio.currentTime).toBe(0);
    usePlayer.getState().prev();
    expect(currentId()).toBe(1);
    usePlayer.getState().prev(); // déjà au début de la liste
    expect(currentId()).toBe(1);
  });
});

describe('répétition', () => {
  it('« tout » reprend au début', () => {
    usePlayer.setState({ repeat: 'all' });
    usePlayer.getState().playContext(tracks(2), 1, 'Album');
    ended();
    expect(currentId()).toBe(1);
    expect(usePlayer.getState().playing).toBe(true);
  });

  it('« tout » : « précédent » depuis le premier titre va au dernier', () => {
    usePlayer.setState({ repeat: 'all' });
    usePlayer.getState().playContext(tracks(3), 0, 'Album');
    usePlayer.getState().prev();
    expect(currentId()).toBe(3);
  });

  it('« un titre » rejoue le même titre à la fin', () => {
    usePlayer.setState({ repeat: 'one' });
    usePlayer.getState().playContext(tracks(3), 0, 'Album');
    ended();
    expect(currentId()).toBe(1);
    expect(audio.currentTime).toBe(0);
  });

  it('le bouton fait défiler off → tout → un titre → off', () => {
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      usePlayer.getState().cycleRepeat();
      seen.push(usePlayer.getState().repeat);
    }
    expect(seen).toEqual(['all', 'one', 'off']);
  });
});

describe('lecture aléatoire', () => {
  it('commence par le titre choisi puis joue chaque titre une seule fois', () => {
    usePlayer.setState({ shuffle: true });
    usePlayer.getState().playContext(tracks(12), 5, 'Album');
    expect(currentId()).toBe(6);
    const played = [currentId()!];
    for (let i = 0; i < 11; i++) {
      ended();
      played.push(currentId()!);
    }
    expect(new Set(played).size).toBe(12);
    ended(); // fin de la liste
    expect(usePlayer.getState().playing).toBe(false);
  });

  it('désactiver l’aléatoire reprend l’ordre normal à partir du titre en cours', () => {
    usePlayer.getState().playContext(tracks(6), 0, 'Album');
    usePlayer.getState().toggleShuffle();
    expect(usePlayer.getState().shuffle).toBe(true);
    // on avance jusqu'à un titre quelconque, puis on désactive
    ended();
    ended();
    const here = currentId()!;
    usePlayer.getState().toggleShuffle();
    ended();
    expect(currentId()).toBe(here + 1 > 6 ? here : here + 1);
  });

  it('activer l’aléatoire ne coupe pas le titre en cours', () => {
    usePlayer.getState().playContext(tracks(6), 2, 'Album');
    usePlayer.getState().toggleShuffle();
    expect(currentId()).toBe(3);
    expect(usePlayer.getState().context!.pos).toBe(0);
    expect(usePlayer.getState().context!.order).toHaveLength(6);
  });

  it('playShuffled active l’aléatoire et lance un titre de la liste', () => {
    usePlayer.getState().playShuffled(tracks(5), 'Album');
    expect(usePlayer.getState().shuffle).toBe(true);
    expect(currentId()).toBeGreaterThanOrEqual(1);
    expect(currentId()).toBeLessThanOrEqual(5);
  });
});

describe('file d’attente', () => {
  it('les titres ajoutés passent avant la suite de l’album, puis l’album reprend', () => {
    const p = usePlayer.getState();
    p.playContext(tracks(4), 0, 'Album');
    p.enqueue([track(90)]);
    p.enqueue([track(91)]);
    p.playNext([track(92)]);
    expect(usePlayer.getState().manual.map((m) => m.track.id)).toEqual([92, 90, 91]);
    ended();
    expect(currentId()).toBe(92);
    ended();
    expect(currentId()).toBe(90);
    ended();
    expect(currentId()).toBe(91);
    ended();
    expect(currentId()).toBe(2); // l'album reprend là où il en était
  });

  it('« précédent » depuis un titre de la file revient au titre de l’album', () => {
    const p = usePlayer.getState();
    p.playContext(tracks(3), 1, 'Album');
    p.enqueue([track(90)]);
    p.next();
    expect(currentId()).toBe(90);
    usePlayer.getState().prev();
    expect(currentId()).toBe(2);
    expect(usePlayer.getState().source).toBe('context');
  });

  it('sans rien en cours, « ajouter à la file » lance la lecture', () => {
    usePlayer.getState().enqueue([track(7), track(8)]);
    expect(currentId()).toBe(7);
    expect(usePlayer.getState().playing).toBe(true);
  });

  it('retirer, vider et sauter dans la file', () => {
    const p = usePlayer.getState();
    p.playContext(tracks(8), 0, 'Album');
    p.enqueue([track(90), track(91), track(92)]);
    const uids = usePlayer.getState().manual.map((m) => m.uid);
    p.removeManual(uids[0]!);
    expect(usePlayer.getState().manual.map((m) => m.track.id)).toEqual([91, 92]);
    p.jumpToManual(uids[1]!);
    expect(currentId()).toBe(91);
    expect(usePlayer.getState().manual.map((m) => m.track.id)).toEqual([92]);
    p.clearManual();
    expect(usePlayer.getState().manual).toEqual([]);
  });

  it('retirer ou sauter dans la suite de l’album', () => {
    const p = usePlayer.getState();
    p.playContext(tracks(6), 0, 'Album');
    p.removeUpcoming(1); // retire le titre 2
    p.jumpToUpcoming(2); // l'ordre est maintenant 1,3,4,5,6 → position 2 = titre 4
    expect(currentId()).toBe(4);
    ended();
    expect(currentId()).toBe(5);
    p.removeUpcoming(0); // ignoré : ce n'est pas un titre à venir
    expect(usePlayer.getState().context!.order).toHaveLength(5);
  });
});

describe('historique d’écoute et réglages', () => {
  it('compte une écoute après 30 secondes, une seule fois', () => {
    usePlayer.getState().playContext(tracks(2), 0, 'Album');
    (audio as FakeEl)._t = 10;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(fetchMock).not.toHaveBeenCalled();
    (audio as FakeEl)._t = 31;
    audio.dispatchEvent(new Event('timeupdate'));
    audio.dispatchEvent(new Event('timeupdate'));
    const calls = fetchMock.mock.calls.filter((c) => String((c as unknown[])[0]).includes('/api/plays'));
    expect(calls).toHaveLength(1);
  });

  it('le volume reste entre 0 et 1', () => {
    usePlayer.getState().setVolume(1.7);
    expect(usePlayer.getState().volume).toBe(1);
    usePlayer.getState().setVolume(-3);
    expect(usePlayer.getState().volume).toBe(0);
  });

  it('pause puis reprise', () => {
    usePlayer.getState().playContext(tracks(2), 0, 'Album');
    usePlayer.getState().toggle();
    expect(usePlayer.getState().playing).toBe(false);
    usePlayer.getState().toggle();
    expect(usePlayer.getState().playing).toBe(true);
  });
});
