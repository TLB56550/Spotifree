import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import type { Track } from '@shared/types';
import { usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { useIsMobile } from '../hooks/useMobile';
import { Cover } from './Cover';
import { Equalizer } from './Controls';

const MAX_SHOWN = 100;

function QueueRow({
  track,
  active,
  playing,
  onPlay,
  onRemove,
}: {
  track: Track;
  active?: boolean;
  playing?: boolean;
  onPlay?: () => void;
  onRemove?: () => void;
}) {
  const mobile = useIsMobile();
  return (
    <div className={`q-row ${active ? 'is-current' : ''}`} onDoubleClick={onPlay} onClick={mobile && onPlay ? (e) => { if (!(e.target as HTMLElement).closest('button')) onPlay(); } : undefined}>
      <button type="button" className="q-cover" onClick={onPlay} aria-label={`Lire ${track.title}`} disabled={!onPlay}>
        <Cover cover={track.cover} seed={track.album} />
        {playing && (
          <span className="q-eq">
            <Equalizer />
          </span>
        )}
      </button>
      <div className="q-text">
        <span className="q-title" title={track.title}>{track.title}</span>
        <Link to={`/artist/${track.artistId}`} className="q-artist">
          {track.artist}
        </Link>
      </div>
      {onRemove && (
        <button type="button" className="icon-btn q-remove" aria-label={`Retirer ${track.title} de la file`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X />
        </button>
      )}
    </div>
  );
}

/** Contenu de la file d'attente : utilisé dans le panneau du PC et dans l'écran « lecture en cours » du téléphone. */
export function QueueBody() {
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const context = usePlayer((s) => s.context);
  const manual = usePlayer((s) => s.manual);
  const { removeManual, removeUpcoming, jumpToUpcoming, jumpToManual, clearManual } = usePlayer.getState();

  const upcoming: { orderIndex: number; track: Track }[] = [];
  if (context) {
    for (let i = context.pos + 1; i < context.order.length && upcoming.length < MAX_SHOWN; i++) {
      upcoming.push({ orderIndex: i, track: context.tracks[context.order[i]!]! });
    }
  }
  const hiddenCount = context ? Math.max(0, context.order.length - context.pos - 1 - upcoming.length) : 0;

  return (
    <div className="queue-body">
      {!current && <p className="queue-empty">Rien en cours. Lance un album ou une playlist, ou ajoute des titres avec « Ajouter à la file d’attente ».</p>}
      {current && (
        <section>
          <h3>En cours de lecture</h3>
          <QueueRow track={current} active playing={playing} />
        </section>
      )}
      {manual.length > 0 && (
        <section>
          <div className="queue-section-head">
            <h3>Ensuite dans la file</h3>
            <button type="button" className="link-btn" onClick={clearManual}>
              Vider
            </button>
          </div>
          {manual.map((m) => (
            <QueueRow key={m.uid} track={m.track} onPlay={() => jumpToManual(m.uid)} onRemove={() => removeManual(m.uid)} />
          ))}
        </section>
      )}
      {context && upcoming.length > 0 && (
        <section>
          <h3>
            Ensuite depuis{' '}
            {context.href ? (
              <Link to={context.href} className="queue-from">
                {context.label}
              </Link>
            ) : (
              context.label
            )}
          </h3>
          {upcoming.map(({ orderIndex, track }) => (
            <QueueRow key={`${orderIndex}-${track.id}`} track={track} onPlay={() => jumpToUpcoming(orderIndex)} onRemove={() => removeUpcoming(orderIndex)} />
          ))}
          {hiddenCount > 0 && <p className="queue-more">… et {hiddenCount.toLocaleString('fr-FR')} autres titres</p>}
        </section>
      )}
      {current && manual.length === 0 && upcoming.length === 0 && <p className="queue-empty">C’est le dernier titre de la liste.</p>}
    </div>
  );
}

export function QueuePanel() {
  const close = useUI((s) => s.toggleQueue);
  return (
    <aside className="panel queue" aria-label="File d’attente">
      <header className="queue-head">
        <h2>File d’attente</h2>
        <button type="button" className="icon-btn" aria-label="Fermer la file d’attente" onClick={close}>
          <X />
        </button>
      </header>
      <QueueBody />
    </aside>
  );
}
