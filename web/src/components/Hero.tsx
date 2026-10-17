import type { CSSProperties, ReactNode } from 'react';
import { MoreHorizontal, Shuffle } from 'lucide-react';
import { PlayButton } from './Controls';
import { usePlayer } from '../store/player';
import { playSource, type Source } from '../lib/actions';
import { openBelow } from '../hooks/useMenus';
import type { MenuItem } from '../store/ui';

interface HeroProps {
  color: string | null;
  kind: string;
  title: string;
  cover: ReactNode;
  round?: boolean;
  description?: string;
  meta?: ReactNode;
  onTitleClick?: () => void;
}

export function Hero({ color, kind, title, cover, round, description, meta, onTitleClick }: HeroProps) {
  const size = title.length > 44 ? 'xl' : title.length > 26 ? 'lg' : 'md';
  const Title = onTitleClick ? 'button' : 'span';
  return (
    <div className="hero" style={{ '--hero': color ?? 'var(--raised)' } as CSSProperties}>
      <div className={`hero-cover ${round ? 'is-round' : ''}`}>{cover}</div>
      <div className="hero-text">
        <span className="hero-kind">{kind}</span>
        <h1 className={`hero-title size-${size}`}>
          <Title {...(onTitleClick ? { type: 'button' as const, onClick: onTitleClick, className: 'hero-title-btn' } : {})}>{title}</Title>
        </h1>
        {description && <p className="hero-desc">{description}</p>}
        {meta && <div className="hero-meta">{meta}</div>}
      </div>
    </div>
  );
}

/** Barre d'actions sous le titre : lecture, aléatoire, menu. */
export function ActionBar({
  source,
  menu,
  disabled,
  children,
}: {
  source: Source;
  menu?: () => MenuItem[];
  disabled?: boolean;
  children?: ReactNode;
}) {
  const playing = usePlayer((s) => s.context?.href === source.href && s.playing);
  const active = usePlayer((s) => s.context?.href === source.href);
  return (
    <div className="actions">
      <PlayButton
        size="lg"
        playing={playing}
        onClick={() => (active ? usePlayer.getState().toggle() : void playSource(source))}
      />
      <button type="button" className="icon-btn big" aria-label="Lecture aléatoire" title="Lecture aléatoire" disabled={disabled} onClick={() => void playSource(source, { shuffle: true })}>
        <Shuffle />
      </button>
      {children}
      {menu && (
        <button type="button" className="icon-btn big" aria-label="Plus d’options" onClick={(e) => openBelow(e, menu())}>
          <MoreHorizontal />
        </button>
      )}
    </div>
  );
}

export function PageMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-message">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Skeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Chargement">
      <div className="sk-hero" />
      <div className="sk-line" />
      <div className="sk-line" />
      <div className="sk-line short" />
    </div>
  );
}
