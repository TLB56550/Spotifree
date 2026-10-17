import { Check, Moon, Sun, SunMoon } from 'lucide-react';
import { PALETTES, resolveMode, swatch, useTheme, type Mode } from '../lib/theme';

const MODES: { id: Mode; label: string; icon: typeof Sun }[] = [
  { id: 'dark', label: 'Sombre', icon: Moon },
  { id: 'light', label: 'Clair', icon: Sun },
  { id: 'auto', label: 'Auto', icon: SunMoon },
];

/** Réglages d'apparence : mode sombre ou clair, et dix palettes de couleurs. Mémorisé sur cet appareil. */
export function Appearance() {
  const mode = useTheme((s) => s.mode);
  const palette = useTheme((s) => s.palette);
  const setMode = useTheme((s) => s.setMode);
  const setPalette = useTheme((s) => s.setPalette);
  const resolved = resolveMode(mode);

  return (
    <section className="setting-block appearance" aria-labelledby="appearance-title">
      <h2 id="appearance-title">Apparence</h2>
      <p className="muted">Le choix est gardé sur cet appareil : ton téléphone et ton PC peuvent avoir chacun le leur.</p>

      <div className="mode-choice" role="radiogroup" aria-label="Mode">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} className={`mode-btn ${mode === id ? 'is-active' : ''}`} onClick={() => setMode(id)}>
            <Icon aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {mode === 'auto' && <p className="muted small">Suit le réglage clair ou sombre de ton appareil.</p>}

      <div className="palette-grid" role="radiogroup" aria-label="Couleurs de l’application">
        {PALETTES.map((p) => {
          const sw = swatch(p.id, resolved);
          const active = palette === p.id;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={active} aria-label={p.name} className={`palette-btn ${active ? 'is-active' : ''}`} onClick={() => setPalette(p.id)}>
              <span className="palette-preview" style={{ background: sw.bg }} aria-hidden>
                <span className="palette-bar" style={{ background: sw.panel }} />
                <span className="palette-bar short" style={{ background: sw.panel }} />
                <span className="palette-dot" style={{ background: sw.accent }}>
                  {active && <Check style={{ color: resolved === 'dark' ? '#14161a' : '#fff' }} />}
                </span>
              </span>
              <span className="palette-name">{p.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
