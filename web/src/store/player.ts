import { create } from 'zustand';
import type { Track } from '@shared/types';
import { api, coverUrl, streamUrl } from '../lib/api';
import { isNativeApp, registerNativeCommands, sendNativePlayback } from '../lib/native';
import { identityOrder, shuffledOrder } from '../lib/queue';
import { toast } from './ui';

export type Repeat = 'off' | 'all' | 'one';

export interface PlayContext {
  /** Nom affiché (« Lemonade », « Mes titres likés »…). */
  label: string;
  /** Lien vers la page d'origine. */
  href?: string;
  /** Les titres dans leur ordre d'origine. */
  tracks: Track[];
  /** Ordre de lecture (indices dans `tracks`) : l'ordre d'origine, ou un ordre aléatoire. */
  order: number[];
  /** Position actuelle dans `order`. */
  pos: number;
}

export interface ManualItem {
  uid: number;
  track: Track;
}

interface PlayerState {
  current: Track | null;
  /** D'où vient le titre en cours : de la file d'attente manuelle ou du contexte (album, playlist…). */
  source: 'context' | 'manual';
  context: PlayContext | null;
  manual: ManualItem[];
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;

  playContext: (tracks: Track[], startIndex: number, label: string, href?: string) => void;
  playShuffled: (tracks: Track[], label: string, href?: string) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  seekBy: (delta: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  enqueue: (tracks: Track[]) => void;
  playNext: (tracks: Track[]) => void;
  removeManual: (uid: number) => void;
  removeUpcoming: (orderIndex: number) => void;
  jumpToUpcoming: (orderIndex: number) => void;
  jumpToManual: (uid: number) => void;
  clearManual: () => void;
  restore: () => Promise<void>;
}

const SETTINGS_KEY = 'mb.player.settings';
const QUEUE_KEY = 'mb.player.queue';
const TIME_KEY = 'mb.player.time';

/** L'élément audio est unique pour toute l'application. */
export const audio: HTMLAudioElement = new Audio();
audio.preload = 'auto';

let uid = 1;
let counted = false;
let pendingSeek: number | null = null;
let errorStreak = 0;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage plein ou indisponible : on ignore.
  }
}

