import { Heart, Pause, Play } from 'lucide-react';
import { useLikes } from '../store/likes';

export function PlayButton({
  playing,
  onClick,
  size = 'md',
  label,
}: {
  playing: boolean;
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`play-btn play-btn-${size}`}
      aria-label={label ?? (playing ? 'Pause' : 'Lecture')}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
    </button>
  );
}

export function LikeButton({ trackId, className = '' }: { trackId: number; className?: string }) {
  const liked = useLikes((s) => s.ids.has(trackId));
  const toggle = useLikes((s) => s.toggle);
  return (
    <button
      type="button"
      className={`icon-btn like-btn ${liked ? 'is-liked' : ''} ${className}`}
      aria-label={liked ? 'Retirer des titres likés' : 'Ajouter aux titres likés'}
      aria-pressed={liked}
      onClick={(e) => {
        e.stopPropagation();
        void toggle(trackId);
      }}
    >
      <Heart fill={liked ? 'currentColor' : 'none'} />
    </button>
  );
}

/** Petites barres animées : un titre est en cours de lecture. */
export function Equalizer() {
  return (
    <span className="equalizer" aria-label="En lecture">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
