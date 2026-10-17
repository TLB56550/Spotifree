import { useSyncExternalStore } from 'react';

/** Téléphones, et tablettes tactiles de petite taille (y compris téléphone en mode paysage). */
export const MOBILE_QUERY = '(max-width: 760px), (pointer: coarse) and (max-width: 1000px)';

const mql: MediaQueryList | null = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_QUERY) : null;

function subscribe(callback: () => void): () => void {
  mql?.addEventListener('change', callback);
  return () => mql?.removeEventListener('change', callback);
}

export const isMobileNow = (): boolean => mql?.matches ?? false;

/** Vrai quand l'interface tactile (barre d'onglets, feuilles du bas) est utilisée. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileNow, () => false);
}

/** Vrai si l'appareil a une vraie souris (le survol existe). */
export const canHover = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches;
