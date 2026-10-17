import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, Home, Library, ListMusic, MoreHorizontal, Pause, Play, Repeat, Repeat1, Search, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { coverUrl } from '../lib/api';
import { useDominantColor } from '../lib/color';
import { formatTime } from '../lib/format';
import { openBelow, useMenus } from '../hooks/useMenus';
import { usePlayer } from '../store/player';
import { Cover } from './Cover';
import { LikeButton } from './Controls';
import { QueueBody } from './QueuePanel';
import { Slider } from './Slider';
import { SoundButton } from './SoundPanel';

/**
 * L'écran « lecture en cours » est une entrée de l'historique (#playing) :
 * le bouton retour d'Android le referme au lieu de quitter la page.
 */
export function useNowPlayingSheet() {
  const location = useLocation();
  const navigate = useNavigate();
  return {
    open: location.hash === '#playing',
    show: () => navigate({ hash: '#playing' }),
    hide: () => {
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) navigate(-1);
      else navigate({ hash: '' }, { replace: true });
    },
  };
}

export function TabBar() {
  const { pathname } = useLocation();
  const inLibrary = /^\/(library|albums|artists|songs|liked|playlist)(\/|$)/.test(pathname);
  const tab = (to: string, icon: React.ReactNode, label: string, active: boolean) => (
    <Link to={to} className={`tab ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
    </Link>
  );
  return (
    <nav className="tabbar" aria-label="Navigation principale">
      {tab('/', <Home />, 'Accueil', pathname === '/')}
      {tab('/search', <Search />, 'Rechercher', pathname === '/search' || pathname.startsWith('/genre/'))}
      {tab('/library', <Library />, 'Bibliothèque', inLibrary)}
    </nav>
  );
}

export function MiniPlayer() {
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const progress = usePlayer((s) => (s.duration > 0 ? Math.min(1, s.time / s.duration) : 0));
  const toggle = usePlayer((s) => s.toggle);
  const { show } = useNowPlayingSheet();
  if (!current) return null;
  return (
    <div className="mini" role="group" aria-label="Lecteur">
      <button type="button" className="mini-main" aria-label={`Ouvrir le lecteur : ${current.title}, ${current.artist}`} onClick={show}>
        <Cover cover={current.cover} seed={current.album} className="mini-cover" />
        <span className="mini-text">
          <span className="mini-title">{current.title}</span>
          <span className="mini-artist">{current.artist}</span>
        </span>
      </button>
      <LikeButton trackId={current.id} className="mini-like" />
      <button type="button" className={`mini-play ${loading && playing ? 'is-loading' : ''}`} aria-label={playing ? 'Pause' : 'Lecture'} onClick={toggle}>
        {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
      </button>
      <div className="mini-progress" aria-hidden>
        <div style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

function NpSeek() {
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const hasTrack = usePlayer((s) => s.current !== null);
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <div className="np-seek">
      <Slider
        className="np-slider"
        label="Position dans le titre"
        value={time}
        max={duration || 0}
        step={5}
        disabled={!hasTrack}
        onPreview={setPreview}
        onCommit={(v) => {
          setPreview(null);
          seek(v);
        }}
        valueText={formatTime}
      />
      <div className="np-times">
        <span>{formatTime(preview ?? time)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

export function NowPlaying() {
  const { open, hide } = useNowPlayingSheet();
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const context = usePlayer((s) => s.context);
  const { toggle, next, prev, toggleShuffle, cycleRepeat } = usePlayer.getState();
  const menus = useMenus();
  const [view, setView] = useState<'cover' | 'queue'>('cover');
  const color = useDominantColor(coverUrl(current?.cover));

  useEffect(() => {
    if (!open) setView('cover');
  }, [open]);

  if (!open) return null;

  return (
    <div className="np" role="dialog" aria-modal="true" aria-label="Lecture en cours" style={{ '--np': color ?? '#262b35' } as CSSProperties}>
      <header className="np-head">
        <button type="button" className="icon-btn" aria-label="Réduire le lecteur" onClick={hide}>
          <ChevronDown />
        </button>
        <div className="np-from">
          <span>Lecture depuis</span>
          <strong>{context?.label ?? 'ta bibliothèque'}</strong>
        </div>
        <SoundButton />
        {current ? (
          <button type="button" className="icon-btn" aria-label="Plus d’options" onClick={(e) => openBelow(e, menus.track(current))}>
            <MoreHorizontal />
          </button>
        ) : (
          <span className="np-head-spacer" />
        )}
      </header>

      {!current ? (
        <div className="np-empty">
          <p>Rien en cours de lecture.</p>
          <button type="button" className="btn btn-primary" onClick={hide}>
            Choisir de la musique
          </button>
        </div>
      ) : (
        <>
          <div className="np-stage">
            {view === 'cover' ? (
              <div className="np-cover">
                <Cover cover={current.cover} seed={current.album} />
              </div>
            ) : (
              <div className="np-queue">
                <QueueBody />
              </div>
            )}
          </div>

          <div className="np-info">
            <div className="np-text">
              <Link to={`/album/${current.albumId}`} className="np-title">
                {current.title}
              </Link>
              <Link to={`/artist/${current.artistId}`} className="np-artist">
                {current.artist}
              </Link>
            </div>
            <LikeButton trackId={current.id} className="np-like" />
          </div>

          <NpSeek />

          <div className="np-transport">
            <button type="button" className={`icon-btn ${shuffle ? 'is-on' : ''}`} aria-label="Lecture aléatoire" aria-pressed={shuffle} onClick={toggleShuffle}>
              <Shuffle />
            </button>
            <button type="button" className="icon-btn np-skip" aria-label="Titre précédent" onClick={prev}>
              <SkipBack fill="currentColor" />
            </button>
            <button type="button" className={`np-play ${loading && playing ? 'is-loading' : ''}`} aria-label={playing ? 'Pause' : 'Lecture'} onClick={toggle}>
              {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
            </button>
            <button type="button" className="icon-btn np-skip" aria-label="Titre suivant" onClick={next}>
              <SkipForward fill="currentColor" />
            </button>
            <button
              type="button"
              className={`icon-btn ${repeat !== 'off' ? 'is-on' : ''}`}
              aria-label={repeat === 'off' ? 'Répéter : désactivé' : repeat === 'all' ? 'Répéter : tout' : 'Répéter : ce titre'}
              onClick={cycleRepeat}
            >
              {repeat === 'one' ? <Repeat1 /> : <Repeat />}
            </button>
          </div>

          <footer className="np-foot">
            <button type="button" className={`icon-btn ${view === 'queue' ? 'is-on' : ''}`} aria-label="File d’attente" aria-pressed={view === 'queue'} onClick={() => setView((v) => (v === 'queue' ? 'cover' : 'queue'))}>
              <ListMusic />
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
