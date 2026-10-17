/**
 * Pont avec l'application Android (« Spotifree »), qui affiche cette interface dans une WebView.
 * Dans un navigateur ordinaire, rien de tout ça n'existe et ces fonctions ne font rien.
 */
interface AndroidBridge {
  update(title: string, artist: string, album: string, artwork: string, playing: boolean, positionMs: number, durationMs: number): void;
  stop(): void;
  changeServer(): void;
  setBars?(color: string, light: boolean): void;
}

function bridge(): AndroidBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { SpotifreeAndroid?: AndroidBridge }).SpotifreeAndroid;
  return b && typeof b.update === 'function' ? b : null;
}

export const isNativeApp = (): boolean => bridge() !== null;

export function changeNativeServer(): void {
  bridge()?.changeServer();
}

export interface NativePlayback {
  title: string;
  artist: string;
  album: string;
  artwork: string;
  playing: boolean;
  position: number; // secondes
  duration: number; // secondes
}

export function sendNativePlayback(p: NativePlayback | null): void {
  const b = bridge();
  if (!b) return;
  try {
    if (!p) b.stop();
    else b.update(p.title, p.artist, p.album, p.artwork, p.playing, Math.round(p.position * 1000), Math.round(p.duration * 1000));
  } catch {
    // Le pont n'est plus joignable (application en cours de fermeture) : rien à faire.
  }
}

/** L'application Android renvoie ici les touches de la notification (lecture, titre suivant…). */
export function registerNativeCommands(run: (command: string, value?: number) => void): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __mbNative?: unknown }).__mbNative = {
    command(name: unknown, value?: unknown) {
      run(String(name), typeof value === 'number' ? value : undefined);
    },
  };
}

/** Colore la barre d'état et la barre de navigation d'Android comme le thème de l'application. */
export function setNativeBars(color: string, light: boolean): void {
  try {
    bridge()?.setBars?.(color, light);
  } catch {
    // Ancienne version de l'application : les barres gardent leur couleur.
  }
}