const savedSettings = readJson<{ volume?: number; muted?: boolean; shuffle?: boolean; repeat?: Repeat }>(SETTINGS_KEY);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const usePlayer = create<PlayerState>((set, get) => {
  const play = () => {
    const p = audio.play() as Promise<void> | undefined;
    p?.catch((e: unknown) => {
      const name = (e as { name?: string } | null)?.name;
      if (name !== 'AbortError') set({ playing: false, loading: false });
    });
  };

  const load = (track: Track, opts: { play?: boolean; at?: number } = {}) => {
    counted = false;
    pendingSeek = opts.at && opts.at > 0 ? opts.at : null;
    audio.src = streamUrl(track.id);
    set({ current: track, time: opts.at ?? 0, duration: track.duration, loading: opts.play !== false });
    if (opts.play !== false) play();
    updateMediaSession(track);
    persistQueue();
  };

  const stopAtEnd = () => {
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // Rien à remettre à zéro.
    }
    set({ playing: false, time: 0 });
  };

  const advance = (auto: boolean) => {
    const s = get();
    const first = s.manual[0];
    if (first) {
      set({ manual: s.manual.slice(1), source: 'manual' });
      load(first.track);
      return;
    }
    const ctx = s.context;
    if (!ctx) {
      if (auto) stopAtEnd();
      return;
    }
    let order = ctx.order;
    let pos = ctx.pos + 1;
    if (pos >= order.length) {
      if (s.repeat === 'all' && order.length) {
        order = s.shuffle ? shuffledOrder(order.length) : identityOrder(order.length);
        pos = 0;
      } else {
        if (auto) stopAtEnd();
        return;
      }
    }
    const track = ctx.tracks[order[pos]!];
    if (!track) return;
    set({ context: { ...ctx, order, pos }, source: 'context' });
    load(track);
  };

  audio.addEventListener('play', () => set({ playing: true }));
  audio.addEventListener('pause', () => set({ playing: false }));
  audio.addEventListener('waiting', () => set({ loading: true }));
  audio.addEventListener('canplay', () => set({ loading: false }));
  audio.addEventListener('playing', () => {
    errorStreak = 0;
    set({ loading: false, playing: true });
  });
  audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) set({ duration: audio.duration });
    if (pendingSeek !== null) {
      audio.currentTime = pendingSeek;
      pendingSeek = null;
    }
  });
  audio.addEventListener('timeupdate', () => {
    const t = audio.currentTime;
    set({ time: t });
    const cur = get().current;
    if (cur && !counted) {
      const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : cur.duration;
      if (t > Math.min(30, dur * 0.5)) {
        counted = true;
        void api.post('/api/plays', { trackId: cur.id }).catch(() => {});
      }
    }
    persistTime();
  });
  audio.addEventListener('ended', () => {
    if (get().repeat === 'one') {
      audio.currentTime = 0;
      play();
    } else advance(true);
  });
  audio.addEventListener('error', () => {
    const cur = get().current;
    if (!cur) return;
    set({ playing: false, loading: false });
    errorStreak++;
    // Après trois échecs d'affilée (connexion coupée, PC éteint…), on s'arrête au lieu de sauter toute la file.
    if (errorStreak >= 3) {
      toast('La lecture est impossible pour le moment. Vérifie que ton PC est allumé et joignable.', 'error');
      return;
    }
    toast(`Impossible de lire « ${cur.title} ».`, 'error');
    const s = get();
    if (s.manual.length || (s.context && s.context.pos + 1 < s.context.order.length)) setTimeout(() => advance(true), 700);
  });

  audio.volume = clamp01(savedSettings?.volume ?? 0.8);
  audio.muted = Boolean(savedSettings?.muted);

  return {
    current: null,
    source: 'context',
    context: null,
    manual: [],
    playing: false,
    loading: false,
    time: 0,
    duration: 0,
    volume: clamp01(savedSettings?.volume ?? 0.8),
    muted: Boolean(savedSettings?.muted),
    shuffle: Boolean(savedSettings?.shuffle),
    repeat: savedSettings?.repeat ?? 'off',

    playContext: (tracks, startIndex, label, href) => {
      if (!tracks.length) return;
      const start = Math.min(Math.max(startIndex, 0), tracks.length - 1);
      const shuffle = get().shuffle;
      const order = shuffle ? shuffledOrder(tracks.length, start) : identityOrder(tracks.length);
      set({ context: { label, href, tracks, order, pos: shuffle ? 0 : start }, source: 'context' });
      load(tracks[start]!);
    },

    playShuffled: (tracks, label, href) => {
      if (!tracks.length) return;
      const start = Math.floor(Math.random() * tracks.length);
      set({
        shuffle: true,
        context: { label, href, tracks, order: shuffledOrder(tracks.length, start), pos: 0 },
        source: 'context',
      });
      saveSettings();
      load(tracks[start]!);
    },

    toggle: () => {
      const s = get();
      if (!s.current) return;
      if (audio.paused) {
        if (!audio.src || audio.ended) load(s.current, { at: audio.ended ? 0 : s.time });
        else play();
      } else audio.pause();
    },

    next: () => advance(false),

    prev: () => {
      const s = get();
      const ctx = s.context;
      if (audio.currentTime > 3 || !ctx) {
        audio.currentTime = 0;
        set({ time: 0 });
        return;
      }
      if (s.source === 'manual') {
        const t = ctx.tracks[ctx.order[ctx.pos]!];
        if (t) {
          set({ source: 'context' });
          load(t);
        }
        return;
      }
      let pos = ctx.pos - 1;
      if (pos < 0) {
        if (s.repeat === 'all') pos = ctx.order.length - 1;
        else {
          audio.currentTime = 0;
          set({ time: 0 });
          return;
        }
      }
      const t = ctx.tracks[ctx.order[pos]!];
      if (!t) return;
      set({ context: { ...ctx, pos } });
      load(t);
    },

    seek: (seconds) => {
      const max = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : get().duration;
      const t = Math.min(Math.max(0, seconds), max || seconds);
      audio.currentTime = t;
      set({ time: t });
    },
    seekBy: (delta) => get().seek(audio.currentTime + delta),

    setVolume: (v) => {
      const volume = clamp01(v);
      audio.volume = volume;
      audio.muted = false;
      set({ volume, muted: false });
      saveSettings();
    },
    toggleMute: () => {
      const muted = !get().muted;
      audio.muted = muted;
      set({ muted });
      saveSettings();
    },

    toggleShuffle: () => {
      const s = get();
      const ctx = s.context;
      const shuffle = !s.shuffle;
      if (!ctx) {
        set({ shuffle });
      } else {
        const current = ctx.order[ctx.pos] ?? 0;
        if (shuffle) set({ shuffle, context: { ...ctx, order: shuffledOrder(ctx.tracks.length, current), pos: 0 } });
        else set({ shuffle, context: { ...ctx, order: identityOrder(ctx.tracks.length), pos: current } });
      }
      saveSettings();
      persistQueue();
    },

    cycleRepeat: () => {
      const order: Repeat[] = ['off', 'all', 'one'];
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length]! });
      saveSettings();
    },

    enqueue: (tracks) => {
      if (!tracks.length) return;
      if (!get().current) return get().playContext(tracks, 0, 'File d’attente');
      set((s) => ({ manual: [...s.manual, ...tracks.map((track) => ({ uid: uid++, track }))] }));
      persistQueue();
    },

    playNext: (tracks) => {
      if (!tracks.length) return;
      if (!get().current) return get().playContext(tracks, 0, 'File d’attente');
      set((s) => ({ manual: [...tracks.map((track) => ({ uid: uid++, track })), ...s.manual] }));
      persistQueue();
    },

    removeManual: (id) => {
      set((s) => ({ manual: s.manual.filter((m) => m.uid !== id) }));
      persistQueue();
    },

    removeUpcoming: (orderIndex) => {
      const ctx = get().context;
      if (!ctx || orderIndex <= ctx.pos || orderIndex >= ctx.order.length) return;
      const order = ctx.order.slice();
      order.splice(orderIndex, 1);
      set({ context: { ...ctx, order } });
      persistQueue();
    },

    jumpToUpcoming: (orderIndex) => {
      const ctx = get().context;
      if (!ctx) return;
      const t = ctx.tracks[ctx.order[orderIndex]!];
      if (!t) return;
      set({ context: { ...ctx, pos: orderIndex }, source: 'context' });
      load(t);
    },

    jumpToManual: (id) => {
      const s = get();
      const i = s.manual.findIndex((m) => m.uid === id);
      if (i < 0) return;
      const item = s.manual[i]!;
      set({ manual: s.manual.slice(i + 1), source: 'manual' });
      load(item.track);
    },

    clearManual: () => {
      set({ manual: [] });
      persistQueue();
    },

    restore: async () => {
      const saved = readJson<SavedQueue>(QUEUE_KEY);
      if (!saved || get().current) return;
      const wanted = new Set<number>([...saved.ids, ...saved.manualIds]);
      if (saved.currentId) wanted.add(saved.currentId);
      if (!wanted.size) return;
      let found: Track[];
      try {
        found = await api.post<Track[]>('/api/tracks/batch', { ids: [...wanted] });
      } catch {
        return;
      }
      if (get().current) return; // l'utilisateur a déjà lancé autre chose
      const byId = new Map(found.map((t) => [t.id, t]));
      const tracks = saved.ids.map((id) => byId.get(id)).filter((t): t is Track => Boolean(t));
      const manual = saved.manualIds
        .map((id) => byId.get(id))
        .filter((t): t is Track => Boolean(t))
        .map((track) => ({ uid: uid++, track }));
      const current = (saved.currentId && byId.get(saved.currentId)) || null;
      let context: PlayContext | null = null;
      if (tracks.length) {
        const indexOf = new Map(tracks.map((t, i) => [t.id, i]));
        let order = saved.orderIds.map((id) => indexOf.get(id)).filter((i): i is number => i !== undefined);
        if (order.length !== tracks.length) order = identityOrder(tracks.length);
        const currentIndex = current ? indexOf.get(current.id) : undefined;
        const pos = currentIndex !== undefined ? Math.max(0, order.indexOf(currentIndex)) : 0;
        context = { label: saved.label, href: saved.href, tracks, order, pos };
      }
      if (!current) return;
      const timeSaved = readJson<{ id: number; time: number }>(TIME_KEY);
      const at = timeSaved && timeSaved.id === current.id ? timeSaved.time : 0;
      set({ context, manual, source: saved.source === 'manual' ? 'manual' : 'context' });
      load(current, { play: false, at });
    },
  };
});

