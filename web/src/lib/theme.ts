import { create } from 'zustand';
import { setNativeBars } from './native';

/**
 * Apparence : un mode (sombre, clair ou automatique) et une palette parmi dix.
 * Tout passe par des variables CSS posées sur <html> ; le choix est mémorisé sur l'appareil.
 */

export type Mode = 'dark' | 'light' | 'auto';

interface Palette {
  id: string;
  name: string;
  hue: number; // teinte des surfaces (0-360)
  satDark: number; // saturation des surfaces en mode sombre (%)
  satLight: number; // et en mode clair
  accentDark: string;
  accentLight: string;
  /** Surfaces exactes du mode sombre d'origine (pour garder l'aspect de la palette Ambre). */
  darkSurfaces?: { bg: string; panel: string; raised: string; raised2: string; text: string; muted: string; faint: string };
}

export const PALETTES: Palette[] = [
  { id: 'ambre', name: 'Ambre', hue: 34, satDark: 16, satLight: 32, accentDark: '#f2b134', accentLight: '#b36b00' },
  { id: 'emeraude', name: 'Émeraude', hue: 152, satDark: 18, satLight: 24, accentDark: '#2fd47a', accentLight: '#0c7f48' },
  { id: 'corail', name: 'Corail', hue: 12, satDark: 16, satLight: 30, accentDark: '#ff7a66', accentLight: '#c8361f' },
  { id: 'ocean', name: 'Océan', hue: 222, satDark: 26, satLight: 30, accentDark: '#5c9bff', accentLight: '#1f58d6' },
  { id: 'violet', name: 'Violet', hue: 258, satDark: 22, satLight: 30, accentDark: '#af92ff', accentLight: '#6140d4' },
  { id: 'rose', name: 'Rose', hue: 330, satDark: 20, satLight: 32, accentDark: '#ff66a9', accentLight: '#c21a6f' },
  { id: 'menthe', name: 'Menthe', hue: 176, satDark: 24, satLight: 28, accentDark: '#3eddc2', accentLight: '#07786a' },
  { id: 'citron', name: 'Citron', hue: 68, satDark: 18, satLight: 36, accentDark: '#d6eb4b', accentLight: '#5d6a00' },
  { id: 'glacier', name: 'Glacier', hue: 200, satDark: 20, satLight: 30, accentDark: '#86d4f5', accentLight: '#096a92' },
  { id: 'graphite', name: 'Graphite', hue: 220, satDark: 3, satLight: 5, accentDark: '#ededed', accentLight: '#1c1c1e' },
];

const KEY_MODE = 'mb.mode';
const KEY_PALETTE = 'mb.palette';
const KEY_VARS = 'mb.theme.vars';

// ---------------------------------------------------------------- couleurs

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Texte posé sur la couleur d'accent : blanc ou presque noir, selon le meilleur contraste. */
function inkOn(accent: string): string {
  return contrast(accent, '#ffffff') >= contrast(accent, '#14161a') ? '#ffffff' : '#14161a';
}

function rgb(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
}

