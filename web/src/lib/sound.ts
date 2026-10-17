import { create } from 'zustand';
import { audio } from '../store/player';

/** Fréquences (Hz) des 6 bandes de l'égaliseur : grave, bas-médium, médium, haut-médium, présence, aigu. */
export const BANDS = [60, 170, 500, 1500, 5000, 12000] as const;
type Curve = readonly [number, number, number, number, number, number];

export type DeviceId = 'standard' | 'headphones' | 'earbuds' | 'speaker';
export type StyleId = 'neutral' | 'rock' | 'jazz' | 'chanson' | 'techno' | 'hiphop' | 'pop' | 'classical' | 'acoustic';

/** Correction selon ce qui diffuse le son (gains en dB par bande). */
export const DEVICES: { id: DeviceId; label: string; hint: string; curve: Curve }[] = [
  { id: 'standard', label: 'Standard', hint: 'Aucune correction', curve: [0, 0, 0, 0, 0, 0] },
  { id: 'headphones', label: 'Casque', hint: 'Grave rond, aigus adoucis', curve: [2, 1, 0, 0, -1, -1] },
  { id: 'earbuds', label: 'Écouteurs', hint: 'Plus de grave, moins d’aigus agressifs', curve: [3, 1, 0, -1, -2, 0] },
  { id: 'speaker', label: 'Haut-parleur', hint: 'Compense le manque de grave', curve: [-2, 3, 2, 0, -1, 0] },
];

/** Ambiances musicales (gains en dB par bande). */
export const STYLES: { id: StyleId; label: string; curve: Curve }[] = [
  { id: 'neutral', label: 'Neutre', curve: [0, 0, 0, 0, 0, 0] },
  { id: 'rock', label: 'Rock', curve: [4, 2, -2, 1, 3, 4] },
  { id: 'jazz', label: 'Jazz', curve: [3, 2, 1, 0, 1, 2] },
  { id: 'chanson', label: 'Chanson', curve: [-1, 0, 2, 3, 1, 0] },
  { id: 'techno', label: 'Techno', curve: [6, 3, -2, 0, 2, 4] },
  { id: 'hiphop', label: 'Hip-hop', curve: [6, 4, 0, -1, 1, 2] },
  { id: 'pop', label: 'Pop', curve: [1, 2, 2, 1, 2, 2] },
  { id: 'classical', label: 'Classique', curve: [1, 0, 0, 0, 1, 2] },
  { id: 'acoustic', label: 'Acoustique', curve: [1, 2, 1, 1, 2, 1] },
];

export interface Mix {
  gains: number[];
  /** Baisse du volume (dB, ≤ 0) qui compense les renforcements pour éviter la saturation. */
  preamp: number;
}

/** Cumule la correction de l'appareil et l'ambiance. */
export function mix(device: DeviceId, style: StyleId): Mix {
  const d = DEVICES.find((x) => x.id === device)?.curve ?? DEVICES[0]!.curve;
  const s = STYLES.find((x) => x.id === style)?.curve ?? STYLES[0]!.curve;
  const gains = d.map((g, i) => Math.max(-12, Math.min(12, g + s[i]!)));
  return { gains, preamp: -Math.max(0, ...gains) };
}

const KEY = 'mb.sound';
interface Saved {
  device: DeviceId;
  style: StyleId;
}

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    return {
      device: DEVICES.some((d) => d.id === v.device) ? v.device! : 'standard',
      style: STYLES.some((s) => s.id === v.style) ? v.style! : 'neutral',
    };
  } catch {
    return { device: 'standard', style: 'neutral' };
  }
}

interface SoundState extends Saved {
  panelOpen: boolean;
  setDevice: (d: DeviceId) => void;
  setStyle: (s: StyleId) => void;
  setPanel: (open: boolean) => void;
}

function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Stockage indisponible : le réglage vaut pour cette session.
  }
}

export const useSound = create<SoundState>((set, get) => ({
  ...load(),
  panelOpen: false,
  setDevice: (device) => {
    set({ device });
    save({ device, style: get().style });
  },
  setStyle: (style) => {
    set({ style });
    save({ device: get().device, style });
  },
  setPanel: (panelOpen) => set({ panelOpen }),
}));

// ---------------------------------------------------------------- moteur audio (Web Audio)

interface Graph {
  ctx: AudioContext;
  filters: BiquadFilterNode[];
  preamp: GainNode;
}
let graph: Graph | null = null;

/**
 * Le lecteur n'est branché sur l'égaliseur qu'au premier réglage non neutre :
 * tant que rien n'est choisi, la lecture passe directement par l'élément audio, comme avant.
 */
function ensureGraph(): Graph | null {
  if (graph) return graph;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(audio);
    const filters = BANDS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1;
      return f;
    });
    const preamp = ctx.createGain();
    let node: AudioNode = source;
    for (const f of filters) {
      node.connect(f);
      node = f;
    }
    node.connect(preamp);
    preamp.connect(ctx.destination);
    graph = { ctx, filters, preamp };
    return graph;
  } catch {
    return null;
  }
}

function apply(): void {
  const { device, style } = useSound.getState();
  const flat = device === 'standard' && style === 'neutral';
  if (flat && !graph) return;
  const g = ensureGraph();
  if (!g) return;
  const m = mix(device, style);
  const t = g.ctx.currentTime;
  g.filters.forEach((f, i) => f.gain.setTargetAtTime(m.gains[i]!, t, 0.05));
  g.preamp.gain.setTargetAtTime(Math.pow(10, m.preamp / 20), t, 0.05);
  void g.ctx.resume().catch(() => {});
}

/** À appeler une fois au démarrage de l'interface. */
export function initSound(): void {
  apply();
  useSound.subscribe((s, prev) => {
    if (s.device !== prev.device || s.style !== prev.style) apply();
  });
  // Le navigateur peut mettre le contexte audio en pause (écran verrouillé, onglet en arrière-plan) : on le relance.
  audio.addEventListener('play', () => {
    if (graph && graph.ctx.state !== 'running') void graph.ctx.resume().catch(() => {});
  });
  audio.addEventListener('timeupdate', () => {
    if (graph && graph.ctx.state === 'suspended') void graph.ctx.resume().catch(() => {});
  });
  (window as unknown as { __mbSound?: () => Graph | null }).__mbSound = () => graph;
}
