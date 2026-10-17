/** Fonctions pures qui servent à gérer l'ordre de lecture. */

export function identityOrder(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Ordre aléatoire de 0..n-1. Si `first` est donné, cet élément passe en tête. */
export function shuffledOrder(n: number, first?: number, rnd: () => number = Math.random): number[] {
  const rest = identityOrder(n).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return first !== undefined && first >= 0 && first < n ? [first, ...rest] : rest;
}

/** Copie du tableau avec l'élément `from` déplacé vers la position `to`. */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const copy = arr.slice();
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length || from === to) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
}