// ---------------------------------------------------------------- mémoire

interface SavedQueue {
  label: string;
  href?: string;
  ids: number[];
  orderIds: number[];
  manualIds: number[];
  currentId: number | null;
  source: 'context' | 'manual';
}

function saveSettings(): void {
  const { volume, muted, shuffle, repeat } = usePlayer.getState();
  writeJson(SETTINGS_KEY, { volume, muted, shuffle, repeat });
}

let queueTimer: ReturnType<typeof setTimeout> | null = null;
function persistQueue(): void {
  if (queueTimer) clearTimeout(queueTimer);
  queueTimer = setTimeout(() => {
    const { context, manual, current, source } = usePlayer.getState();
    const saved: SavedQueue = {
      label: context?.label ?? '',
      href: context?.href,
      ids: context?.tracks.map((t) => t.id) ?? [],
      orderIds: context?.order.map((i) => context.tracks[i]!.id) ?? [],
      manualIds: manual.map((m) => m.track.id),
      currentId: current?.id ?? null,
      source,
    };
    writeJson(QUEUE_KEY, saved);
  }, 400);
}

let lastTimeSave = 0;
function persistTime(): void {
  const now = Date.now();
  if (now - lastTimeSave < 4000) return;
  lastTimeSave = now;
  const { current, time } = usePlayer.getState();
  if (current) writeJson(TIME_KEY, { id: current.id, time });
}

