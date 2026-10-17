import { useEffect, useState } from 'react';
import { ListMusic, Music, User } from 'lucide-react';
import { coverUrl } from '../lib/api';
import { hueOf } from '../lib/format';

interface CoverProps {
  cover?: string | null;
  /** Texte qui sert à choisir la couleur de remplacement. */
  seed: string;
  className?: string;
  kind?: 'music' | 'playlist' | 'artist';
}

export function Cover({ cover, seed, className = '', kind = 'music' }: CoverProps) {
  const src = coverUrl(cover);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (src && !failed) {
    return (
      <img
        className={`cover ${className}`}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
      />
    );
  }
  const hue = hueOf(seed);
  const Icon = kind === 'playlist' ? ListMusic : kind === 'artist' ? User : Music;
  return (
    <div
      className={`cover cover-fallback ${className}`}
      style={{ background: `linear-gradient(145deg, hsl(${hue} 34% 30%), hsl(${(hue + 50) % 360} 40% 14%))` }}
      aria-hidden
    >
      <Icon />
    </div>
  );
}

/** Mosaïque de quatre pochettes, ou une seule, ou un fond de couleur. */
export function PlaylistCover({ covers, name, className = '' }: { covers: string[]; name: string; className?: string }) {
  if (covers.length >= 4) {
    return (
      <div className={`cover cover-mosaic ${className}`} aria-hidden>
        {covers.slice(0, 4).map((c) => (
          <img key={c} src={coverUrl(c) ?? ''} alt="" loading="lazy" decoding="async" draggable={false} />
        ))}
      </div>
    );
  }
  return <Cover cover={covers[0]} seed={name} kind="playlist" className={className} />;
}
