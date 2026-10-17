import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Clock, MoreHorizontal, Play } from 'lucide-react';
import type { Track } from '@shared/types';
import { formatDate, formatTime } from '../lib/format';
import { usePlayer } from '../store/player';
import { useScrollParent } from '../hooks/scroll';
import { openAt, openBelow, useMenus } from '../hooks/useMenus';
import { useIsMobile } from '../hooks/useMobile';
import { Cover } from './Cover';
import { Equalizer, LikeButton } from './Controls';

export type SortKey = 'title' | 'artist' | 'album' | 'addedAt' | 'duration';

export interface TrackListProps {
  tracks: Track[];
  /** Nom du contexte de lecture (affiché dans la file d'attente). */
  label: string;
  href?: string;
  showAlbum?: boolean;
  showAdded?: boolean;
  showCover?: boolean;
  /** Pour les longues listes : seules les lignes visibles sont dessinées. */
  virtual?: boolean;
  /** Lignes d'une playlist : permet de glisser pour réordonner et de retirer. */
  reorderable?: boolean;
  onReorder?: (from: number, to: number) => void;
  onRemove?: (index: number) => void;
  sort?: { key: SortKey; dir: 'asc' | 'desc'; onSort: (key: SortKey) => void };
  /** Premier titre à afficher en tête de colonne « # » : numéro de piste plutôt que position. */
  numbering?: 'position' | 'trackNo';
}

const ROW_HEIGHT = 56;
const ROW_HEIGHT_MOBILE = 64;

interface RowProps {
  track: Track;
  index: number;
  total: number;
  number: number;
  showAlbum: boolean;
  showAdded: boolean;
  showCover: boolean;
  reorderable: boolean;
  dropMark: 'before' | 'after' | null;
  selected: boolean;
  onSelect: (i: number) => void;
  onPlay: (i: number) => void;
  onRemove?: (i: number) => void;
  onMove?: (i: number, dir: -1 | 1) => void;
  onDragStart: (i: number) => void;
  onDragOver: (i: number, after: boolean) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  style?: CSSProperties;
}

const Row = memo(function Row(p: RowProps) {
  const { track, index } = p;
  const isCurrent = usePlayer((s) => s.current?.id === track.id);
  const isPlaying = usePlayer((s) => s.current?.id === track.id && s.playing);
  const menus = useMenus();
  const mobile = useIsMobile();
  const items = () =>
    menus.track(track, {
      onRemove: p.onRemove ? () => p.onRemove!(index) : undefined,
      onMoveUp: p.onMove && index > 0 ? () => p.onMove!(index, -1) : undefined,
      onMoveDown: p.onMove && index < p.total - 1 ? () => p.onMove!(index, 1) : undefined,
    });

  return (
    <div
      className={`tl-row ${p.showCover ? 'has-cover' : ''} ${isCurrent ? 'is-current' : ''} ${p.selected ? 'is-selected' : ''} ${p.dropMark ? `drop-${p.dropMark}` : ''}`}
      role="row"
      tabIndex={0}
      style={p.style}
      draggable={p.reorderable && !mobile}
      // Au doigt, un seul toucher lance le titre ; à la souris, un clic sélectionne et un double clic lance.
      onClick={() => (mobile ? p.onPlay(index) : p.onSelect(index))}
      onDoubleClick={() => p.onPlay(index)}
      onContextMenu={(e) => openAt(e, items())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') p.onPlay(index);
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        p.onDragStart(index);
      }}
      onDragOver={(e) => {
        if (!p.reorderable) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        p.onDragOver(index, e.clientY > r.top + r.height / 2);
      }}
      onDrop={(e) => {
        e.preventDefault();
        p.onDrop();
      }}
      onDragEnd={p.onDragEnd}
    >
      <div className="tl-num">
        {isPlaying ? <Equalizer /> : <span className="tl-index">{p.number}</span>}
        <button type="button" className="tl-play" aria-label={`Lire ${track.title}`} onClick={(e) => { e.stopPropagation(); p.onPlay(index); }}>
          <Play fill="currentColor" />
        </button>
      </div>
      <div className="tl-title">
        {p.showCover && <Cover cover={track.cover} seed={track.album} className="tl-cover" />}
        <div className="tl-text">
          <span className="tl-name" title={track.title}>{track.title}</span>
          <Link className="tl-artist" to={`/artist/${track.artistId}`} onClick={(e) => e.stopPropagation()}>
            {track.artist}
          </Link>
        </div>
      </div>
      {p.showAlbum && (
        <Link className="tl-album" to={`/album/${track.albumId}`} onClick={(e) => e.stopPropagation()}>
          {track.album}
        </Link>
      )}
      {p.showAdded && <span className="tl-added">{formatDate(track.addedAt)}</span>}
      <LikeButton trackId={track.id} className="tl-like" />
      <span className="tl-dur">{formatTime(track.duration)}</span>
      <button type="button" className="icon-btn tl-more" aria-label="Plus d’options" onClick={(e) => openBelow(e, items())}>
        <MoreHorizontal />
      </button>
    </div>
  );
});

