import { useRef, useState } from 'react';

interface SliderProps {
  value: number;
  max: number;
  /** Appelé pendant le glissement. */
  onPreview?: (value: number) => void;
  /** Appelé quand on relâche, ou au clavier. */
  onCommit: (value: number) => void;
  label: string;
  step?: number;
  className?: string;
  disabled?: boolean;
  valueText?: (value: number) => string;
}

export function Slider({ value, max, onPreview, onCommit, label, step = 1, className = '', disabled, valueText }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const valueAt = (clientX: number): number => {
    const rect = ref.current!.getBoundingClientRect();
    const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    return ratio * max;
  };

  const shown = drag ?? value;
  const pct = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0;

  return (
    <div
      ref={ref}
      className={`slider ${drag !== null ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={valueText ? valueText(shown) : undefined}
      aria-disabled={disabled}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = valueAt(e.clientX);
        setDrag(v);
        onPreview?.(v);
      }}
      onPointerMove={(e) => {
        if (drag === null) return;
        const v = valueAt(e.clientX);
        setDrag(v);
        onPreview?.(v);
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        const v = valueAt(e.clientX);
        setDrag(null);
        onCommit(v);
      }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          onCommit(Math.min(max, value + step));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          onCommit(Math.max(0, value - step));
        } else if (e.key === 'Home') {
          e.preventDefault();
          onCommit(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          onCommit(max);
        }
      }}
    >
      <div className="slider-rail">
        <div className="slider-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="slider-thumb" style={{ left: `${pct}%` }} />
    </div>
  );
}
