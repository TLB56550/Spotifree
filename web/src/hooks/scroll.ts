import { createContext, useContext, type RefObject } from 'react';

/** Le panneau central défile : les listes virtualisées en ont besoin. */
export const ScrollContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function useScrollParent(): RefObject<HTMLElement | null> {
  const ref = useContext(ScrollContext);
  if (!ref) throw new Error('ScrollContext manquant');
  return ref;
}