function Header({ showAlbum, showAdded, sort }: { showAlbum: boolean; showAdded: boolean; sort?: TrackListProps['sort'] }) {
  const head = (key: SortKey, text: string, className: string) => {
    if (!sort) return <span className={className}>{text}</span>;
    const active = sort.key === key;
    return (
      <button type="button" className={`${className} tl-sort ${active ? 'is-active' : ''}`} onClick={() => sort.onSort(key)}>
        {text}
        {active && (sort.dir === 'asc' ? <ArrowUp /> : <ArrowDown />)}
      </button>
    );
  };
  return (
    <div className="tl-head" role="row">
      <span className="tl-num">#</span>
      {head('title', 'Titre', 'tl-title')}
      {showAlbum && head('album', 'Album', 'tl-album')}
      {showAdded && head('addedAt', 'Ajouté le', 'tl-added')}
      <span className="tl-like" />
      {sort ? (
        <button type="button" className={`tl-dur tl-sort ${sort.key === 'duration' ? 'is-active' : ''}`} aria-label="Trier par durée" onClick={() => sort.onSort('duration')}>
          <Clock />
        </button>
      ) : (
        <span className="tl-dur"><Clock aria-label="Durée" /></span>
      )}
      <span className="tl-more" />
    </div>
  );
}

export function TrackList(props: TrackListProps) {
  const {
    tracks,
    label,
    href,
    showAlbum = true,
    showAdded = false,
    showCover = true,
    virtual = false,
    reorderable = false,
    numbering = 'position',
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number; after: boolean } | null>(null);

  const play = (i: number) => usePlayer.getState().playContext(tracks, i, label, href);

  const wide = ['48px', 'minmax(0,6fr)', showAlbum ? 'minmax(0,4fr)' : null, showAdded ? 'minmax(0,2.4fr)' : null, '40px', '64px', '40px'];
  const narrow = ['40px', 'minmax(0,1fr)', '40px', '56px', '40px'];
  const style = {
    '--tl-cols-wide': wide.filter(Boolean).join(' '),
    '--tl-cols-narrow': narrow.join(' '),
  } as CSSProperties;

  const rowProps = (i: number): Omit<RowProps, 'style'> => {
    const t = tracks[i]!;
    let dropMark: 'before' | 'after' | null = null;
    if (drag && drag.over === i && drag.from !== i) dropMark = drag.after ? 'after' : 'before';
    return {
      track: t,
      index: i,
      total: tracks.length,
      number: numbering === 'trackNo' && t.trackNo ? t.trackNo : i + 1,
      showAlbum,
      showAdded,
      showCover,
      reorderable,
      dropMark,
      selected: selected === i,
      onSelect: setSelected,
      onPlay: play,
      onRemove: props.onRemove,
      onMove: reorderable && props.onReorder ? (from: number, dir: -1 | 1) => props.onReorder!(from, from + dir) : undefined,
      onDragStart: (from) => setDrag({ from, over: from, after: false }),
      onDragOver: (over, after) => setDrag((d) => (d && (d.over !== over || d.after !== after) ? { ...d, over, after } : d)),
      onDrop: () => {
        if (drag && props.onReorder) {
          let to = drag.over + (drag.after ? 1 : 0);
          if (drag.from < to) to -= 1; // l'élément retiré décale les suivants
          if (to !== drag.from) props.onReorder(drag.from, to);
        }
        setDrag(null);
      },
      onDragEnd: () => setDrag(null),
    };
  };

  return (
    <div className="tl" role="table" style={style} ref={wrapRef} aria-label={label}>
      <Header showAlbum={showAlbum} showAdded={showAdded} sort={props.sort} />
      {virtual ? (
        <VirtualRows count={tracks.length} wrapRef={wrapRef} renderRow={(i, rowStyle) => <Row key={tracks[i]!.id} {...rowProps(i)} style={rowStyle} />} />
      ) : (
        tracks.map((t, i) => <Row key={`${t.id}-${i}`} {...rowProps(i)} />)
      )}
    </div>
  );
}

function VirtualRows({
  count,
  wrapRef,
  renderRow,
}: {
  count: number;
  wrapRef: React.RefObject<HTMLDivElement | null>;
  renderRow: (index: number, style: CSSProperties) => React.ReactNode;
}) {
  const scrollRef = useScrollParent();
  const mobile = useIsMobile();
  const rowHeight = mobile ? ROW_HEIGHT_MOBILE : ROW_HEIGHT;
  const headHeight = mobile ? 0 : 40; // l'en-tête de colonnes n'existe pas sur téléphone
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const scroller = scrollRef.current;
      const wrap = wrapRef.current;
      if (!scroller || !wrap) return;
      const top = wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      setMargin(top + headHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [scrollRef, wrapRef, count, headHeight]);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    scrollMargin: margin,
  });

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((v) =>
        renderRow(v.index, {
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: rowHeight,
          transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)`,
        }),
      )}
    </div>
  );
}
