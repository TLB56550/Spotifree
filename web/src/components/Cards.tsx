import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PlayButton } from './Controls';
import { usePlayer } from '../store/player';

interface MediaCardProps {
  to: string;
  title: string;
  subtitle?: ReactNode;
  media: ReactNode;
  round?: boolean;
  /** Lance la lecture quand ce n'est pas déjà ce contenu qui est en cours. */
  onPlay?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}

export function MediaCard({ to, title, subtitle, media, round, onPlay, onContextMenu }: MediaCardProps) {
  const active = usePlayer((s) => s.context?.href === to);
  const playing = usePlayer((s) => s.context?.href === to && s.playing);
  return (
    <div className={`card ${round ? 'is-round' : ''} ${active ? 'is-active' : ''}`} onContextMenu={onContextMenu}>
      <div className="card-media">
        {media}
        {onPlay && (
          <div className="card-play">
            <PlayButton
              playing={playing}
              size="md"
              label={`${playing ? 'Mettre en pause' : 'Lire'} ${title}`}
              onClick={() => (active ? usePlayer.getState().toggle() : onPlay())}
            />
          </div>
        )}
      </div>
      <Link className="card-title" to={to} title={title}>
        {title}
      </Link>
      {subtitle && <p className="card-sub">{subtitle}</p>}
    </div>
  );
}

/** Une rangée de cartes : on n'affiche que celles qui tiennent sur une ligne. */
export function Shelf({ title, to, children }: { title: string; to?: string; children: ReactNode }) {
  return (
    <section className="shelf">
      <header className="shelf-head">
        <h2>{title}</h2>
        {to && (
          <Link className="shelf-more" to={to}>
            Tout afficher
          </Link>
        )}
      </header>
      <div className="shelf-row">{children}</div>
    </section>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="card-grid">{children}</div>;
}
