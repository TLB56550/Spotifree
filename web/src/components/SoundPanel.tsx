import { useEffect } from 'react';
import { Headphones, Headset, SlidersHorizontal, Speaker, X } from 'lucide-react';
import { DEVICES, STYLES, mix, useSound, type DeviceId } from '../lib/sound';

const DEVICE_ICONS: Record<DeviceId, typeof Speaker> = {
  standard: SlidersHorizontal,
  headphones: Headphones,
  earbuds: Headset,
  speaker: Speaker,
};

/** Courbe de l'égaliseur résultante : six barres, vers le haut pour un renfort, vers le bas pour une atténuation. */
function Curve() {
  const device = useSound((s) => s.device);
  const style = useSound((s) => s.style);
  const { gains } = mix(device, style);
  return (
    <div className="eq-curve" aria-hidden>
      {gains.map((g, i) => (
        <span key={i} className="eq-band">
          <span className="eq-bar" style={{ height: `${Math.abs(g) * 5}%`, [g >= 0 ? 'bottom' : 'top']: '50%' }} />
        </span>
      ))}
    </div>
  );
}

/** Les deux sélecteurs : ce qui diffuse le son, et l'ambiance musicale. Mémorisés sur cet appareil. */
export function SoundSettings() {
  const device = useSound((s) => s.device);
  const style = useSound((s) => s.style);
  const setDevice = useSound((s) => s.setDevice);
  const setStyle = useSound((s) => s.setStyle);
  const current = DEVICES.find((d) => d.id === device);
  return (
    <div className="sound">
      <h3 className="sound-title">J’écoute avec</h3>
      <div className="device-grid" role="radiogroup" aria-label="Appareil d’écoute">
        {DEVICES.map(({ id, label }) => {
          const Icon = DEVICE_ICONS[id];
          return (
            <button key={id} type="button" role="radio" aria-checked={device === id} className={`device-btn ${device === id ? 'is-active' : ''}`} onClick={() => setDevice(id)}>
              <Icon aria-hidden />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <p className="muted small">{current?.hint}</p>

      <h3 className="sound-title">Ambiance</h3>
      <div className="style-grid" role="radiogroup" aria-label="Ambiance musicale">
        {STYLES.map(({ id, label }) => (
          <button key={id} type="button" role="radio" aria-checked={style === id} className={`style-chip ${style === id ? 'is-active' : ''}`} onClick={() => setStyle(id)}>
            {label}
          </button>
        ))}
      </div>
      <Curve />
    </div>
  );
}

/** Bouton « Son » du lecteur : ouvre le panneau des deux sélecteurs. */
export function SoundButton({ className = 'icon-btn' }: { className?: string }) {
  const open = useSound((s) => s.panelOpen);
  const active = useSound((s) => s.device !== 'standard' || s.style !== 'neutral');
  const setPanel = useSound((s) => s.setPanel);
  return (
    <button type="button" className={`${className} ${active ? 'is-on' : ''}`} aria-label="Son : appareil et ambiance" aria-expanded={open} title="Son : appareil et ambiance" onClick={() => setPanel(!open)}>
      <SlidersHorizontal />
    </button>
  );
}

export function SoundPanelHost() {
  const open = useSound((s) => s.panelOpen);
  const setPanel = useSound((s) => s.setPanel);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setPanel]);
  if (!open) return null;
  return (
    <>
      <div className="sound-backdrop" onClick={() => setPanel(false)} />
      <div className="sound-panel" role="dialog" aria-label="Son">
        <header>
          <h2>Son</h2>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={() => setPanel(false)}>
            <X />
          </button>
        </header>
        <SoundSettings />
      </div>
    </>
  );
}