export function buildVars(paletteId: string, resolved: 'dark' | 'light'): Record<string, string> {
  const p = PALETTES.find((x) => x.id === paletteId) ?? PALETTES[0]!;
  if (resolved === 'dark') {
    // Surfaces plus claires et teintées que du quasi-noir : la palette se voit partout.
    const sat = p.id === 'graphite' ? p.satDark : p.satDark + 8;
    const s = p.darkSurfaces ?? {
      bg: hslToHex(p.hue, sat, 9),
      panel: hslToHex(p.hue, sat, 13),
      raised: hslToHex(p.hue, sat - 1, 18),
      raised2: hslToHex(p.hue, sat - 2, 24),
      text: hslToHex(p.hue, Math.min(sat, 16) + 4, 95),
      muted: hslToHex(p.hue, 10, 73),
      faint: hslToHex(p.hue, 8, 56),
    };
    return {
      '--bg': s.bg, '--panel': s.panel, '--raised': s.raised, '--raised-2': s.raised2,
      '--line': 'rgba(255, 255, 255, 0.08)', '--line-strong': 'rgba(255, 255, 255, 0.18)',
      '--text': s.text, '--muted': s.muted, '--faint': s.faint,
      '--accent': p.accentDark, '--accent-ink': inkOn(p.accentDark), '--danger': '#ff7062',
      '--on-text': '#14161a',
      '--hover': 'rgba(255, 255, 255, 0.07)', '--hover-2': 'rgba(255, 255, 255, 0.11)', '--hover-3': 'rgba(255, 255, 255, 0.15)',
      '--rail': 'rgba(255, 255, 255, 0.2)',
      '--glass': `rgba(${rgb(s.panel)}, 0.86)`,
      '--page-shade': 'rgba(0, 0, 0, 0.2)',
      '--hero-mix': '100%',
      '--glow-mix': '26%',
    };
  }
  const bg = hslToHex(p.hue, p.satLight, 96.5);
  const panel = hslToHex(p.hue, p.satLight - 4, 99);
  return {
    '--bg': bg, '--panel': panel, '--raised': hslToHex(p.hue, p.satLight - 6, 93), '--raised-2': hslToHex(p.hue, p.satLight - 8, 88.5),
    '--line': 'rgba(0, 0, 0, 0.1)', '--line-strong': 'rgba(0, 0, 0, 0.2)',
    '--text': hslToHex(p.hue, Math.min(p.satLight, 25), 10), '--muted': hslToHex(p.hue, 10, 36), '--faint': hslToHex(p.hue, 8, 48),
    '--accent': p.accentLight, '--accent-ink': inkOn(p.accentLight), '--danger': '#d23a2a',
    '--on-text': '#ffffff',
    '--hover': 'rgba(0, 0, 0, 0.055)', '--hover-2': 'rgba(0, 0, 0, 0.09)', '--hover-3': 'rgba(0, 0, 0, 0.13)',
    '--rail': 'rgba(0, 0, 0, 0.18)',
    '--glass': `rgba(${rgb(panel)}, 0.88)`,
    '--page-shade': 'rgba(0, 0, 0, 0)',
    '--hero-mix': '30%',
    '--glow-mix': '17%',
  };
}

// ---------------------------------------------------------------- application

const systemQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : null;

export function resolveMode(mode: Mode): 'dark' | 'light' {
  if (mode === 'auto') return systemQuery()?.matches ? 'light' : 'dark';
  return mode;
}

export function applyTheme(mode: Mode, paletteId: string): void {
  const resolved = resolveMode(mode);
  const vars = buildVars(paletteId, resolved);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.mode = resolved;
  root.dataset.palette = paletteId;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg']!);
  setNativeBars(vars['--bg']!, resolved === 'light');
  try {
    // L'écran de démarrage (index.html) relit ceci avant même que l'application ne s'affiche.
    localStorage.setItem(KEY_VARS, JSON.stringify({ vars, mode: resolved, palette: paletteId }));
  } catch {
    // Stockage indisponible : la préférence reste valable pendant la session.
  }
}

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {
    // Stockage indisponible.
  }
  return fallback;
}

interface ThemeState {
  mode: Mode;
  palette: string;
  setMode: (m: Mode) => void;
  setPalette: (id: string) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: read<Mode>(KEY_MODE, ['dark', 'light', 'auto'], 'dark'),
  palette: read(KEY_PALETTE, PALETTES.map((p) => p.id), 'ambre'),
  setMode: (mode) => {
    try {
      localStorage.setItem(KEY_MODE, mode);
    } catch {
      // Voir plus haut.
    }
    set({ mode });
    applyTheme(mode, get().palette);
  },
  setPalette: (palette) => {
    try {
      localStorage.setItem(KEY_PALETTE, palette);
    } catch {
      // Voir plus haut.
    }
    set({ palette });
    applyTheme(get().mode, palette);
  },
}));

/** À appeler une fois au démarrage : applique le choix mémorisé et suit le réglage du téléphone en mode auto. */
export function initTheme(): void {
  const { mode, palette } = useTheme.getState();
  applyTheme(mode, palette);
  systemQuery()?.addEventListener?.('change', () => {
    const s = useTheme.getState();
    if (s.mode === 'auto') applyTheme(s.mode, s.palette);
  });
}

/** Les couleurs d'une palette pour l'aperçu dans les réglages. */
export function swatch(paletteId: string, resolved: 'dark' | 'light'): { bg: string; panel: string; accent: string; text: string } {
  const v = buildVars(paletteId, resolved);
  return { bg: v['--bg']!, panel: v['--raised']!, accent: v['--accent']!, text: v['--text']! };
}
