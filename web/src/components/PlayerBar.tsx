import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { formatTime } from '../lib/format';
import { usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { Cover } from './Cover';
import { LikeButton } from './Controls';
import { Slider } from './Slider';
import { SoundButton } from './SoundPanel';

function SeekBar() {
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const hasTrack = usePlayer((s) => s.current !== null);
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <div className="seek">
      <span className="seek-time">{formatTime(preview ?? time)}</span>
      <Slider
        className="seek-slider"
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
      <span className="seek-time">{formatTime(duration)}</span>
    </div>
  );
}

function Volume() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const level = muted ? 0 : volume;
  const Icon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2;
  return (
    <div className="volume">
      <button type="button" className="icon-btn" aria-label={muted ? 'Réactiver le son' : 'Couper le son'} onClick={toggleMute}>
        <Icon />
      </button>
      <Slider className="volume-slider" label="Volume" value={level} max={1} step={0.05} onCommit={setVolume} onPreview={setVolume} valueText={(v) => `${Math.round(v * 100)} %`} />
    </div>
  );
}

export function PlayerBar() {
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const { toggle, next, prev, toggleShuffle, cycleRepeat } = usePlayer.getState();
  const queueOpen = useUI((s) => s.queueOpen);
  const toggleQueue = useUI((s) => s.toggleQueue);
  const disabled = !current;

  return (
    <footer className="player" aria-label="Lecteur">
      <div className="player-left">
        {current ? (
          <>
            <Link to={`/album/${current.albumId}`} className="player-cover-link" aria-label={`Album ${current.album}`}>
              <Cover cover={current.cover} seed={current.album} className="player-cover" />
            </Link>
            <div className="player-text">
              <Link className="player-title" to={`/album/${current.albumId}`} title={current.title}>
                {current.title}
              </Link>
              <Link className="player-artist" to={`/artist/${current.artistId}`}>
                {current.artist}
              </Link>
            </div>
            <LikeButton trackId={current.id} />
          </>
        ) : (
          <p className="player-idle">Choisis un titre pour commencer.</p>
        )}
      </div>

      <div className="player-center">
        <div className="transport">
          <button type="button" className={`icon-btn ${shuffle ? 'is-on' : ''}`} aria-label="Lecture aléatoire" aria-pressed={shuffle} onClick={toggleShuffle}>
            <Shuffle />
          </button>
          <button type="button" className="icon-btn" aria-label="Titre précédent" disabled={disabled} onClick={prev}>
            <SkipBack fill="currentColor" />
          </button>
          <button
            type="button"
            className={`transport-play ${loading && playing ? 'is-loading' : ''}`}
            aria-label={playing ? 'Pause' : 'Lecture'}
            disabled={disabled}
            onClick={toggle}
          >
            {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
          <button type="button" className="icon-btn" aria-label="Titre suivant" disabled={disabled} onClick={next}>
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
        <SeekBar />
      </div>

      <div className="player-right">
        <SoundButton />
        <button type="button" className={`icon-btn ${queueOpen ? 'is-on' : ''}`} aria-label="File d’attente" aria-pressed={queueOpen} onClick={toggleQueue}>
          <ListMusic />
        </button>
        <Volume />
      </div>
    </footer>
  );
}