// ------------------------------------------------- touches multimédia, titre

function updateMediaSession(track: Track): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const art = coverUrl(track.cover);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    // Adresse complète : la notification Android récupère l'image hors de la page.
    artwork: art ? [{ src: new URL(art, window.location.href).href, sizes: '512x512' }] : [],
  });
}

if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => usePlayer.getState().toggle()],
    ['pause', () => usePlayer.getState().toggle()],
    ['previoustrack', () => usePlayer.getState().prev()],
    ['nexttrack', () => usePlayer.getState().next()],
    ['seekto', (d) => d.seekTime !== undefined && usePlayer.getState().seek(d.seekTime)],
    ['seekbackward', (d) => usePlayer.getState().seekBy(-(d.seekOffset ?? 10))],
    ['seekforward', (d) => usePlayer.getState().seekBy(d.seekOffset ?? 10)],
  ];
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Action non prise en charge par ce navigateur.
    }
  }
}

if (typeof document !== 'undefined') {
  usePlayer.subscribe((s, prev) => {
    if (s.current !== prev.current || s.playing !== prev.playing) {
      document.title = s.current && s.playing ? `${s.current.title} · ${s.current.artist}` : 'Ma Bibliothèque';
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        navigator.mediaSession.playbackState = s.current ? (s.playing ? 'playing' : 'paused') : 'none';
      }
    }
  });
}

// ------------------------------------------------- application Android (notification, écran verrouillé)

if (typeof window !== 'undefined' && isNativeApp()) {
  registerNativeCommands((command, value) => {
    const p = usePlayer.getState();
    if (command === 'toggle') p.toggle();
    else if (command === 'play') {
      if (!p.playing) p.toggle();
    } else if (command === 'pause') {
      if (p.playing) p.toggle();
    } else if (command === 'next') p.next();
    else if (command === 'prev') p.prev();
    else if (command === 'seek' && value !== undefined) p.seek(value);
  });

  let sentAt = 0;
  let sentPos = 0;
  const push = (s: PlayerState) => {
    if (!s.current) {
      sendNativePlayback(null);
      return;
    }
    const art = coverUrl(s.current.cover);
    sentAt = Date.now();
    sentPos = s.time;
    sendNativePlayback({
      title: s.current.title,
      artist: s.current.artist,
      album: s.current.album,
      artwork: art ? new URL(art, window.location.href).href : '',
      playing: s.playing,
      position: s.time,
      duration: s.duration,
    });
  };
  usePlayer.subscribe((s, prev) => {
    if (s.current !== prev.current || s.playing !== prev.playing || s.duration !== prev.duration) {
      push(s);
      return;
    }
    // Un saut dans le titre (barre de progression) : on prévient la notification.
    const expected = sentPos + (s.playing ? (Date.now() - sentAt) / 1000 : 0);
    if (s.current && Math.abs(s.time - expected) > 2.5) push(s);
  });
}
